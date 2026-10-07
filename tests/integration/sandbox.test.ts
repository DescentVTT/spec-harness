import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { runCommand } from '../../src/sandbox.js';
import { brief, BRIEF_FILE, cleanup, repository, spawnBin, temp, type Repository } from './helpers.js';

/**
 * What the sandbox promises beyond a job that ends on its own, which
 * edges.test.ts covers: a worktree removed when the process is interrupted or
 * exits mid-job, and every command still running in it stopped first, with
 * everything it started; a worktree git forgets, and a job whose answer
 * stands, when the directory cannot be deleted (ADR-0003); and a probe's
 * command run as CI runs it, its output bounded, stopped whole at its timeout
 * (ADR-0007).
 */

afterAll(cleanup);

const EVENTS = ['exit', 'SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'] as const;
type ProcessEvent = (typeof EVENTS)[number];
type Handler = (...args: unknown[]) => void;

// The process as the emitter it is, whose listeners any event name reads. The
// tests call its raw listeners: one installed with `once` then removes itself
// as it runs, as it does when the event is emitted.
const emitter: NodeJS.EventEmitter = process;
const snapshots: Map<ProcessEvent, Function[]>[] = [];
// Processes the tests' commands started, stopped after each test whatever it
// left running: a test that fails leaves them behind otherwise.
const strays: number[] = [];

afterEach(() => {
  for (const pid of strays.splice(0)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Already gone, as it is when the test passed.
    }
  }
  // The handlers a test's module installed stay on this worker's process
  // otherwise, and a real signal would find them.
  for (const before of snapshots.splice(0)) {
    for (const event of EVENTS) {
      for (const listener of emitter.rawListeners(event)) {
        if (!(before.get(event) ?? []).includes(listener)) emitter.removeListener(event, listener as Handler);
      }
    }
  }
  vi.restoreAllMocks();
});

type Sandbox = typeof import('../../src/sandbox.js');

/**
 * The sandbox as a process loads it, with the handlers it has installed on
 * the process so far. The module installs them once, the first time it makes
 * a worktree or runs a command, so each test loads a copy of its own: one an
 * earlier test or file loaded would already have.
 */
async function freshSandbox(): Promise<{ withWorktree: Sandbox['withWorktree']; runCommand: Sandbox['runCommand']; handlers: (event: ProcessEvent) => Handler[] }> {
  vi.resetModules();
  const before = new Map(EVENTS.map((event) => [event, emitter.rawListeners(event)] as const));
  snapshots.push(before);
  const { withWorktree, runCommand: run } = await import('../../src/sandbox.js');
  const handlers = (event: ProcessEvent): Handler[] => emitter.rawListeners(event).filter((listener) => !(before.get(event) ?? []).includes(listener)) as Handler[];
  return { withWorktree, runCommand: run, handlers };
}

function only(handlers: Handler[], event: ProcessEvent): Handler {
  expect(handlers, `the handler for ${event}`).toHaveLength(1);
  return handlers[0] as Handler;
}

function worktrees(repo: Repository): string[] {
  return repo.git('worktree', 'list', '--porcelain').split('\n').filter((line) => line.startsWith('worktree '));
}

interface Exit {
  readonly code: number;
  /** When the process would have exited, by `Date.now()`. */
  readonly at: number;
}

/** Stubs `process.exit`, and answers the first exit the process makes. */
function stubExit(): Promise<Exit> {
  return new Promise((resolve) => {
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => resolve({ code: code ?? 0, at: Date.now() })) as () => never);
  });
}

