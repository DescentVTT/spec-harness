/**
 * The work tree a hook decides for (ADR-0005, amended 2026-10-18).
 *
 * Claude Code names the project a session started in, and hands the hook
 * the directory Claude works in as `cwd`: in a worktree session started from
 * the desktop app, and after Claude enters a worktree, the first is the main
 * checkout and the second the worktree. The hook read the main checkout's
 * branch, which named no brief, and let a write the worktree's brief
 * protects pass with no word. Each test here runs the command line on the
 * words Claude Code's line hands it, with the question Claude Code asks.
 */

import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { brief, BRIEF_FILE, cleanup, cli, git, install, installFake, parsed, repository, temp, write, type Repository } from './helpers.js';

afterAll(cleanup);

const FILES = {
  [BRIEF_FILE]: brief({ affected: ['src/auth/**'], protected: ['src/db/**'] }),
  '.gitignore': 'node_modules/\n.claude/worktrees/\n',
  'src/db/schema.ts': 'table;\n',
  'src/auth/a.ts': 'a;\n',
  'README.md': '# x\n',
};

/** A project with no configuration and spec-brief installed in its main checkout, on `branch`. */
function project(branch = 'main'): Repository {
  const repo = repository(FILES, null);
  install(repo.root, 'spec-brief');
  if (branch !== 'main') repo.git('checkout', '-q', '-b', branch);
  return repo;
}

/** A linked worktree of `repo` at `path`, on a new branch. */
function linked(repo: Repository, path: string, branch: string, from = 'main'): string {
  repo.git('worktree', 'add', '-q', '-b', branch, path, from);
  return path;
}

const file = (root: string, path: string): string => join(root, ...path.split('/'));

function question(event: string, cwd: string, input: Record<string, unknown>): string {
  return JSON.stringify({ session_id: 's', transcript_path: '/t', cwd, hook_event_name: event, tool_name: 'Edit', tool_input: { old_string: 'a', new_string: 'b', ...input } });
}

/** The hook as Claude Code starts it: in the project it names, with that project in CLAUDE_PROJECT_DIR. */
async function hook(projectDir: string, event: string, cwd: string, input: Record<string, unknown>) {
  return cli(['hook', 'claude'], projectDir, { stdin: question(event, cwd, input), env: { CLAUDE_PROJECT_DIR: projectDir } });
}

function decision(stdout: string): string | undefined {
  return stdout === '' ? undefined : (JSON.parse(stdout) as { hookSpecificOutput: { permissionDecision?: string } }).hookSpecificOutput.permissionDecision;
}

const REFUSAL = 'spec-harness: brief 001 does not empower this round to change src/db/schema.ts (protectedFiles: src/db/**)';

describe('a session in a linked worktree, with the project Claude Code names on main', () => {
  it("refuses a write the worktree's brief protects, inside the project, beside it, and from below its top", async () => {
    const repo = project();
    const inside = linked(repo, join(repo.root, '.claude', 'worktrees', 'w'), 'claude/brief-001-w');
    const beside = linked(repo, join(temp(), 'beside'), 'claude/brief-001-b');
    // And one inside it in a directory of the project's own, where no name starts with a dot.
    const nested = linked(repo, join(repo.root, 'trees', 'n'), 'claude/brief-001-n');
    for (const [tree, cwd] of [
      [inside, inside],
      [beside, beside],
      [inside, join(inside, 'src')],
      [nested, nested],
    ] as const) {
      const result = await hook(repo.root, 'PreToolUse', cwd, { file_path: file(tree, 'src/db/schema.ts') });
      expect({ code: result.code, stderr: result.stderr, decision: decision(result.stdout) }, cwd).toEqual({ code: 0, stderr: '', decision: 'deny' });
      expect(result.stdout, cwd).toContain(REFUSAL);
    }
  });

  it("says nothing of a write in the worktree's scope, and warns after one outside it, by its brief", async () => {
    const repo = project();
    const tree = linked(repo, join(repo.root, '.claude', 'worktrees', 'w'), 'claude/brief-001-w');
    expect(await hook(repo.root, 'PreToolUse', tree, { file_path: file(tree, 'src/auth/a.ts') })).toEqual({ code: 0, stdout: '', stderr: '' });
    expect(await hook(repo.root, 'PostToolUse', tree, { file_path: file(tree, 'src/auth/a.ts') })).toEqual({ code: 0, stdout: '', stderr: '' });
    const after = await hook(repo.root, 'PostToolUse', tree, { file_path: file(tree, 'README.md') });
    expect(after.code).toBe(0);
    expect(JSON.parse(after.stdout)).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: expect.stringMatching(/^spec-harness: README\.md is outside brief 001's scope, which covers src\/auth\/\*\*\. Next: /),
      },
    });
  });

  it.skipIf(process.platform === 'win32')('refuses it where the one start of git cannot be read for the worktree, whose top holds a line break', async () => {
    // Its common directory is asked for again, from its top (workspace.ts).
    const repo = project();
    const tree = linked(repo, join(temp(), 'two\nlines'), 'claude/brief-001-w');
    const result = await hook(repo.root, 'PreToolUse', tree, { file_path: file(tree, 'src/db/schema.ts') });
    expect({ code: result.code, decision: decision(result.stdout) }).toEqual({ code: 0, decision: 'deny' });
  });

  it("runs the worktree's own install where it has one, and the project's where it has none", async () => {
    const repo = project();
    const tree = linked(repo, join(repo.root, '.claude', 'worktrees', 'w'), 'claude/brief-001-w');
    // Its own, too old to run: it is the one read, and the write waits, though the project's would do.
    installFake(tree, 'spec-brief', JSON.stringify({ version: '0.1.0' }));
    expect(await hook(repo.root, 'PreToolUse', tree, { file_path: file(tree, 'src/db/schema.ts') })).toEqual({
      code: 2,
      stdout: '',
      stderr: 'spec-harness: cannot check this write: spec-brief 0.1.0 is installed here; spec-harness needs 0.2.0 or later: npm install --save-dev @descent-vtt/spec-brief@latest\n',
    });
    // Neither has one: the write waits, as it did.
    const bare = repository(FILES, null);
    const elsewhere = linked(bare, join(bare.root, '.claude', 'worktrees', 'w'), 'claude/brief-001-w');
    expect(await hook(bare.root, 'PreToolUse', elsewhere, { file_path: file(elsewhere, 'src/db/schema.ts') })).toEqual({
      code: 2,
      stdout: '',
      stderr: 'spec-harness: cannot check this write: spec-brief is not installed here: npm install --save-dev @descent-vtt/spec-brief, or name its command under "tools" in .spec-harness.json\n',
    });
  });
});

