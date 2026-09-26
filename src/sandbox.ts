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

import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { addWorktree, removeWorktree } from './git.js';

const live = new Map<string, string>();
let installed = false;

/** Removes every live worktree synchronously: the only kind of work an exit handler may do. */
function sweep(): void {
  for (const [directory, repository] of live) {
    try {
      execFileSync('git', ['worktree', 'remove', '--force', directory], { cwd: repository, stdio: 'ignore', windowsHide: true });
    } catch {
      // Removed below regardless; `git worktree prune` then forgets it.
    }
    rmSync(directory, { recursive: true, force: true });
    try {
      execFileSync('git', ['worktree', 'prune'], { cwd: repository, stdio: 'ignore', windowsHide: true });
    } catch {
      // Nothing more can be done from an exit handler.
    }
  }
  live.clear();
}

function install(): void {
  if (installed) return;
  installed = true;
  process.once('exit', sweep);
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.once(signal, () => {
      sweep();
      process.exit(signal === 'SIGINT' ? 130 : 143);
    });
  }
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
    await removeWorktree(directory, repository);
    rmSync(directory, { recursive: true, force: true });
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
 * with everything it started when it outlives `timeoutSeconds`.
 *
 * Through the shell, on purpose: a probe's command is a line from the
 * repository's own brief - `npm test -- x` - which the person approved with
 * the brief, exactly as CI runs the repository's own scripts. Nothing from
 * outside the repository reaches it.
 */
export function runCommand(line: string, cwd: string, timeoutSeconds: number): Promise<CommandRun> {
  return new Promise((resolve) => {
    const child = spawn(line, { cwd, shell: true, windowsHide: true, detached: process.platform !== 'win32', env: { ...process.env, CI: '1' } });
    let output = '';
    const keep = (chunk: Buffer): void => {
      // Enough to find a signature in; a runaway log is not kept whole.
      if (output.length < 4 * 1024 * 1024) output += chunk.toString('utf8');
    };
    child.stdout?.on('data', keep);
    child.stderr?.on('data', keep);
    let stopped = false;
    const timer = setTimeout(() => {
      stopped = true;
      if (child.pid === undefined) return;
      try {
        if (process.platform === 'win32') execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
        else process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    }, timeoutSeconds * 1000);
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ exitCode: 127, output: `${output}${error.message}\n` });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ exitCode: stopped ? null : (code ?? 1), output });
    });
  });
}
