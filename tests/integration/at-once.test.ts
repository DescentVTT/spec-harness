/**
 * What a command asks at once, and what it reads once.
 *
 * A process is what a command's time is made of: on a Windows workstation
 * git answers in a few hundred milliseconds and Claude Code in seconds, so
 * what `doctor`, `init` and the hook take is how many of them wait on one
 * another. Nothing a command prints says which did, so these tests read the
 * order the processes were started and answered in, through a mock of
 * `execFile` that hands every call on as it was given. No test here reads a
 * clock: where one thing has to be shown started before another has
 * answered, the mock keeps the answer back until it is.
 *
 * The same for a matcher that is a pattern, read in a context of its own:
 * the readings are counted through a mock of `runInNewContext`.
 *
 * A file of its own, because a mock reaches everything the file imports.
 */

import { chmodSync, copyFileSync, linkSync } from 'node:fs';
import { basename, join } from 'node:path';

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { mergeClaudeSettings } from '../../src/configure.js';
import { brief, BRIEF_FILE, cleanup, cli, parsed, repository, temp, type Repository } from './helpers.js';

/** An answer kept back until something else is asked. */
interface Kept {
  /** What the command whose answer waits holds on its line. */
  readonly answer: string;
  /** Which asking of it, the first being 1. */
  readonly nth: number;
  /** What the line holds whose asking lets the answer go. */
  readonly until: string;
}

const seen = vi.hoisted(() => ({
  /** Every asking and every answer, in the order they happened; a line is the program by its name, and its arguments. */
  log: [] as { what: 'asked' | 'answered'; line: string }[],
  kept: null as Kept | null,
  waiting: [] as (() => void)[],
  /** The source of every pattern read in a context of its own. */
  readings: [] as string[],
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  type Done = (error: Error | null, stdout: string, stderr: string) => void;
  const started = actual.execFile as unknown as (file: string, args: string[], options: object, done: Done) => unknown;
  const asked = (part: string): number => seen.log.filter((entry) => entry.what === 'asked' && entry.line.includes(part)).length;
  const execFile = (file: string, args: readonly string[], options: object, done: Done): unknown => {
    const line = [basename(file).replace(/\.exe$/i, ''), ...args].join(' ');
    seen.log.push({ what: 'asked', line });
    const { kept } = seen;
    const waits = kept !== null && line.includes(kept.answer) && asked(kept.answer) === kept.nth;
    if (kept !== null && line.includes(kept.until)) for (const deliver of seen.waiting.splice(0)) deliver();
    return started(file, [...args], options, (error, stdout, stderr) => {
      const deliver = (): void => {
        seen.log.push({ what: 'answered', line });
        done(error, stdout, stderr);
      };
      if (kept === null || !waits || asked(kept.until) > 0) return deliver();
      seen.waiting.push(deliver);
      // Where the other is never asked while this one waits, the answer is
      // handed on at last, and the test fails on the order it then reads.
      setTimeout(() => {
        const at = seen.waiting.indexOf(deliver);
        if (at === -1) return;
        seen.waiting.splice(at, 1);
        deliver();
      }, 5000).unref();
    });
  };
  return { ...actual, execFile };
});

vi.mock('node:vm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:vm')>();
  const runInNewContext: typeof actual.runInNewContext = (code, context, options) => {
    const handed = typeof context === 'object' ? (context as { readonly source?: unknown }) : {};
    seen.readings.push(String(handed.source));
    return actual.runInNewContext(code, context, options);
  };
  return { ...actual, runInNewContext };
});

beforeEach(() => {
  seen.log.length = 0;
  seen.kept = null;
  seen.waiting.length = 0;
  seen.readings.length = 0;
});

afterAll(cleanup);

/** Where, in the order things happened, the one command that holds `part` on its line was asked, or answered. */
function when(what: 'asked' | 'answered', part: string): number {
  const found = seen.log.flatMap((entry, index) => (entry.what === what && entry.line.includes(part) ? [index] : []));
  expect(found, `${what} once: ${part}\n${seen.log.map((entry) => `${entry.what} ${entry.line}`).join('\n')}`).toHaveLength(1);
  return found[0]!;
}