function within<T>(promise: Promise<T>, seconds: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no ${what} within ${seconds}s`)), seconds * 1000);
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

/** Calls an installed signal handler as the signal would, and answers how the process exits. */
async function interrupt(handler: Handler, signal: NodeJS.Signals): Promise<Exit> {
  const exited = stubExit();
  const returned = Promise.resolve(handler(signal));
  return within(Promise.race([exited, returned.then(() => exited)]), 60, `exit after ${signal}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Whether a process is running: signal 0 asks without sending anything. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function until(done: () => boolean, what: string, seconds: number): Promise<void> {
  const deadline = Date.now() + seconds * 1000;
  while (!done()) {
    if (Date.now() > deadline) throw new Error(`still waiting for ${what} after ${seconds}s`);
    await sleep(50);
  }
}

/**
 * A command line running a script of the test's own, which is handed `file`
 * to write process ids to. A script, rather than `node -e`, because cmd.exe
 * and sh quote a line inside a line differently. Every process the scripts
 * start ends on its own after ten minutes, so none that a stopped test run
 * left behind runs on.
 */
function script(name: string, lines: readonly string[], file: string): string {
  const path = join(temp(), name);
  writeFileSync(path, `${lines.join('\n')}\n`);
  return `node "${path}" "${file}"`;
}

// Written whole under another name and then renamed, so a test never reads
// half of it.
const WRITE_IDS = "const { renameSync, writeFileSync } = require('node:fs'); const write = (ids) => { writeFileSync(`${process.argv[2]}.part`, ids.join(' ')); renameSync(`${process.argv[2]}.part`, process.argv[2]); };";

/**
 * A command whose child starts a grandchild that ignores SIGTERM, and writes
 * the grandchild's id and its own. On Windows the grandchild is detached from
 * its parent's job object, which would otherwise end it with its parent:
 * only taskkill following the tree stops it. On Linux and macOS it stays in
 * the command's process group, which is what is signalled.
 */
function tree(file: string): string {
  return script(
    'tree.cjs',
    [
      WRITE_IDS,
      "const { spawn } = require('node:child_process');",
      "const grandchild = spawn(process.execPath, ['-e', \"process.on('SIGTERM', () => {}); setTimeout(() => {}, 600000)\"], { stdio: 'inherit', detached: process.platform === 'win32', windowsHide: true });",
      'write([grandchild.pid, process.pid]);',
      'setTimeout(() => {}, 600000);',
    ],
    file,
  );
}

/**
 * A command that leaves behind a process holding its output and ends: the
 * holder, in a process group of its own and with its parent gone, is out of
 * reach of both the group signal and taskkill's tree. It writes the holder's
 * id and its own.
 */
function escaped(file: string): string {
  return script(
    'escaped.cjs',
    [
      WRITE_IDS,
      "const { spawn } = require('node:child_process');",
      "const holder = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 600000)'], { stdio: 'inherit', detached: true, windowsHide: true });",
      'holder.unref();',
      'write([holder.pid, process.pid]);',
    ],
    file,
  );
}

/** The ids a command's script wrote to `file`, once it has; each is stopped after the test. */
async function ids(file: string): Promise<number[]> {
  let found: number[] = [];
  await until(
    () => {
      if (!existsSync(file)) return false;
      found = readFileSync(file, 'utf8').split(' ').map(Number);
      return true;
    },
    `the ids in ${file}`,
    120,
  );
  strays.push(...found);
  return found;
}

/**
 * The directory of a worktree whose job never ends, as a job does not when
 * its process exits or is interrupted. Its own removal at the end would run
 * only because the test stubs the exit, and on Windows it would find the
 * directory still being released by the commands just stopped.
 */
function midJob(withWorktree: Sandbox['withWorktree'], repo: Repository): Promise<string> {
  return new Promise((resolve, reject) => {
    withWorktree(repo.root, 'HEAD', (directory) => {
      resolve(directory);
      return new Promise<never>(() => undefined);
    }).catch(reject);
  });
}

/** A command that has left a process holding its output behind and ended; the holder's id. */
async function holding(run: Sandbox['runCommand']): Promise<number> {
  const file = join(temp(), 'ids');
  void run(escaped(file), temp(), 600);
  const [holder = 0, command = 0] = await ids(file);
  await until(() => !alive(command), 'the command to end', 60);
  return holder;
}

interface Pin {
  /** Lets go of the directory, and leaves it as it is. */
  free(): Promise<void>;
  /** Lets go of the directory and deletes it. */
  release(): Promise<void>;
}

/**
 * Keeps `directory` from being deleted for `ms` after this answers, from a
 * process of its own, and answers what lets go of it sooner. On Windows the
 * process runs in the directory, which cannot be deleted while in use, as in
 * the moment a stopped command takes to end. Elsewhere a directory in use can
 * be, so the process holds one inside it that its owner may not write, and
 * lets go by making it writable. `at` is where the process runs, when that is
 * to be a directory inside the one it pins.
 */
async function pin(directory: string, ms: number, at = directory): Promise<Pin> {
  const locked = process.platform === 'win32' ? '' : join(directory, 'locked');
  if (locked !== '') {
    mkdirSync(locked);
    writeFileSync(join(locked, 'kept'), '');
    chmodSync(locked, 0o500);
  }
  const file = join(temp(), 'ids');
  const path = join(temp(), 'pin.cjs');
  const release = "setTimeout(() => { if (process.argv[4] !== '') require('node:fs').chmodSync(process.argv[4], 0o700); }, Number(process.argv[3]));";
  writeFileSync(path, [WRITE_IDS, 'write([process.pid]);', release, ''].join('\n'));
  spawn(process.execPath, [path, file, String(ms), locked], { cwd: at, stdio: 'ignore', windowsHide: true });
  const [pid = 0] = await ids(file);
  const free = async (): Promise<void> => {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // It let go on its own, after `ms`.
    }
    await until(() => !alive(pid), 'the pinning process to end', 30);
    if (locked !== '' && existsSync(locked)) chmodSync(locked, 0o700);
  };
  return {
    free,
    release: async () => {
      await free();
      await until(() => removed(directory), `${directory} to be removed`, 30);
    },
  };
}

