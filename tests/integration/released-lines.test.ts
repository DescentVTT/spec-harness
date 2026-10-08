/**
 * The command lines the releases put into people's repositories.
 *
 * `init` writes the guard hooks into `.claude/settings.json`, the server
 * into `.mcp.json` and git's pre-commit hook, and never writes one of them
 * again: a repository keeps the line the release it ran wrote. The plugin
 * ships the same hooks and server. So each line any release wrote is one a
 * later release is still handed, argument for argument, and a release that
 * refuses what an earlier one accepted is held to them here: none may be
 * refused, and Claude Code's hook least of all, since exit 2 from it holds
 * every write of a session (ADR-0005, ADR-0012).
 *
 * The lines are data, read from the tags: `src/setup.ts`, `src/configure.ts`,
 * `hooks/hooks.json` and `.mcp.json` at v0.1.0 to v0.11.1. A line is added
 * here when a release changes what it writes, and none is taken out.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { GIT_HOOK_LINE, GUARD_HOOK, mcpServer, PRE_COMMIT, PROJECT_DIR, PROJECT_DIR_OR_HERE } from '../../src/configure.js';
import { refusal } from '../../src/usage.js';
import { parseOptions } from '../../src/workspace.js';
import { brief, BRIEF_FILE, cleanup, cli, repository, ROOT, temp, type Repository } from './helpers.js';

afterAll(cleanup);

const SCRIPT = 'node_modules/@descent-vtt/spec-harness/bin/spec-harness.js';

interface Written {
  /** The releases whose `init` wrote the line, or whose plugin shipped it. */
  readonly releases: string;
  readonly where: string;
  /** As it was written: one string where a shell reads it, a program and its arguments where none does. */
  readonly line: string | readonly string[];
}

const HOOKS = "the guard hooks init wrote into .claude/settings.json, and the plugin's hooks/hooks.json";

const WRITTEN: readonly Written[] = [
  { releases: '0.1.0 to 0.1.1', where: HOOKS, line: 'npx --no-install spec-harness hook claude' },
  { releases: '0.1.2 to 0.11.1', where: HOOKS, line: ['node', `\${CLAUDE_PROJECT_DIR}/${SCRIPT}`, 'hook', 'claude'] },
  { releases: '0.1.0 to 0.1.1', where: "the server init registered in .mcp.json, and the plugin's .mcp.json", line: ['npx', '--no-install', 'spec-harness', 'mcp'] },
  { releases: '0.1.2 to 0.11.1', where: 'the server init registered in .mcp.json', line: ['node', `\${CLAUDE_PROJECT_DIR:-.}/${SCRIPT}`, 'mcp', '--root', '${CLAUDE_PROJECT_DIR:-.}'] },
  { releases: '0.1.2 to 0.11.1', where: "the plugin's .mcp.json", line: ['node', `\${CLAUDE_PROJECT_DIR}/${SCRIPT}`, 'mcp', '--root', '${CLAUDE_PROJECT_DIR}'] },
  {
    releases: '0.1.0 to 0.9.1',
    where: "the pre-commit hook init --git-hook wrote, and the line init and doctor gave for a hook of the repository's own",
    line: 'npx --no-install spec-harness hook git',
  },
  { releases: '0.10.0 to 0.11.1', where: 'the pre-commit hook init --git-hook wrote, with bin set to the script', line: 'node "$bin" hook git' },
  { releases: '0.10.0 to 0.11.1', where: "the line init and doctor give for a hook of the repository's own", line: `node ${SCRIPT} hook git` },
];

/** The words of a line, as a shell splits one that holds no space inside a word. */
function wordsOf(line: string | readonly string[]): readonly string[] {
  return typeof line === 'string' ? line.split(' ') : line;
}

/**
 * What the harness is handed: the words after the one that starts it, each
 * placeholder filled in as Claude Code fills it, `project` being the project
 * where Claude Code knows it and `null` where it does not. `null` for a
 * line that starts nothing then: its script's path, with nothing in front
 * of it, is at the top of the filesystem, where node finds none.
 */
function handed(line: Written['line'], project: string | null): string[] | null {
  const words = wordsOf(line).map((word) =>
    word
      .split('${CLAUDE_PROJECT_DIR:-.}')
      .join(project ?? '.')
      .split('${CLAUDE_PROJECT_DIR}')
      .join(project ?? ''),
  );
  const launcher = words.findIndex((word) => word === 'spec-harness' || word === '"$bin"' || word.endsWith('/spec-harness.js'));
  if (launcher === -1) throw new Error(`no launcher in ${words.join(' ')}`);
  return (words[launcher] as string).startsWith('/node_modules/') ? null : words.slice(launcher + 1);
}

