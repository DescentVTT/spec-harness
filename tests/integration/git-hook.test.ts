/**
 * git's pre-commit hook as git runs it: the hook init writes, started by a
 * real `git commit` - through the sh Git for Windows ships, on Windows - at
 * the top of the work tree being committed, from the main work tree, a
 * subdirectory of it, a linked worktree, and a hooks directory two
 * repositories share.
 */

import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PRE_COMMIT } from '../../src/configure.js';
import { brief, BRIEF_FILE, cleanup, cli, installHarness, parsed, repository, ROOT, temp, type Repository } from './helpers.js';

afterAll(cleanup);

beforeAll(() => {
  if (!existsSync(join(ROOT, 'dist', 'cli.js'))) throw new Error('dist/cli.js is missing: run "npm run build" before the suite');
});

const SCRIPT = 'node_modules/@descent-vtt/spec-harness/bin/spec-harness.js';
const REFUSED = [
  'refused  brief 001 does not empower this round to change src/db/schema.ts (protectedFiles: src/db/**)',
  '         if the round cannot be done without it, stop and ask for a ruling: spec-harness escalate --path <file> --reason <why>, or the request_escalation tool',
  'spec-harness: 1 file(s) this round may not change; the commit was stopped',
  '',
].join('\n');
/** What the hook says where the project's install is not in the work tree: the script, the work tree as sh spells it, and what to do. */
const NOT_INSTALLED = new RegExp(
  `^spec-harness: ${SCRIPT.replaceAll('.', '\\.')} is not in \\S.*, the work tree git commits in: install the project's dependencies there, as with npm ci, and commit again\\n$`,
);

/** The hook's `node` is this Node, found first on PATH, as a person's is. */
function environment(): NodeJS.ProcessEnv {
  return { ...process.env, SPEC_BRIEF: '', PATH: `${dirname(process.execPath)}${delimiter}${process.env['PATH'] ?? ''}` };
}

