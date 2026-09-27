import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { runCommand } from '../../src/sandbox.js';
import { cleanup, repository, temp, type Repository } from './helpers.js';

/**
 * What the sandbox promises beyond a job that ends on its own, which
 * edges.test.ts covers: a worktree removed when the process is interrupted or
 * exits mid-job (ADR-0003), and a probe's command run as CI runs it, its
 * output bounded, stopped whole at its timeout (ADR-0007).
 */

afterAll(cleanup);

const EVENTS = ['exit', 'SIGINT', 'SIGTERM', 'SIGHUP'] as const;
type ProcessEvent = (typeof EVENTS)[number];
type Handler = (...args: unknown[]) => void;

// The process as the emitter it is, whose listeners any event name reads.
const emitter: NodeJS.EventEmitter = process;
const snapshots: Map<ProcessEvent, Function[]>[] = [];

afterEach(() => {
  // The handlers a test's module installed stay on this worker's process
  // otherwise, and a real signal would find them.
  for (const before of snapshots.splice(0)) {
    for (const event of EVENTS) {
      for (const listener of emitter.listeners(event)) {
        if (!(before.get(event) ?? []).includes(listener)) emitter.removeListener(event, listener as Handler);
      }
    }
  }
  vi.restoreAllMocks();
});

/**
 * The sandbox as a process loads it, with the handlers it has installed on
 * the process so far. The module installs them once, the first time it makes
 * a worktree, so each test loads a copy of its own: one an earlier test or
 * file loaded would already have.
 */
async function freshSandbox(): Promise<{ withWorktree: typeof import('../../src/sandbox.js').withWorktree; handlers: (event: ProcessEvent) => Handler[] }> {
  vi.resetModules();
  const before = new Map(EVENTS.map((event) => [event, emitter.listeners(event)] as const));
  snapshots.push(before);
  const { withWorktree } = await import('../../src/sandbox.js');
  const handlers = (event: ProcessEvent): Handler[] => emitter.listeners(event).filter((listener) => !(before.get(event) ?? []).includes(listener)) as Handler[];
  return { withWorktree, handlers };
}

function only(handlers: Handler[], event: ProcessEvent): Handler {
  expect(handlers, `the handler for ${event}`).toHaveLength(1);
  return handlers[0] as Handler;
}

function worktrees(repo: Repository): string[] {
  return repo.git('worktree', 'list', '--porcelain').split('\n').filter((line) => line.startsWith('worktree '));
}

