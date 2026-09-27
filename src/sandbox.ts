/**
 * Temporary worktrees: somewhere to run a command at a commit without
 * touching the person's own checkout.
 *
 * The family's tools read git and never write it (spec-core ADR-0005). The one
 * exception is this: a detached worktree under the system's temporary
 * directory, added for one job and removed after it, whether the job
 * succeeded, threw, or the process was interrupted (ADR-0003). The person's
 * branch, index, stash and working files are never touched; a failed round is
 * discarded by discarding its worktree, never by resetting theirs.
 */

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { constants, tmpdir } from 'node:os';
import { join } from 'node:path';

import { addWorktree, removeWorktree } from './git.js';

const live = new Map<string, string>();
const running = new Set<ChildProcess>();
let installed = false;
/** Set once the process is interrupted: from then on a command's end is never answered. */
let ending = false;

/**
 * How long the sandbox waits for the commands it stopped to let go of their
 * output and their directory. They were stopped forced, so this is only the
 * time the system takes to end them; whatever still holds either after it has
 * left the tree, and no wait would end it.
 */
const SETTLE_MS = 3_000;

/**
 * Stops a command with everything it started, forced: SIGKILL to its process
 * group on Linux and macOS, taskkill over its tree on Windows.
 *
 * `windowsHide` here and below only keeps a console window from opening on
 * Windows, which nothing reads, so its mutants are equivalent.
 */
function stop(child: ChildProcess): void {
  // No pid means the spawn failed and nothing runs. Past the tick it failed
  // in, the kill below throws on the missing id and the fallback finds no
  // process, so the mutant that lets it through is equivalent; within that
  // tick nothing here stops a command.
  if (child.pid === undefined) return;
  try {
    // False already on Linux and macOS, so the mutants that make it false
    // are equivalent there. On Windows the tests fail without taskkill:
    // stopping the shell alone leaves node holding the output.
    if (process.platform === 'win32') execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    else process.kill(-child.pid, 'SIGKILL');
  } catch {
    // Reached when the group or the tree is already gone, and the command's
    // shell with it, as when the command left something holding its output;
    // and on Windows when taskkill cannot be run, where stopping the shell is
    // what is left. No test takes that second path.
    child.kill('SIGKILL');
  }
}

/**
 * Deletes a worktree's directory, trying again for up to `SETTLE_MS` while
 * something holds it. On Windows a command just stopped lets go of its
 * directory a moment after taskkill returns, and an exit handler, which runs
 * synchronously, has no other way to wait; elsewhere a directory in use is
 * deleted all the same.
 */
function discard(directory: string): void {
  const deadline = Date.now() + SETTLE_MS;
  for (;;) {
    try {
      rmSync(directory, { recursive: true, force: true });
      return;
    } catch (error) {
      // `>=` would differ only in the millisecond the deadline falls on, so
      // that mutant is equivalent.
      if (Date.now() > deadline) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
}

/**
 * Stops every command still running, then removes every live worktree:
 * synchronously, the only kind of work an exit handler may do, so at exit
 * nothing waits for the commands to end but `discard`'s retries.
 */
function sweep(): void {
  for (const child of running) stop(child);
  for (const [directory, repository] of live) {
    // Deleted first, as at the end of a job, so that git forgets it however
    // the job left it (`removeWorktree` says why).
    discard(directory);
    try {
      execFileSync('git', ['worktree', 'remove', '--force', directory], { cwd: repository, stdio: 'ignore', windowsHide: true });
    } catch {
      // Git holds nothing of it any more, or cannot be run; nothing more can
      // be done from an exit handler.
    }
  }
  // A signal handler ends in an exit, which sweeps again over worktrees
  // already gone and forgotten, so a mutant that keeps them changes nothing.
  live.clear();
}

/**
 * Stops every running command with its tree, waits a bounded time for them to
 * let go of their output, removes the worktrees, and exits as a shell reports
 * a process the signal ended: 128 and the signal's number, the same on every
 * platform Node runs on. The commands lead process groups of their own on
 * Linux and macOS, so the terminal's signal never reached them.
 */
async function interrupted(signal: NodeJS.Signals): Promise<void> {
  ending = true;
  const stopping = [...running];
  for (const child of stopping) stop(child);
  await Promise.race([
    Promise.all(stopping.map((child) => new Promise((resolve) => child.once('close', resolve)))),
    new Promise((resolve) => setTimeout(resolve, SETTLE_MS)),
  ]);
  sweep();
  process.exit(128 + constants.signals[signal]);
}

function install(): void {
  if (installed) return;
  installed = true;
  process.once('exit', sweep);
  // `on`, not `once`: a second signal while the first waits would otherwise
  // meet Node's default, which ends the process before any 'exit' handler
  // runs, with the worktrees still in place. It runs the same steps again,
  // and the first to finish exits.
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(signal, interrupted);
}

/** Runs `work` in a detached worktree of `repository` at `revision`, and removes the worktree after. */
export async function withWorktree<T>(repository: string, revision: string, work: (directory: string) => Promise<T>): Promise<T> {
  install();
  const directory = mkdtempSync(join(tmpdir(), 'spec-harness-'));
  live.set(directory, repository);
  try {
    await addWorktree(directory, revision, repository);
    return await work(directory);
  } finally {
    discard(directory);
    await removeWorktree(directory, repository);
    live.delete(directory);
  }
}

export interface CommandRun {
  /** `null` when the command was stopped at its timeout. */
  readonly exitCode: number | null;
  readonly output: string;
}

/**
 * Runs a command line in a directory, output and errors interleaved, stopped
 * with everything it started when it outlives `timeoutSeconds` or the process
 * is interrupted or exits. Once the process is interrupted it never answers:
 * the job waiting on it would otherwise carry on in a worktree being removed.
 *
 * Through the shell, on purpose: a probe's command is a line from the
 * repository's own brief - `npm test -- x` - which the person approved with
 * the brief, exactly as CI runs the repository's own scripts. Nothing from
 * outside the repository reaches it.
 */
export function runCommand(line: string, cwd: string, timeoutSeconds: number): Promise<CommandRun> {
  install();
  return new Promise((resolve) => {
    // Elsewhere the command leads a process group of its own, so the timeout
    // can stop the group. Windows has none to signal, and taskkill follows
    // the tree instead; a command detached there loses its output, which the
    // tests catch on Windows. Everywhere else `detached` is true already, so
    // the mutants that make it true are equivalent there, as are
    // `windowsHide`'s.
    const child = spawn(line, { cwd, shell: true, windowsHide: true, detached: process.platform !== 'win32', env: { ...process.env, CI: '1' } });
    running.add(child);
    let output = '';
    const keep = (chunk: Buffer): void => {
      // Enough to find a signature in; a runaway log is not kept whole.
      if (output.length < 4 * 1024 * 1024) output += chunk.toString('utf8');
    };
    // Both streams are piped, so both exist: `?.` only satisfies the type,
    // and its mutants are equivalent.
    child.stdout?.on('data', keep);
    child.stderr?.on('data', keep);
    let stopped = false;
    const timer = setTimeout(() => {
      stopped = true;
      stop(child);
    }, timeoutSeconds * 1000);
    child.on('error', (error) => {
      // 'close' follows the error of a spawn that failed, and clears the
      // timer too, so the mutant that drops this call is equivalent.
      clearTimeout(timer);
      resolve({ exitCode: 127, output: `${output}${error.message}\n` });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      running.delete(child);
      if (!ending) resolve({ exitCode: stopped ? null : (code ?? 1), output });
    });
  });
}