/** Whether every one of them was asked before any of them had answered. */
function atOnce(...parts: readonly string[]): boolean {
  return Math.max(...parts.map((part) => when('asked', part))) < Math.min(...parts.map((part) => when('answered', part)));
}

/**
 * Waits until every answer still on its way is in. A run that ends on a
 * fault of a work tree it was opening leaves the two processes it had asked
 * at once with the configuration, and their answers are not the next test's
 * to count.
 */
async function settled(): Promise<void> {
  const count = (what: 'asked' | 'answered'): number => seen.log.filter((entry) => entry.what === what).length;
  await vi.waitFor(() => expect(count('answered')).toBe(count('asked')), { timeout: 60_000, interval: 20 });
}

const TOP = 'rev-parse --show-toplevel';
const COMMON = '--git-common-dir';
const BRANCH = 'symbolic-ref --quiet --short HEAD';
const BRIEFS = 'list --archived --format json';
const BASE = 'rev-parse --verify --quiet main^{commit}';
const HEAD = 'rev-parse --verify --quiet HEAD^{commit}';
const MERGE_BASE = 'merge-base';
const SIGNERS = 'show ';
const HOOKS = '--git-path hooks/pre-commit';
const REMOTE = 'refs/remotes/origin/HEAD';
const BRANCHES = 'for-each-ref';
const RELEASE = 'claude --version';

const WIRED = JSON.stringify(mergeClaudeSettings({}));
const SCRIPT = '${CLAUDE_PROJECT_DIR}/node_modules/@descent-vtt/spec-harness/bin/spec-harness.js';
const line = (...rest: string[]): unknown => ({ type: 'command', command: 'node', args: [SCRIPT, 'hook', 'claude', ...rest], timeout: 60 });

/** A repository on the branch of its one brief, so that spec-brief is asked which brief the branch names. */
function onBrief(files: Readonly<Record<string, string>> = {}): Repository {
  const repo = repository({ [BRIEF_FILE]: brief({ affected: ['src/**'], protected: ['src/db/**'] }), ...files });
  repo.git('checkout', '-q', '-b', 'brief/001-rotate');
  return repo;
}