describe("git's hook and doctor in a linked worktree with no install", () => {
  it("read the main work tree's siblings: a protected commit is refused, and doctor says whose install it read", async () => {
    const repo = project();
    const tree = linked(repo, join(temp(), 'linked'), 'brief/001-linked');
    write(tree, 'src/db/schema.ts', 'changed;\n');
    git(tree, 'add', 'src/db/schema.ts');
    const commit = await cli(['hook', 'git'], tree);
    expect(commit.code).toBe(1);
    expect(commit.stderr).toContain('refused  brief 001 does not empower this round to change src/db/schema.ts');
    const doctor = parsed<{ siblings: { tool: string; state: string; elsewhere: string | null }[] }>(await cli(['doctor', '--format', 'json'], tree));
    expect(doctor.siblings.find((sibling) => sibling.tool === 'spec-brief')).toMatchObject({ state: 'found', elsewhere: expect.any(String) });
    // Every other command reads the work tree's own install, as before.
    expect(await cli(['guard', 'src/db/schema.ts'], tree)).toMatchObject({ code: 2, stderr: expect.stringContaining('spec-brief is not installed here') });
  });
});

describe("the project's own writes", () => {
  it('are decided by its own branch, from a worktree inside it or beside it on a branch that names no brief', async () => {
    const repo = project('brief/001-main');
    const inside = linked(repo, join(repo.root, '.claude', 'worktrees', 'side'), 'side');
    const beside = linked(repo, join(temp(), 'beside'), 'side2');
    for (const cwd of [repo.root, inside, beside]) {
      const result = await hook(repo.root, 'PreToolUse', cwd, { file_path: file(repo.root, 'src/db/schema.ts') });
      expect({ code: result.code, decision: decision(result.stdout) }, cwd).toEqual({ code: 0, decision: 'deny' });
      expect(result.stdout, cwd).toContain(REFUSAL);
    }
    // The worktree's own file is its own branch's, which names no brief: nothing before the write, and nothing after it.
    expect(await hook(repo.root, 'PreToolUse', inside, { file_path: file(inside, 'src/db/schema.ts') })).toEqual({ code: 0, stdout: '', stderr: '' });
    expect(await hook(repo.root, 'PostToolUse', inside, { file_path: file(inside, 'src/db/schema.ts') })).toEqual({ code: 0, stdout: '', stderr: '' });
    // One question that names a file of each: each is decided where it is, and the refusal stands.
    const both = await hook(repo.root, 'PreToolUse', inside, { file_path: file(inside, 'src/db/schema.ts'), path: file(repo.root, 'src/db/schema.ts') });
    expect({ code: both.code, decision: decision(both.stdout) }).toEqual({ code: 0, decision: 'deny' });
    expect(JSON.parse(both.stdout).hookSpecificOutput.permissionDecisionReason.split('\n')).toHaveLength(1);
  });

  it("are a worktree's where the project is that worktree, inside a main checkout on a branch that names no brief", async () => {
    const repo = project();
    const tree = linked(repo, join(repo.root, '.claude', 'worktrees', 'w'), 'claude/brief-001-w');
    install(tree, 'spec-brief');
    // Claude Code names the worktree, and Claude has gone up into the main checkout around it.
    const result = await hook(tree, 'PreToolUse', repo.root, { file_path: file(tree, 'src/db/schema.ts') });
    expect({ code: result.code, decision: decision(result.stdout) }).toEqual({ code: 0, decision: 'deny' });
    expect(result.stdout).toContain(REFUSAL);
    // The main checkout's file of that name is its own branch's, as it was.
    expect(await hook(tree, 'PreToolUse', repo.root, { file_path: file(repo.root, 'src/db/schema.ts') })).toEqual({ code: 0, stdout: '', stderr: '' });
  });
});

