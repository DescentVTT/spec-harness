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
 * `hooks/hooks.json` and `.mcp.json` at v0.1.0 to v0.13.0. A line is added
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
  { releases: '0.1.2 to 0.13.0', where: HOOKS, line: ['node', `\${CLAUDE_PROJECT_DIR}/${SCRIPT}`, 'hook', 'claude'] },
  { releases: '0.1.0 to 0.1.1', where: "the server init registered in .mcp.json, and the plugin's .mcp.json", line: ['npx', '--no-install', 'spec-harness', 'mcp'] },
  { releases: '0.1.2 to 0.13.0', where: 'the server init registered in .mcp.json', line: ['node', `\${CLAUDE_PROJECT_DIR:-.}/${SCRIPT}`, 'mcp', '--root', '${CLAUDE_PROJECT_DIR:-.}'] },
  { releases: '0.1.2 to 0.13.0', where: "the plugin's .mcp.json", line: ['node', `\${CLAUDE_PROJECT_DIR}/${SCRIPT}`, 'mcp', '--root', '${CLAUDE_PROJECT_DIR}'] },
  {
    releases: '0.1.0 to 0.9.1',
    where: "the pre-commit hook init --git-hook wrote, and the line init and doctor gave for a hook of the repository's own",
    line: 'npx --no-install spec-harness hook git',
  },
  { releases: '0.10.0 to 0.13.0', where: 'the pre-commit hook init --git-hook wrote, with bin set to the script', line: 'node "$bin" hook git' },
  { releases: '0.10.0 to 0.13.0', where: "the line init and doctor give for a hook of the repository's own", line: `node ${SCRIPT} hook git` },
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