/** `git commit` of what is staged, as a person runs it, from `cwd`. */
function commit(cwd: string): { code: number | null; stdout: string; stderr: string } {
  const result = spawnSync('git', ['commit', '-q', '-m', 'work'], { cwd, encoding: 'utf8', env: environment() });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

/**
 * A repository with the project's install of the harness and everything init
 * writes, the hook with it, on the round's branch. What init wrote is on the
 * base, so a round's commit holds only what the test stages.
 */
async function guarded(): Promise<Repository> {
  const repo = repository({
    [BRIEF_FILE]: brief({ affected: ['src/auth/**'], protected: ['src/db/**'] }),
    '.gitignore': 'node_modules/\n',
    'src/db/schema.ts': 'table;\n',
    'src/auth/a.ts': 'a;\n',
  });
  installHarness(repo.root);
  const written = await cli(['init', '--git-hook', '--write'], repo.root);
  expect(written.stdout).toContain('create  .git/hooks/pre-commit\n        refuse a commit that changes what the active brief protects\n');
  repo.git('add', '-A');
  repo.git('commit', '-q', '--no-verify', '-m', 'configured');
  repo.git('checkout', '-q', '-b', 'brief/001-rotate');
  return repo;
}

function head(root: string): string {
  return spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
}

describe('the pre-commit hook init writes, run by git', () => {
  it('is a POSIX sh script that runs node and the script in the project\'s install, and never npx', async () => {
    const repo = await guarded();
    const hook = repo.read('.git/hooks/pre-commit');
    expect(hook).toBe(PRE_COMMIT);
    expect(hook.startsWith('#!/bin/sh\n')).toBe(true);
    expect(hook).toContain(`\nbin=${SCRIPT}\n`);
    expect(hook.endsWith('\nexec node "$bin" hook git\n')).toBe(true);
    expect(hook).not.toContain('npx');
    expect(hook).not.toContain('\r');
  });

  it('refuses a commit that changes a protected file, and says nothing of one inside the scope', async () => {
    const repo = await guarded();
    const before = head(repo.root);
    repo.write('src/db/schema.ts', 'changed;\n');
    repo.git('add', 'src/db/schema.ts');
    expect(commit(repo.root)).toEqual({ code: 1, stdout: '', stderr: REFUSED });
    expect(head(repo.root)).toBe(before);
    repo.git('reset', '-q', '--hard');
    repo.write('src/auth/a.ts', 'b;\n');
    repo.git('add', 'src/auth/a.ts');
    // Nothing on stderr: no runner between git and the harness has anything to say.
    expect(commit(repo.root)).toEqual({ code: 0, stdout: '', stderr: '' });
    expect(head(repo.root)).not.toBe(before);
  });

  it('finds the install from the top of the work tree when the commit is made in a subdirectory', async () => {
    const repo = await guarded();
    repo.write('src/db/schema.ts', 'changed;\n');
    repo.git('add', 'src/db/schema.ts');
    expect(commit(join(repo.root, 'src', 'db'))).toEqual({ code: 1, stdout: '', stderr: REFUSED });
  });

  it('runs the install of a linked worktree, where git runs the shared hook, and stops the commit where there is none', async () => {
    const repo = await guarded();
    const linked = join(temp(), 'linked');
    repo.git('worktree', 'add', '-q', '-b', 'brief/001-linked', linked);
    const change = (path: string, content: string): void => {
      mkdirSync(dirname(join(linked, path)), { recursive: true });
      writeFileSync(join(linked, path), content);
      spawnSync('git', ['add', path], { cwd: linked });
    };
    const before = head(linked);
    // The main work tree's install is not this work tree's: the hook says so, and the commit waits.
    change('src/auth/a.ts', 'linked;\n');
    const missing = commit(linked);
    // git's own code for a commit its hook stopped, whatever the hook exited with.
    expect(missing.code).toBe(1);
    expect(missing.stdout).toBe('');
    expect(missing.stderr).toMatch(NOT_INSTALLED);
    expect(missing.stderr).toContain('linked, the work tree git commits in');
    expect(head(linked)).toBe(before);
    // Installed there, the same hook file guards that work tree.
    installHarness(linked);
    expect(commit(linked)).toEqual({ code: 0, stdout: '', stderr: '' });
    change('src/db/schema.ts', 'changed;\n');
    expect(commit(join(linked, 'src'))).toEqual({ code: 1, stdout: '', stderr: REFUSED });
  });

  it('guards each repository that shares a hooks directory by its own install, and stops a commit in one that has none', async () => {
    const hooks = join(temp(), 'shared-hooks');
    const repo = await guarded();
    repo.git('config', 'core.hooksPath', hooks);
    const plan = parsed<{ steps: { file: string; action: string }[] }>(await cli(['init', '--git-hook', '--write', '--format', 'json'], repo.root));
    expect(plan.steps.find((step) => step.file.endsWith('pre-commit'))?.action).toBe('create');
    expect(readFileSync(join(hooks, 'pre-commit'), 'utf8')).toBe(PRE_COMMIT);
    repo.write('src/db/schema.ts', 'changed;\n');
    repo.git('add', 'src/db/schema.ts');
    expect(commit(repo.root)).toEqual({ code: 1, stdout: '', stderr: REFUSED });
    // Another repository on the same hooks, which never installed the harness.
    const other = repository({ 'a.txt': 'a\n' }, null);
    other.git('config', 'core.hooksPath', hooks);
    other.write('a.txt', 'b\n');
    other.git('add', '-A');
    const before = head(other.root);
    const stopped = commit(other.root);
    expect(stopped.code).toBe(1);
    expect(stopped.stderr).toMatch(NOT_INSTALLED);
    expect(head(other.root)).toBe(before);
  });

  it('runs from a hooks directory core.hooksPath names in the work tree', async () => {
    const repo = await guarded();
    repo.git('config', 'core.hooksPath', '.githooks');
    await cli(['init', '--git-hook', '--write'], repo.root);
    expect(repo.read('.githooks/pre-commit')).toBe(PRE_COMMIT);
    repo.write('src/db/schema.ts', 'changed;\n');
    repo.git('add', 'src/db/schema.ts');
    expect(commit(join(repo.root, 'src', 'auth'))).toEqual({ code: 1, stdout: '', stderr: REFUSED });
  });
});

describe('a hook that runs the harness through npx, as init wrote it through 0.9.1', () => {
  const OLD = '#!/bin/sh\n# spec-harness: refuse a commit that changes what the active brief protects.\nexec npx --no-install spec-harness hook git\n';
  const NOTE =
    'it runs spec-harness through npx, which starts npm to start node on every commit, and under npm 12 prints two "npm notice run" lines each time: ' +
    `to run it with node from the project's install, as Claude Code's hooks are, replace the npx command there with "node ${SCRIPT} hook git"`;

  function hooked(text: string): Repository {
    const repo = repository({});
    repo.write('.git/hooks/pre-commit', text);
    chmodSync(join(repo.root, '.git', 'hooks', 'pre-commit'), 0o755);
    return repo;
  }

  it('is a hook that runs spec-harness to doctor, with a note that offers the node line and fails nothing', async () => {
    const old = hooked(OLD);
    const now = hooked(PRE_COMMIT);
    const said = await cli(['doctor'], old.root);
    expect(said.stdout).toContain(`\ngit     .git/hooks/pre-commit runs spec-harness\n        ${NOTE}\n\n`);
    const json = parsed<{ gitHook: unknown }>(await cli(['doctor', '--format', 'json'], old.root));
    expect(json.gitHook).toEqual({ state: 'runs', file: '.git/hooks/pre-commit', detail: '.git/hooks/pre-commit runs spec-harness', note: NOTE });
    // A note: the exit code is the one a hook written today gets, --strict or not.
    for (const flags of [[], ['--strict']]) {
      expect((await cli(['doctor', ...flags], old.root)).code).toBe((await cli(['doctor', ...flags], now.root)).code);
    }
    // The hook written today has no note.
    expect((await cli(['doctor'], now.root)).stdout).toContain('\ngit     .git/hooks/pre-commit runs spec-harness\n\n');
    expect(parsed<{ gitHook: { note: unknown } }>(await cli(['doctor', '--format', 'json'], now.root)).gitHook.note).toBeNull();
  });

  it('is kept by init, byte for byte, with the same note, asked for the hook or not', async () => {
    const old = hooked(OLD);
    for (const flags of [['--git-hook', '--write'], ['--write'], []]) {
      const result = await cli(['init', ...flags], old.root);
      expect(result.stdout).toContain(`keep    .git/hooks/pre-commit\n        already runs spec-harness; ${NOTE}\n`);
    }
    expect(old.read('.git/hooks/pre-commit')).toBe(OLD);
  });

  it('is noted in a hook of the repository\'s own that holds the line init advised, and not in one that has no hook line', async () => {
    const own = hooked('#!/bin/sh\nnpm test || exit 1\nnpx --no-install spec-harness hook git\n');
    expect(parsed<{ gitHook: { state: string; note: unknown } }>(await cli(['doctor', '--format', 'json'], own.root)).gitHook).toMatchObject({ state: 'runs', note: NOTE });
    const none = hooked('#!/bin/sh\nnpm test\n');
    expect(parsed<{ gitHook: { state: string; note: unknown } }>(await cli(['doctor', '--format', 'json'], none.root)).gitHook).toMatchObject({ state: 'other', note: null });
    const absent = repository({});
    expect(parsed<{ gitHook: { state: string; note: unknown } }>(await cli(['doctor', '--format', 'json'], absent.root)).gitHook).toMatchObject({ state: 'absent', note: null });
  });
});