describe('a brief that is none, in one work tree or the other', () => {
  it("holds only the writes of the work tree whose branch names it, and a question with no cwd is the project's", async () => {
    // The worktree's branch names a brief spec-brief does not know: the project's own file is the project's to decide.
    const repo = project('brief/001-main');
    const unknown = linked(repo, join(repo.root, '.claude', 'worktrees', 'u'), 'claude/brief-999-u');
    const own = await hook(repo.root, 'PreToolUse', unknown, { file_path: file(repo.root, 'src/db/schema.ts') });
    expect({ code: own.code, decision: decision(own.stdout) }).toEqual({ code: 0, decision: 'deny' });
    const held = await hook(repo.root, 'PreToolUse', unknown, { file_path: file(unknown, 'src/db/schema.ts') });
    expect(held).toEqual({ code: 2, stdout: '', stderr: 'spec-harness: the branch names brief 999, and spec-brief knows no such brief. Fix the brief or the branch before writing.\n' });
    // The project's branch names one: a write in a worktree whose brief is one is that worktree's to decide.
    const other = project('brief/999-main');
    const tree = linked(other, join(other.root, '.claude', 'worktrees', 'w'), 'claude/brief-001-w');
    const there = await hook(other.root, 'PreToolUse', tree, { file_path: file(tree, 'src/db/schema.ts') });
    expect({ code: there.code, decision: decision(there.stdout) }).toEqual({ code: 0, decision: 'deny' });
    expect((await hook(other.root, 'PreToolUse', tree, { file_path: file(other.root, 'src/db/schema.ts') })).code).toBe(2);
    // No cwd in the question: the project, as before.
    const bare = await cli(['hook', 'claude'], repo.root, {
      stdin: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: file(repo.root, 'src/db/schema.ts') } }),
      env: { CLAUDE_PROJECT_DIR: repo.root },
    });
    expect({ code: bare.code, decision: decision(bare.stdout) }).toEqual({ code: 0, decision: 'deny' });
  });
});

describe('a cwd in another repository, or in none', () => {
  it("leaves every write where it was: decided by the project's briefs, by the path it has in the project", async () => {
    const repo = project('brief/001-main');
    // A repository of its own inside the project, on a branch whose brief protects one of its files.
    const nested = join(repo.root, 'vendor', 'n');
    write(nested, 'briefs/099_n.md', brief({ title: '099 - Nested', affected: ['lib/**'], protected: ['secret.txt'] }));
    write(nested, 'secret.txt', 'secret\n');
    git(nested, 'init', '-q', '-b', 'brief/099-n');
    git(nested, 'add', '-A');
    git(nested, 'commit', '-q', '-m', 'n');
    for (const cwd of [nested, temp(), join(repo.root, 'no-such-directory')]) {
      const result = await hook(repo.root, 'PreToolUse', cwd, { file_path: file(repo.root, 'src/db/schema.ts') });
      expect({ code: result.code, decision: decision(result.stdout) }, cwd).toEqual({ code: 0, decision: 'deny' });
    }
    // What that lets through: the nested repository's own brief is not read, and its file is outside the project's scope.
    expect(await hook(repo.root, 'PreToolUse', nested, { file_path: file(nested, 'secret.txt') })).toEqual({ code: 0, stdout: '', stderr: '' });
    const after = await hook(repo.root, 'PostToolUse', nested, { file_path: file(nested, 'secret.txt') });
    expect(JSON.parse(after.stdout).hookSpecificOutput.additionalContext).toMatch(/^spec-harness: vendor\/n\/secret\.txt is outside brief 001's scope/);
  });
});

describe('a branch beside a tag of its name', () => {
  it('names its brief: the hook refuses a protected write, git\'s hook a protected commit, and doctor says the brief', async () => {
    const repo = project('claude/brief-001-t');
    repo.git('tag', 'claude/brief-001-t');
    const result = await hook(repo.root, 'PreToolUse', repo.root, { file_path: file(repo.root, 'src/db/schema.ts') });
    expect({ code: result.code, decision: decision(result.stdout) }).toEqual({ code: 0, decision: 'deny' });
    repo.write('src/db/schema.ts', 'changed;\n');
    repo.git('add', 'src/db/schema.ts');
    const commit = await cli(['hook', 'git'], repo.root);
    expect(commit.code).toBe(1);
    expect(commit.stderr).toContain('refused  brief 001 does not empower this round to change src/db/schema.ts');
    const doctor = parsed<{ branch: string; brief: string | null }>(await cli(['doctor', '--format', 'json'], repo.root));
    expect({ branch: doctor.branch, brief: doctor.brief }).toEqual({ branch: 'claude/brief-001-t', brief: '001' });
  });
});