let repo: Repository;

beforeAll(() => {
  repo = repository({ [BRIEF_FILE]: brief({ affected: ['src/auth/**'], protected: ['src/db/**'] }), 'src/db/schema.ts': 'table;\n' });
  repo.git('checkout', '-q', '-b', 'brief/001-rotate');
  // A commit that would change a protected file: what git's hook is asked about.
  repo.write('src/db/schema.ts', 'table changed;\n');
  repo.git('add', 'src/db/schema.ts');
});

const QUESTION = (): string =>
  JSON.stringify({ session_id: 's', cwd: repo.root, hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: join(repo.root, 'src', 'db', 'schema.ts'), old_string: 'a', new_string: 'b' } });

const SESSION = `${[
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } },
  { jsonrpc: '2.0', method: 'notifications/initialized' },
  { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'check_path', arguments: { paths: ['src/db/schema.ts'] } } },
]
  .map((message) => JSON.stringify(message))
  .join('\n')}\n`;

/** What the server answered the one call of {@link SESSION}. */
function answered(stdout: string): string {
  const answers = stdout
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as { id: number; result?: { content?: { text: string }[] } });
  return answers.find((answer) => answer.id === 2)?.result?.content?.[0]?.text ?? stdout;
}

describe('the lines the releases wrote', () => {
  it('are these, down to what this release writes, so that a line it changes is a line added here', () => {
    const lines = WRITTEN.map((written) => written.line);
    expect(lines).toContainEqual([GUARD_HOOK['command'], ...(GUARD_HOOK['args'] as string[])]);
    const project = mcpServer(PROJECT_DIR_OR_HERE);
    expect(lines).toContainEqual([project['command'], ...(project['args'] as string[])]);
    const plugin = mcpServer(PROJECT_DIR);
    expect(lines).toContainEqual([plugin['command'], ...(plugin['args'] as string[])]);
    expect(lines).toContain(GIT_HOOK_LINE);
    // The hook's last line, without the `exec` that hands it the shell.
    expect(PRE_COMMIT).toContain(`\nbin=${SCRIPT}\n`);
    expect(lines).toContain(PRE_COMMIT.trimEnd().split('\n').at(-1)?.replace(/^exec /, ''));
    // And the plugin's own files hold lines that are listed.
    const hooks = JSON.parse(readFileSync(join(ROOT, 'hooks', 'hooks.json'), 'utf8')) as { hooks: Record<string, { hooks: { command: string; args: string[] }[] }[]> };
    for (const event of ['PreToolUse', 'PostToolUse']) {
      for (const hook of hooks.hooks[event]?.flatMap((group) => group.hooks) ?? []) expect(lines, event).toContainEqual([hook.command, ...hook.args]);
    }
    const servers = JSON.parse(readFileSync(join(ROOT, '.mcp.json'), 'utf8')) as { mcpServers: Record<string, { command: string; args: string[] }> };
    const server = servers.mcpServers['spec-harness'] as { command: string; args: string[] };
    expect(lines).toContainEqual([server.command, ...server.args]);
  });

  /** Every command line they hand the harness: where Claude Code knows the project, and where its environment does not hold it. */
  const HANDED = WRITTEN.flatMap((written) => ['/the/project', null].flatMap((project) => handed(written.line, project) ?? [])).length;

  it('hand the harness these five command lines, and no other', () => {
    const all = WRITTEN.flatMap((written) => ['/the/project', null].map((project) => handed(written.line, project)?.join(' ')));
    expect([...new Set(all.filter((argv) => argv !== undefined))].sort()).toEqual(['hook claude', 'hook git', 'mcp', 'mcp --root .', 'mcp --root /the/project']);
    expect(HANDED).toBeGreaterThan(0);
  });

  it('are none of them refused: each is read as the release that wrote it read it', () => {
    const isDirectory = (path: string): boolean => path === '/the/project' || path === '.';
    for (const written of WRITTEN) {
      for (const project of ['/the/project', null]) {
        const argv = handed(written.line, project);
        if (argv !== null) expect(refusal(parseOptions(argv), isDirectory), `${written.releases}: ${wordsOf(written.line).join(' ')}`).toBeNull();
      }
    }
  });

  it('name the root of a server by the placeholder they find its script with, so a root filled with nothing never ran', () => {
    // --root "" is refused now, where it ran in the directory the server was
    // started in. No line here was ever handed it and ran: the placeholder
    // that would leave the root empty leaves the script without its path.
    const rooted = WRITTEN.filter((written) => wordsOf(written.line).includes('--root'));
    expect(rooted).toHaveLength(2);
    for (const written of rooted) {
      const words = wordsOf(written.line);
      const root = words[words.indexOf('--root') + 1] as string;
      expect(root).toMatch(/^\$\{CLAUDE_PROJECT_DIR(?::-\.)?\}$/);
      expect(words[1]).toBe(`${root}/${SCRIPT}`);
    }
  });
});

