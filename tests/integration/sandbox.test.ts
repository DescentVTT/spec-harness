import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type AddressInfo, type Socket } from 'node:net';
import { join } from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { runCommand } from '../../src/sandbox.js';
import { BIN, brief, BRIEF_FILE, cleanup, cli, repository, ROOT, spawnBin, temp, withEnvironment, type Captured, type Repository } from './helpers.js';

/**
 * What the sandbox promises beyond a job that ends on its own, which
 * edges.test.ts covers: a worktree removed when the process is interrupted or
 * exits mid-job, and every command still running in it stopped first, with
 * everything it started, and none stopped under an id that is no longer its
 * own; a worktree git forgets, and a job whose answer stands, when the
 * directory cannot be deleted (ADR-0003); and a probe's command run as CI
 * runs it, with npm told to fetch nothing for it unless the person's
 * environment says otherwise, its output bounded, stopped whole at its
 * timeout (ADR-0007), and answered within a bound of that timeout when
 * something the stop did not reach still holds its output (ADR-0003).
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

/**
 * A process one of the tests' commands started, known by the connection it
 * opened to this file as it started, and never by its id. Once a process has
 * ended, its id is the system's to give to another, on Windows within seconds
 * (ADR-0003), and a signal sent to the id then stops a stranger: another
 * worker's git, or the sibling an audit is waiting on. A connection is the
 * process's own for as long as it runs and closes when it ends, however it
 * ends, so it answers both whether the process runs and when it has gone.
 */
interface Stray {
  /** Settles once the process has ended. */
  readonly ended: Promise<void>;
  /** Tells the process to end, over its connection, and waits until it has. */
  end(): Promise<void>;
}

// What a process says first, so that nothing else that finds the port is
// taken for one of them.
const KEY = randomUUID();
const strays = new Map<string, Stray>();
const connections = new Set<Socket>();
// The processes this file started itself, and so holds: each is stopped
// through its handle, which reaches no other process whatever its id becomes.
const own: ChildProcess[] = [];
let names = 0;

const lobby = createServer((socket) => {
  connections.add(socket);
  socket.once('close', () => connections.delete(socket));
  // A process that is stopped drops its connection, and 'close' follows.
  socket.on('error', () => undefined);
  let said = '';
  const hear = (chunk: Buffer): void => {
    said += chunk.toString('utf8');
    if (!said.includes('\n')) return;
    socket.off('data', hear);
    const [key, name] = said.trim().split(' ');
    if (key !== KEY || name === undefined) {
      socket.destroy();
      return;
    }
    const ended = new Promise<void>((resolve) => socket.once('close', () => resolve()));
    strays.set(name, {
      ended,
      end: async () => {
        if (!socket.destroyed) socket.write('end\n');
        await within(ended, 30, `${name} to end`);
      },
    });
    socket.write('known\n');
  };
  socket.on('data', hear);
});

beforeAll(() => new Promise<void>((resolve) => lobby.listen(0, '127.0.0.1', () => resolve())));
afterAll(
  () =>
    new Promise<void>((resolve) => {
      for (const socket of connections) socket.destroy();
      lobby.close(() => resolve());
    }),
);

afterEach(async () => {
  // Whatever a test left running, as one that failed does. The processes its
  // commands started are told to end, each over its own connection, where one
  // that has ended hears nothing; those this file started are stopped through
  // the handles it holds, where nothing happens to one that has ended.
  const left = [...strays.values()];
  strays.clear();
  for (const child of own.splice(0)) child.kill('SIGKILL');
  try {
    await Promise.all(left.map((stray) => stray.end()));
  } finally {
    // The handlers a test's module installed stay on this worker's process
    // otherwise, and a real signal would find them.
    for (const before of snapshots.splice(0)) {
      for (const event of EVENTS) {
        for (const listener of emitter.rawListeners(event)) {
          if (!(before.get(event) ?? []).includes(listener)) emitter.removeListener(event, listener as Handler);
        }
      }
    }
    vi.doUnmock('node:child_process');
    vi.restoreAllMocks();
  }
});

type Sandbox = typeof import('../../src/sandbox.js');

