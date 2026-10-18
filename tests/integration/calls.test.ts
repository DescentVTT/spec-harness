/**
 * The answer after a write, from what the run before it decided (ADR-0002,
 * ADR-0003, amended 2026-10-18).
 *
 * Claude Code starts the hook before a write and after it, and the run after
 * decided the write again, at what the run before cost: git, and spec-brief
 * on a brief's branch. The run before now keeps what the run after would
 * say, under the git common directory, by the question's session and call,
 * and the run after answers from it with no process started. Each test runs
 * the command line on the question Claude Code asks, and tells a run that
 * decided from one that answered from what was kept by taking away what
 * deciding needs: spec-brief, or git on PATH.
 */

import { existsSync, mkdirSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { brief, BRIEF_FILE, cleanup, cli, git, install, repository, siblings, temp, type Repository } from './helpers.js';

afterAll(cleanup);

const FILES = {
  [BRIEF_FILE]: brief({ affected: ['src/auth/**'], protected: ['src/db/**'] }),
  '.gitignore': 'node_modules/\n',
  'src/db/schema.ts': 'table;\n',
  'src/auth/a.ts': 'a;\n',
  'README.md': '# x\n',
};

/** A project on a brief's branch with spec-brief installed in it, and the configuration given, which names no sibling's command, or none. */
function project(config: Record<string, unknown> | null = null): Repository {
  const repo = repository(FILES, config === null ? null : { tools: {}, ...config });
  install(repo.root, 'spec-brief');
  repo.git('checkout', '-q', '-b', 'brief/001-rotate');
  return repo;
}

let calls = 0;
const call = (): string => `toolu_${(calls += 1)}`;

function question(event: string, repo: Repository, path: string, id: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ session_id: 'session-1', tool_use_id: id, cwd: repo.root, hook_event_name: event, tool_name: 'Edit', tool_input: { file_path: join(repo.root, ...path.split('/')), old_string: 'a', new_string: 'b' }, ...extra });
}

async function hook(repo: Repository, event: string, path: string, id: string, options: { readonly env?: Record<string, string>; readonly extra?: Record<string, unknown> } = {}) {
  return cli(['hook', 'claude'], repo.root, { stdin: question(event, repo, path, id, options.extra), env: { CLAUDE_PROJECT_DIR: repo.root, ...options.env } });
}

const kept = (repo: Repository): string[] => {
  const directory = join(repo.root, '.git', 'spec-harness', 'calls');
  return existsSync(directory) ? readdirSync(directory).sort() : [];
};

