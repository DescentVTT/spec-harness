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
 *
 * Git forgets a worktree whatever becomes of its directory. A directory that
 * cannot be deleted, as on Windows while something a command started still
 * runs in it, costs the job nothing: its answer stands, the directory is
 * tried again as the process exits, and one still there then is named on the
 * standard error.
 */

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { constants, tmpdir } from 'node:os';
import { join } from 'node:path';

import { addWorktree, removeWorktree } from './git.js';
import { probeEnvironment } from './probe.js';

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
 * Whether a process has this id now. Signal 0 asks and sends nothing, and any
 * answer but "no such process" says one has it: another user's process
 * answers that it may not be signalled.
 */
function taken(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

/**
 * Stops a command with what can be reached of what it started, forced:
 * SIGKILL to its process group on Linux and macOS, taskkill over its tree on
 * Windows. A process that left the group is not in it, and taskkill follows
 * a tree from parent to child while each parent runs: one whose parent has
 * ended is found under no root. Such a process runs on (ADR-0003).
 *
 * Both name the command by its id, and the id is the command's only while
 * something holds it (ADR-0003). Node holds the command's shell until it has
 * seen the shell end, and until then the system gives the id to nothing else.
 * After that the id is free on Windows, where a process started seconds later
 * can be given it: taskkill would stop that process with all it started, and
 * could not have found what the command left anyway, since it finds no tree
 * under a root that has ended. So a command whose shell has ended is not
 * stopped there. On Linux and macOS the id names the command's process group
 * as well, and stays out of use while the group has a member: what the shell
 * left in its group is still stopped, unless a process has the id now, which
 * says the group emptied and the id was given out again.
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
  // Node sets one of the two when it sees the shell end, and lets go of the
  // shell then. Windows reports no signal: there the second is set only once
  // the fallback below has stopped the shell, on the path no test takes.
  const held = child.exitCode === null && child.signalCode === null;
  // Windows is not asked whether a process has the id: one could be given it
  // between the answer and taskkill. Elsewhere `win32` is false already, so
  // the mutants that make it false are equivalent there.
  if (!held && (process.platform === 'win32' || taken(child.pid))) return;
  try {
    // False already on Linux and macOS, so the mutants that make it false
    // are equivalent there. On Windows the tests fail without taskkill:
    // stopping the shell alone leaves node holding the output. True already
    // on Windows, so the mutant that makes it true is equivalent there;
    // elsewhere there is no taskkill, and the shell alone is stopped.
    if (process.platform === 'win32') execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    else process.kill(-child.pid, 'SIGKILL');
  } catch {
    // Reached when the group is already gone, and the command's shell with
    // it, as when the command left something outside the group holding its
    // output; on Windows when the shell has only just ended, which taskkill
    // sees before Node does; and there when taskkill cannot be run, where
    // stopping the shell is what is left. No test takes that last path.
    // `kill` goes through Node's own hold on the shell, and does nothing
    // once that is gone.
    child.kill('SIGKILL');
  }
}

/**
 * Deletes a worktree's directory, trying again for up to `SETTLE_MS` while
 * something holds it, and answers `null` once it is gone, or else why it is
 * not. On Windows a command just stopped lets go of its directory a moment
 * after taskkill returns, and an exit handler, which runs synchronously, has
 * no other way to wait; elsewhere a directory in use is deleted all the same.
 */
function discard(directory: string): Error | null {
  const deadline = Date.now() + SETTLE_MS;
  for (;;) {
    try {
      rmSync(directory, { recursive: true, force: true });
      return null;
    } catch (error) {
      // `>=` would differ only in the millisecond the deadline falls on, so
      // that mutant is equivalent.
      if (Date.now() > deadline) return error as Error;
      // The pause only spares the processor between attempts: without it
      // the directory is deleted, or given up on, at the same moment, so
      // that mutant is equivalent.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
}

/**
 * Has git remove the worktree at `directory` with its record of it, as
 * `removeWorktree` does and synchronously, and answers whether git did.
 */
function forget(directory: string, repository: string): boolean {
  try {
    execFileSync('git', ['worktree', 'remove', '--force', directory], { cwd: repository, stdio: 'ignore', windowsHide: true });
    // Asked again about a worktree it has forgotten, git changes nothing, so
    // the mutant that answers false here is equivalent.
    return true;
  } catch {
    // Git refused a worktree its job broke, could not delete all of the
    // directory, holds nothing of it any more, or cannot be run. The answer
    // is read with `!` and nowhere else, so the mutant that answers nothing
    // here is equivalent.
    return false;
  }
}

/**
 * Stops every command still running, then removes every live worktree:
 * synchronously, the only kind of work an exit handler may do, so at exit
 * nothing waits for the commands to end but `discard`'s retries. A directory
 * that outlasts those is named on the standard error and left: nothing
 * thrown here could be caught, and the next worktree is still to remove.
 */
function sweep(): void {
  for (const child of running) stop(child);
  for (const [directory, repository] of live) {
    // In the order a job's end takes, for the reasons `withWorktree` gives.
    const forgotten = forget(directory, repository);
    const kept = discard(directory);
    if (kept !== null) process.stderr.write(`spec-harness: the temporary worktree at ${directory} could not be deleted and is left there: ${kept.message}\n`);
    // The mutant that always asks again is equivalent, as in `forget`.
    else if (!forgotten) forget(directory, repository);
  }
  // A signal handler ends in an exit, which sweeps again: over worktrees
  // already gone and forgotten, where keeping them would change nothing, and
  // over one that could not be deleted, which would be named a second time.
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
  //
  // SIGBREAK is Windows' own: Ctrl+Break, which GitHub's runner sends there,
  // after Ctrl+C, where it sends SIGTERM elsewhere. Unheard, it ends the
  // process before any 'exit' handler runs, and the commands run on.
  // Elsewhere there is no such signal and nothing calls its listener, so
  // its mutants are equivalent there.
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'] as const) process.on(signal, interrupted);
}

/**
 * Runs `work` in a detached worktree of `repository` at `revision`, and
 * removes the worktree after.
 *
 * Git removes it first, while it is as the job left it: git then forgets the
 * worktree whether or not all of its directory can be deleted. What git left
 * of the directory is deleted next, which is all of it when the job broke the
 * worktree, since git refuses one whose `.git` file is gone. Only then is
 * git asked again, once the directory is gone, when it forgets what it finds
 * missing (`removeWorktree`).
 *
 * A directory that cannot be deleted stays on the list for the exit to try
 * again, and does not take the job's answer with it.
 */
export async function withWorktree<T>(repository: string, revision: string, work: (directory: string) => Promise<T>): Promise<T> {
  install();
  const directory = mkdtempSync(join(tmpdir(), 'spec-harness-'));
  live.set(directory, repository);
  try {
    await addWorktree(directory, revision, repository);
    return await work(directory);
  } finally {
    const forgotten = await removeWorktree(directory, repository);
    if (discard(directory) === null) {
      // Asked again about a worktree it has forgotten, git changes nothing,
      // so the mutant that always asks again is equivalent.
      if (!forgotten) await removeWorktree(directory, repository);
      live.delete(directory);
    }
  }
}

export interface CommandRun {
  /** `null` when the command was stopped at its timeout. */
  readonly exitCode: number | null;
  /** What the command had printed by the time it was answered. */
  readonly output: string;
  /**
   * Set on a command that was stopped at its timeout and answered with its
   * output still open: something it started holds the output where the stop
   * did not reach it, and runs on (ADR-0003).
   */
  readonly outputHeld?: true;
}

/**
 * Runs a command line in a directory, output and errors interleaved, until
 * its output closes. A command that outlives `timeoutSeconds` is stopped
 * with what `stop` reaches of it, as is one still running when the process
 * is interrupted or exits. Once the process is interrupted it never answers:
 * the job waiting on it would otherwise carry on in a worktree being removed.
 *
 * The timeout bounds the wait as well as the command. What the stop reached
 * lets go of the output in the time the system takes to end it, and the
 * command answers then. What still holds the output `SETTLE_MS` later is
 * what `stop` does not reach, and no wait would end it: the sandbox lets go
 * of the output instead, and answers with what was printed and with
 * `outputHeld`. Letting go is what the end of this process would do to
 * whatever holds the output, only sooner, and without it the open output
 * keeps this process from ending once its work is done.
 *
 * Through the shell, on purpose: a probe's command is a line from the
 * repository's own brief - `npm test -- x` - which the person approved with
 * the brief, exactly as CI runs the repository's own scripts. Nothing from
 * outside the repository reaches it.
 *
 * The line is run as it is written. Its environment is the person's own as
 * `probeEnvironment` hands it on: `CI` set, and npm told to fetch nothing for
 * a command where neither that environment nor the line says what it may
 * fetch (ADR-0007).
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
    //
    // It is given no input: nobody is there to type any, and a pipe that is
    // never written to and never closed kept a command that reads its input
    // waiting until the timeout stopped it.
    const child = spawn(line, {
      cwd,
      shell: true,
      windowsHide: true,
      detached: process.platform !== 'win32',
      env: probeEnvironment(process.env),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
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
    const answer = (run: CommandRun): void => {
      if (!ending) resolve(run);
    };
    let stopped = false;
    let settling: NodeJS.Timeout | undefined;
    const timer = setTimeout(() => {
      stopped = true;
      stop(child);
      settling = setTimeout(() => {
        // With both let go, 'close' follows as soon as Node has seen the
        // shell end, and takes the command off the list of those running.
        // The streams exist, as above, so the mutants of `?.` are equivalent.
        child.stdout?.destroy();
        child.stderr?.destroy();
        answer({ exitCode: null, output, outputHeld: true });
      }, SETTLE_MS);
    }, timeoutSeconds * 1000);
    child.on('error', (error) => {
      // 'close' follows the error of a spawn that failed, and clears the
      // timer too, so the mutant that drops this call is equivalent.
      clearTimeout(timer);
      resolve({ exitCode: 127, output: `${output}${error.message}\n` });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      clearTimeout(settling);
      running.delete(child);
      // The second answer of a command already answered as held does nothing.
      answer({ exitCode: stopped ? null : (code ?? 1), output });
    });
  });
}