/** What the sandbox wrote to the standard error since this was called, a line apiece. */
function said(): () => string[] {
  const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  return () => write.mock.calls.flatMap(([text]) => String(text).split('\n')).filter((line) => line !== '');
}

/** How the one line begins that the sandbox writes for a worktree it had to leave: the system's reason follows. */
function left(directory: string): string {
  return `spec-harness: the temporary worktree at ${directory} could not be deleted and is left there: `;
}

function removed(directory: string): boolean {
  try {
    rmSync(directory, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

// How the process exits on each signal: 128 and the signal's number, as a
// shell reports a process that signal ended.
const EXIT_CODES = [
  { signal: 'SIGHUP', number: 1, code: 129 },
  { signal: 'SIGINT', number: 2, code: 130 },
  { signal: 'SIGTERM', number: 15, code: 143 },
  // Ctrl+Break, which GitHub's runner also sends a step it cancels on
  // Windows. Windows alone has the signal, so only there is there a number
  // to exit as.
  ...(process.platform === 'win32' ? [{ signal: 'SIGBREAK', number: 21, code: 149 } as const] : []),
] as const;

describe('a worktree, whatever ends its job', () => {
  it.each(EXIT_CODES)('is removed when the process is interrupted mid-job by $signal, and the process exits $code', async ({ signal, number, code }) => {
    expect(code).toBe(128 + number);
    const { withWorktree, handlers } = await freshSandbox();
    const repo = repository({ 'a.txt': 'a\n' });
    await withWorktree(repo.root, 'HEAD', async (directory) => {
      expect((await interrupt(only(handlers(signal), signal), signal)).code).toBe(code);
      expect(existsSync(directory)).toBe(false);
      expect(worktrees(repo)).toHaveLength(1);
    });
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

  // A job may leave its worktree in any state. Without its .git file, git
  // refuses to remove it, and says so; without its directory, git removes
  // what it holds of it.
  it.each([
    { broken: 'its .git file', remove: (directory: string) => rmSync(join(directory, '.git')) },
    { broken: 'its directory', remove: (directory: string) => rmSync(directory, { recursive: true, force: true }) },
  ])('is removed, and forgotten by git, when its job deleted $broken', async ({ remove }) => {
    const { withWorktree, handlers } = await freshSandbox();
    const repo = repository({ 'a.txt': 'a\n' });
    await withWorktree(repo.root, 'HEAD', async (directory) => {
      remove(directory);
      only(handlers('exit'), 'exit')(0);
      expect(existsSync(directory)).toBe(false);
      expect(worktrees(repo)).toHaveLength(1);
    });
  });

  it('is the only worktree an interrupt or exit removes: the person\'s own are left alone, even one git has lost', async () => {
    // `git worktree prune` would forget every worktree git has lost track
    // of: one on a drive that is not mounted, or another tool's.
    for (const event of ['SIGINT', 'exit'] as const) {
      const { withWorktree, handlers } = await freshSandbox();
      const repo = repository({ 'a.txt': 'a\n' });
      const kept = join(temp(), 'kept');
      const lost = join(temp(), 'lost');
      repo.git('worktree', 'add', '-q', '--detach', kept, 'HEAD');
      repo.git('worktree', 'add', '-q', '--detach', lost, 'HEAD');
      rmSync(lost, { recursive: true, force: true });
      await withWorktree(repo.root, 'HEAD', async (directory) => {
        rmSync(join(directory, '.git'));
        if (event === 'exit') only(handlers('exit'), 'exit')(0);
        else await interrupt(only(handlers(event), event), event);
        expect(existsSync(directory), event).toBe(false);
      });
      expect(worktrees(repo), event).toHaveLength(3);
      expect(existsSync(join(kept, 'a.txt')), event).toBe(true);
    }
  });

  it('is removed and forgotten alone when its job ends having broken it: the person\'s worktree git has lost stays', async () => {
    const { withWorktree } = await freshSandbox();
    const repo = repository({ 'a.txt': 'a\n' });
    const lost = join(temp(), 'lost');
    repo.git('worktree', 'add', '-q', '--detach', lost, 'HEAD');
    rmSync(lost, { recursive: true, force: true });
    let seen = '';
    await withWorktree(repo.root, 'HEAD', async (directory) => {
      seen = directory;
      rmSync(join(directory, '.git'));
    });
    expect(existsSync(seen)).toBe(false);
    expect(worktrees(repo)).toHaveLength(2);
  });

  it('is not touched again once its job is done, even when another worktree is given its path', async () => {
    // A name in the temporary directory is free again once this one is
    // removed, and another run of the harness can be given it.
    const { withWorktree, handlers } = await freshSandbox();
    const repo = repository({ 'a.txt': 'a\n' });
    let seen = '';
    await withWorktree(repo.root, 'HEAD', async (directory) => {
      seen = directory;
    });
    repo.git('worktree', 'add', '-q', '--detach', seen, 'HEAD');
    try {
      only(handlers('exit'), 'exit')(0);
      expect(existsSync(join(seen, 'a.txt'))).toBe(true);
      expect(worktrees(repo)).toHaveLength(2);
    } finally {
      rmSync(seen, { recursive: true, force: true });
    }
  });

  it('is watched by one set of handlers, however many worktrees the process makes', async () => {
    const { withWorktree, handlers } = await freshSandbox();
    const repo = repository({ 'a.txt': 'a\n' });
    for (let job = 0; job < 3; job += 1) await withWorktree(repo.root, 'HEAD', async () => job);
    for (const event of EVENTS) expect(handlers(event), event).toHaveLength(1);
  });

  it('is still watched while an interrupt waits, so a second signal cannot end the process with it in place', async () => {
    // Node ends a process on a signal nothing listens for, before any 'exit'
    // handler runs, so a second Ctrl+C would leave the worktree behind.
    const { withWorktree, handlers } = await freshSandbox();
    const repo = repository({ 'a.txt': 'a\n' });
    await withWorktree(repo.root, 'HEAD', async () => {
      const exited = interrupt(only(handlers('SIGINT'), 'SIGINT'), 'SIGINT');
      for (const event of EVENTS) expect(handlers(event), event).toHaveLength(1);
      await exited;
    });
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

describe('a command still running when the process is interrupted or exits', () => {
  // On Linux and macOS a command leads a session of its own, for the timeout,
  // so the terminal's Ctrl+C never reaches it: left alone it would run on in a
  // worktree removed from under it.
  it('is stopped with everything it started, then its worktree is removed', async () => {
    const { withWorktree, runCommand: run, handlers } = await freshSandbox();
    const repo = repository({ 'a.txt': 'a\n' });
    const file = join(temp(), 'ids');
    const directory = await midJob(withWorktree, repo);
    void run(tree(file), directory, 600);
    const [grandchild = 0] = await ids(file);
    expect((await interrupt(only(handlers('SIGINT'), 'SIGINT'), 'SIGINT')).code).toBe(130);
    // Stopped already; a process whose parent has gone can take a moment to
    // be collected by the system, and answers to its id until then.
    await until(() => !alive(grandchild), 'the grandchild to be gone', 30);
    expect(existsSync(directory)).toBe(false);
    expect(worktrees(repo)).toHaveLength(1);
  });

  it('is stopped as the interrupt begins, not once the interrupt has waited out its bound', async () => {
    const { withWorktree, runCommand: run, handlers } = await freshSandbox();
    const repo = repository({ 'a.txt': 'a\n' });
    const file = join(temp(), 'ids');
    void run(tree(file), await midJob(withWorktree, repo), 600);
    const [grandchild = 0] = await ids(file);
    const exited = interrupt(only(handlers('SIGINT'), 'SIGINT'), 'SIGINT');
    try {
      // Well inside the three seconds an interrupt waits at most (ADR-0003),
      // which a tree left running would hold it to.
      await until(() => !alive(grandchild), 'the grandchild to be gone', 2);
    } finally {
      await exited;
    }
  });

  it('is stopped with everything it started when the process exits mid-job, then its worktree is removed', async () => {
    const { withWorktree, runCommand: run, handlers } = await freshSandbox();
    const repo = repository({ 'a.txt': 'a\n' });
    const file = join(temp(), 'ids');
    const directory = await midJob(withWorktree, repo);
    void run(tree(file), directory, 600);
    const [grandchild = 0] = await ids(file);
    only(handlers('exit'), 'exit')(0);
    await until(() => !alive(grandchild), 'the grandchild to be gone', 30);
    expect(existsSync(directory)).toBe(false);
    expect(worktrees(repo)).toHaveLength(1);
  });

  it('never answers once the process is interrupted, so its job cannot carry on in the worktree being removed', async () => {
    const { withWorktree, runCommand: run, handlers } = await freshSandbox();
    const repo = repository({ 'a.txt': 'a\n' });
    const file = join(temp(), 'ids');
    const answered = vi.fn();
    void run(tree(file), await midJob(withWorktree, repo), 600).then(answered);
    await ids(file);
    await interrupt(only(handlers('SIGINT'), 'SIGINT'), 'SIGINT');
    await sleep(100);
    expect(answered).not.toHaveBeenCalled();
  });

  it('is waited for by an interrupt until everything holding its output has let go', async () => {
    const { runCommand: run, handlers } = await freshSandbox();
    const holder = await holding(run);
    const exited = stubExit();
    let exit: Exit | null = null;
    void exited.then((value) => {
      exit = value;
    });
    only(handlers('SIGINT'), 'SIGINT')('SIGINT');
    await sleep(300);
    expect(exit, 'an exit while the output is still held').toBeNull();
    const released = Date.now();
    process.kill(holder, 'SIGKILL');
    const { code, at } = await within(exited, 60, 'exit');
    expect(code).toBe(130);
    expect(at - released).toBeLessThan(1_000);
  });

  it('is not waited for past a bound, when something it started left the tree and holds its output', async () => {
    const { runCommand: run, handlers } = await freshSandbox();
    await holding(run);
    const interrupted = Date.now();
    const { code, at } = await interrupt(only(handlers('SIGINT'), 'SIGINT'), 'SIGINT');
    expect(code).toBe(130);
    expect(at - interrupted).toBeLessThan(15_000);
  });

  it('is removed at exit once whatever keeps it from being deleted lets go, as a command just stopped does on Windows', async () => {
    const { withWorktree, handlers } = await freshSandbox();
    const repo = repository({ 'a.txt': 'a\n' });
    const directory = await midJob(withWorktree, repo);
    await pin(directory, 500);
    const lines = said();
    only(handlers('exit'), 'exit')(0);
    expect(existsSync(directory)).toBe(false);
    expect(worktrees(repo)).toHaveLength(1);
    // Nothing was left, so nothing is said.
    expect(lines()).toEqual([]);
  });

  it('once ended, is neither stopped nor waited for again, so an interrupt with nothing running ends at once', async () => {
    // The id of a command that has ended can be given to another process.
    const { runCommand: run, handlers } = await freshSandbox();
    expect((await run('node -e "1"', temp(), 30)).exitCode).toBe(0);
    const exited = stubExit();
    let exit: Exit | null = null;
    void exited.then((value) => {
      exit = value;
    });
    only(handlers('SIGINT'), 'SIGINT')('SIGINT');
    await new Promise((resolve) => setImmediate(resolve));
    const early = exit;
    // Whatever the answer, the handler has finished before the test ends
    // and the real process.exit is back.
    await within(exited, 60, 'exit');
    expect(early).toMatchObject({ code: 130 });
  });
});

// As root on Linux and macOS nothing keeps a directory from being deleted.
describe.skipIf(process.getuid?.() === 0)('a worktree whose directory cannot be deleted', () => {
  it('is forgotten by git all the same, and its job still answers, once a bound has passed', async () => {
    const { withWorktree } = await freshSandbox();
    const repo = repository({ 'a.txt': 'a\n' });
    let pinned: Pin | undefined;
    let seen = '';
    try {
      let ended = 0;
      const answer = await withWorktree(repo.root, 'HEAD', async (directory) => {
        seen = directory;
        // Inside it, as something a command started in a directory of the
        // project runs: deleting the worktree's directory first would then
        // take its .git file and stop at this one, and git refuses a
        // worktree without its .git file.
        mkdirSync(join(directory, 'inside'));
        pinned = await pin(directory, 600_000, join(directory, 'inside'));
        ended = Date.now();
        return 7;
      });
      expect(answer).toBe(7);
      // The three seconds a directory is tried for (ADR-0003), and git twice.
      expect(Date.now() - ended).toBeLessThan(30_000);
      expect(existsSync(seen)).toBe(true);
      // The person's repository holds nothing of it: only its directory is left.
      expect(worktrees(repo)).toHaveLength(1);
    } finally {
      await pinned?.release();
    }
  });

  it('does not take its job\'s failure with it either: what the job threw is what is thrown', async () => {
    const { withWorktree } = await freshSandbox();
    const repo = repository({ 'a.txt': 'a\n' });
    let pinned: Pin | undefined;
    try {
      await expect(
        withWorktree(repo.root, 'HEAD', async (directory) => {
          pinned = await pin(directory, 600_000);
          throw new Error('the job failed');
        }),
      ).rejects.toThrow('the job failed');
      expect(worktrees(repo)).toHaveLength(1);
    } finally {
      await pinned?.release();
    }
  });

  it('is forgotten by git even when its job also deleted its .git file, once its directory can be deleted at exit', async () => {
    // Git refuses a worktree whose .git file is gone for as long as its
    // directory is there, and forgets it once the directory is not.
    const { withWorktree, handlers } = await freshSandbox();
    const repo = repository({ 'a.txt': 'a\n' });
    let pinned: Pin | undefined;
    let seen = '';
    try {
      await withWorktree(repo.root, 'HEAD', async (directory) => {
        seen = directory;
        rmSync(join(directory, '.git'));
        pinned = await pin(directory, 600_000);
      });
      expect(existsSync(seen)).toBe(true);
      expect(worktrees(repo)).toHaveLength(2);
      await pinned?.free();
      const lines = said();
      only(handlers('exit'), 'exit')(0);
      expect(existsSync(seen)).toBe(false);
      expect(worktrees(repo)).toHaveLength(1);
      expect(lines()).toEqual([]);
    } finally {
      await pinned?.release();
    }
  });

  it('is deleted at exit, and nothing is said, when whatever kept it has let go by then', async () => {
    const { withWorktree, handlers } = await freshSandbox();
    const repo = repository({ 'a.txt': 'a\n' });
    let pinned: Pin | undefined;
    let seen = '';
    try {
      await withWorktree(repo.root, 'HEAD', async (directory) => {
        seen = directory;
        pinned = await pin(directory, 600_000);
      });
      expect(existsSync(seen)).toBe(true);
      await pinned?.free();
      const lines = said();
      only(handlers('exit'), 'exit')(0);
      expect(existsSync(seen)).toBe(false);
      expect(lines()).toEqual([]);
    } finally {
      await pinned?.release();
    }
  });

  it('is named on the standard error at exit when it is still there, once a bound has passed, and nothing is thrown where nothing could catch it', async () => {
    const { withWorktree, handlers } = await freshSandbox();
    const repo = repository({ 'a.txt': 'a\n' });
    const directory = await midJob(withWorktree, repo);
    const pinned = await pin(directory, 600_000);
    try {
      const lines = said();
      const started = Date.now();
      only(handlers('exit'), 'exit')(0);
      expect(Date.now() - started).toBeLessThan(15_000);
      expect(lines()).toHaveLength(1);
      expect(lines()[0]?.startsWith(left(directory))).toBe(true);
      // Why, in the system's words, after the colon.
      expect(lines()[0]?.length).toBeGreaterThan(left(directory).length);
      expect(existsSync(directory)).toBe(true);
      expect(worktrees(repo)).toHaveLength(1);
    } finally {
      await pinned.release();
    }
  });

  it('does not keep the worktrees after it from being removed at exit', async () => {
    const { withWorktree, handlers } = await freshSandbox();
    const repo = repository({ 'a.txt': 'a\n' });
    const first = await midJob(withWorktree, repo);
    const second = await midJob(withWorktree, repo);
    const pinned = await pin(first, 600_000);
    try {
      const lines = said();
      only(handlers('exit'), 'exit')(0);
      expect(lines().map((line) => line.startsWith(left(first)))).toEqual([true]);
      expect(existsSync(second)).toBe(false);
      expect(worktrees(repo)).toHaveLength(1);
    } finally {
      await pinned.release();
    }
  });

  it('is named once when the process is interrupted, not again by the exit the interrupt ends in', async () => {
    const { withWorktree, handlers } = await freshSandbox();
    const repo = repository({ 'a.txt': 'a\n' });
    const directory = await midJob(withWorktree, repo);
    const pinned = await pin(directory, 600_000);
    try {
      const lines = said();
      expect((await interrupt(only(handlers('SIGINT'), 'SIGINT'), 'SIGINT')).code).toBe(130);
      only(handlers('exit'), 'exit')(130);
      expect(lines().map((line) => line.startsWith(left(directory)))).toEqual([true]);
    } finally {
      await pinned.release();
    }
  });

  it('costs a probe nothing but a line: the verdict is printed, the exit is the verdict\'s, and git lists no worktree', async () => {
    // The command line as a person runs it. The probe's command leaves the
    // worktree as `pin` does: on Windows a process of its own still running
    // in it, elsewhere a directory in it that its owner may not write.
    const leave = [
      "const { spawn } = require('node:child_process');",
      "const { chmodSync, mkdirSync, writeFileSync } = require('node:fs');",
      "if (process.platform === 'win32') {",
      "  const holder = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 120000)'], { stdio: 'ignore', detached: true, windowsHide: true });",
      '  holder.unref();',
      '  writeFileSync(process.env.SPEC_HARNESS_TEST_HOLDER, String(holder.pid));',
      '} else {',
      "  mkdirSync('locked');",
      "  writeFileSync('locked/kept', '');",
      "  chmodSync('locked', 0o500);",
      '}',
      "console.log('expected fixed, got broken');",
      'process.exit(1);',
    ].join('\n');
    const body = ['## Probes', '', '```probe', 'id: v', 'run: node leave.js', 'signature: expected fixed', '```', '', '```probe-file leave.js', leave, '```', ''].join('\n');
    const repo = repository({ [BRIEF_FILE]: brief({ affected: ['src/**'], body }) }, { probes: { runs: 1 } });
    repo.git('checkout', '-q', '-b', 'brief/001-fix');
    const holder = join(temp(), 'holder');
    process.env['SPEC_HARNESS_TEST_HOLDER'] = holder;
    let directory = '';
    try {
      const result = spawnBin(['probe', '--at', 'base'], repo.root);
      const lines = result.stderr.split('\n').filter((line) => line !== '');
      directory = /^spec-harness: the temporary worktree at (.+) could not be deleted and is left there: ./.exec(lines[0] ?? '')?.[1] ?? '';
      expect(lines, result.stderr).toHaveLength(1);
      expect(directory, result.stderr).not.toBe('');
      expect(result.stdout).toMatch(/\| v \| base `[0-9a-f]{12}` \| 1\/1 \| measured \| expected fixed, got broken \|/);
      expect(result.code).toBe(0);
      expect(existsSync(directory)).toBe(true);
      expect(worktrees(repo)).toHaveLength(1);
    } finally {
      delete process.env['SPEC_HARNESS_TEST_HOLDER'];
      // What the probe's command left is this test's to end and to delete.
      if (existsSync(holder)) {
        const pid = Number(readFileSync(holder, 'utf8'));
        strays.push(pid);
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // Already gone.
        }
        await until(() => !alive(pid), 'the process the command left to end', 30);
      }
      if (directory !== '') {
        if (existsSync(join(directory, 'locked'))) chmodSync(join(directory, 'locked'), 0o700);
        await until(() => removed(directory), `${directory} to be removed`, 30);
      }
    }
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