const QUESTION = (event = 'PreToolUse'): string =>
  JSON.stringify({ session_id: 's', cwd: repo.root, hook_event_name: event, tool_name: 'Edit', tool_input: { file_path: join(repo.root, 'src', 'db', 'schema.ts'), old_string: 'a', new_string: 'b' } });

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

  it('are read argument for argument: the command, the word after it, and a root only where one is written', () => {
    // The parser is asked first, and a line it refused would be one no release ever had refused.
    const read = (argv: readonly string[]): unknown => (({ command, positionals, given, root }) => ({ command, positionals, given, root }))(parseOptions(argv));
    expect(read(['hook', 'claude'])).toEqual({ command: 'hook', positionals: ['claude'], given: [], root: undefined });
    expect(read(['hook', 'git'])).toEqual({ command: 'hook', positionals: ['git'], given: [], root: undefined });
    expect(read(['mcp'])).toEqual({ command: 'mcp', positionals: [], given: [], root: undefined });
    expect(read(['mcp', '--root', '.'])).toEqual({ command: 'mcp', positionals: [], given: ['root'], root: '.' });
    expect(read(['mcp', '--root', '/the/project'])).toEqual({ command: 'mcp', positionals: [], given: ['root'], root: '/the/project' });
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

  it("put no --root on a hook's line: one that stands there, and what the hook says of it, is a person's", () => {
    // Claude Code's hook says a root that is not there, with exit 1. Every
    // line a release wrote for a hook is still handed to it without one.
    const hooks = WRITTEN.filter((written) => wordsOf(written.line).includes('hook'));
    expect(hooks.map((written) => wordsOf(written.line).at(-1))).toEqual(['claude', 'claude', 'git', 'git', 'git']);
    for (const written of hooks) expect(wordsOf(written.line), written.releases).not.toContain('--root');
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
  // would be exit 2 before every write, the one that mends the line included.
  it('answers as it did: what it does not read is passed over, and the write is still refused', async () => {
    for (const rest of [['extra', '--strict', '--format', 'json', '--note', 'x', '--list', '--id', ''], ['--brief', ' ', '--base', '']]) {
      const result = await cli(['hook', 'claude', ...rest], repo.root, { stdin: QUESTION() });
      expect(result, rest.join(' ')).toMatchObject({ code: 0, stderr: '' });
      expect(JSON.parse(result.stdout), rest.join(' ')).toMatchObject({ hookSpecificOutput: { permissionDecision: 'deny' } });
    }
  });

  it('keeps its own answers: exit 1 for a question it cannot read, exit 0 outside a work tree, exit 2 for a brief that is not one', async () => {
    expect(await cli(['hook', 'claude', 'extra', '--strict'], repo.root, { stdin: 'not json' })).toEqual({ code: 1, stdout: '', stderr: 'spec-harness: the hook input is not JSON\n' });
    // A root that is there and is no work tree is a session outside one.
    expect(await cli(['hook', 'claude', '--root', temp()], repo.root, { stdin: QUESTION() })).toEqual({ code: 0, stdout: '', stderr: '' });
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

describe("Claude Code's hook, with a --root on its line that is not there", () => {
  // No release wrote a --root on the hook's line: one that stands there is a
  // person's. A root that is a file, or is not there, read as a session
  // outside a work tree: exit 0, no word, and the write went on unguarded.
  // It is said now, and with exit 1: to Claude Code an error that does not
  // block, whose first line of stderr it shows the person. Exit 2 would hold
  // every write of the session over a line only a write can mend (ADR-0005).
  const said = (root: string): string =>
    `spec-harness: --root is "${root}", which is not a directory, so the guard is off and this write is not checked; give the hook's line a directory that exists, or leave --root out for the project Claude Code names\n`;

  it('says so in one line with exit 1, before a write and after one, and refuses nothing', async () => {
    const nowhere = join(repo.root, 'nowhere');
    for (const event of ['PreToolUse', 'PostToolUse']) {
      expect(await cli(['hook', 'claude', '--root', nowhere], repo.root, { stdin: QUESTION(event) }), event).toEqual({ code: 1, stdout: '', stderr: said(nowhere) });
    }
    const file = join(repo.root, 'src', 'db', 'schema.ts');
    expect(await cli(['hook', 'claude', '--root', file], repo.root, { stdin: QUESTION() })).toEqual({ code: 1, stdout: '', stderr: said(file) });
    // Space alone names no directory either; git started in none for it.
    expect(await cli(['hook', 'claude', '--root', ' '], repo.root, { stdin: QUESTION() })).toEqual({ code: 1, stdout: '', stderr: said(' ') });
  });

  it('is exit 1 whatever stands beside it, never the exit 2 that holds every write, and never an answer', async () => {
    const nowhere = join(repo.root, 'nowhere');
    // --brief 404 alone holds the write, exit 2: the root is asked about first, since no brief can be read without one.
    for (const rest of [['--brief', '404'], ['--brief', '', '--base', ' '], ['001', '--brief', '001', '--list', '--path', 'src/a.ts', '--strict']]) {
      const result = await cli(['hook', 'claude', '--root', nowhere, ...rest], repo.root, { stdin: QUESTION() });
      expect(result, rest.join(' ')).toEqual({ code: 1, stdout: '', stderr: said(nowhere) });
    }
  });

  it('keeps what the hook answered before it: a question it cannot read, and a tool that writes no file', async () => {
    const nowhere = join(repo.root, 'nowhere');
    expect(await cli(['hook', 'claude', '--root', nowhere], repo.root, { stdin: 'not json' })).toEqual({ code: 1, stdout: '', stderr: 'spec-harness: the hook input is not JSON\n' });
    const bash = JSON.stringify({ session_id: 's', cwd: repo.root, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } });
    expect(await cli(['hook', 'claude', '--root', nowhere], repo.root, { stdin: bash })).toEqual({ code: 0, stdout: '', stderr: '' });
  });

  it('guards as it did where the root is empty, in the directory the hook was started in, whatever else another command would refuse', async () => {
    // An empty root is what an unset variable leaves on a line written by
    // hand, and git starts where the hook did for it: the write is refused,
    // as in every release, not waved through with a line about the root.
    // Beside it, what every other command refuses since: an option --list
    // leaves unread, and a brief named twice.
    const result = await cli(['hook', 'claude', '--root', '', '001', '--brief', '001', '--list', '--path', 'src/a.ts', '--show', 'E-001-1'], repo.root, { stdin: QUESTION() });
    expect(result).toMatchObject({ code: 0, stderr: '' });
    expect(JSON.parse(result.stdout)).toMatchObject({ hookSpecificOutput: { permissionDecision: 'deny' } });
  });
});

describe("Claude Code's hook, on a line the parser cannot read", () => {
  // An option no command has, an option left without its value, a --format
  // or an --at that is none: each was exit 2 before the question was read,
  // which to Claude Code holds the write, and every write after it, the one
  // that mends the line among them. It is said as a root that is not there
  // is: one line, exit 1, where there is a write the line leaves unchecked
  // (ADR-0005).
  const OFF = '), so the guard is off and this write is not checked; mend it in Claude Code\'s settings, where init writes "hook claude" and nothing after it\n';
  const said = (wrong: string): string => `spec-harness: the hook's line cannot be read (${wrong}${OFF}`;

  /** Lines node's parser refuses, each with how its refusal starts: the rest is node's to word. */
  const REFUSED: readonly (readonly [readonly string[], string])[] = [
    [['--nope'], "Unknown option '--nope'"],
    [['--nope=value', 'extra'], "Unknown option '--nope'"],
    [['-x'], "Unknown option '-x'"],
    [['--root'], "Option '--root <value>' argument missing"],
    [['--brief'], "Option '--brief <value>' argument missing"],
    [['--strict=yes'], "Option '--strict' does not take an argument"],
    [['--format'], "Option '--format <value>' argument missing"],
  ];

  /** Lines that parse, and name a format or a probe position that is none: the harness's own words. */
  const NONE: readonly (readonly [readonly string[], string])[] = [
    [['--format', 'xml'], '--format must be pretty, json, gitlab, sarif or github, not "xml"'],
    [['--format', ''], '--format must be pretty, json, gitlab, sarif or github, not ""'],
    [['--format', 'gitlab'], '--format gitlab is for audit and premises; hook prints pretty or json'],
    [['--at', 'sideways'], '--at must be base, head or both, not "sideways"'],
  ];

  it('says so in one line with exit 1, before a write and after one, and holds no write for it', async () => {
    for (const event of ['PreToolUse', 'PostToolUse']) {
      for (const [rest, starts] of REFUSED) {
        const result = await cli(['hook', 'claude', ...rest], repo.root, { stdin: QUESTION(event) });
        const where = `${event}: ${rest.join(' ')}`;
        expect({ code: result.code, stdout: result.stdout }, where).toEqual({ code: 1, stdout: '' });
        expect(result.stderr.startsWith(`spec-harness: the hook's line cannot be read (${starts}`), `${where}: ${result.stderr}`).toBe(true);
        expect(result.stderr.endsWith(OFF), where).toBe(true);
        // One line: Claude Code shows the first of a hook that exits 1.
        expect(result.stderr.indexOf('\n'), where).toBe(result.stderr.length - 1);
      }
      for (const [rest, wrong] of NONE) {
        expect(await cli(['hook', 'claude', ...rest], repo.root, { stdin: QUESTION(event) }), `${event}: ${rest.join(' ')}`).toEqual({ code: 1, stdout: '', stderr: said(wrong) });
      }
    }
  });

  it('keeps on one line what node says in three of an option that may have lost its value', async () => {
    const result = await cli(['hook', 'claude', '--root', '--brief', '001'], repo.root, { stdin: QUESTION() });
    expect({ code: result.code, stdout: result.stdout }).toEqual({ code: 1, stdout: '' });
    expect(result.stderr).toBe(
      said("Option '--root' argument is ambiguous. Did you forget to specify the option argument for '--root'? To specify an option argument starting with a dash use '--root=-XYZ'."),
    );
  });

  it('is exit 1 whatever else stands on the line or names the brief, never the exit 2 that holds every write, and never an answer', async () => {
    // --brief 404 alone holds the write, exit 2, and so does SPEC_BRIEF: a line that cannot be read names no round.
    for (const rest of [['--brief', '404', '--nope'], ['--nope', '--root', join(repo.root, 'nowhere')], ['--version', '--nope'], ['--help=1'], ['extra', '--list', '--nope']]) {
      for (const event of ['PreToolUse', 'PostToolUse']) {
        const result = await cli(['hook', 'claude', ...rest], repo.root, { stdin: QUESTION(event), env: { SPEC_BRIEF: '404' } });
        expect({ code: result.code, stdout: result.stdout }, `${event}: ${rest.join(' ')}`).toEqual({ code: 1, stdout: '' });
        expect(result.stderr.endsWith(OFF), `${event}: ${rest.join(' ')}`).toBe(true);
      }
    }
  });

  it("is the hook's line wherever the option stands, and a value before the command is not taken for it", async () => {
    for (const argv of [['--nope', 'hook', 'claude'], ['hook', '--nope', 'claude'], ['--root', repo.root, 'hook', 'claude', '--nope'], ['hook', 'claude', 'extra', '-x']]) {
      const result = await cli(argv, repo.root, { stdin: QUESTION() });
      expect({ code: result.code, stdout: result.stdout }, argv.join(' ')).toEqual({ code: 1, stdout: '' });
      expect(result.stderr.endsWith(OFF), argv.join(' ')).toBe(true);
    }
  });

  it('keeps what the hook answered before it: a question it cannot read, and a tool that writes no file', async () => {
    expect(await cli(['hook', 'claude', '--nope'], repo.root, { stdin: 'not json' })).toEqual({ code: 1, stdout: '', stderr: 'spec-harness: the hook input is not JSON\n' });
    expect(await cli(['hook', 'claude', '--format', 'xml'], repo.root, { stdin: '{"tool_name":"Write"}' })).toEqual({ code: 1, stdout: '', stderr: 'spec-harness: the hook input names no event or tool\n' });
    const bash = JSON.stringify({ session_id: 's', cwd: repo.root, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } });
    for (const rest of [['--nope'], ['--root'], ['--at', 'sideways']]) {
      expect(await cli(['hook', 'claude', ...rest], repo.root, { stdin: bash }), rest.join(' ')).toEqual({ code: 0, stdout: '', stderr: '' });
    }
  });

  it("is the hook's alone: git's hook, a hook that is neither and every other command stop on the same line, exit 2", async () => {
    // git stops one commit on a line a person reads, who can then mend the hook.
    const git = await cli(['hook', 'git', '--nope'], repo.root, { stdin: QUESTION() });
    expect({ code: git.code, stdout: git.stdout }).toEqual({ code: 2, stdout: '' });
    expect(git.stderr.startsWith("spec-harness: Unknown option '--nope'")).toBe(true);
    expect(git.stderr).not.toContain('the guard is off');
    expect(await cli(['hook', 'git', '--format', 'xml'], repo.root, { stdin: QUESTION() })).toEqual({
      code: 2,
      stdout: '',
      stderr: 'spec-harness: --format must be pretty, json, gitlab, sarif or github, not "xml"\n',
    });
    // A line that does not say whose hook it is, is nobody's: the word claude taken for a value, misspelt, or left out.
    for (const argv of [['hook', '--brief', 'claude', '--nope'], ['hook', 'claud', '--nope'], ['hook', '--nope'], ['guard', 'claude', '--nope'], ['--nope']]) {
      const result = await cli(argv, repo.root, { stdin: QUESTION() });
      expect({ code: result.code, stdout: result.stdout }, argv.join(' ')).toEqual({ code: 2, stdout: '' });
      expect(result.stderr.startsWith("spec-harness: Unknown option '--nope'"), argv.join(' ')).toBe(true);
    }
  });
});

describe("Claude Code's hook, whatever is on its line", () => {
  // The two things a line must never do: answer `allow`, which would skip
  // the person's own permission prompt, and hold a write, exit 2, for what is
  // wrong with the line itself. Exit 2 is for a write the hook could not
  // check, as for the brief that is named and is not one, above.
  const LINES: readonly (readonly string[])[] = [
    // Read, and passed over: the word as an option, an argument and a value.
    ['--allow', 'allow', '--note', 'allow'],
    // Not read, or with a root that is not there: said, and nothing answered.
    ['--allow', '--nope'],
    ['--allow=allow'],
    ['--root'],
    ['--format', 'allow'],
    ['--at', 'allow'],
    ['--allow', '--root', 'nowhere'],
  ];

  it('never answers allow, and never holds a write for its own line: one the round may make, one it may not, one outside its scope', async () => {
    const before = (path: string): string =>
      JSON.stringify({ session_id: 's', cwd: repo.root, hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: join(repo.root, ...path.split('/')), content: 'x' } });
    for (const rest of LINES) {
      for (const path of ['src/auth/a.ts', 'src/db/schema.ts', 'README.md']) {
        const result = await cli(['hook', 'claude', ...rest], repo.root, { stdin: before(path) });
        const where = `${rest.join(' ')} | ${path}`;
        expect(result.stdout, where).not.toContain('"allow"');
        expect([0, 1], where).toContain(result.code);
        // The line that is read still decides: the protected file is refused.
        if (rest === LINES[0] && path === 'src/db/schema.ts') expect(JSON.parse(result.stdout)).toMatchObject({ hookSpecificOutput: { permissionDecision: 'deny' } });
      }
    }
  });
});