/** What a run after a write says of README.md, which brief 001's scope does not cover. */
const WARNING = /^\{"hookSpecificOutput":\{"hookEventName":"PostToolUse","additionalContext":"spec-harness: README\.md is outside brief 001's scope, which covers src\/auth\/\*\*\. Next: /;

/** spec-brief taken away, so that a run that asks it ends in exit 2. */
const unInstall = (repo: Repository): void => rmSync(join(repo.root, 'node_modules', '@descent-vtt', 'spec-brief'), { recursive: true, force: true });
const NOT_INSTALLED = 'spec-harness: spec-brief is not installed here: npm install --save-dev @descent-vtt/spec-brief, or name its command under "tools" in .spec-harness.json\n';

/** Runs `work` with no git on PATH, so that a run that asks git finds none. */
async function withoutGit<T>(work: () => Promise<T>): Promise<T> {
  const path = process.env['PATH'];
  process.env['PATH'] = temp();
  try {
    return await work();
  } finally {
    process.env['PATH'] = path;
  }
}

describe('the run after a write', () => {
  it('answers from what the run before kept for its call, asking neither git nor spec-brief, and takes it away', async () => {
    const repo = project();
    const id = call();
    expect(await hook(repo, 'PreToolUse', 'README.md', id)).toEqual({ code: 0, stdout: '', stderr: '' });
    expect(kept(repo)).toEqual([`session-1.${id}.json`]);
    unInstall(repo);
    const after = await withoutGit(() => hook(repo, 'PostToolUse', 'README.md', id));
    expect(after.code).toBe(0);
    expect(after.stdout).toMatch(WARNING);
    expect(kept(repo)).toEqual([]);
    // Taken away: asked again for the same call, it decides, and spec-brief is not there.
    expect(await hook(repo, 'PostToolUse', 'README.md', id)).toEqual({ code: 2, stdout: '', stderr: NOT_INSTALLED });
  });

  it('decides as before for a call nothing was kept for, and for one whose kept decisions are another call\'s', async () => {
    const repo = project();
    expect((await hook(repo, 'PostToolUse', 'README.md', call())).stdout).toMatch(WARNING);
    // The same session and call, before a write of another file: another call's decisions, taken away and not read.
    const id = call();
    await hook(repo, 'PreToolUse', 'src/auth/a.ts', id);
    expect(kept(repo)).toHaveLength(1);
    expect((await hook(repo, 'PostToolUse', 'README.md', id)).stdout).toMatch(WARNING);
    expect(kept(repo)).toEqual([]);
    // And one kept under another session's name answers this session nothing.
    const other = call();
    await hook(repo, 'PreToolUse', 'src/auth/a.ts', other, { extra: { session_id: 'session-2' } });
    unInstall(repo);
    expect(await hook(repo, 'PostToolUse', 'src/auth/a.ts', other)).toEqual({ code: 2, stdout: '', stderr: NOT_INSTALLED });
    expect(kept(repo)).toEqual([`session-2.${other}.json`]);
  });

  it("is another call's where the line, a variable the hook reads or the directory it starts in differs between the two runs", async () => {
    const pairs: [(root: string) => string[], Record<string, string>, string | undefined][] = [
      [() => ['--brief', '001'], {}, undefined],
      [() => [], { SPEC_BRIEF: '001' }, undefined],
      [(root) => ['--root', root], {}, undefined],
      [() => [], {}, 'src'],
    ];
    for (const [lineOf, beforeEnv, from] of pairs) {
      const repo = project();
      const beforeLine = lineOf(repo.root);
      const id = call();
      const ask = (event: string, line: string[], env: Record<string, string>, at = repo.root) =>
        cli(['hook', 'claude', ...line], at, { stdin: question(event, repo, 'README.md', id), env: { CLAUDE_PROJECT_DIR: repo.root, ...env } });
      expect((await ask('PreToolUse', beforeLine, beforeEnv)).code).toBe(0);
      expect(kept(repo)).toHaveLength(1);
      unInstall(repo);
      const where = JSON.stringify([beforeLine.length, beforeEnv, from]);
      expect(await ask('PostToolUse', [], {}, from === undefined ? repo.root : join(repo.root, from)), where).toEqual({ code: 2, stdout: '', stderr: NOT_INSTALLED });
    }
  });

  it('answers each of two calls at once from its own', async () => {
    const repo = project();
    const [first, second] = [call(), call()];
    await hook(repo, 'PreToolUse', 'README.md', first);
    await hook(repo, 'PreToolUse', 'src/auth/a.ts', second);
    unInstall(repo);
    expect(await withoutGit(() => hook(repo, 'PostToolUse', 'src/auth/a.ts', second))).toEqual({ code: 0, stdout: '', stderr: '' });
    expect((await withoutGit(() => hook(repo, 'PostToolUse', 'README.md', first))).stdout).toMatch(WARNING);
    expect(kept(repo)).toEqual([]);
  });

  it('is kept nothing for a refused call, nor for a write to what the answer is made from, nor where the question names no call', async () => {
    const repo = project();
    repo.write('briefs/notes.md', '# notes\n');
    repo.write('.spec-harness.json', '{}\n');
    for (const path of ['src/db/schema.ts', BRIEF_FILE, 'briefs/notes.md', '.spec-harness.json', '.spec-brief.json', 'spec-brief.json']) {
      await hook(repo, 'PreToolUse', path, call());
      expect(kept(repo), path).toEqual([]);
    }
    await hook(repo, 'PreToolUse', 'src/auth/a.ts', call(), { extra: { tool_use_id: undefined } });
    await hook(repo, 'PreToolUse', 'src/auth/a.ts', call(), { extra: { session_id: '../elsewhere' } });
    expect(kept(repo)).toEqual([]);
    // A file of the scope, and one outside it, are kept for.
    await hook(repo, 'PreToolUse', 'src/auth/a.ts', call());
    await hook(repo, 'PreToolUse', 'README.md', call());
    expect(kept(repo)).toHaveLength(2);
    // And a write where no brief is named.
    const plain = repository(FILES, null);
    expect(await hook(plain, 'PreToolUse', 'README.md', call())).toEqual({ code: 0, stdout: '', stderr: '' });
    expect(kept(plain)).toHaveLength(1);
  });

  it('is kept nothing for a write to a brief that stands at the top, where spec-brief reads its briefs there', async () => {
    const repo = repository({ ...FILES, '.spec-brief.json': JSON.stringify({ briefs: '.', archive: 'archive' }), '001_rotate-tokens.md': FILES[BRIEF_FILE] }, null);
    install(repo.root, 'spec-brief');
    repo.git('checkout', '-q', '-b', 'brief/001-rotate');
    await hook(repo, 'PreToolUse', '001_rotate-tokens.md', call());
    expect(kept(repo)).toEqual([]);
    await hook(repo, 'PreToolUse', 'README.md', call());
    expect(kept(repo)).toHaveLength(1);
  });

  it('is decided again after a write that changed what decides, where the run before kept nothing', async () => {
    const repo = project();
    const id = call();
    await hook(repo, 'PreToolUse', '.spec-harness.json', id);
    repo.write('.spec-harness.json', '{ not json');
    expect(await hook(repo, 'PostToolUse', '.spec-harness.json', id)).toEqual({ code: 2, stdout: '', stderr: expect.stringMatching(/^spec-harness: \.spec-harness\.json is not valid JSON/) });
  });

  it('removes what no run after a write read in a day, as the next run before one keeps its own', async () => {
    const repo = project();
    await hook(repo, 'PreToolUse', 'src/auth/a.ts', call());
    const directory = join(repo.root, '.git', 'spec-harness', 'calls');
    const age = (name: string, hours: number): void => {
      writeFileSync(join(directory, name), '{}\n');
      const then = new Date(Date.now() - hours * 60 * 60 * 1000);
      utimesSync(join(directory, name), then, then);
    };
    age('session-0.old.json', 25);
    age('session-0.recent.json', 23);
    age('session-0.old.json.4242.tmp', 25);
    const id = call();
    await hook(repo, 'PreToolUse', 'src/auth/a.ts', id);
    expect(kept(repo)).toEqual(['session-0.recent.json', `session-1.${id}.json`, `session-1.toolu_${calls - 1}.json`].sort());
  });

  it('answers before a write as it would have where nothing can be kept', async () => {
    const repo = project();
    mkdirSync(join(repo.root, '.git', 'spec-harness'), { recursive: true });
    writeFileSync(join(repo.root, '.git', 'spec-harness', 'calls'), 'a file where the directory would be\n');
    expect(await hook(repo, 'PreToolUse', 'src/auth/a.ts', call())).toEqual({ code: 0, stdout: '', stderr: '' });
    const refused = await hook(repo, 'PreToolUse', 'src/db/schema.ts', call());
    expect(refused.code).toBe(0);
    expect(JSON.parse(refused.stdout)).toMatchObject({ hookSpecificOutput: { permissionDecision: 'deny' } });
  });

  it('finds what was kept in a linked worktree the session started in, under the common directory', async () => {
    const repo = repository(FILES, { tools: siblings() });
    const linked = join(temp(), 'linked');
    repo.git('worktree', 'add', '-q', '-b', 'brief/001-linked', linked);
    const tree: Repository = { ...repo, root: linked };
    const id = call();
    await hook(tree, 'PreToolUse', 'README.md', id);
    expect(readdirSync(join(repo.root, '.git', 'spec-harness', 'calls'))).toEqual([`session-1.${id}.json`]);
    expect((await withoutGit(() => hook(tree, 'PostToolUse', 'README.md', id))).stdout).toMatch(WARNING);
    expect(readdirSync(join(repo.root, '.git', 'spec-harness', 'calls'))).toEqual([]);
  });
});

describe('the run after a write, where nothing was kept', () => {
  it('says nothing under outOfScope ask or deny, asking neither git nor spec-brief', async () => {
    for (const outOfScope of ['ask', 'deny']) {
      const repo = project({ outOfScope });
      unInstall(repo);
      expect(await withoutGit(() => hook(repo, 'PostToolUse', 'README.md', call())), outOfScope).toEqual({ code: 0, stdout: '', stderr: '' });
      // A session below the root, with no work tree between, is the same work tree's.
      expect(await hook(repo, 'PostToolUse', 'README.md', call(), { extra: { cwd: join(repo.root, 'src', 'auth') } }), outOfScope).toEqual({ code: 0, stdout: '', stderr: '' });
    }
  });

  it('decides as before under outOfScope warn, under a configuration that does not load, and where git may read another work tree', async () => {
    const warn = project({ outOfScope: 'warn' });
    unInstall(warn);
    expect(await hook(warn, 'PostToolUse', 'README.md', call())).toEqual({ code: 2, stdout: '', stderr: NOT_INSTALLED });
    const broken = project();
    broken.write('.spec-harness.json', '{ "outOfScope": "sideways" }\n');
    expect(await hook(broken, 'PostToolUse', 'README.md', call())).toEqual({ code: 2, stdout: '', stderr: 'spec-harness: .spec-harness.json: "outOfScope" must be "warn", "ask" or "deny"\n' });
    // Where git is sent elsewhere, or the configuration moves the work tree, or keeps one for a worktree.
    const deny = project({ outOfScope: 'deny' });
    unInstall(deny);
    for (const env of [{ GIT_DIR: join(deny.root, '.git') }, { GIT_WORK_TREE: deny.root }]) {
      expect(await hook(deny, 'PostToolUse', 'README.md', call(), { env }), JSON.stringify(env)).toEqual({ code: 2, stdout: '', stderr: NOT_INSTALLED });
    }
    deny.git('config', 'core.worktree', deny.root);
    expect(await hook(deny, 'PostToolUse', 'README.md', call())).toEqual({ code: 2, stdout: '', stderr: NOT_INSTALLED });
    deny.git('config', '--unset', 'core.worktree');
    writeFileSync(join(deny.root, '.git', 'config.worktree'), '[core]\n');
    expect(await hook(deny, 'PostToolUse', 'README.md', call())).toEqual({ code: 2, stdout: '', stderr: NOT_INSTALLED });
    rmSync(join(deny.root, '.git', 'config.worktree'));
    // A session in a repository of its own inside the project.
    const nested = join(deny.root, 'vendor', 'n');
    mkdirSync(nested, { recursive: true });
    git(nested, 'init', '-q', '-b', 'main');
    expect(await hook(deny, 'PostToolUse', 'README.md', call(), { extra: { cwd: nested } })).toEqual({ code: 2, stdout: '', stderr: NOT_INSTALLED });
    expect(await withoutGit(() => hook(deny, 'PostToolUse', 'README.md', call()))).toEqual({ code: 0, stdout: '', stderr: '' });
    // A session outside the work tree; and a question that names no directory, which is the project's.
    expect(await hook(deny, 'PostToolUse', 'README.md', call(), { extra: { cwd: temp() } })).toEqual({ code: 2, stdout: '', stderr: NOT_INSTALLED });
    expect(await hook(deny, 'PostToolUse', 'README.md', call(), { extra: { cwd: undefined } })).toEqual({ code: 0, stdout: '', stderr: '' });
    // A session in no work tree has nothing to say, as before.
    const outside = temp();
    expect(await cli(['hook', 'claude'], outside, { stdin: JSON.stringify({ session_id: 's', tool_use_id: call(), cwd: outside, hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: join(outside, 'a.ts') } }), env: { CLAUDE_PROJECT_DIR: outside } })).toEqual({ code: 0, stdout: '', stderr: '' });
  });
});