interface Fresh {
  readonly withWorktree: Sandbox['withWorktree'];
  readonly runCommand: Sandbox['runCommand'];
  handlers(event: ProcessEvent): Handler[];
}

/**
 * The sandbox as a process loads it, with the handlers it has installed on
 * the process so far. The module installs them once, the first time it makes
 * a worktree or runs a command, so each test loads a copy of its own: one an
 * earlier test or file loaded would already have.
 */
async function freshSandbox(): Promise<Fresh> {
  vi.resetModules();
  const before = new Map(EVENTS.map((event) => [event, emitter.rawListeners(event)] as const));
  snapshots.push(before);
  const { withWorktree, runCommand: run } = await import('../../src/sandbox.js');
  const handlers = (event: ProcessEvent): Handler[] => emitter.rawListeners(event).filter((listener) => !(before.get(event) ?? []).includes(listener)) as Handler[];
  return { withWorktree, runCommand: run, handlers };
}

interface Watched extends Fresh {
  /** Each command the sandbox started, as the sandbox itself holds it, in the order it started them. */
  readonly started: ChildProcess[];
  /** The arguments of each taskkill the sandbox asked for, where `noted` has it noted and not run. */
  readonly taskkills: string[][];
}

/**
 * The sandbox with the commands it starts in the test's hands as well: what
 * the sandbox has seen of a command's shell, which decides whether it may
 * still stop the command by its id, is not something a caller is told. Where
 * a test says so, a taskkill the sandbox asks for is noted and not run, so
 * that a sandbox that asks for one it should not have stops nothing.
 */