describe('doctor', () => {
  it('asks at once what waits on the work tree alone, and in turn what waits on an answer', async () => {
    const repo = onBrief({ '.claude/settings.json': WIRED });
    const result = await cli(['doctor'], repo.root, { env: { PATH: temp() } });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('\nbrief   001\n');
    // The work tree first: everything else is asked of its root.
    expect(when('answered', TOP)).toBeLessThan(Math.min(when('asked', COMMON), when('asked', BRANCH)));
    expect(atOnce(COMMON, BRANCH)).toBe(true);
    expect(Math.max(when('answered', COMMON), when('answered', BRANCH))).toBeLessThan(when('asked', BRIEFS));
    // Then the brief, the two commits of the base and git's hooks: none says anything another is asked with.
    expect(atOnce(BRIEFS, BASE, HEAD, HOOKS)).toBe(true);
    // The commit the two share waits on both, and the signers' file on that.
    expect(Math.max(when('answered', BASE), when('answered', HEAD))).toBeLessThan(when('asked', MERGE_BASE));
    expect(when('answered', MERGE_BASE)).toBeLessThan(when('asked', SIGNERS));
  });

  it('asks Claude Code its release while git is still answering, and not at all where nothing wires it to the guard', async () => {
    // This Node under the name claude, which every platform starts without a shell: it prints its own version.
    const directory = temp();
    const name = process.platform === 'win32' ? 'claude.exe' : 'claude';
    try {
      linkSync(process.execPath, join(directory, name));
    } catch {
      copyFileSync(process.execPath, join(directory, name));
    }
    const env = { PATH: directory };
    // HEAD's commit is kept back until Claude Code is asked: asked only
    // after git's last answer, as it was, it would not be asked in time.
    seen.kept = { answer: HEAD, nth: 1, until: RELEASE };
    const result = await cli(['doctor'], repository({ '.claude/settings.json': WIRED }).root, { env });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(`cannot be told: claude --version printed "${process.version}", which is not a version`);
    expect(when('asked', RELEASE)).toBeLessThan(when('answered', HEAD));
    seen.log.length = 0;
    seen.kept = null;
    const bare = await cli(['doctor', '--format', 'json'], repository({}).root, { env });
    expect(parsed<{ claudeCode: { state: string } }>(bare).claudeCode.state).toBe('none');
    expect(seen.log.filter((entry) => entry.line.includes(RELEASE))).toEqual([]);
    when('answered', SIGNERS);
  });

  // A directory for git's hook ended a run too, and is now a line of the
  // report (ADR-0005). What is left at the hook's path that ends one is a file
  // the account may not read, which only a system with such bits can hold,
  // and which an account that may do anything reads all the same.
  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('ends on the first of them to fail in the order it read them in, whichever failed first', async () => {
    // Two things fail. The root on the hook's line has a configuration that
    // does not load, and git's pre-commit hook is a file nobody may read.
    // The line was read before the hook was, so the run ends on the line's
    // fault, said in a line. Here the hook's fault is known first: the
    // root's work tree is not answered until git has been asked for the
    // signers' file, two answers after it was asked where its hooks are.
    const broken = repository({ '.spec-harness.json': '{ not json' }, null);
    const repo = repository({ '.claude/settings.json': JSON.stringify({ hooks: { PreToolUse: [{ hooks: [line('--root', broken.root, '--brief', '001')] }] } }), '.githooks/pre-commit': '#!/bin/sh\n' });
    repo.git('config', 'core.hooksPath', '.githooks');
    chmodSync(join(repo.root, '.githooks', 'pre-commit'), 0o000);
    seen.kept = { answer: TOP, nth: 2, until: SIGNERS };
    const result = await cli(['doctor'], repo.root, { env: { PATH: temp() } });
    expect(result).toMatchObject({ code: 2, stdout: '' });
    expect(result.stderr).toMatch(/^spec-harness: \.spec-harness\.json is not valid JSON: .*\n$/);
    // Alone, the hook's fault ends the run, so the run above had both to choose from.
    repo.write('.claude/settings.json', '{}');
    seen.kept = null;
    const alone = await cli(['doctor'], repo.root, { env: { PATH: temp() } });
    expect(alone).toMatchObject({ code: 2, stdout: '' });
    expect(alone.stderr).toContain('EACCES');
    await settled();
  });

  it('ends on a fault of the root on the hook\'s line however late it is known, and on nothing the report has a line for', async () => {
    // What stands for git's pre-commit hook is a directory, which is said in
    // the report and ends no run. The root on the hook's line has a
    // configuration that does not load, and its work tree is not answered
    // until git has been asked for the signers' file, by when the hook has
    // long been read: the run ends on the line's fault all the same.
    const broken = repository({ '.spec-harness.json': '{ not json' }, null);
    const repo = repository({ '.claude/settings.json': JSON.stringify({ hooks: { PreToolUse: [{ hooks: [line('--root', broken.root, '--brief', '001')] }] } }), '.githooks/pre-commit/keep': '' });
    repo.git('config', 'core.hooksPath', '.githooks');
    seen.kept = { answer: TOP, nth: 2, until: SIGNERS };
    const result = await cli(['doctor'], repo.root, { env: { PATH: temp() } });
    expect(result).toMatchObject({ code: 2, stdout: '' });
    expect(result.stderr).toMatch(/^spec-harness: \.spec-harness\.json is not valid JSON: .*\n$/);
    await settled();
  });
});