describe('each line, run', () => {
  it("answers Claude Code's hook before a write to a protected file with a refusal, and exit 0", async () => {
    const result = await cli(['hook', 'claude'], repo.root, { stdin: QUESTION() });
    expect(result).toMatchObject({ code: 0, stderr: '' });
    expect(JSON.parse(result.stdout)).toMatchObject({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny' } });
  });

  it("answers git's hook for a commit that changes a protected file with a refusal, and exit 1", async () => {
    const result = await cli(['hook', 'git'], repo.root);
    expect(result).toMatchObject({ code: 1, stdout: '' });
    expect(result.stderr).toContain('refused  brief 001 does not empower this round to change src/db/schema.ts');
  });

  it('serves the project it runs in, and the one --root names from anywhere else', async () => {
    const here = await cli(['mcp'], repo.root, { stdin: SESSION });
    expect(here).toMatchObject({ code: 0, stderr: '' });
    expect(answered(here.stdout)).toMatch(/^deny: brief 001 does not empower this round to change src\/db\/schema\.ts/);
    // The plugin's line, from the plugin's own directory. `--root .`, which a
    // project's line is where Claude Code's environment does not hold the
    // project, is run as Claude Code runs it in claude-code.test.ts.
    const rooted = await cli(['mcp', '--root', repo.root], temp(), { stdin: SESSION });
    expect(rooted).toMatchObject({ code: 0, stderr: '' });
    expect(answered(rooted.stdout)).toMatch(/^deny: brief 001 does not empower/);
  });
});

describe("Claude Code's hook, with more on its line than a release wrote", () => {
  // Every other command refuses these. The hook reads its line as 0.11.1
  // did: a settings file is not the harness's to rewrite, and a refusal here
  // is exit 2 before every write, the one that would mend the line included.
  it('answers as it did: what it does not read is passed over, and the write is still refused', async () => {
    for (const rest of [['extra', '--strict', '--format', 'json', '--note', 'x', '--list', '--id', ''], ['--brief', ' ', '--base', '']]) {
      const result = await cli(['hook', 'claude', ...rest], repo.root, { stdin: QUESTION() });
      expect(result, rest.join(' ')).toMatchObject({ code: 0, stderr: '' });
      expect(JSON.parse(result.stdout), rest.join(' ')).toMatchObject({ hookSpecificOutput: { permissionDecision: 'deny' } });
    }
  });

  it('keeps its own answers: exit 1 for a question it cannot read, exit 0 outside a work tree, exit 2 for a brief that is not one', async () => {
    expect(await cli(['hook', 'claude', 'extra', '--strict'], repo.root, { stdin: 'not json' })).toEqual({ code: 1, stdout: '', stderr: 'spec-harness: the hook input is not JSON\n' });
    expect(await cli(['hook', 'claude', '--root', join(repo.root, 'nowhere')], repo.root, { stdin: QUESTION() })).toEqual({ code: 0, stdout: '', stderr: '' });
    expect(await cli(['hook', 'claude', '--brief', '404'], repo.root, { stdin: QUESTION() })).toEqual({
      code: 2,
      stdout: '',
      stderr: 'spec-harness: the flag names brief 404, and spec-brief knows no such brief. Fix the brief or the branch before writing.\n',
    });
  });

  it("is the only line read so: git's hook refuses what it does not take, and the commit waits on a line that says why", async () => {
    expect(await cli(['hook', 'git', 'extra'], repo.root)).toEqual({ code: 2, stdout: '', stderr: 'spec-harness: hook takes one argument, "claude" or "git", not "git", "extra"\n' });
    expect(await cli(['hook', 'git', '--strict'], repo.root)).toEqual({ code: 2, stdout: '', stderr: 'spec-harness: hook does not take --strict; its options are --brief, --base and --root\n' });
  });
});