async function watchedSandbox(taskkill: 'run' | 'noted' = 'run'): Promise<Watched> {
  const started: ChildProcess[] = [];
  const taskkills: string[][] = [];
  vi.doMock('node:child_process', async (original) => {
    const actual = await original<typeof import('node:child_process')>();
    return {
      ...actual,
      spawn: (...args: unknown[]): ChildProcess => {
        const child = (actual.spawn as (...given: unknown[]) => ChildProcess)(...args);
        started.push(child);
        return child;
      },
      execFileSync: (file: string, args: readonly string[], options: unknown): unknown => {
        if (file === 'taskkill' && taskkill === 'noted') {
          taskkills.push([...args]);
          return '';
        }
        return (actual.execFileSync as (...given: unknown[]) => unknown)(file, args, options);
      },
    };
  });
  return { ...(await freshSandbox()), started, taskkills };
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

/**
 * The built command line, started as a person starts it and not waited on
 * here, so that this file goes on hearing the processes its commands start
 * while it runs. How it ended, once it has. One still running when its test
 * ends is stopped through its handle.
 */
function startBin(args: readonly string[], cwd: string): Promise<Captured> {
  if (!existsSync(join(ROOT, 'dist', 'cli.js'))) throw new Error('dist/cli.js is missing: run "npm run build" before the suite');
  const child = spawn(process.execPath, [BIN, ...args], { cwd, env: { ...process.env, SPEC_BRIEF: '' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  own.push(child);
  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
  child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
  return new Promise((resolve) => child.once('close', (code) => resolve({ code: code ?? -1, stdout, stderr })));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function until(done: () => boolean, what: string, seconds: number): Promise<void> {
  const deadline = Date.now() + seconds * 1000;
  while (!done()) {
    if (Date.now() > deadline) throw new Error(`still waiting for ${what} after ${seconds}s`);
    await sleep(50);
  }
}

/** A name no other process of this file's has taken. */
function named(role: string): string {
  names += 1;
  return `${role}-${names}`;
}

/** The process that has made itself known as `name`, once it has. */
async function stray(name: string, seconds = 120): Promise<Stray> {
  await until(() => strays.has(name), `${name} to make itself known`, seconds);
  return strays.get(name) as Stray;
}

interface Ended {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}

/** How a process whose handle the caller has ended, once it has: as Node saw it end. */
function exitOf(child: ChildProcess): Promise<Ended> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) resolve({ code: child.exitCode, signal: child.signalCode });
    else child.once('exit', (code, signal) => resolve({ code, signal }));
  });
}

/**
 * How a process a command starts makes itself known to this file, as the
 * first lines of its script: it connects, says the key and the name it was
 * handed, and calls `then` once this file has answered. It ends when it is
 * told to over the connection, when the connection closes, as it does when
 * this worker ends, and after ten minutes whatever happens: so neither a
 * test that fails nor a run that is stopped leaves one running on.
 */
const KNOWN = [
  'const known = (name, then = () => {}) => {',
  "  const socket = require('node:net').connect(Number(process.argv[2]), '127.0.0.1', () => socket.write(`${process.argv[3]} ${name}\\n`));",
  "  let heard = '';",
  "  socket.on('data', (chunk) => {",
  "    const first = heard === '';",
  '    heard += chunk;',
  "    if (heard.includes('end')) process.exit(0);",
  '    if (first) then(socket);',
  '  });',
  "  for (const event of ['error', 'close']) socket.on(event, () => process.exit(0));",
  '  setTimeout(() => process.exit(0), 600000).unref();',
  '};',
];

/**
 * A command line running a script of the test's own, which is handed where
 * this file listens, the key, and `args`. A script, rather than `node -e`,
 * because cmd.exe and sh quote a line inside a line differently.
 */
function script(name: string, lines: readonly string[], ...args: readonly string[]): string {
  const path = join(temp(), name);
  writeFileSync(path, `${[...KNOWN, ...lines].join('\n')}\n`);
  return [`node "${path}"`, (lobby.address() as AddressInfo).port, KEY, ...args].join(' ');
}

/**
 * A script whose process makes itself known by the name it is handed, and
 * then only waits to be ended. It ignores SIGTERM, a request to stop.
 */
function waiter(): string {
  const path = join(temp(), 'wait.cjs');
  writeFileSync(path, `${[...KNOWN, "process.on('SIGTERM', () => {});", 'known(process.argv[4]);'].join('\n')}\n`);
  return path;
}

/**
 * A command whose child starts a grandchild that ignores SIGTERM, and makes
 * itself known as `grandchild`. On Windows the grandchild is detached from
 * its parent's job object, which would otherwise end it with its parent:
 * only taskkill following the tree stops it. On Linux and macOS it stays in
 * the command's process group, which is what is signalled.
 */
function tree(grandchild: string): string {
  return script(
    'tree.cjs',
    [
      "const { spawn } = require('node:child_process');",
      "spawn(process.execPath, [process.argv[5], process.argv[2], process.argv[3], process.argv[4]], { stdio: 'inherit', detached: process.platform === 'win32', windowsHide: true });",
      'known(process.argv[6]);',
    ],
    grandchild,
    `"${waiter()}"`,
    named('command'),
  );
}

/**
 * A command that leaves behind a process holding its output, known as `name`,
 * and ends. Left outside the command's process group, in one of its own and
 * with its parent gone, the process is out of reach of both the group signal
 * and taskkill's tree. Left in the group, it is what the group signal still
 * reaches on Linux and macOS; on Windows a process node starts without
 * detaching it ends with node, so none is left that way there.
 *
 * The command prints `says` first, when there is one. The process it leaves
 * runs in the temporary directory, not where the command ran: on Windows a
 * directory something runs in cannot be deleted, which other tests are about.
 */
function leaving(name: string, where: 'outside its group' | 'in its group', command = named('command'), says = ''): string {
  return script(
    'leaving.cjs',
    [
      "const { spawn } = require('node:child_process');",
      'if (process.argv[8] !== undefined) console.log(process.argv[8]);',
      "const kept = spawn(process.execPath, [process.argv[5], process.argv[2], process.argv[3], process.argv[4]], { cwd: require('node:os').tmpdir(), stdio: 'inherit', detached: process.argv[7] === 'detached', windowsHide: true });",
      'kept.unref();',
      '// Known before it ends, so that its end is seen: its connection closes with it.',
      'known(process.argv[6], (socket) => socket.unref());',
    ],
    name,
    `"${waiter()}"`,
    command,
    where === 'outside its group' ? 'detached' : 'grouped',
    ...(says === '' ? [] : [says]),
  );
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

/** A command that has left a process holding its output behind and ended; that process. */
async function holding(run: Sandbox['runCommand']): Promise<Stray> {
  const holder = named('holder');
  const command = named('command');
  void run(leaving(holder, 'outside its group', command), temp(), 600);
  const kept = await stray(holder);
  await within((await stray(command)).ended, 60, 'the command to end');
  return kept;
}

/**
 * Starts a command, and answers its promise with what its timeout runs,
 * called as the timer would call it: a test cannot wait ten minutes, and a
 * timeout short enough to wait for could fire before the test is ready.
 */
function timed<T>(start: () => Promise<T>, seconds: number): { answered: Promise<T>; timeout: () => void } {
  const timers = vi.spyOn(globalThis, 'setTimeout');
  try {
    const answered = start();
    const call = timers.mock.calls.find(([, ms]) => ms === seconds * 1000);
    if (call === undefined) throw new Error(`the command set no timer of ${seconds}s`);
    return { answered, timeout: call[0] as () => void };
  } finally {
    timers.mockRestore();
  }
}

/**
 * A process of this file's own, to be given a command's id as the system
 * gives an id to another process once nothing holds its last owner. It leads
 * a process group where there are groups, so a signal to the group of that
 * id reaches it. How it ends says whether it was stopped: with 7 once its
 * input is closed, as the test closes it, and otherwise as what stopped it
 * left it.
 */
function another(): ChildProcess {
  const child = spawn(process.execPath, ['-e', "process.stdin.resume(); process.stdin.on('end', () => process.exit(7)); setTimeout(() => process.exit(8), 600000);"], {
    stdio: ['pipe', 'ignore', 'ignore'],
    detached: process.platform !== 'win32',
    windowsHide: true,
  });
  own.push(child);
  return child;
}

/** Has `command`, which the sandbox holds, carry the id of `other`, as it does once the system has given its id to `other`. */
function give(command: ChildProcess, other: ChildProcess): void {
  (command as { pid: number | undefined }).pid = other.pid;
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
  const path = join(temp(), 'pin.cjs');
  const release = "setTimeout(() => { if (process.argv[3] !== '') require('node:fs').chmodSync(process.argv[3], 0o700); }, Number(process.argv[2]));";
  // It says when it runs, which is when `ms` begins.
  writeFileSync(path, ["console.log('pinning');", release, ''].join('\n'));
  const child = spawn(process.execPath, [path, String(ms), locked], { cwd: at, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
  own.push(child);
  await within(new Promise((resolve) => child.stdout?.once('data', resolve)), 120, 'the pinning process to run');
  const free = async (): Promise<void> => {
    // Through the handle: nothing happens once it has let go on its own, after `ms`.
    child.kill('SIGKILL');
    await within(exitOf(child), 30, 'the pinning process to end');
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
    const name = named('grandchild');
    const directory = await midJob(withWorktree, repo);
    void run(tree(name), directory, 600);
    const grandchild = await stray(name);
    expect((await interrupt(only(handlers('SIGINT'), 'SIGINT'), 'SIGINT')).code).toBe(130);
    // Stopped already; its connection closes a moment after, once the system
    // has ended it.
    await within(grandchild.ended, 30, 'the grandchild to be gone');
    expect(existsSync(directory)).toBe(false);
    expect(worktrees(repo)).toHaveLength(1);
  });

  it('is stopped as the interrupt begins, not once the interrupt has waited out its bound', async () => {
    const { withWorktree, runCommand: run, handlers } = await freshSandbox();
    const repo = repository({ 'a.txt': 'a\n' });
    const name = named('grandchild');
    void run(tree(name), await midJob(withWorktree, repo), 600);
    const grandchild = await stray(name);
    const exited = interrupt(only(handlers('SIGINT'), 'SIGINT'), 'SIGINT');
    try {
      // Well inside the three seconds an interrupt waits at most (ADR-0003),
      // which a tree left running would hold it to.
      await within(grandchild.ended, 2, 'the grandchild to be gone');
    } finally {
      await exited;
    }
  });

  it('is stopped with everything it started when the process exits mid-job, then its worktree is removed', async () => {
    const { withWorktree, runCommand: run, handlers } = await freshSandbox();
    const repo = repository({ 'a.txt': 'a\n' });
    const name = named('grandchild');
    const directory = await midJob(withWorktree, repo);
    void run(tree(name), directory, 600);
    const grandchild = await stray(name);
    only(handlers('exit'), 'exit')(0);
    await within(grandchild.ended, 30, 'the grandchild to be gone');
    expect(existsSync(directory)).toBe(false);
    expect(worktrees(repo)).toHaveLength(1);
  });

  it('never answers once the process is interrupted, so its job cannot carry on in the worktree being removed', async () => {
    const { withWorktree, runCommand: run, handlers } = await freshSandbox();
    const repo = repository({ 'a.txt': 'a\n' });
    const name = named('grandchild');
    const answered = vi.fn();
    void run(tree(name), await midJob(withWorktree, repo), 600).then(answered);
    await stray(name);
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
    const gone = holder.end();
    const { code, at } = await within(exited, 60, 'exit');
    await gone;
    expect(code).toBe(130);
    expect(at - released).toBeLessThan(1_000);
  });

  it('is not waited for past a bound, when something it started left the tree and holds its output', async () => {
    const { runCommand: run, handlers } = await freshSandbox();
    const holder = await holding(run);
    let over = false;
    void holder.ended.then(() => {
      over = true;
    });
    const interrupted = Date.now();
    const { code, at } = await interrupt(only(handlers('SIGINT'), 'SIGINT'), 'SIGINT');
    expect(code).toBe(130);
    expect(at - interrupted).toBeLessThan(15_000);
    // An interrupt reaches what a timeout reaches, and that process is not it.
    expect(over, 'the holder ended').toBe(false);
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

describe('a command whose shell has ended while something it started still holds its output', () => {
  // The sandbox still waits for such a command, and has let go of its shell:
  // the id is the system's to give to another process. No test can have the
  // system do that, so the tests give the id to a process of their own, which
  // they hold, and stop the command once, while they hold it: an interrupt
  // stops a command twice, three seconds apart, and a sandbox that got this
  // wrong would send the second to an id nothing held any more.
  it.each(['its timeout', 'the exit of the process'] as const)('is not stopped under its id by %s: the process that has the id by then runs on', async (by) => {
    const { runCommand: run, handlers, started } = await watchedSandbox();
    const name = named('holder');
    const { answered, timeout } = timed(() => run(leaving(name, 'outside its group'), temp(), 600), 600);
    const holder = await stray(name);
    const command = started[0] as ChildProcess;
    expect(await within(exitOf(command), 60, 'the sandbox to see the shell end')).toEqual({ code: 0, signal: null });
    const other = another();
    give(command, other);
    if (by === 'its timeout') timeout();
    else only(handlers('exit'), 'exit')(0);
    other.stdin?.end();
    expect(await within(exitOf(other), 60, 'the other process to end')).toEqual({ code: 7, signal: null });
    if (by === 'its timeout') {
      // Its timeout is still what ended it, whether its output closed first
      // or the bound on the wait for that passed.
      await holder.end();
      expect(await within(answered, 60, 'the command to answer')).toMatchObject({ exitCode: null, output: '' });
    }
  });

  // Windows reports no signal for a process: there a shell ends with a code.
  it.skipIf(process.platform === 'win32')('is not stopped under its id either when a signal ended its shell', async () => {
    const { runCommand: run, handlers, started } = await watchedSandbox();
    const name = named('holder');
    void run(`${leaving(name, 'outside its group')}; kill -KILL $$`, temp(), 600);
    await stray(name);
    const command = started[0] as ChildProcess;
    expect(await within(exitOf(command), 60, 'the sandbox to see the shell end')).toEqual({ code: null, signal: 'SIGKILL' });
    const other = another();
    give(command, other);
    only(handlers('exit'), 'exit')(0);
    other.stdin?.end();
    expect(await within(exitOf(other), 60, 'the other process to end')).toEqual({ code: 7, signal: null });
  });

  // No test can start another user's process, so the system's answer for one
  // is given by hand, and with it nothing is sent to any process at all.
  it.skipIf(process.platform === 'win32')('is not stopped under its id when what has the id may not be signalled, as another user\'s process may not', async () => {
    const { runCommand: run, handlers, started } = await watchedSandbox();
    const name = named('holder');
    void run(leaving(name, 'outside its group'), temp(), 600);
    await stray(name);
    expect(await within(exitOf(started[0] as ChildProcess), 60, 'the sandbox to see the shell end')).toEqual({ code: 0, signal: null });
    const sent: unknown[] = [];
    vi.spyOn(process, 'kill').mockImplementation((_pid, signal) => {
      if (signal === 0) throw Object.assign(new Error('kill EPERM'), { code: 'EPERM' });
      sent.push(signal);
      return true;
    });
    only(handlers('exit'), 'exit')(0);
    expect(sent).toEqual([]);
  });

  // The group's id is given to no other process while the group has a member
  // (ADR-0003). Windows has no such group, and taskkill finds no tree under
  // a root that has ended, so there nothing is left to stop the process by.
  it.skipIf(process.platform === 'win32')('is still stopped at its timeout with what its shell left in its process group', async () => {
    const { runCommand: run, started } = await watchedSandbox();
    const name = named('member');
    const { answered, timeout } = timed(() => run(leaving(name, 'in its group'), temp(), 600), 600);
    const member = await stray(name);
    expect(await within(exitOf(started[0] as ChildProcess), 60, 'the sandbox to see the shell end')).toEqual({ code: 0, signal: null });
    timeout();
    await within(member.ended, 30, 'the process left in the group to be gone');
    // Stopped whole, so nothing is said to hold its output.
    expect(await within(answered, 30, 'the command to answer')).toEqual({ exitCode: null, output: '' });
  });

  // Asking first whether a process has the id would leave the moment between
  // the answer and taskkill's own look, in which one can be given it.
  it.runIf(process.platform === 'win32')('is never handed to taskkill, even while no process has its id, where a command still running is', async () => {
    const { runCommand: run, handlers, started, taskkills } = await watchedSandbox('noted');
    const holder = named('holder');
    void run(leaving(holder, 'outside its group'), temp(), 600);
    await stray(holder);
    expect(await within(exitOf(started[0] as ChildProcess), 60, 'the sandbox to see the shell end')).toEqual({ code: 0, signal: null });
    const grandchild = named('grandchild');
    void run(tree(grandchild), temp(), 600);
    await stray(grandchild);
    only(handlers('exit'), 'exit')(0);
    expect(taskkills.map((args) => args[1])).toEqual([String(started[1]?.pid)]);
  });
});

describe('a command stopped at its timeout while something the stop cannot reach holds its output', () => {
  // A process in a group of its own, its parent gone: neither the group's
  // signal nor taskkill's tree finds it (ADR-0003). The command waited for it
  // without bound, and the probe with it.
  const SAID = ', and something it started was left running, holding its output';

  it('is answered within a bound of its timeout, with what it had printed, and its output is let go while the holder runs on', async () => {
    const { runCommand: run, started } = await watchedSandbox();
    const name = named('holder');
    const { answered, timeout } = timed(() => run(leaving(name, 'outside its group', named('command'), 'printed'), temp(), 600), 600);
    const holder = await stray(name);
    const command = started[0] as ChildProcess;
    expect(await within(exitOf(command), 60, 'the sandbox to see the shell end')).toEqual({ code: 0, signal: null });
    let over = false;
    void holder.ended.then(() => {
      over = true;
    });
    // Node says a command is closed once nothing of its output is open on
    // this side: until then the open output keeps the process from ending.
    const closed = new Promise<void>((resolve) => command.once('close', () => resolve()));
    const stopped = Date.now();
    timeout();
    const answer = await within(answered, 60, 'the command to answer');
    // The three seconds the sandbox waits for what it stopped (ADR-0003).
    expect(Date.now() - stopped).toBeLessThan(15_000);
    expect(answer).toEqual({ exitCode: null, output: 'printed\n', outputHeld: true });
    await within(closed, 30, 'the sandbox to let go of the output');
    expect(over, 'the holder ended').toBe(false);
  });

  // Through `probe`, for what a person is told. The command's timeout, ten
  // minutes, is run by hand once the command has ended and left the holder,
  // as `timed` runs one.
  it.each([
    {
      line: 'run',
      fields: (left: string) => [`run: ${left}`, 'timeout: 600'],
      code: 1,
      table: new RegExp(`^\\| v \\| base \`[0-9a-f]{12}\` \\| 1/1 \\| invalid \\| stopped after 600 seconds${SAID} \\|$`, 'm'),
      told: (): string => `spec-harness: probe v is invalid at base: run 1 of 1: stopped after 600 seconds${SAID}; its output ended:\nprinted\n`,
    },
    {
      line: 'setup',
      fields: (left: string) => [`setup: ${left}`, 'run: node -e "process.exit(1)"'],
      code: 2,
      table: /^$/,
      told: (left: string): string => `spec-harness: the probe setup "${left}" was stopped after 600 seconds at base${SAID}:\nprinted\n`,
    },
  ])('is said to have left something running, where a person reads of a probe whose $line it was', async ({ fields, code, table, told }) => {
    const name = named('holder');
    const command = named('command');
    const left = leaving(name, 'outside its group', command, 'printed');
    const body = ['## Probes', '', '```probe', 'id: v', ...fields(left), 'signature: expected fixed', '```', ''].join('\n');
    const repo = repository({ [BRIEF_FILE]: brief({ affected: ['src/**'], body }) }, { probes: { runs: 1 } });
    repo.git('checkout', '-q', '-b', 'brief/001-fix');
    const timers = vi.spyOn(globalThis, 'setTimeout');
    const probed = cli(['probe', '--at', 'base'], repo.root);
    const holder = await stray(name);
    await within((await stray(command)).ended, 60, 'the command to end');
    let over = false;
    void holder.ended.then(() => {
      over = true;
    });
    const timeout = timers.mock.calls.find(([, ms]) => ms === 600_000)?.[0] as (() => void) | undefined;
    timers.mockRestore();
    expect(timeout, 'the timer of the command').toBeDefined();
    timeout?.();
    const result = await within(probed, 60, 'the probe to answer');
    expect(over, 'the holder ended').toBe(false);
    expect(result.stderr).toBe(told(left));
    expect(result.stdout).toMatch(table);
    expect(result.code).toBe(code);
    expect(worktrees(repo)).toHaveLength(1);
  });

  // The command line as a person runs it, which alone shows that the process
  // ends: an output left open keeps Node from ending, with the verdict
  // already printed. Here the holder runs where the command ran, in the
  // worktree, as what a probe's command leaves behind does.
  it('does not keep `probe` from ending: the verdict is printed, the exit is the verdict\'s, and git lists no worktree', async () => {
    const leave = [
      "const { spawn } = require('node:child_process');",
      "const holder = spawn(process.execPath, JSON.parse(process.env.SPEC_HARNESS_TEST_HOLDER), { stdio: 'inherit', detached: true, windowsHide: true });",
      'holder.unref();',
      "console.log('printed');",
    ].join('\n');
    // Ten seconds for a command that ends at once: stopped sooner, while it
    // still ran, it would take the holder with it on Windows.
    const body = ['## Probes', '', '```probe', 'id: v', 'run: node leave.js', 'signature: expected fixed', 'timeout: 10', '```', '', '```probe-file leave.js', leave, '```', ''].join('\n');
    const repo = repository({ [BRIEF_FILE]: brief({ affected: ['src/**'], body }) }, { probes: { runs: 1 } });
    repo.git('checkout', '-q', '-b', 'brief/001-fix');
    const name = named('holder');
    process.env['SPEC_HARNESS_TEST_HOLDER'] = JSON.stringify([waiter(), String((lobby.address() as AddressInfo).port), KEY, name]);
    let directory = '';
    try {
      const ended = startBin(['probe', '--at', 'base'], repo.root);
      const holder = await stray(name);
      let over = false;
      void holder.ended.then(() => {
        over = true;
      });
      const result = await within(ended, 120, 'end of the probe while the holder runs');
      expect(over, 'the holder ended').toBe(false);
      const lines = result.stderr.split('\n').filter((text) => text !== '');
      // On Windows a directory something runs in cannot be deleted, and the
      // worktree is named as it is left; elsewhere it is deleted under the holder.
      if (process.platform === 'win32') directory = /^spec-harness: the temporary worktree at (.+) could not be deleted and is left there: ./.exec(lines.pop() ?? '')?.[1] ?? '';
      expect(lines, result.stderr).toEqual([`spec-harness: probe v is invalid at base: run 1 of 1: stopped after 10 seconds${SAID}; its output ended:`, 'printed']);
      expect(result.stdout).toContain(`| 1/1 | invalid | stopped after 10 seconds${SAID} |`);
      expect(result.code).toBe(1);
      expect(directory === '', result.stderr).toBe(process.platform !== 'win32');
      expect(worktrees(repo)).toHaveLength(1);
    } finally {
      delete process.env['SPEC_HARNESS_TEST_HOLDER'];
      await stray(name, 30).then(
        (kept) => kept.end(),
        () => undefined,
      );
      if (directory !== '') await until(() => removed(directory), `${directory} to be removed`, 30);
    }
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
    // in it, which makes itself known to this file as the commands' other
    // processes do, elsewhere a directory in it that its owner may not write.
    const leave = [
      "const { spawn } = require('node:child_process');",
      "const { chmodSync, mkdirSync, writeFileSync } = require('node:fs');",
      "if (process.platform === 'win32') {",
      "  const holder = spawn(process.execPath, JSON.parse(process.env.SPEC_HARNESS_TEST_HOLDER), { stdio: 'ignore', detached: true, windowsHide: true });",
      '  holder.unref();',
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
    const holder = named('holder');
    process.env['SPEC_HARNESS_TEST_HOLDER'] = JSON.stringify([waiter(), String((lobby.address() as AddressInfo).port), KEY, holder]);
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
      // The process connected while the probe ran and this worker waited on
      // it; one that never started has nothing to end.
      if (process.platform === 'win32') {
        await stray(holder, 30).then(
          (kept) => kept.end(),
          () => undefined,
        );
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

  it("is handed npm's `yes` setting as false, so that npx fetches nothing for it, unless the person's environment sets it in either case", async () => {
    // Each spelling of the setting the command was handed, with its value.
    const path = join(temp(), 'said.cjs');
    writeFileSync(path, "console.log(JSON.stringify(Object.entries(process.env).filter(([name]) => name.toLowerCase() === 'npm_config_yes')));\n");
    const handed = (changes: Record<string, string | undefined>): Promise<unknown> =>
      withEnvironment({ npm_config_yes: undefined, ...changes }, async () => {
        const run = await runCommand(`node "${path}"`, temp(), 60);
        expect(run.exitCode, run.output).toBe(0);
        return JSON.parse(run.output);
      });
    expect(await handed({})).toEqual([['npm_config_yes', 'false']]);
    // A person who set it has said what npm may fetch, and it reaches the command as they set it.
    expect(await handed({ npm_config_yes: 'true' })).toEqual([['npm_config_yes', 'true']]);
    expect(await handed({ NPM_CONFIG_YES: 'true' })).toEqual([['NPM_CONFIG_YES', 'true']]);
    expect(await handed({ npm_config_yes: 'false' })).toEqual([['npm_config_yes', 'false']]);
  });

  it('is given no input, so one that reads its input is told at once that there is none', async () => {
    // Left a pipe nobody closes, it waited for input until the timeout stopped it.
    const run = await runCommand('node -e "process.stdin.resume(); process.stdin.on(\'end\', () => console.log(\'no input\'))"', temp(), 20);
    expect(run).toEqual({ exitCode: 0, output: 'no input\n' });
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

  it('leaves no timer behind either once its timeout has stopped it whole: the wait for its output is over, and holds the process no longer', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const answered = runCommand('node -e "setTimeout(() => {}, 20000)"', temp(), 600);
      vi.advanceTimersByTime(600_000);
      // Stopped whole, its output closed with it: nothing is said to hold
      // it. The bound itself never passes here, whatever the machine's pace.
      expect(await answered).toEqual({ exitCode: null, output: '' });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