describe('init', () => {
  it("asks git at once for the remote's default branch, the local branches and where its hooks are", async () => {
    const repo = repository({ 'README.md': '# x\n' }, null);
    const result = await cli(['init', '--format', 'json'], repo.root, { env: {} });
    expect(result.code).toBe(0);
    expect(parsed<{ steps: { file: string; action: string }[] }>(result).steps.find((step) => step.file === '.spec-harness.json')?.action).toBe('create');
    expect(Math.max(when('answered', COMMON), when('answered', BRANCH))).toBeLessThan(when('asked', REMOTE));
    expect(atOnce(REMOTE, BRANCHES, HOOKS)).toBe(true);
  });

  it('asks git for no base where the configuration names one', async () => {
    const result = await cli(['init', '--format', 'json'], repository({}).root, { env: {} });
    expect(result.code).toBe(0);
    expect(seen.log.filter((entry) => entry.line.includes(REMOTE) || entry.line.includes(BRANCHES))).toEqual([]);
    when('answered', HOOKS);
  });
});

describe('the hook', () => {
  it('opens its work tree as every command does, the common directory and the branch asked at once', async () => {
    const repo = onBrief();
    const question = JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: join(repo.root, 'src', 'db', 'schema.ts') }, cwd: repo.root });
    const result = await cli(['hook', 'claude'], repo.root, { env: { CLAUDE_PROJECT_DIR: repo.root }, stdin: question });
    expect(result.code).toBe(0);
    expect(parsed<{ hookSpecificOutput: { permissionDecision: string } }>(result).hookSpecificOutput.permissionDecision).toBe('deny');
    expect(when('answered', TOP)).toBeLessThan(Math.min(when('asked', COMMON), when('asked', BRANCH)));
    expect(atOnce(COMMON, BRANCH)).toBe(true);
    // spec-brief is asked which brief the branch names, so only once the branch is known.
    expect(when('answered', BRANCH)).toBeLessThan(when('asked', BRIEFS));
    // A write to a protected file asks for the base its rulings are checked on: both commits at once.
    expect(when('answered', BRIEFS)).toBeLessThan(Math.min(when('asked', BASE), when('asked', HEAD)));
    expect(atOnce(BASE, HEAD)).toBe(true);
  });
});

describe('a matcher that is a pattern', () => {
  it('is read once in a run of doctor and once in a run of init, however many entries stand under it', async () => {
    // Two patterns, each read in half a millisecond: what is counted is the
    // readings, not what they take. One matches no tool that writes, so
    // every entry under it is asked of where an entry that is started is
    // looked for; the other stands over a line a person wrote.
    const idle = '^Bash$';
    const some = 'Edit.*';
    const entry = (matcher: string, ...rest: string[]): unknown => ({ matcher, hooks: [line(...rest)] });
    const held = {
      hooks: {
        PreToolUse: [entry(idle), entry(idle), entry(some, '--base', 'main'), entry(idle), entry(some, '--base', 'main')],
        PostToolUse: [entry(idle), entry(some, '--base', 'main'), entry(idle)],
      },
    };
    const repo = repository({ '.claude/settings.json': JSON.stringify(held) });
    const env = { PATH: temp() };
    const doctor = await cli(['doctor', '--format', 'json'], repo.root, { env });
    expect(parsed<{ claudeCode: { lines: { state: string; before: string[] }[] } }>(doctor).claudeCode.lines.map((said) => [said.state, said.before])).toEqual([
      ['unstarted', []],
      ['guards', ['Edit', 'NotebookEdit']],
    ]);
    expect(seen.readings).toEqual([idle, some]);
    seen.readings.length = 0;
    // init reads the file for what doctor says of it, and again for what to write into it.
    const init = await cli(['init', '--format', 'json'], repo.root, { env });
    expect(parsed<{ steps: { file: string; action: string }[] }>(init).steps.find((step) => step.file === '.claude/settings.json')?.action).toBe('keep');
    expect(seen.readings).toEqual([idle, some]);
  });
});