describe('a worktree, whatever ends its job', () => {
  it('is removed when the process is interrupted mid-job, and the process exits as interrupted', async () => {
    const { withWorktree, handlers } = await freshSandbox();
    const repo = repository({ 'a.txt': 'a\n' });
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as () => never);
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
      await withWorktree(repo.root, 'HEAD', async (directory) => {
        only(handlers(signal), signal)(signal);
        expect(existsSync(directory), signal).toBe(false);
        expect(worktrees(repo), signal).toHaveLength(1);
      });
    }
    // 128 and the signal's number, as a shell reports a process a signal
    // ended: SIGINT 2, SIGTERM 15.
    expect(exit.mock.calls.slice(0, 2)).toEqual([[130], [143]]);
    expect(exit).toHaveBeenCalledTimes(3);
  });

  it('is removed when the process exits mid-job', async () => {
    const { withWorktree, handlers } = await freshSandbox();
    const repo = repository({ 'a.txt': 'a\n' });
    await withWorktree(repo.root, 'HEAD', async (directory) => {
      only(handlers('exit'), 'exit')(0);
      expect(existsSync(directory)).toBe(false);
      expect(worktrees(repo)).toHaveLength(1);
    });
  });

  it('is removed, and forgotten by git, when its job broke it so that git will not remove it', async () => {
    // A job may leave its worktree in any state. Without its .git file, git
    // refuses to remove it, and says so.
    const { withWorktree, handlers } = await freshSandbox();
    const repo = repository({ 'a.txt': 'a\n' });
    await withWorktree(repo.root, 'HEAD', async (directory) => {
      rmSync(join(directory, '.git'));
      only(handlers('exit'), 'exit')(0);
      expect(existsSync(directory)).toBe(false);
      expect(worktrees(repo)).toHaveLength(1);
    });
  });

  it('is watched by one set of handlers, however many worktrees the process makes', async () => {
    const { withWorktree, handlers } = await freshSandbox();
    const repo = repository({ 'a.txt': 'a\n' });
    for (let job = 0; job < 3; job += 1) await withWorktree(repo.root, 'HEAD', async () => job);
    for (const event of EVENTS) expect(handlers(event), event).toHaveLength(1);
  });

  it('once its job is done, leaves the repository alone at exit, even a worktree git has lost', async () => {
    // A worktree on a drive that is not mounted is, to git, one to prune; it
    // is the person's to prune, not the harness's.
    const { withWorktree, handlers } = await freshSandbox();
    const repo = repository({ 'a.txt': 'a\n' });
    const lost = join(temp(), 'lost');
    repo.git('worktree', 'add', '-q', '--detach', lost, 'HEAD');
    rmSync(lost, { recursive: true, force: true });
    await withWorktree(repo.root, 'HEAD', async () => 1);
    only(handlers('exit'), 'exit')(0);
    expect(worktrees(repo)).toHaveLength(2);
  });
});

describe('a command', () => {
  it('runs as CI runs the repository\'s own scripts, with CI set and the rest of the environment passed on', async () => {
    process.env['SPEC_HARNESS_SANDBOX_TEST'] = 'passed-on';
    try {
      const run = await runCommand('node -e "console.log(process.env.CI, process.env.SPEC_HARNESS_SANDBOX_TEST)"', temp(), 30);
      expect(run.exitCode).toBe(0);
      expect(run.output.trim()).toBe('1 passed-on');
    } finally {
      delete process.env['SPEC_HARNESS_SANDBOX_TEST'];
    }
  });

  it('keeps its output up to 4 MiB, enough to find a signature in, and drops what comes after', async () => {
    // The last byte waits until the rest has left the command, so it arrives
    // on its own, after exactly 4 MiB.
    const run = await runCommand(
      'node -e "process.stdout.write(\'a\'.repeat(4 * 1024 * 1024), () => setTimeout(() => process.stdout.write(\'b\'), 1000))"',
      temp(),
      60,
    );
    expect(run.exitCode).toBe(0);
    expect(run.output.length).toBe(4 * 1024 * 1024);
    expect(run.output.endsWith('a')).toBe(true);
  });

  it('is stopped at its timeout with everything it started, even what ignores a request to stop', async () => {
    // With `&&` the shell waits to run the rest, so node is the shell's child
    // rather than the shell itself, and node ignores SIGTERM: stopping the
    // shell alone, or asking politely, leaves node holding the output open
    // for a minute.
    const started = Date.now();
    const run = await runCommand('node -e "process.on(\'SIGTERM\', () => {}); setTimeout(() => {}, 60000)" && echo never', temp(), 1);
    expect(run.exitCode).toBeNull();
    expect(run.output).not.toContain('never');
    expect(Date.now() - started).toBeLessThan(30_000);
  });

  it('that cannot be started answers 127, as a shell does, with the reason as its output', async () => {
    const run = await runCommand('node -e "1"', join(temp(), 'missing'), 30);
    expect(run.exitCode).toBe(127);
    expect(run.output).toMatch(/ENOENT\n$/);
  });

  it('leaves no timer behind once it ends, so nothing is stopped later under its id', async () => {
    // The id of a process that has ended can be given to another; a timer
    // left running would stop that one at the timeout.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const run = await runCommand('node -e "process.exit(0)"', temp(), 600);
      expect(run.exitCode).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
