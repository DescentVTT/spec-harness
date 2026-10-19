import { spawn, spawnSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import { chmodSync, copyFileSync, cpSync, existsSync, linkSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { HELP, run } from '../../src/cli.js';
import { mergeClaudeSettings, mergeMcp, reportHooks } from '../../src/configure.js';
import { BIN, brief, BRIEF_FILE, claudeOf, cleanup, cli, git, installFake, installHarness, installPlugin, parsed, repository, ROOT, siblings, SPEC_BRIEF, spawnBin, temp, write, type Repository } from './helpers.js';

afterAll(cleanup);

const VERSION = (JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string }).version;

describe('the command line', () => {
  it('prints its help, and exits 2 when given no command', async () => {
    expect(await cli(['--help'], ROOT)).toEqual({ code: 0, stdout: HELP, stderr: '' });
    expect(await cli(['guard', '-h'], ROOT)).toEqual({ code: 0, stdout: HELP, stderr: '' });
    expect(await cli([], ROOT)).toEqual({ code: 2, stdout: HELP, stderr: '' });
  });

  it('prints its version', async () => {
    expect(await cli(['--version'], ROOT)).toEqual({ code: 0, stdout: `${VERSION}\n`, stderr: '' });
    expect(await cli(['-v', 'guard'], ROOT)).toEqual({ code: 0, stdout: `${VERSION}\n`, stderr: '' });
  });

  it('refuses an unknown command or flag with exit 2', async () => {
    expect(await cli(['archive'], ROOT)).toEqual({ code: 2, stdout: '', stderr: 'spec-harness: unknown command "archive"; see spec-harness --help\n' });
    const flag = await cli(['guard', '--frobnicate'], ROOT);
    expect(flag.code).toBe(2);
    expect(flag.stderr).toContain("Unknown option '--frobnicate'");
    expect(await cli(['audit', '--format', 'xml'], ROOT)).toEqual({ code: 2, stdout: '', stderr: 'spec-harness: --format must be pretty, json, gitlab, sarif or github, not "xml"\n' });
  });

  it('names every command in its help', () => {
    for (const command of ['context', 'guard', 'hook claude', 'hook git', 'escalate', 'rule', 'rulings', 'audit', 'probe', 'premises', 'init', 'mcp', 'doctor']) {
      expect(HELP, command).toContain(`\n  ${command} `);
    }
  });

  it('refuses to run outside a git work tree', async () => {
    const outside = temp();
    const result = await cli(['guard', 'a.ts'], outside);
    expect(result).toEqual({ code: 2, stdout: '', stderr: `spec-harness: ${outside} is not inside a git work tree; spec-harness measures rounds by their commits\n` });
    expect((await cli(['doctor', '--root', outside], ROOT)).code).toBe(2);
  });
});

describe('an input that is set and names nothing', () => {
  // Each ran as if it had not been given, and answered, exit 0, a question
  // nobody had put (spec-core ADR-0005).
  it('is refused in one line that names it, exit 2, before the command reads or writes anything', async () => {
    const repo = repository({ [BRIEF_FILE]: brief({ affected: ['src/**'] }) });
    const refused = async (argv: string[], stderr: string): Promise<void> => {
      expect(await cli(argv, repo.root), argv.join(' ')).toEqual({ code: 2, stdout: '', stderr: `spec-harness: ${stderr}\n` });
    };
    await refused(['doctor', '--note', 'x'], 'doctor does not take --note; its options are --brief, --base, --root, --format and --strict');
    await refused(['premises', 'extra'], 'premises takes no argument, not "extra"');
    await refused(['mcp', '--brief', '1'], 'mcp does not take --brief; its only option is --root');
    await refused(['guard', 'src/a.ts', ''], 'guard was given "" as a path, which names none; give it the paths the round would write');
    await refused(['context', '--brief', ' '], '--brief is " ", which names no brief; give it a brief\'s id, or leave it out for the one SPEC_BRIEF or the branch names');
    await refused(['audit', '--base', ''], '--base is "", which names no commit; give it a branch or a commit, or leave it out for the configured base');
    await refused(['guard', 'src/a.ts', '--root', ''], '--root is "", which names no directory; give it one, or leave it out to run in the current directory');
    // A request spelled out beside --list printed the list and was never
    // raised, and a brief named twice was the argument's with no word.
    await refused(['escalate', '--list', '--path', 'src/a.ts', '--reason', 'why'], 'escalate --list does not take --path; beside --list its options are --root and --format');
    await refused(['escalate', '--show', 'E-001-1', '--brief', '1'], 'escalate --show does not take --brief; beside --show its options are --root and --format');
    await refused(['audit', '1', '--brief', '1'], 'audit was given the brief twice, as its argument "1" and as --brief "1"; give one of them');
    // init mydir set up the directory it stood in, and wrote there.
    await refused(['init', 'mydir', '--write'], 'init takes no argument, not "mydir"');
    expect(existsSync(join(repo.root, '.claude'))).toBe(false);
    expect(existsSync(join(repo.root, '.mcp.json'))).toBe(false);
  });

  it('is a --root that is a file or is not there, by the option\'s name, and not one that is a directory', async () => {
    // Each was `is not inside a git work tree`, which named no option.
    const repo = repository({ 'notes.txt': 'a file\n' });
    const words = 'which is not a directory; give it one that exists, or leave it out to run in the current directory';
    for (const root of [join(repo.root, 'notes.txt'), join(repo.root, 'nowhere')]) {
      expect(await cli(['doctor', '--root', root], repo.root)).toEqual({ code: 2, stdout: '', stderr: `spec-harness: --root is "${root}", ${words}\n` });
    }
    // A directory that is in no work tree is one, and is refused for what it is.
    const outside = temp();
    expect((await cli(['doctor', '--root', outside], repo.root)).stderr).toBe(`spec-harness: ${outside} is not inside a git work tree; spec-harness measures rounds by their commits\n`);
    const there = await cli(['guard', join(repo.root, 'a.ts'), '--root', repo.root], temp());
    expect(there).toMatchObject({ code: 0, stderr: '' });
    expect(there.stdout).toMatch(/^ok {7}no brief governs /);
  });

  it('is refused with --help or --version on the line, as an option no command has always was (spec-core ADR-0005)', async () => {
    // Each printed the help or the version, exit 0, and said nothing of what was wrong.
    const repo = repository({ 'notes.txt': 'a file\n' });
    const nowhere = join(repo.root, 'nowhere');
    for (const answer of ['--help', '-h', '--version', '-v']) {
      for (const [argv, stderr] of [
        [['doctor', 'extra', '--note', 'x', answer], 'doctor does not take --note; its options are --brief, --base, --root, --format and --strict'],
        [['doctor', 'extra', answer], 'doctor takes no argument, not "extra"'],
        [[answer, 'init', 'mydir', '--root', ''], 'init takes no argument, not "mydir"'],
        [['doctor', answer, '--root', ''], '--root is "", which names no directory; give it one, or leave it out to run in the current directory'],
        [['doctor', '--root', nowhere, answer], `--root is "${nowhere}", which is not a directory; give it one that exists, or leave it out to run in the current directory`],
        [['audit', '1', '--brief', '1', answer], 'audit was given the brief twice, as its argument "1" and as --brief "1"; give one of them'],
        [['escalate', '--list', '--path', 'src/a.ts', answer], 'escalate --list does not take --path; beside --list its options are --root and --format'],
        [['guard', answer, ''], 'guard was given "" as a path, which names none; give it the paths the round would write'],
        [['hook', 'git', answer, '--strict'], 'hook does not take --strict; its options are --brief, --base and --root'],
        [['doctor', answer, '--root', 'a', '--root', 'b'], '--root is given twice, as "a" and as "b", and one of the two would go unread; give it one'],
        [['archive', answer], 'unknown command "archive"; see spec-harness --help'],
        [[answer, 'constructor'], 'unknown command "constructor"; see spec-harness --help'],
      ] as const) {
        expect(await cli(argv, repo.root), argv.join(' ')).toEqual({ code: 2, stdout: '', stderr: `spec-harness: ${stderr}\n` });
      }
    }
  });

  it('answers --help and --version on a line that is right, a command that needs more than the line gives it among them', async () => {
    // guard needs a path, hook the word after it, rule --allow or --deny and escalate a request: each says so when it runs, which --help asks it not to.
    for (const argv of [[], ['doctor'], ['guard'], ['hook'], ['hook', 'claude'], ['rule'], ['escalate'], ['doctor', '--root', '.', '--root', './'], ['context', '--brief', '1', '--brief', '001']]) {
      expect(await cli([...argv, '--help'], ROOT), argv.join(' ')).toEqual({ code: 0, stdout: HELP, stderr: '' });
      expect(await cli(['-v', ...argv], ROOT), argv.join(' ')).toEqual({ code: 0, stdout: `${VERSION}\n`, stderr: '' });
    }
    expect(await cli(['archive', 'extra', '--note', 'x'], ROOT)).toEqual({ code: 2, stdout: '', stderr: 'spec-harness: unknown command "archive"; see spec-harness --help\n' });
    expect(await cli(['--root', ''], ROOT)).toEqual({ code: 2, stdout: HELP, stderr: '' });
  });

  it('refuses --help beside --version, in either order, in one line that names both', async () => {
    // The version was printed, and the help went unread.
    for (const [argv, first, other] of [
      [['--help', '--version'], '--help', '--version'],
      [['--version', '--help'], '--version', '--help'],
      [['doctor', '-h', '-v'], '-h', '-v'],
      [['hook', 'git', '-v', '--help'], '-v', '--help'],
    ] as const) {
      expect(await cli(argv, ROOT), argv.join(' ')).toEqual({ code: 2, stdout: '', stderr: `spec-harness: ${first} is given beside ${other}, and one of the two answers would go unread; give one of them\n` });
    }
  });
});

describe('an option that takes one value, given two', () => {
  // The parser kept the last, and the earlier went unread with no word of it:
  // `doctor --root nowhere --root .` ran in `.`, and `--brief 404 --brief 001`
  // was brief 001 (spec-core ADR-0005).
  it('is refused, exit 2, in one line that names both, before the command reads or writes anything', async () => {
    const repo = repository({ [BRIEF_FILE]: brief({ affected: ['src/**'] }) });
    const twice = (option: string, first: string, other: string): string =>
      `spec-harness: --${option} is given twice, as ${JSON.stringify(first)} and as ${JSON.stringify(other)}, and one of the two would go unread; give it one\n`;
    for (const [argv, option, first, other] of [
      [['doctor', '--root', 'nowhere', '--root', '.'], 'root', 'nowhere', '.'],
      [['context', '--brief', '404', '--brief', '001'], 'brief', '404', '001'],
      [['audit', '--base', 'nowhere', '--base', 'main'], 'base', 'nowhere', 'main'],
      [['guard', 'src/a.ts', '--format', 'pretty', '--format', 'json'], 'format', 'pretty', 'json'],
      [['probe', '--at', 'sideways', '--at', 'head'], 'at', 'sideways', 'head'],
      [['probe', '--id', 'p', '--id', 'q'], 'id', 'p', 'q'],
      [['escalate', '--path', 'src/a.ts', '--reason', 'why', '--reason', 'because'], 'reason', 'why', 'because'],
      [['escalate', '--path', 'src/a.ts', '--reason', 'why', '--recommend', 'Allow.', '--recommend', 'Deny.'], 'recommend', 'Allow.', 'Deny.'],
      [['escalate', '--show', 'E-001-1', '--show', 'E-001-2'], 'show', 'E-001-1', 'E-001-2'],
      [['rule', 'E-001-1', '--allow', '--note', 'one', '--note', 'two'], 'note', 'one', 'two'],
      [['hook', 'git', '--root', 'src', '--root', '.'], 'root', 'src', '.'],
      [['mcp', '--root', '.', '--root', 'src'], 'root', '.', 'src'],
      [['init', '--write', '--format', 'json', '--format', 'pretty'], 'format', 'json', 'pretty'],
      // Before an option the command does not read, and with no command at all.
      [['doctor', '--note', 'x', '--root', 'a', '--root', 'b'], 'root', 'a', 'b'],
      [['--root', 'a', '--root', 'b'], 'root', 'a', 'b'],
    ] as const) {
      expect(await cli(argv, repo.root), argv.join(' ')).toEqual({ code: 2, stdout: '', stderr: twice(option, first, other) });
    }
    // Nothing was raised, and init wrote nothing.
    expect(existsSync(join(repo.root, '.git', 'spec-harness'))).toBe(false);
    expect(existsSync(join(repo.root, '.claude'))).toBe(false);
  });

  it('is the option once where the two name one thing as it reads them, and runs with the last', async () => {
    const repo = repository({ [BRIEF_FILE]: brief({ affected: ['src/**'] }), 'src/a.ts': 'a;\n' });
    // A relative root is read from where the command is started, which is not the directory a test runs it for.
    const here = await cli(['doctor', '--root', repo.root, '--root', `${repo.root}/`, '--format', 'json', '--format', 'json'], repo.root);
    expect(here).toMatchObject({ code: 0, stderr: '' });
    expect(parsed<{ root: string }>(here).root).toBe(parsed<{ root: string }>(await cli(['doctor', '--format', 'json'], repo.root)).root);
    // A brief by its id, as spec-brief's names are matched.
    const guarded = await cli(['guard', 'src/a.ts', '--brief', '1', '--brief', ' 001 '], repo.root);
    expect(guarded).toMatchObject({ code: 0, stderr: '' });
    expect(guarded.stdout).toMatch(/^ok {7}src\/a\.ts is in brief 001's scope/);
  });

  it('keeps a list a list: each --path and each --option is one more', async () => {
    const repo = repository({ [BRIEF_FILE]: brief({ affected: ['src/**'] }) });
    repo.git('checkout', '-q', '-b', 'brief/001-rotate');
    const raised = await cli(['escalate', '--path', 'src/a.ts', '--path', 'src/b.ts', '--reason', 'why', '--option', 'Allow: one', '--option', 'Refuse'], repo.root);
    expect(raised).toMatchObject({ code: 1, stderr: '' });
    for (const said of ['src/a.ts', 'src/b.ts', 'Allow', 'Refuse']) expect(raised.stdout, said).toContain(said);
  });
});

interface Refused {
  readonly code: number;
  readonly stderr: string;
}

/**
 * The command line with a stdout that throws. No command expects the stream
 * to refuse a write, so it stands for every error none of them names. Left
 * to reject, such an error reached the launcher as Node's uncaught error,
 * exit 1: a refusal or a finding to a script, and to Claude Code a hook that
 * failed without blocking.
 */
async function refusing(argv: readonly string[], cwd: string, options: { readonly thrown?: unknown; readonly stdin?: () => Promise<string> } = {}): Promise<Refused> {
  let stderr = '';
  const thrown = 'thrown' in options ? options.thrown : new Error('the stream is gone');
  const code = await run(argv, {
    stdout: {
      write: () => {
        throw thrown;
      },
    },
    stderr: { write: (text: string) => (stderr += text) },
    cwd,
    env: {},
    ...(options.stdin === undefined ? {} : { stdin: options.stdin }),
  });
  return { code, stderr };
}

describe('an error the harness did not expect', () => {
  // The stack, so a report of it says where: the message alone names no line.
  const GONE = /^spec-harness: unexpected error: Error: the stream is gone\n {4}at [^]*\n$/;
  const BROKE = /^spec-harness: unexpected error: Error: the pipe broke\n {4}at [^]*\n$/;
  const broke = async (): Promise<string> => {
    throw new Error('the pipe broke');
  };

  it('ends --version and --help with exit 2 and the stack on stderr', async () => {
    for (const argv of [['--version'], ['--help'], []]) {
      const result = await refusing(argv, ROOT);
      expect(result.code, argv.join(' ')).toBe(2);
      expect(result.stderr, argv.join(' ')).toMatch(GONE);
    }
  });

  it('ends a command the same way, in either format', async () => {
    const repo = repository({ [BRIEF_FILE]: brief({ protected: ['src/db/schema.ts'] }), 'src/db/schema.ts': 'x\n' });
    for (const argv of [['guard', 'src/db/schema.ts', '--brief', '1'], ['guard', 'src/db/schema.ts', '--brief', '1', '--format', 'json'], ['doctor']]) {
      const result = await refusing(argv, repo.root);
      expect(result.code, argv.join(' ')).toBe(2);
      expect(result.stderr, argv.join(' ')).toMatch(GONE);
    }
    // The server, when what it is sent cannot be read.
    const server = await refusing(['mcp'], repo.root, { stdin: broke });
    expect(server.code).toBe(2);
    expect(server.stderr).toMatch(BROKE);
  });

  it('answers a hook with exit 2 too, which is what makes Claude Code hold a write (ADR-0012)', async () => {
    const repo = repository({ [BRIEF_FILE]: brief({ affected: ['src/**'], protected: ['src/db/schema.ts'] }) });
    const hook = (event: string, file: string): string => JSON.stringify({ hook_event_name: event, tool_name: 'Write', cwd: repo.root, tool_input: { file_path: file } });
    // After a write outside the scope the hook has a warning to print.
    const after = await refusing(['hook', 'claude', '--brief', '1'], repo.root, { stdin: async () => hook('PostToolUse', 'docs/notes.md') });
    expect(after.code).toBe(2);
    expect(after.stderr).toMatch(GONE);
    // Before one, the hook answers its own way, as it did: the write waits.
    const before = await refusing(['hook', 'claude', '--brief', '1'], repo.root, { stdin: async () => hook('PreToolUse', 'src/db/schema.ts') });
    expect(before).toEqual({ code: 2, stderr: 'spec-harness: cannot check this write: the stream is gone\n' });
    // A hook whose input cannot be read at all has no event to answer by: as
    // for a question it cannot parse, it refuses nothing it cannot see.
    expect(await refusing(['hook', 'claude'], repo.root, { stdin: broke })).toEqual({ code: 1, stderr: 'spec-harness: the hook input could not be read: the pipe broke\n' });
  });

  it('reports the message of an error that has no stack, and a thrown value that is no Error as it reads', async () => {
    const bare = new Error('no stack on this one');
    delete bare.stack;
    expect(await refusing(['--version'], ROOT, { thrown: bare })).toEqual({ code: 2, stderr: 'spec-harness: unexpected error: no stack on this one\n' });
    expect(await refusing(['--version'], ROOT, { thrown: 'only a string' })).toEqual({ code: 2, stderr: 'spec-harness: unexpected error: only a string\n' });
  });

  it('still names an error it does expect by its message alone', async () => {
    const outside = temp();
    expect(await refusing(['guard', 'a.ts'], outside)).toEqual({
      code: 2,
      stderr: `spec-harness: ${outside} is not inside a git work tree; spec-harness measures rounds by their commits\n`,
    });
  });
});

describe('a reader that closed the output', () => {
  // `spec-harness context | head`: the write fails with EPIPE once head has
  // left. The answer was not delivered, which is still 2, and nothing in the
  // harness is at fault, so no stack says a defect was found.
  const failed = (code: string): Error => Object.assign(new Error(`${code}: the write failed`), { code, syscall: 'write' });
  const CLOSED = { code: 2, stderr: 'spec-harness: stdout was closed before all of the output was written\n' };

  it('ends the run with exit 2 and one line that says so, before a command and inside one', async () => {
    expect(await refusing(['--version'], ROOT, { thrown: failed('EPIPE') })).toEqual(CLOSED);
    expect(await refusing(['--help'], ROOT, { thrown: failed('EPIPE') })).toEqual(CLOSED);
    const repo = repository({ [BRIEF_FILE]: brief({ protected: ['src/db/schema.ts'] }), 'src/db/schema.ts': 'x\n' });
    expect(await refusing(['guard', 'src/db/schema.ts', '--brief', '1', '--format', 'json'], repo.root, { thrown: failed('EPIPE') })).toEqual(CLOSED);
    expect(await refusing(['doctor'], repo.root, { thrown: failed('EPIPE') })).toEqual(CLOSED);
  });

  it('keeps the stack of a write that failed for any other reason', async () => {
    // A disk that filled up under `> audit.json` is not a reader that left.
    const result = await refusing(['--version'], ROOT, { thrown: failed('ENOSPC') });
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/^spec-harness: unexpected error: Error: ENOSPC: the write failed\n {4}at /);
  });

  it('reads the code of the error, not its words', async () => {
    const result = await refusing(['--version'], ROOT, { thrown: new Error('EPIPE: broken pipe, write') });
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/^spec-harness: unexpected error: Error: EPIPE: broken pipe, write\n {4}at /);
  });
});

describe('a module of the build that is not there', () => {
  // The launcher says a build without its command line in this line. A
  // module the command line asks for where a command runs it is missing
  // from the same build, and is said the same way, with no stack.
  const MISSING = 'spec-harness: build output is missing; run "npm run build" first, or install the published package.\n';
  const gone = (code: string): Error => Object.assign(new Error("Cannot find module '/x/dist/commands.js' imported from /x/dist/cli.js"), { code });

  it('ends the run with exit 2 and the line the launcher has for it, read by its code', async () => {
    expect(await refusing(['--version'], ROOT, { thrown: gone('ERR_MODULE_NOT_FOUND') })).toEqual({ code: 2, stderr: MISSING });
    expect(readFileSync(BIN, 'utf8')).toContain(MISSING.trimEnd());
    // Any other failure to load keeps its stack.
    const other = await refusing(['--version'], ROOT, { thrown: gone('ERR_UNSUPPORTED_DIR_IMPORT') });
    expect(other.code).toBe(2);
    expect(other.stderr).toMatch(/^spec-harness: unexpected error: Error: Cannot find module [^]*\n {4}at /);
  });

  it('is said by the built command line for the command that runs the module, and is nothing to a command that does not', () => {
    // A copy of the build with one command's module taken out of it.
    const build = temp();
    for (const part of ['bin', 'dist', 'package.json']) cpSync(join(ROOT, part), join(build, part), { recursive: true });
    rmSync(join(build, 'dist', 'commands.js'));
    const repo = repository({ [BRIEF_FILE]: brief({ affected: ['src/**'], protected: ['src/db/schema.ts'] }), 'src/db/schema.ts': 'x\n' });
    repo.git('checkout', '-q', '-b', 'brief/001-rotate');
    const built = (args: readonly string[], input = ''): { code: number | null; stdout: string; stderr: string } => {
      const result = spawnSync(process.execPath, [join(build, 'bin', 'spec-harness.js'), ...args], { cwd: repo.root, input, encoding: 'utf8', env: { ...process.env, SPEC_BRIEF: '' } });
      return { code: result.status, stdout: result.stdout, stderr: result.stderr };
    };
    expect(built(['context'])).toEqual({ code: 2, stdout: '', stderr: MISSING });
    expect(built(['audit'])).toEqual({ code: 2, stdout: '', stderr: MISSING });
    expect(built(['--version'])).toEqual({ code: 0, stdout: `${VERSION}\n`, stderr: '' });
    const question = (event: string): string => JSON.stringify({ hook_event_name: event, tool_name: 'Edit', cwd: repo.root, tool_input: { file_path: 'src/db/schema.ts' } });
    const hook = built(['hook', 'claude'], question('PreToolUse'));
    expect(hook).toMatchObject({ code: 0, stderr: '' });
    expect(JSON.parse(hook.stdout).hookSpecificOutput.permissionDecision).toBe('deny');
    // Without the operations of a round the hook cannot check a write: it
    // holds the write before it, and ends in the launcher's line after it.
    rmSync(join(build, 'dist', 'round.js'));
    const held = built(['hook', 'claude'], question('PreToolUse'));
    expect(held).toMatchObject({ code: 2, stdout: '' });
    expect(held.stderr).toMatch(/^spec-harness: cannot check this write: Cannot find module .*round\.js' imported from .*cli\.js\n$/);
    expect(built(['hook', 'claude'], question('PostToolUse'))).toEqual({ code: 2, stdout: '', stderr: MISSING });
    expect(built(['guard', 'src/db/schema.ts'])).toEqual({ code: 2, stdout: '', stderr: MISSING });
    // And without the command line itself, the launcher's own line.
    rmSync(join(build, 'dist', 'cli.js'));
    expect(built(['--version'])).toEqual({ code: 2, stdout: '', stderr: MISSING });
  });
});

describe('a git command that failed', () => {
  it('is reported as what git said, on one line with no stack, and exit 2', async () => {
    // It ended on `unexpected error: GitError:` and a stack, as a defect would.
    const repo = repository({ 'a.txt': 'a\n' });
    repo.write('a.txt', 'b\n');
    repo.git('add', 'a.txt');
    expect((await cli(['hook', 'git'], repo.root)).code).toBe(0);
    // An index git cannot read: the hook cannot learn what is staged.
    repo.write('.git/index', 'no index');
    const unread = await cli(['hook', 'git'], repo.root);
    expect(unread.code).toBe(2);
    expect(unread.stdout).toBe('');
    expect(unread.stderr).toMatch(/^spec-harness: git diff --cached failed: fatal: [^]*\S\n$/);
    expect(unread.stderr).not.toMatch(/\n {4}at /);
  });
});

describe('the configuration', () => {
  it('stops the run on a key it does not know, or a file that is not JSON', async () => {
    const repo = repository({ [BRIEF_FILE]: brief() }, { outofscope: 'deny' });
    const unknown = await cli(['guard', 'a.ts'], repo.root);
    expect(unknown.code).toBe(2);
    expect(unknown.stderr).toBe(
      'spec-harness: .spec-harness.json: unknown key "outofscope"; the keys are $schema, branches, outOfScope, base, rulings, dependencies, context, assertions, probes, tools\n',
    );
    repo.write('.spec-harness.json', '{ "base": ');
    const broken = await cli(['guard', 'a.ts'], repo.root);
    expect(broken.code).toBe(2);
    expect(broken.stderr.startsWith('spec-harness: .spec-harness.json is not valid JSON: ')).toBe(true);
  });

  it('says a directory under its name is one, in a line of its own and not in Node\'s', async () => {
    // It was `is not valid JSON: EISDIR: illegal operation on a directory, read`.
    const repo = repository({}, null);
    mkdirSync(join(repo.root, '.spec-harness.json'));
    expect(await cli(['guard', 'a.ts'], repo.root)).toEqual({ code: 2, stdout: '', stderr: 'spec-harness: .spec-harness.json is a directory, not a configuration file\n' });
  });

  it('blocks the hook too, rather than guarding what the file did not say', async () => {
    const repo = repository({ [BRIEF_FILE]: brief() }, { outOfScope: 'block' });
    const input = JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Write', cwd: repo.root, tool_input: { file_path: 'a.ts' } });
    const result = await cli(['hook', 'claude'], repo.root, { stdin: input });
    expect(result).toEqual({ code: 2, stdout: '', stderr: 'spec-harness: .spec-harness.json: "outOfScope" must be "warn", "ask" or "deny"\n' });
  });
});

describe('the siblings', () => {
  function fake(script: string): string[] {
    const directory = temp();
    write(directory, 'sibling.js', script);
    return ['node', join(directory, 'sibling.js')];
  }

  it('reports which siblings it found, and fails only when it found none', async () => {
    const repo = repository({ [BRIEF_FILE]: brief() });
    repo.git('checkout', '-q', '-b', 'brief/001-x');
    const pretty = await cli(['doctor'], repo.root);
    expect(pretty.code).toBe(0);
    expect(pretty.stdout).toContain('branch  brief/001-x\nbrief   001\n');
    const mergeBase = repo.git('rev-parse', 'HEAD').slice(0, 12);
    expect(pretty.stdout).toContain(`\nbase    main (.spec-harness.json), merge base ${mergeBase}\n`);
    expect(pretty.stdout).toContain(
      '\nsigners .github/allowed_signers is not on main, so no ruling can count: commit it there, one line per person: <email> namespaces="git" <public key>\n',
    );
    expect(pretty.stdout).toContain('\nplugin  spec-brief has no configuration at the root, so it loads no plugin');
    expect(pretty.stdout).toContain(
      '\nclaude  neither the spec-harness plugin nor the hooks init writes, so Claude Code guards no write: run spec-harness init --write, or install the plugin\n',
    );
    expect(pretty.stdout).toContain(`found     spec-brief  node ${SPEC_BRIEF} (named in .spec-harness.json; its version is not checked)`);
    expect(pretty.stdout).toContain('absent    spec-graph  spec-graph is not installed here: npm install --save-dev @descent-vtt/spec-graph, or name its command under "tools" in .spec-harness.json');
    const json = parsed<{
      root: string;
      branch: string;
      brief: string;
      base: unknown;
      allowedSigners: unknown;
      plugin: unknown;
      claudeCode: unknown;
      siblings: { tool: string; state: string; version: string | null; minimum: string }[];
    }>(await cli(['doctor', '--format', 'json'], repo.root));
    expect(json.brief).toBe('001');
    expect(json.base).toEqual({ ref: 'main', source: 'config', mergeBase: repo.git('rev-parse', 'HEAD') });
    expect(json.allowedSigners).toMatchObject({ file: '.github/allowed_signers', onBase: false });
    expect(json.plugin).toMatchObject({ state: 'unconfigured', file: null });
    expect(json.claudeCode).toMatchObject({ state: 'none', plugin: null, hooks: [], server: false });
    expect(json.siblings.map((s) => [s.tool, s.state, s.version, s.minimum])).toEqual([
      ['spec-brief', 'found', null, '0.2.0'],
      ['spec-graph', 'absent', null, '0.9.0'],
      ['spec-guard', 'found', null, '0.12.0'],
    ]);
    const bare = repository({}, null);
    bare.git('checkout', '-q', '--detach');
    const none = await cli(['doctor'], bare.root);
    expect(none.code).toBe(1);
    expect(none.stdout).toContain('branch  (detached)\nbrief   (none named)\n');
    expect(none.stdout).toContain(
      '\nbase    none: no base is named and the remote has no default branch; pass --base <ref> or set "base"\nsigners .github/allowed_signers, read from the base, which could not be resolved: no ruling can count\n',
    );
    bare.write('.github/allowed_signers', 'x\n');
    bare.write('.spec-brief.json', '{ "plugins": [] }');
    bare.commit('signers');
    const based = await cli(['doctor', '--base', 'HEAD'], bare.root);
    expect(based.stdout).toContain(`\nbase    HEAD (--base), merge base ${bare.git('rev-parse', 'HEAD').slice(0, 12)}\nsigners .github/allowed_signers is on HEAD\n`);
    expect(based.stdout).toContain('\nplugin  spec-brief does not load spec-harness\'s plugin');
  });

  it('says in JSON what it could not read - no base, no signers file, no branch named - and adds no line about a Claude Code nothing wires', async () => {
    const bare = repository({}, null);
    bare.git('checkout', '-q', '--detach');
    const json = parsed<{ branch: unknown; branchSource: unknown; base: unknown; allowedSigners: unknown }>(await cli(['doctor', '--format', 'json'], bare.root));
    expect(json).toMatchObject({ branch: null, branchSource: null, base: { unresolved: expect.any(String) } });
    // No base, so no file was read from it: nothing is on it, nothing is wrong with it.
    expect(json.allowedSigners).toMatchObject({ onBase: null, notFido2: [], problems: [] });
    expect((await cli(['doctor'], bare.root)).stdout).toMatch(/\nclaude  [^\n]*\ngit     /);
    // CI names the branch of a detached head, and the JSON says which variable did.
    const named = parsed<{ branch: unknown; branchSource: unknown }>(await cli(['doctor', '--format', 'json'], bare.root, { env: { GITHUB_HEAD_REF: 'brief/001-x' } }));
    expect(named).toMatchObject({ branch: 'brief/001-x', branchSource: 'GITHUB_HEAD_REF' });
  });

  it('reports the Claude Code plugin beside init\'s hooks and server as a double install, with exit 1 (ADR-0012)', async () => {
    const local = JSON.stringify({ enabledPlugins: { 'spec-harness@spec-tools': true } });
    const repo = repository({
      '.claude/settings.json': JSON.stringify(mergeClaudeSettings({})),
      '.claude/settings.local.json': local,
      '.mcp.json': JSON.stringify(mergeMcp({})),
    });
    const pretty = await cli(['doctor'], repo.root);
    expect(pretty.code).toBe(1);
    expect(pretty.stdout).toContain(
      "\nclaude  the spec-harness plugin is on (spec-harness@spec-tools in .claude/settings.local.json), beside the guard hooks in .claude/settings.json, the server in .mcp.json: every write is guarded twice and the server is registered twice. Keep one: take spec-harness's entries out of those files, or turn the plugin off for this project with claude plugin disable spec-harness@spec-tools --scope local\n",
    );
    expect(parsed<{ claudeCode: unknown }>(await cli(['doctor', '--format', 'json'], repo.root)).claudeCode).toMatchObject({
      state: 'both',
      plugin: { id: 'spec-harness@spec-tools', file: '.claude/settings.local.json' },
      hooks: ['.claude/settings.json'],
      server: true,
    });
    // Turned off for the project, the plugin leaves init's entries alone, and doctor passes.
    repo.write('.claude/settings.local.json', JSON.stringify({ enabledPlugins: { 'spec-harness@spec-tools': false } }));
    const settled = await cli(['doctor'], repo.root);
    expect(settled.code).toBe(0);
    expect(settled.stdout).toContain("\nclaude  init's entries: the guard hooks in .claude/settings.json, the server in .mcp.json\n");
  });

  it('reports the plugin alone, turned on in the user\'s settings, as the guard, with exit 0', async () => {
    const user = temp();
    write(user, 'settings.json', JSON.stringify({ enabledPlugins: { 'spec-harness@spec-tools': true } }));
    const repo = repository({ '.claude/settings.json': JSON.stringify({ permissions: {} }) });
    const result = await cli(['doctor'], repo.root, { env: { CLAUDE_CONFIG_DIR: user } });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(`\nclaude  the spec-harness plugin is on (spec-harness@spec-tools in ${join(user, 'settings.json')}) and brings the guard hooks and the server\n`);
  });

  it('reports a sibling older than this release runs as a problem, naming the minimum', async () => {
    const repo = repository({}, null);
    const bin = installFake(repo.root, 'spec-brief', JSON.stringify({ version: '0.2.1' }));
    installFake(repo.root, 'spec-guard', JSON.stringify({ version: '0.11.0' }));
    const pretty = await cli(['doctor'], repo.root);
    expect(pretty.code).toBe(1);
    expect(pretty.stdout).toContain(`found     spec-brief  ${process.execPath} ${bin} (0.2.1)`);
    expect(pretty.stdout).toContain(
      'outdated  spec-guard  spec-guard 0.11.0 is installed here; spec-harness needs 0.12.0 or later: npm install --save-dev @descent-vtt/spec-guard@latest',
    );
    const json = parsed<{ siblings: { tool: string; state: string; version: string | null; minimum: string }[] }>(await cli(['doctor', '--format', 'json'], repo.root));
    expect(json.siblings.map((s) => [s.tool, s.state, s.version, s.minimum])).toEqual([
      ['spec-brief', 'found', '0.2.1', '0.2.0'],
      ['spec-graph', 'absent', null, '0.9.0'],
      ['spec-guard', 'outdated', '0.11.0', '0.12.0'],
    ]);
  });

  it('cannot be trusted with a spec-brief older than its minimum, which it does not run', async () => {
    const repo = repository({}, null);
    installFake(repo.root, 'spec-brief', JSON.stringify({ version: '0.1.0' }));
    const refused = await cli(['guard', 'a.ts', '--brief', '1'], repo.root);
    expect(refused.code).toBe(2);
    expect(refused.stdout).toBe('');
    expect(refused.stderr.trimEnd()).toBe(
      'spec-harness: spec-brief 0.1.0 is installed here; spec-harness needs 0.2.0 or later: npm install --save-dev @descent-vtt/spec-brief@latest',
    );
  });

  it('cannot be trusted without spec-brief, and says how to install it', async () => {
    const repo = repository({}, null);
    const result = await cli(['guard', 'a.ts', '--brief', '1'], repo.root);
    expect(result.code).toBe(2);
    expect(result.stderr).toBe(
      'spec-harness: spec-brief is not installed here: npm install --save-dev @descent-vtt/spec-brief, or name its command under "tools" in .spec-harness.json\n',
    );
  });

  it('prints what doctor read a line each, then a blank line and a line per sibling', async () => {
    const r = repository({ [BRIEF_FILE]: brief() });
    const doctor = await cli(['doctor'], r.root);
    expect(doctor.stdout).toMatch(/^root    \S[^\n]*\nbranch  main\n/);
    expect(doctor.stdout).toMatch(/\ngit     [^\n]*\n\n(found|absent|outdated) +spec-brief /);
    expect(parsed<{ command: string }>(await cli(['doctor', '--format', 'json'], r.root)).command).toBe('doctor');
  });

  it('refuses a list document at a schema version it does not read', async () => {
    const tool = fake("process.stdout.write(JSON.stringify({ tool: 'spec-brief', command: 'list', schemaVersion: 9, briefs: [] }));");
    const repo = repository({}, { tools: { 'spec-brief': tool } });
    const result = await cli(['guard', 'a.ts', '--brief', '1'], repo.root);
    expect(result).toEqual({ code: 2, stdout: '', stderr: 'spec-harness: spec-brief printed schemaVersion 9; this harness reads 1, 2, 3\n' });
  });

  it('refuses a sibling that prints no JSON, quoting what it said', async () => {
    const tool = fake("process.stdout.write('Usage: something else\\n'); process.stderr.write('line one\\nline two\\nline three\\nline four\\n');");
    const repo = repository({}, { tools: { 'spec-brief': tool } });
    const result = await cli(['guard', 'a.ts', '--brief', '1'], repo.root);
    expect(result).toEqual({ code: 2, stdout: '', stderr: 'spec-harness: spec-brief exited 0 without JSON: line one line two line three\n' });
    const silent = repository({}, { tools: { 'spec-brief': fake('process.exit(1);') } });
    expect((await cli(['guard', 'a.ts', '--brief', '1'], silent.root)).stderr).toBe('spec-harness: spec-brief exited 1 without JSON\n');
    // Blank lines on stderr say nothing, so what it printed is quoted instead, without its own line ends.
    const blank = repository({}, { tools: { 'spec-brief': fake("process.stdout.write('Usage: x\\n'); process.stderr.write('\\n');") } });
    expect((await cli(['guard', 'a.ts', '--brief', '1'], blank.root)).stderr).toBe('spec-harness: spec-brief exited 0 without JSON: Usage: x\n');
  });

  it('says why spec-brief could not list the briefs, or its exit code when it says nothing', async () => {
    const said = repository({}, { tools: { 'spec-brief': fake("process.stderr.write('\\nno briefs directory\\nmore'); process.exit(2);") } });
    expect((await cli(['guard', 'a.ts', '--brief', '1'], said.root)).stderr).toBe('spec-harness: spec-brief could not list the briefs: no briefs directory\n');
    const mute = repository({}, { tools: { 'spec-brief': fake('process.exit(2);') } });
    expect((await cli(['guard', 'a.ts', '--brief', '1'], mute.root)).stderr).toBe('spec-harness: spec-brief could not list the briefs: exit 2\n');
  });

  it('says to name a script when a command cannot be started without a shell', async () => {
    const repo = repository({}, { tools: { 'spec-brief': ['no-such-program-for-spec-harness', 'list'] } });
    const result = await cli(['guard', 'a.ts', '--brief', '1'], repo.root);
    expect(result.code).toBe(2);
    expect(result.stderr).toBe(
      'spec-harness: spec-brief exited -1 without JSON: cannot start "no-such-program-for-spec-harness": name the tool\'s script, such as ["node", "node_modules/@descent-vtt/<tool>/bin/<tool>.js"]\n',
    );
  });

  it('stops with exit 2, not a stack trace, when the brief spec-brief names cannot be read', async () => {
    const tool = fake("process.stdout.write(JSON.stringify({ tool: 'spec-brief', command: 'list', schemaVersion: 2, briefs: [{ id: '001', file: 'briefs/gone.md', phase: 'live' }] }));");
    const repo = repository({}, { tools: { 'spec-brief': tool } });
    expect(await cli(['context', '1'], repo.root)).toEqual({ code: 2, stdout: '', stderr: 'spec-harness: briefs/gone.md cannot be read\n' });
  });

  it('passes arguments to a sibling as they are, never through a shell', async () => {
    // The sibling reports the arguments it received as the brief's title.
    const tool = fake(
      "process.stdout.write(JSON.stringify({ tool: 'spec-brief', command: 'list', schemaVersion: 2, briefs: [{ id: '001', file: 'briefs/001_rotate-tokens.md', phase: 'live', title: JSON.stringify(process.argv.slice(2)) }] }));",
    );
    const repo = repository({ [BRIEF_FILE]: brief() }, { tools: { 'spec-brief': [...tool, 'a b;c', '$(exit 7)', '%PATH%'] } });
    const result = await cli(['context', '1'], repo.root);
    expect(result.code).toBe(0);
    expect(result.stdout.split('\n')[0]).toBe('# Round 001: ["a b;c","$(exit 7)","%PATH%","list","--archived","--format","json","--no-color"]');
  });
});

describe('doctor on a brief or a base that names nothing', () => {
  // A diagnosis says what is wrong with what it was given, where every other
  // command stops: it is what a person runs when the guard holds a write.
  const briefLine = (stdout: string): string | undefined => /\nbrief   ([^\n]*)\n/.exec(stdout)?.[1];
  let repo: Repository;
  beforeAll(() => {
    repo = repository({ [BRIEF_FILE]: brief(), 'briefs/archive/003_old.md': brief({ title: '003 - Old', status: 'archived' }) });
  });

  it('says an empty --brief and an empty --base in its report, by the option, and fails nothing for either', async () => {
    const result = await cli(['doctor', '--brief', '', '--base', ' '], repo.root);
    expect(result).toMatchObject({ code: 0, stderr: '' });
    expect(result.stdout).toContain(
      [
        '',
        'brief   none: --brief is "", which names no brief; give it a brief\'s id, or leave it out for the one SPEC_BRIEF or the branch names',
        'base    none: --base is " ", which names no commit; give it a branch or a commit, or leave it out for the configured base',
        'signers .github/allowed_signers, read from the base, which could not be resolved: no ruling can count',
        '',
      ].join('\n'),
    );
  });

  it('says a brief spec-brief does not know, where it printed the id and no more, and exits as it did', async () => {
    const unknown = await cli(['doctor', '--brief', '404', '--format', 'json'], repo.root);
    expect(unknown.code).toBe(0);
    expect(parsed(unknown)).toMatchObject({ brief: '404', briefProblem: 'the flag names brief 404, and spec-brief knows no such brief' });
    const archived = await cli(['doctor'], repo.root, { env: { SPEC_BRIEF: '3' } });
    expect(archived.code).toBe(0);
    expect(briefLine(archived.stdout)).toBe('none: the environment names brief 003, which is archived; a closed round writes nothing');
  });

  it('fails for a branch that names a brief no round can work under, which holds every write, and says it in the words the hook holds a write with', async () => {
    // It said the brief and exited as it would have, where the hook held every write (ADR-0004).
    const named = repository({ [BRIEF_FILE]: brief(), 'briefs/archive/003_old.md': brief({ title: '003 - Old', status: 'archived' }) });
    for (const [branch, line] of [
      ['brief/999-nowhere', 'the branch names brief 999, and spec-brief knows no such brief'],
      ['brief/003-old', 'the branch names brief 003, which is archived; a closed round writes nothing'],
      ['fix/brief-list-order', 'the branch names brief list, and spec-brief knows no such brief'],
    ] as const) {
      named.git('checkout', '-q', '-B', branch, 'main');
      const result = await cli(['doctor'], named.root);
      expect(result.code, branch).toBe(1);
      expect(briefLine(result.stdout), branch).toBe(`none: ${line}`);
      const write = JSON.stringify({ cwd: named.root, hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: join(named.root, 'src', 'a.ts') } });
      expect(await cli(['hook', 'claude'], named.root, { stdin: write, env: { CLAUDE_PROJECT_DIR: named.root } }), branch).toEqual({ code: 2, stdout: '', stderr: `spec-harness: ${line}. Fix the brief or the branch before writing.\n` });
      // The flag is the question doctor was asked, and names the brief in the branch's place.
      expect((await cli(['doctor', '--brief', '1'], named.root)).code, branch).toBe(0);
    }
    named.git('checkout', '-q', '-B', 'brief/001-rotate', 'main');
    expect(await cli(['doctor'], named.root)).toMatchObject({ code: 0, stderr: '' });
  });

  it('says nothing of a brief that is one, by the id it was named with', async () => {
    const known = await cli(['doctor', '--brief', '1', '--format', 'json'], repo.root);
    expect(parsed(known)).toMatchObject({ brief: '1', briefProblem: null });
  });

  it('says when spec-brief could not be asked, and leaves a spec-brief that is not there to its own row', async () => {
    const directory = temp();
    write(directory, 'sibling.js', "process.stderr.write('no briefs directory'); process.exit(2);");
    const failing = repository({}, { tools: { 'spec-brief': ['node', join(directory, 'sibling.js')] } });
    const asked = await cli(['doctor', '--brief', '1'], failing.root);
    expect(briefLine(asked.stdout)).toBe(
      'none: spec-brief could not say whether it knows brief 1: spec-brief could not list the briefs: no briefs directory',
    );
    // The flag holds no write of anyone's, so it fails nothing.
    expect(asked.code).toBe(0);
    const bare = repository({}, null);
    const absent = await cli(['doctor', '--brief', '7'], bare.root);
    expect(briefLine(absent.stdout)).toBe('7');
    expect(absent.stdout).toContain('absent    spec-brief  spec-brief is not installed here');
    // With another sibling there, and nothing named, nothing is held, and nothing fails.
    const guarded = repository({}, { tools: { 'spec-guard': siblings()['spec-guard'] } });
    expect(await cli(['doctor'], guarded.root)).toMatchObject({ code: 0, stderr: '' });
  });
});

describe('doctor on the Claude Code that runs the guard (ADR-0012)', () => {
  const wired = (): Repository => repository({ '.claude/settings.json': JSON.stringify(mergeClaudeSettings({})) });

  /** A directory holding a `claude` that prints `output` for --version: a shell script, which Windows cannot run without a shell. */
  function claude(output: string): string {
    const directory = temp();
    const file = join(directory, 'claude');
    writeFileSync(file, `#!/bin/sh\necho '${output}'\n`);
    chmodSync(file, 0o755);
    return directory;
  }

  it.skipIf(process.platform === 'win32')('fails when it is older than the hooks need, which lets every write through unguarded', async () => {
    const repo = wired();
    const result = await cli(['doctor'], repo.root, { env: { PATH: claude('2.1.100 (Claude Code)') } });
    expect(result.code).toBe(1);
    expect(result.stdout).toContain(
      "\n        Claude Code 2.1.100 is older than 2.1.139, which the hooks need: it ignores a hook's args and runs a bare node, which fails, and a PreToolUse hook that fails blocks nothing, so every write passes unguarded: update Claude Code, with claude update\n",
    );
    const json = parsed<{ claudeCode: { release: unknown } }>(await cli(['doctor', '--format', 'json'], repo.root, { env: { PATH: claude('2.1.100 (Claude Code)') } }));
    expect(json.claudeCode.release).toMatchObject({ state: 'outdated', version: '2.1.100', minimum: '2.1.139' });
  });

  it.skipIf(process.platform === 'win32')('passes a release at the minimum or later', async () => {
    const result = await cli(['doctor', '--strict'], wired().root, { env: { PATH: claude('2.1.139 (Claude Code)') } });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('\n        Claude Code 2.1.139 runs the hooks, which need 2.1.139 or later\n');
  });

  it('cannot tell when no claude is on PATH, which is never fine and fails under --strict', async () => {
    const repo = wired();
    const result = await cli(['doctor'], repo.root, { env: { PATH: temp() } });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(
      '\n        whether Claude Code is 2.1.139 or later, which the hooks need, cannot be told: no claude is on PATH; an older release lets every write pass unguarded, so check claude --version where Claude Code runs\n',
    );
    expect((await cli(['doctor', '--strict'], repo.root, { env: { PATH: temp() } })).code).toBe(1);
    expect(parsed<{ claudeCode: { release: unknown } }>(await cli(['doctor', '--format', 'json'], repo.root, { env: {} })).claudeCode.release).toEqual({
      state: 'unknown',
      version: null,
      minimum: '2.1.139',
      detail: expect.stringContaining('cannot be told: no claude is on PATH'),
    });
  });

  it('cannot tell from a program that prints no version, which it runs without a shell', async () => {
    // This Node under the name claude: it prints its own version, v24.x, which is not Claude Code's.
    const directory = temp();
    const name = process.platform === 'win32' ? 'claude.exe' : 'claude';
    try {
      linkSync(process.execPath, join(directory, name));
    } catch {
      copyFileSync(process.execPath, join(directory, name));
    }
    const result = await cli(['doctor'], wired().root, { env: { PATH: directory } });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(`cannot be told: claude --version printed "${process.version}", which is not a version`);
  });

  it.runIf(process.platform === 'win32')('cannot tell from a claude.cmd that runs no Claude Code package, which only a shell can start', async () => {
    const directory = temp();
    write(directory, 'claude.cmd', '@echo 2.1.200 (Claude Code)\r\n');
    const result = await cli(['doctor', '--strict'], wired().root, { env: { PATH: directory, PATHEXT: '.COM;.EXE;.BAT;.CMD' } });
    expect(result.code).toBe(1);
    expect(result.stdout).toContain(
      `cannot be told: claude on PATH is ${join(directory, 'claude.cmd')}, a script that cannot be started without a shell, which spec-harness does not use, and it names no @anthropic-ai/claude-code package whose package.json gives a version`,
    );
  });

  it.runIf(process.platform === 'win32')('reads the release of the Claude Code npm\'s claude.cmd runs from its package.json, and passes --strict on it', async () => {
    // npm's shim for Claude Code's bin/claude.exe; the tests of host.ts hold the other layouts.
    const directory = temp();
    const shim = ['@ECHO off', 'GOTO start', ':find_dp0', 'SET dp0=%~dp0', 'EXIT /b', ':start', 'SETLOCAL', 'CALL :find_dp0', '"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*', ''];
    write(directory, 'claude.cmd', shim.join('\r\n'));
    write(directory, 'node_modules/@anthropic-ai/claude-code/package.json', '{ "name": "@anthropic-ai/claude-code", "version": "2.1.285" }\n');
    const env = { PATH: directory, PATHEXT: '.COM;.EXE;.BAT;.CMD' };
    const result = await cli(['doctor', '--strict'], wired().root, { env });
    expect(result.code).toBe(0);
    const manifest = join(directory, 'node_modules', '@anthropic-ai', 'claude-code', 'package.json');
    expect(result.stdout).toContain(`\n        Claude Code 2.1.285 (as ${manifest} declares) runs the hooks, which need 2.1.139 or later\n`);
    const json = parsed<{ claudeCode: { release: unknown } }>(await cli(['doctor', '--format', 'json'], wired().root, { env }));
    expect(json.claudeCode.release).toMatchObject({ state: 'ok', version: '2.1.285', minimum: '2.1.139' });
  });

  it('asks nothing of Claude Code where nothing wires it to the guard', async () => {
    const result = await cli(['doctor', '--strict', '--format', 'json'], repository({}).root, { env: { PATH: temp() } });
    expect(result.code).toBe(0);
    expect(parsed<{ claudeCode: { release: unknown } }>(result).claudeCode.release).toEqual({
      state: 'unchecked',
      version: null,
      minimum: '2.1.139',
      detail: 'not asked: nothing wires Claude Code to the guard here',
    });
  });
});

describe("doctor on the line of Claude Code's hook in its settings (ADR-0005)", () => {
  const SCRIPT = '${CLAUDE_PROJECT_DIR}/node_modules/@descent-vtt/spec-harness/bin/spec-harness.js';
  const hook = (rest: readonly string[], more: Readonly<Record<string, unknown>> = {}) => ({ type: 'command', command: 'node', args: [SCRIPT, 'hook', 'claude', ...rest], timeout: 60, ...more });
  /** The hooks under both events with the matcher given, which is the one init writes unless a test is about another. */
  const settings = (hooks: readonly unknown[], matcher = 'Edit|Write|MultiEdit|NotebookEdit'): string => JSON.stringify({ hooks: { PreToolUse: [{ matcher, hooks }], PostToolUse: [{ matcher, hooks }] } });

  /** A PATH whose Claude Code runs the hooks, told as each platform lets doctor tell it, so that --strict fails for nothing else. */
  function newEnough(): Record<string, string> {
    const directory = temp();
    if (process.platform === 'win32') {
      write(directory, 'claude.cmd', ['@ECHO off', 'SETLOCAL', 'SET dp0=%~dp0', '"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*', ''].join('\r\n'));
      write(directory, 'node_modules/@anthropic-ai/claude-code/package.json', '{ "name": "@anthropic-ai/claude-code", "version": "2.1.300" }\n');
      return { PATH: directory, PATHEXT: '.COM;.EXE;.BAT;.CMD' };
    }
    const file = join(directory, 'claude');
    writeFileSync(file, "#!/bin/sh\necho '2.1.300 (Claude Code)'\n");
    chmodSync(file, 0o755);
    return { PATH: directory };
  }

  it('knows the hook with more on its line than init writes: says the line and that it guards, and fails nothing, --strict or not', async () => {
    const repo = repository({ '.claude/settings.json': settings([hook(['--root', '${CLAUDE_PROJECT_DIR}'])]) });
    const env = newEnough();
    const json = parsed<{ root: string; claudeCode: unknown }>(await cli(['doctor', '--format', 'json'], repo.root, { env }));
    const detail = `"hook claude --root \${CLAUDE_PROJECT_DIR}" in .claude/settings.json is more than init writes, and guards: the hook reads the line, and its root, ${json.root}, is a directory`;
    expect(json.claudeCode).toMatchObject({
      state: 'init',
      hooks: ['.claude/settings.json'],
      lines: [{ file: '.claude/settings.json', events: ['PreToolUse', 'PostToolUse'], line: ['hook', 'claude', '--root', '${CLAUDE_PROJECT_DIR}'], state: 'guards', onFailure: null, detail, note: null }],
    });
    const result = await cli(['doctor', '--strict'], repo.root, { env });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(`\nclaude  init's entries: the guard hooks in .claude/settings.json\n        ${detail}\n        Claude Code 2.1.300 `);
  });

  it('fails for a line that turns the guard off, says each in the hook\'s words with what onFailure makes of it, and passes once they are mended', async () => {
    const user = temp();
    const userFile = join(user, 'settings.json');
    write(user, 'settings.json', settings([hook(['--format', 'xml'], { onFailure: 'block' })]));
    const repo = repository({ '.claude/settings.json': settings([hook(['--base', 'main'])]), '.claude/settings.local.json': settings([hook(['--root', 'nowhere'])]) });
    const result = await cli(['doctor'], repo.root, { env: { CLAUDE_CONFIG_DIR: user } });
    expect(result.code).toBe(1);
    expect(result.stdout).toContain(
      [
        `claude  init's entries: the guard hooks in ${userFile}, the guard hooks in .claude/settings.json, the guard hooks in .claude/settings.local.json`,
        `        "hook claude --format xml" in ${userFile}: the hook's line cannot be read (--format must be pretty, json, gitlab, sarif or github, not "xml"), so the guard is off and no write is checked; mend it in Claude Code's settings, where init writes "hook claude" and nothing after it`,
        `        "hook claude --format xml" in ${userFile} sets onFailure to "block", so Claude Code 2.1.295 or later holds a write when the hook fails, which with this line is every write, the one that mends the line among them: mend it by hand`,
        '        "hook claude --base main" in .claude/settings.json is more than init writes, and guards: the hook reads the line',
        '        "hook claude --root nowhere" in .claude/settings.local.json: --root is "nowhere", which is not a directory, so the guard is off and no write is checked; give the hook\'s line a directory that exists, or leave --root out for the project Claude Code names',
        '        whether Claude Code is 2.1.139 or later, which the hooks need, cannot be told: ',
      ].join('\n'),
    );
    // One line that is off is enough; with none, a line that only holds more than init writes fails nothing.
    repo.write('.claude/settings.local.json', settings([hook(['--root', '${CLAUDE_PROJECT_DIR}'])]));
    expect((await cli(['doctor'], repo.root, { env: { CLAUDE_CONFIG_DIR: user } })).code).toBe(1);
    write(user, 'settings.json', settings([hook([], { onFailure: 'block' })]));
    const mended = await cli(['doctor'], repo.root, { env: { CLAUDE_CONFIG_DIR: user } });
    expect(mended.code).toBe(0);
    expect(mended.stdout).toContain(`\n        "hook claude" in ${userFile} sets onFailure to "block", so Claude Code 2.1.295 or later holds a write when the hook fails, where it lets the write go ahead without it: `);
  });

  it('cannot tell what a shell hands the hook: said, never fine, and a failure under --strict alone', async () => {
    const env = newEnough();
    const repo = repository({ '.claude/settings.json': settings([{ type: 'command', command: `node "${SCRIPT}" hook claude --root "\${CLAUDE_PROJECT_DIR}"` }]) });
    const result = await cli(['doctor'], repo.root, { env });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(
      '\n        "hook claude --root "${CLAUDE_PROJECT_DIR}"" in .claude/settings.json is a shell\'s to read before the hook is handed it, so what the hook does with it cannot be told here: written with "args", each word reaches the hook as it stands\n',
    );
    expect((await cli(['doctor', '--strict'], repo.root, { env })).code).toBe(1);
  });

  it('fails for a line that names a brief which is not one, in the words the hook holds every write with, and passes once it names one', async () => {
    const env = newEnough();
    // Beside it, a line of the harness's that is not the hook's, which is read and not reported.
    const other = { type: 'command', command: 'node', args: [SCRIPT, 'hook', 'git'] };
    const repo = repository({ [BRIEF_FILE]: brief(), '.claude/settings.json': settings([hook(['--brief', '404']), other]) });
    const result = await cli(['doctor'], repo.root, { env });
    expect(result.code).toBe(1);
    expect(result.stdout).toContain(
      '\nclaude  init\'s entries: the guard hooks in .claude/settings.json\n        "hook claude --brief 404" in .claude/settings.json: the flag names brief 404, and spec-brief knows no such brief, so the hook holds every write until the line is mended: name a brief spec-brief lists, or take --brief off the line\n        Claude Code 2.1.300 ',
    );
    // A brief the environment names is not the line's: it is said on doctor's own line for the brief, and
    // of a line that names none, or names one that is a brief, nothing but that it guards.
    repo.write('.claude/settings.json', settings([hook(['--brief', '001']), hook(['--base', 'main'])]));
    const mended = await cli(['doctor', '--strict'], repo.root, { env: { ...env, SPEC_BRIEF: '404' } });
    expect(mended.code).toBe(0);
    expect(mended.stdout).toContain('\nbrief   none: the environment names brief 404, and spec-brief knows no such brief\n');
    expect(mended.stdout).toContain(
      [
        '        "hook claude --brief 001" in .claude/settings.json is more than init writes, and guards: the hook reads the line',
        '        "hook claude --base main" in .claude/settings.json is more than init writes, and guards: the hook reads the line',
        '        Claude Code 2.1.300 ',
      ].join('\n'),
    );
  });

  it("asks about the brief where the hook would: in the work tree the line's root is in, and of none where the root is in no work tree", async () => {
    const env = newEnough();
    // Brief 001 is one in the other repository, and none in the one doctor runs in.
    const other = repository({ [BRIEF_FILE]: brief() });
    const outside = temp();
    const repo = repository({
      '.claude/settings.json': settings([hook(['--root', other.root, '--brief', '001']), hook(['--root', other.root, '--brief', '404']), hook(['--root', outside, '--brief', '001'])]),
    });
    const result = await cli(['doctor', '--strict', '--format', 'json'], repo.root, { env });
    expect(result.code).toBe(1);
    const lines = parsed<{ claudeCode: { lines: { state: string; detail: string }[] } }>(result).claudeCode.lines;
    // Asked in the other repository, 001 is a brief and 404 is none; asked in this one, neither would be. Under 404 the hook holds every write, and under 001 it checks the other repository's writes and none of this project's.
    expect(lines.map((line) => line.state)).toEqual(['off', 'held', 'off']);
    expect(lines[0]?.detail).toContain(`--root is "${other.root}", a directory in ${other.git('rev-parse', '--show-toplevel')}, the work tree of another repository, which does not hold this project`);
    expect(lines[1]?.detail).toContain('the flag names brief 404, and spec-brief knows no such brief, so the hook holds every write until the line is mended');
    // A root in no work tree is a guard that is off, whatever brief its line names: the hook reads none there, and none is asked about.
    expect(lines[2]?.detail).toContain(`--root is "${outside}", a directory outside any git work tree, which the hook reads as a session outside one, exit 0 and no word, so the guard is off`);
    // A root whose configuration does not load ends the hook with exit 2 and that file's fault, and doctor with it.
    const broken = repository({ '.spec-harness.json': '{ not json' }, null);
    repo.write('.claude/settings.json', settings([hook(['--root', broken.root, '--brief', '001'])]));
    const stopped = await cli(['doctor'], repo.root, { env });
    expect(stopped).toMatchObject({ code: 2, stdout: '' });
    expect(stopped.stderr).toContain('.spec-harness.json is not valid JSON');
  });

  it('does not take for the guard a line Claude Code waits on before no write and starts after none, and says what the line stands under', async () => {
    const env = newEnough();
    const repo = repository({ '.claude/settings.json': settings([hook([])], 'Bash') });
    const result = await cli(['doctor', '--strict'], repo.root, { env });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(
      [
        'claude  neither the spec-harness plugin nor the hooks init writes, so Claude Code guards no write: run spec-harness init --write, or install the plugin',
        '        "hook claude" in .claude/settings.json: Claude Code waits on it before no write, so it is not the guard and refuses none (under PreToolUse it has the matcher "Bash"); it is started after no write, so it warns of none (under PostToolUse it has the matcher "Bash")',
        'git     ',
      ].join('\n'),
    );
    // Beside the plugin such a line doubles nothing: the plugin alone is the guard.
    repo.write('.claude/settings.local.json', JSON.stringify({ enabledPlugins: { 'spec-harness@team': true } }));
    const beside = await cli(['doctor', '--strict', '--format', 'json'], repo.root, { env: { ...env, CLAUDE_CODE_PLUGIN_CACHE_DIR: installPlugin(temp(), 'spec-harness@team') } });
    expect(beside.code).toBe(0);
    expect(parsed<{ claudeCode: unknown }>(beside).claudeCode).toMatchObject({ state: 'plugin', hooks: [], lines: [{ state: 'unstarted', before: [], after: [] }] });
    // A line that is started after a write alone refuses none either, and still doubles what the plugin says after one.
    repo.write('.claude/settings.json', JSON.stringify({ hooks: { PostToolUse: [{ hooks: [hook([])] }] } }));
    const after = await cli(['doctor', '--format', 'json'], repo.root, { env });
    expect(after.code).toBe(1);
    expect(parsed<{ claudeCode: unknown }>(after).claudeCode).toMatchObject({ state: 'both', hooks: ['.claude/settings.json'], lines: [{ state: 'unstarted', before: [], after: ['Edit', 'Write', 'NotebookEdit'] }] });
  });

  it('comes back from a matcher whose pattern backtracks without end, and cannot tell from it', async () => {
    const env = newEnough();
    // Five stars, each around the last: testing a tool's name against it does not end.
    const slow = '^((((([A-Za-z]*)*)*)*)*)*$X';
    const held = { hooks: { PreToolUse: [{ matcher: slow, hooks: [hook([])] }], PostToolUse: [{ matcher: 'Edit|Write|MultiEdit|NotebookEdit', hooks: [hook([])] }] } };
    // The budget is held first where a reading without one can be stopped, by
    // a bound of the test's own: doctor's reading below is not in a test's
    // hands, and without the budget it would not come back.
    const read = (): unknown => reportHooks([{ file: '.claude/settings.json', settings: held }], '/the/project', () => ({ state: 'guards', root: undefined }));
    expect(runInNewContext('read()', { read }, { timeout: 2000 })).toMatchObject([{ state: 'unknown', before: null }]);
    const repo = repository({ '.claude/settings.json': JSON.stringify(held) });
    const result = await cli(['doctor', '--strict', '--format', 'json'], repo.root, { env });
    expect(result.code).toBe(1);
    expect(parsed<{ claudeCode: unknown }>(result).claudeCode).toMatchObject({
      state: 'init',
      lines: [
        {
          state: 'unknown',
          before: null,
          cover: `"hook claude" in .claude/settings.json: which writes Claude Code waits on it before cannot be told here (under PreToolUse it has the matcher ${JSON.stringify(slow)})`,
        },
      ],
    });
  });

  it('says which writes a line leaves unchecked and fails for none of them, and cannot tell under an "if", which fails --strict alone', async () => {
    const env = newEnough();
    const repo = repository({ '.claude/settings.json': settings([hook([])], 'Edit|Write') });
    const result = await cli(['doctor', '--strict'], repo.root, { env });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(
      '\nclaude  init\'s entries: the guard hooks in .claude/settings.json\n        "hook claude" in .claude/settings.json: Claude Code waits on it before a write by Edit and Write, and before none by NotebookEdit, which goes unchecked (under PreToolUse it has the matcher "Edit|Write"); it is started after a write by Edit and Write alone (under PostToolUse it has the matcher "Edit|Write")\n        Claude Code 2.1.300 ',
    );
    // Edit, Write and NotebookEdit are every tool a supported Claude Code writes a file with: of a line under them there is no more to say than of init's own, and the lists hold no MultiEdit.
    repo.write('.claude/settings.json', settings([hook([])], 'Edit|Write|NotebookEdit'));
    const every = await cli(['doctor', '--strict', '--format', 'json'], repo.root, { env });
    expect(every.code).toBe(0);
    expect(parsed<{ claudeCode: unknown }>(every).claudeCode).toMatchObject({
      state: 'init',
      lines: [{ state: 'guards', detail: null, before: ['Edit', 'Write', 'NotebookEdit'], after: ['Edit', 'Write', 'NotebookEdit'], cover: null }],
    });
    // Before every write and after none, it is the guard, and one of init's entries.
    repo.write('.claude/settings.json', JSON.stringify({ hooks: { PreToolUse: [{ hooks: [hook([])] }] } }));
    const before = await cli(['doctor', '--strict', '--format', 'json'], repo.root, { env });
    expect(before.code).toBe(0);
    expect(parsed<{ claudeCode: unknown }>(before).claudeCode).toMatchObject({
      state: 'init',
      hooks: ['.claude/settings.json'],
      lines: [{ state: 'guards', after: [], cover: '"hook claude" in .claude/settings.json (under PreToolUse alone): it is started after no write, so it warns of none (it stands under no PostToolUse)' }],
    });
    repo.write('.claude/settings.json', settings([hook([], { if: 'Edit(*.ts)' })]));
    const untold = await cli(['doctor'], repo.root, { env });
    expect(untold.code).toBe(0);
    expect(untold.stdout).toContain('\n        "hook claude" in .claude/settings.json: which writes Claude Code waits on it before cannot be told here (under PreToolUse it has the matcher "Edit|Write|MultiEdit|NotebookEdit" with "if" "Edit(*.ts)"); ');
    expect((await cli(['doctor', '--strict'], repo.root, { env })).code).toBe(1);
  });

  describe('a matcher the Claude Code on this machine reads otherwise (ADR-0005)', () => {
    interface Read {
      state: string;
      hooks: string[];
      lines: { state: string; before: string[] | null; after: string[] | null; detail: string | null; cover: string | null }[];
      release: { state: string; version: string | null };
    }
    const read = async (repo: Repository, env: Record<string, string>, ...more: string[]) => {
      const result = await cli(['doctor', ...more, '--format', 'json'], repo.root, { env });
      return { code: result.code, ...parsed<{ claudeCode: Read }>(result).claudeCode };
    };

    it('reads names with a comma as the release on PATH reads them: no guard before 2.1.191, the guard from it on, and it cannot tell without a release', async () => {
      const repo = repository({ '.claude/settings.json': settings([hook([])], 'Edit, Write') });
      const aside = ', which Claude Code 2.1.190 reads as a pattern that matches no tool: a comma separates names from 2.1.191 on, where the matcher is Edit and Write';
      // No guard is a choice, and fails nothing, --strict or not: the line is said with the release, which was asked and is reported.
      const old = await read(repo, claudeOf('2.1.190'), '--strict');
      expect(old).toMatchObject({ code: 0, state: 'none', hooks: [], lines: [{ state: 'unstarted', before: [], after: [], detail: null }], release: { state: 'ok', version: '2.1.190' } });
      expect(old.lines[0]?.cover).toBe(
        `"hook claude" in .claude/settings.json: Claude Code waits on it before no write, so it is not the guard and refuses none (under PreToolUse it has the matcher "Edit, Write"${aside}); it is started after no write, so it warns of none (under PostToolUse it has the matcher "Edit, Write"${aside})`,
      );
      // The release that mended it reads the matcher as it is written.
      const told = await read(repo, claudeOf('2.1.191'), '--strict');
      expect(told).toMatchObject({ code: 0, state: 'init', hooks: ['.claude/settings.json'], lines: [{ state: 'guards', before: ['Edit', 'Write'], after: ['Edit', 'Write'] }] });
      expect(told.lines[0]?.cover).not.toContain('2.1.191');
      // A release too old for the hooks fails as it did, and reads the comma as every release before 2.1.191.
      expect(await read(repo, claudeOf('2.1.100'))).toMatchObject({ code: 1, state: 'none', lines: [{ state: 'unstarted' }], release: { state: 'outdated', version: '2.1.100' } });
      // No release, no reading: which writes the line is started for cannot be told, which is never fine.
      const untold = await read(repo, { PATH: temp() });
      expect(untold).toMatchObject({ code: 0, state: 'init', lines: [{ state: 'unknown', before: null, after: null }], release: { state: 'unknown' } });
      expect(untold.lines[0]?.cover).toContain('from Claude Code 2.1.191 on, where a comma separates names, and a pattern that matches no tool before it: the release here cannot be told');
    });

    it('reads names with a hyphen as the release on PATH reads them: cannot tell before 2.1.195, the names from it on, and cannot tell without a release', async () => {
      // Claude Code's changelog has a hyphenated name match as a substring before 2.1.195, and does not say how the rest of such a matcher was read.
      const repo = repository({ '.claude/settings.json': settings([hook([])], 'Edit|Write|my-tool') });
      const aside = ", which Claude Code 2.1.194 may read otherwise: before 2.1.195 a matcher with a hyphenated name in it matched as a substring, and Claude Code's changelog does not say how the rest of it was read; from 2.1.195 on it is Edit and Write";
      const older = await read(repo, claudeOf('2.1.194'));
      expect(older).toMatchObject({ code: 0, state: 'init', hooks: ['.claude/settings.json'], lines: [{ state: 'unknown', before: null, after: null, detail: null }], release: { state: 'ok', version: '2.1.194' } });
      expect(older.lines[0]?.cover).toBe(
        `"hook claude" in .claude/settings.json: which writes Claude Code waits on it before cannot be told here (under PreToolUse it has the matcher "Edit|Write|my-tool"${aside}); which writes it is started after cannot be told here (under PostToolUse it has the matcher "Edit|Write|my-tool"${aside})`,
      );
      // Cannot tell is never fine: --strict fails it.
      expect((await read(repo, claudeOf('2.1.194'), '--strict')).code).toBe(1);
      // The release that mended it reads the names exactly, as before.
      const told = await read(repo, claudeOf('2.1.195'), '--strict');
      expect(told).toMatchObject({ code: 0, state: 'init', lines: [{ state: 'guards', before: ['Edit', 'Write'], after: ['Edit', 'Write'] }] });
      expect(told.lines[0]?.cover).not.toContain('2.1.195');
      expect((await read(repo, { PATH: temp() })).lines[0]?.cover).toContain(', which is Edit and Write from Claude Code 2.1.195 on, and may be read otherwise before it, where a matcher with a hyphenated name in it matched as a substring');
      // init writes no hook beside a line whose writes cannot be told.
      expect((await cli(['init', '--write'], repo.root, { env: claudeOf('2.1.194') })).stdout).toContain('keep    .claude/settings.json\n');
    });

    it('asks no release where nothing is wired under any reading of a comma, as before', async () => {
      // Names that are no tool that writes, with a comma between them: no release makes this line the guard.
      const repo = repository({ '.claude/settings.json': settings([hook([])], 'Bash, Read') });
      const result = await cli(['doctor', '--strict', '--format', 'json'], repo.root, { env: { PATH: temp() } });
      expect(result.code).toBe(0);
      expect(parsed<{ claudeCode: Read }>(result).claudeCode).toMatchObject({ state: 'none', lines: [{ state: 'unstarted', before: [], after: [] }], release: { state: 'unchecked' } });
    });

    it('fails for a guard that an array for a matcher keeps Claude Code from loading, says it of each line the array reaches, and passes once it is one string', async () => {
      const env = newEnough();
      const other = { type: 'command', command: '/usr/local/bin/lint-check.sh' };
      const GUARD = 'Edit|Write|MultiEdit|NotebookEdit';
      const held = (matcher: unknown): string =>
        JSON.stringify({ hooks: { PreToolUse: [{ matcher: GUARD, hooks: [hook([]), hook(['--base', 'main'])] }, { matcher, hooks: [other] }], PostToolUse: [{ matcher: GUARD, hooks: [hook([])] }] } });
      const repo = repository({ '.claude/settings.json': held(['Bash', 'PowerShell']) });
      const array =
        '.claude/settings.json has an array for a matcher under PreToolUse, ["Bash","PowerShell"], which Claude Code lists as an invalid setting, and beside one under PreToolUse or PermissionRequest it loads none of the file\'s other hooks, so the guard is off and no write is checked; write the matcher as one string, its names between "|"';
      const pretty = await cli(['doctor'], repo.root, { env });
      expect(pretty.code).toBe(1);
      // Nothing of the file is loaded, so nothing wires Claude Code to the guard, and its release is not asked: git's hook is the next line.
      // The first line advises the array, which init --write would only advise in turn.
      const first =
        'claude  neither the spec-harness plugin nor the hooks init writes, so Claude Code guards no write: .claude/settings.json has an array for a matcher under PreToolUse, ["Bash","PowerShell"], which Claude Code lists as an invalid setting, and beside one under PreToolUse or PermissionRequest it loads none of the file\'s other hooks, those init writes among them: write the matcher as one string, its names between "|", then run spec-harness init --write, or install the plugin';
      expect(pretty.stdout).toContain([first, `        "hook claude" in .claude/settings.json: ${array}`, `        "hook claude --base main" in .claude/settings.json (under PreToolUse alone): ${array}`, 'git     '].join('\n'));
      expect(parsed<{ claudeCode: { unloaded: unknown } }>(await cli(['doctor', '--format', 'json'], repo.root, { env })).claudeCode.unloaded).toEqual({ event: 'PreToolUse', matcher: '["Bash","PowerShell"]' });
      // The same names as one string, and an array in another settings file, which reaches no line of this one: every hook of this file is loaded.
      repo.write('.claude/settings.json', held('Bash|PowerShell'));
      const user = temp();
      write(user, 'settings.json', JSON.stringify({ hooks: { PermissionRequest: [{ matcher: ['Bash'], hooks: [other] }] } }));
      expect(await read(repo, { ...env, CLAUDE_CONFIG_DIR: user }, '--strict')).toMatchObject({ code: 0, state: 'init', lines: [{ state: 'guards' }, { state: 'guards' }], release: { state: 'ok' } });
      // An array in the user's own settings unloads that file alone: init writes into the project's, and nothing is advised of it.
      const theirs = await cli(['doctor', '--format', 'json'], repository({}).root, { env: { ...env, CLAUDE_CONFIG_DIR: user } });
      expect(parsed<{ claudeCode: { unloaded: unknown; detail: string } }>(theirs).claudeCode).toMatchObject({
        unloaded: null,
        detail: 'neither the spec-harness plugin nor the hooks init writes, so Claude Code guards no write: run spec-harness init --write, or install the plugin',
      });
    });
  });

  describe('a guard that is set up and checks nothing (ADR-0005, ADR-0012)', () => {
    const under = (...hooks: unknown[]) => ({ hooks: { PreToolUse: [{ matcher: 'Edit|Write|MultiEdit|NotebookEdit', hooks }], PostToolUse: [{ matcher: 'Edit|Write|MultiEdit|NotebookEdit', hooks }] } });
    const ID = 'spec-harness@spec-tools';
    const ON = { enabledPlugins: { [ID]: true } };
    interface Wiring {
      state: string;
      presence: { state: string; detail: string | null } | null;
      hooksOff: string | null;
      hooks: string[];
      notes: string[];
      detail: string;
      lines: { line: string[]; state: string; detail: string | null }[];
    }
    const wiring = async (repo: Repository, env: Record<string, string>, ...more: string[]) => {
      const result = await cli(['doctor', ...more, '--format', 'json'], repo.root, { env });
      return { code: result.code, ...parsed<{ claudeCode: Wiring }>(result).claudeCode };
    };
    /** A plugins root that records no marketplace and caches nothing: Claude Code has run here, and has fetched none. */
    const empty = (): string => {
      const directory = temp();
      write(directory, 'known_marketplaces.json', '{}');
      return directory;
    };

    it('fails for a root on the line that is a directory outside any work tree, which the hook checks no write under and says nothing of', async () => {
      const outside = temp();
      const repo = repository({ '.claude/settings.json': JSON.stringify(under(hook(['--root', outside]), hook(['--root', 'packages/app']), hook(['--brief', '404', '--root', outside]))), 'packages/app/a.ts': 'a;\n' });
      const said = await wiring(repo, {});
      const off = (line: string): string =>
        `"hook claude ${line}" in .claude/settings.json: --root is "${outside}", a directory outside any git work tree, which the hook reads as a session outside one, exit 0 and no word, so the guard is off and no write is checked; give the hook's line a directory in the work tree, or leave --root out for the project Claude Code names`;
      expect(said.code).toBe(1);
      expect(said.lines.map((line) => [line.state, line.detail])).toEqual([
        ['off', off(`--root ${outside}`)],
        // A root in the work tree, written from the project, is one the hook guards in.
        ['guards', expect.stringContaining('"hook claude --root packages/app" in .claude/settings.json is more than init writes, and guards')],
        // No brief is asked about under such a root: the hook reads none there.
        ['off', off(`--brief 404 --root ${outside}`)],
      ]);
      // With those lines gone the file passes. And a line that names no brief is asked about none, whatever the branch names: a branch that names one spec-brief does not know holds every write for every line, which is said of the brief, not of the line.
      repo.write('.claude/settings.json', JSON.stringify(under(hook(['--root', 'packages/app']))));
      repo.git('checkout', '-q', '-b', 'brief/404-nowhere');
      const mended = await wiring(repo, {});
      expect(mended.code).toBe(0);
      expect(mended.lines.map((line) => line.state)).toEqual(['guards']);
    });

    it('fails for a root on the line in a work tree that does not hold the project, where the hook checks no write to a file of it, and says whose briefs check one where the work tree holds it', async () => {
      const INNER = brief({ affected: ['src/**'], protected: ['src/db/**'] });
      /** A repository made where the test says, with the siblings named as every test repository names them; its top as git spells it. */
      const at = (directory: string, files: Readonly<Record<string, string>>): string => {
        mkdirSync(directory, { recursive: true });
        git(directory, 'init', '-q', '-b', 'main');
        write(directory, '.spec-harness.json', JSON.stringify({ base: 'main', tools: siblings() }));
        for (const [path, content] of Object.entries(files)) write(directory, path, content);
        git(directory, 'add', '-A');
        git(directory, 'commit', '-q', '-m', 'base');
        return git(directory, 'rev-parse', '--show-toplevel');
      };
      // A repository beside the project; one that holds it, whose brief protects the project's files by the path they have in it; and inside the project a repository of its own and a linked worktree.
      const beside = repository({ [BRIEF_FILE]: INNER, 'src/db/schema.ts': 'table;\n' });
      const outer = repository({ [BRIEF_FILE]: brief({ affected: ['packages/**'], protected: ['packages/app/src/db/**'] }), '.gitignore': 'packages/\n' });
      const root = join(outer.root, 'packages', 'app');
      at(root, { 'src/db/schema.ts': 'table;\n', '.gitignore': 'vendor/\nlinked/\n' });
      const nested = join(root, 'vendor', 'lib');
      const nestedTop = at(nested, { [BRIEF_FILE]: INNER, 'src/db/schema.ts': 'table;\n' });
      const linked = join(root, 'linked');
      git(root, 'worktree', 'add', '-q', linked, '-b', 'another');
      const LINES = [['--root', outer.root, '--brief', '001'], ['--root', beside.root, '--brief', '001'], ['--root', nested, '--brief', '001'], ['--root', linked]];
      write(root, '.claude/settings.json', JSON.stringify(under(...LINES.map((rest) => hook(rest)))));
      const result = await cli(['doctor', '--format', 'json'], root);
      expect(result.code).toBe(1);
      const lines = parsed<{ claudeCode: Wiring }>(result).claudeCode.lines;
      expect(lines.map((line) => line.state)).toEqual(['guards', 'off', 'off', 'off']);
      const top = (directory: string): string => git(directory, 'rev-parse', '--show-toplevel');
      expect(lines[0]?.detail).toBe(
        `"hook claude --root ${outer.root} --brief 001" in .claude/settings.json is more than init writes, and guards: the hook reads the line, and its root, ${outer.root}, is a directory in ${top(outer.root)}, the work tree of another repository, which holds this project: the hook checks a write here by that work tree's briefs and its branch, as a file under packages/app/ there`,
      );
      const elsewhere = (line: readonly string[], tree: string): string =>
        `"hook claude ${line.join(' ')}" in .claude/settings.json: --root is "${line[1]}", a directory in ${tree}, which does not hold this project: the hook checks a write to a file of that work tree, by its briefs, and passes any other with no word, exit 0, so the guard is off and no write to a file of this project is checked; give the hook's line a directory in this work tree, or leave --root out for the project Claude Code names`;
      expect(lines[1]?.detail).toBe(elsewhere(LINES[1]!, `${top(beside.root)}, the work tree of another repository`));
      expect(lines[2]?.detail).toBe(elsewhere(LINES[2]!, `${nestedTop}, the work tree of another repository`));
      // A linked worktree is this repository's own, and holds no file of this work tree either.
      expect(lines[3]?.detail).toBe(elsewhere(LINES[3]!, `${top(linked)}, another work tree of this repository`));
      // The hook, handed each line: a write to the project's file is refused where doctor says the line guards, by the holder's brief, and passed with no word where it says no write here is checked.
      const before = (file: string): string => JSON.stringify({ session_id: 's', cwd: root, hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: file } });
      const mine = join(root, 'src', 'db', 'schema.ts');
      const held = await cli(['hook', 'claude', ...LINES[0]!], root, { stdin: before(mine) });
      expect(held).toMatchObject({ code: 0, stderr: '' });
      expect(JSON.parse(held.stdout)).toMatchObject({ hookSpecificOutput: { permissionDecision: 'deny', permissionDecisionReason: expect.stringContaining('packages/app/src/db/schema.ts (protectedFiles: packages/app/src/db/**)') } });
      for (const line of [LINES[1]!, LINES[3]!]) expect(await cli(['hook', 'claude', ...line], root, { stdin: before(mine) }), line.join(' ')).toEqual({ code: 0, stdout: '', stderr: '' });
      // And a write to a file of the work tree the root is in is checked there, by its briefs.
      const there = await cli(['hook', 'claude', ...LINES[1]!], root, { stdin: before(join(beside.root, 'src', 'db', 'schema.ts')) });
      expect(JSON.parse(there.stdout)).toMatchObject({ hookSpecificOutput: { permissionDecision: 'deny' } });
      // A work tree that holds the project fails nothing: its briefs are whose a write here is checked by, and that is said.
      write(root, '.claude/settings.json', JSON.stringify(under(hook(LINES[0]!))));
      expect((await cli(['doctor', '--strict'], root, { env: newEnough() })).code).toBe(0);
    });

    it('fails where disableAllHooks switches the guard hooks off, with the file that holds the key, and notes it where there is no guard to switch off', async () => {
      const OFF = '"disableAllHooks" is true in .claude/settings.json, so Claude Code runs no hook of the user\'s, the project\'s or the local settings, and none of a plugin: no write is guarded. Take the key out of .claude/settings.json, or set it to false, to have the guard back. Hooks of managed settings, and of a plugin managed settings force on, keep running, and no managed settings are read here';
      const repo = repository({ '.claude/settings.json': JSON.stringify({ disableAllHooks: true, ...under(hook(['--base', 'main'])) }) });
      const pretty = await cli(['doctor'], repo.root);
      expect(pretty.code).toBe(1);
      // Said under the wiring, before what is said of each line.
      expect(pretty.stdout).toContain(
        ["claude  init's entries: the guard hooks in .claude/settings.json", `        ${OFF}`, '        "hook claude --base main" in .claude/settings.json is more than init writes, and guards: the hook reads the line', ''].join('\n'),
      );
      expect(await wiring(repo, {})).toMatchObject({ code: 1, state: 'init', hooksOff: '.claude/settings.json', notes: [OFF] });
      // Where nothing is wired there is no guard to switch off: a note, which fails nothing.
      const bare = repository({ '.claude/settings.json': JSON.stringify({ disableAllHooks: true }) });
      const noted = await wiring(bare, {});
      expect(noted).toMatchObject({ code: 0, state: 'none', hooksOff: '.claude/settings.json' });
      expect(noted.notes).toEqual([expect.stringMatching(/^note: "disableAllHooks" is true in \.claude\/settings\.json, .* would not run while it stands$/)]);
    });

    it('fails where the plugin the project turns on is not on this machine and no hook of init\'s guards instead, and says what would bring it', async () => {
      const env = { CLAUDE_CODE_PLUGIN_CACHE_DIR: empty() };
      const repo = repository({ '.claude/settings.json': JSON.stringify(ON) });
      const pretty = await cli(['doctor'], repo.root, { env });
      expect(pretty.code).toBe(1);
      const why = `.claude/settings.json alone turns it on, and Claude Code fetches no plugin that a project's settings alone turn on, unless its marketplace lists it by a relative path or a seed directory holds it: no marketplace spec-tools is recorded as fetched or declared in settings, and no version of the plugin is in a cache (${join(env.CLAUDE_CODE_PLUGIN_CACHE_DIR, 'cache')})`;
      const gone = `the spec-harness plugin is on (${ID} in .claude/settings.json) and is not on this machine, so it brings no hook here: ${why}`;
      // Nothing wires Claude Code to the guard, so its release is not asked: git's hook is the next line.
      expect(pretty.stdout).toContain(
        `\nclaude  ${gone}, and Claude Code guards no write. To have the guard, install it here, with claude plugin install ${ID} once its marketplace is added, or turn the plugin off for this project with claude plugin disable ${ID} --scope local and run spec-harness init --write\ngit     `,
      );
      // Beside init's hooks those guard, and the plugin is a note under them that fails nothing.
      repo.write('.claude/settings.json', JSON.stringify({ ...ON, ...under(hook([])) }));
      const beside = await wiring(repo, env);
      expect(beside).toMatchObject({ code: 0, state: 'init', presence: { state: 'absent', detail: why }, detail: "init's entries: the guard hooks in .claude/settings.json" });
      expect(beside.notes).toEqual([`${gone}. With the plugin installed as well, every write is guarded twice: turn the plugin off for this project with claude plugin disable ${ID} --scope local`]);
      // The server alone guards nothing: the plugin that is not there is the problem still.
      repo.write('.claude/settings.json', JSON.stringify(ON));
      repo.write('.mcp.json', JSON.stringify(mergeMcp({})));
      expect(await wiring(repo, env)).toMatchObject({ code: 1, state: 'init', hooks: [], notes: [expect.stringContaining(', and Claude Code guards no write. To have the guard, ')] });
    });

    it('cannot tell where what Claude Code keeps on disk does not say, which fails --strict alone', async () => {
      const env = { ...newEnough(), CLAUDE_CODE_PLUGIN_CACHE_DIR: temp() };
      const repo = repository({ '.claude/settings.json': JSON.stringify(ON) });
      const untold = await wiring(repo, env, '--strict');
      const record = join(env.CLAUDE_CODE_PLUGIN_CACHE_DIR, 'known_marketplaces.json');
      expect(untold).toMatchObject({
        code: 1,
        state: 'plugin',
        presence: { state: 'unknown', detail: `${record}, where Claude Code records the marketplaces it has fetched, is not there` },
        detail: `the spec-harness plugin is on (${ID} in .claude/settings.json) and brings the guard hooks and the server`,
      });
      expect(untold.notes).toEqual([
        `whether ${ID} is on this machine cannot be told: ${record}, where Claude Code records the marketplaces it has fetched, is not there. A plugin that is not there brings no hook: Claude Code's /plugin lists it, and its errors`,
      ]);
      expect((await wiring(repo, env)).code).toBe(0);
    });
  });
});

describe('doctor on the rest of what a ruling and a commit need', () => {
  // Made-up keys: nothing here decodes one.
  const KEY = 'AAAAC3NzaC1lZDI1NTE5AAAAIGb0mVx1Vt1yZ1U0dG1uZm9yZXhhbXBsZW9ubHk=';

  it('notes the signers whose key is not FIDO2, a certificate authority left out, and fails nothing for it (ADR-0006)', async () => {
    const repo = repository({
      '.github/allowed_signers': [
        `a@example.com namespaces="git" ssh-ed25519 ${KEY}`,
        `b@example.com sk-ssh-ed25519@openssh.com ${KEY}`,
        `*@example.com cert-authority ssh-rsa ${KEY}`,
        `c@example.com ecdsa-sha2-nistp256 ${KEY}`,
        'not a signer',
        '',
      ].join('\n'),
    });
    const result = await cli(['doctor'], repo.root);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(
      "\nsigners .github/allowed_signers is on main\n        note: signers whose key is not a FIDO2 key: a@example.com (ssh-ed25519, line 1), c@example.com (ecdsa-sha2-nistp256, line 4). Where an agent runs as the person, ADR-0006 recommends a FIDO2 key, ssh-keygen -t ed25519-sk, whose signature needs a touch no process can supply, or a key the agent's account cannot read; a PIV or PKCS#11 hardware key reads as a plain ssh-rsa or ecdsa line, so this is a note, not a failure\n        note: line 5 is not a signer: a signer is its principals, any options, a key type and a key\n",
    );
    const json = parsed<{ allowedSigners: unknown }>(await cli(['doctor', '--format', 'json'], repo.root));
    expect(json.allowedSigners).toMatchObject({
      onBase: true,
      notFido2: [
        { line: 1, principals: ['a@example.com'], keyType: 'ssh-ed25519' },
        { line: 4, principals: ['c@example.com'], keyType: 'ecdsa-sha2-nistp256' },
      ],
      problems: [{ line: 5, message: 'a signer is its principals, any options, a key type and a key' }],
    });
  });

  it('says nothing of the keys when every signer\'s is FIDO2', async () => {
    const repo = repository({ '.github/allowed_signers': `b@example.com sk-ssh-ed25519@openssh.com ${KEY}\n` });
    const result = await cli(['doctor'], repo.root);
    expect(result.stdout).toContain('\nsigners .github/allowed_signers is on main\nplugin  ');
  });

  it('reports whether git\'s pre-commit hook runs spec-harness, where git runs it from', async () => {
    const repo = repository({});
    expect((await cli(['doctor'], repo.root)).stdout).toContain(
      '\ngit     no pre-commit hook runs spec-harness (.git/hooks/pre-commit): one refuses a commit that changes what the active brief protects, for any agent or none, a shell\'s writes included; run spec-harness init --git-hook --write to add it\n',
    );
    await cli(['init', '--git-hook', '--write'], repo.root);
    expect((await cli(['doctor'], repo.root)).stdout).toContain('\ngit     .git/hooks/pre-commit runs spec-harness\n');
    const json = parsed<{ gitHook: unknown }>(await cli(['doctor', '--format', 'json'], repo.root));
    expect(json.gitHook).toEqual({ state: 'runs', file: '.git/hooks/pre-commit', detail: '.git/hooks/pre-commit runs spec-harness', note: null });
    const other = repository({});
    other.git('config', 'core.hooksPath', '.githooks');
    other.write('.githooks/pre-commit', '#!/bin/sh\nnpm test\n');
    expect((await cli(['doctor'], other.root)).stdout).toContain(
      '\ngit     .githooks/pre-commit does not run spec-harness: add the line "node node_modules/@descent-vtt/spec-harness/bin/spec-harness.js hook git" to it\n',
    );
  });

  it.skipIf(process.platform === 'win32')('says a hook git skips, one that is not executable, is not installed', async () => {
    const repo = repository({});
    await cli(['init', '--git-hook', '--write'], repo.root);
    chmodSync(join(repo.root, '.git', 'hooks', 'pre-commit'), 0o644);
    expect((await cli(['doctor'], repo.root)).stdout).toContain(
      '\ngit     .git/hooks/pre-commit runs spec-harness, but is not executable, so git skips it: chmod +x .git/hooks/pre-commit\n',
    );
  });

  it('says where the base came from: the flag, the configuration, or the remote\'s default branch', async () => {
    const r = repository({ [BRIEF_FILE]: brief() }, { base: null });
    r.git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    r.git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
    const base = async (args: string[], root = r.root) => parsed<{ base: { ref: string; source: string } }>(await cli(['doctor', ...args, '--format', 'json'], root)).base;
    expect(await base([])).toMatchObject({ ref: 'origin/main', source: 'remote' });
    expect(await base(['--base', 'main'])).toMatchObject({ ref: 'main', source: 'flag' });
    const configured = repository({ [BRIEF_FILE]: brief() });
    expect(await base([], configured.root)).toMatchObject({ ref: 'main', source: 'config' });
  });

  it('reads a spec-brief configuration that is not JSON as one that cannot say whether it loads the plugin', async () => {
    const r = repository({ [BRIEF_FILE]: brief(), '.spec-brief.json': '{ plugins: [' });
    const doctor = parsed<{ plugin: { state: string; file: string | null } }>(await cli(['doctor', '--format', 'json'], r.root));
    expect(doctor.plugin).toMatchObject({ state: 'unreadable', file: '.spec-brief.json' });
  });

  it('reads a spec-brief plugin loaded by a path to this package\'s plugin as loaded', async () => {
    const repo = repository({ '.spec-brief.json': JSON.stringify({ plugins: [{ module: './node_modules/@descent-vtt/spec-harness/plugin.js' }] }) });
    installHarness(repo.root);
    expect((await cli(['doctor'], repo.root)).stdout).toContain("\nplugin  spec-brief loads spec-harness's plugin (.spec-brief.json)");
    // As the package ships its export, under conditions: the file for an import is the default one.
    const manifest = { name: '@descent-vtt/spec-harness', type: 'module', exports: { './spec-brief-plugin': { types: './plugin.d.ts', default: './plugin.js' } } };
    repo.write('node_modules/@descent-vtt/spec-harness/package.json', JSON.stringify(manifest));
    expect((await cli(['doctor'], repo.root)).stdout).toContain("\nplugin  spec-brief loads spec-harness's plugin (.spec-brief.json)");
    // Absolute, and to this checkout's own build.
    repo.write('.spec-brief.json', JSON.stringify({ plugins: [join(ROOT, 'dist', 'plugin.js')] }));
    expect((await cli(['doctor'], repo.root)).stdout).toContain("\nplugin  spec-brief loads spec-harness's plugin (.spec-brief.json)");
    repo.write('.spec-brief.json', JSON.stringify({ plugins: ['./node_modules/@descent-vtt/spec-harness/package.json', './missing.js'] }));
    expect((await cli(['doctor'], repo.root)).stdout).toContain("\nplugin  spec-brief does not load spec-harness's plugin");
  });

  it('reads the plugin\'s file under the import or the node condition, and no missing file as it', async () => {
    const repo = repository({ '.spec-brief.json': JSON.stringify({ plugins: ['./node_modules/@descent-vtt/spec-harness/plugin.js'] }) });
    installHarness(repo.root);
    const exported = (target: unknown): void =>
      repo.write('node_modules/@descent-vtt/spec-harness/package.json', JSON.stringify({ name: '@descent-vtt/spec-harness', type: 'module', exports: { './spec-brief-plugin': target } }));
    for (const conditions of [{ import: './plugin.js' }, { node: './plugin.js' }]) {
      exported(conditions);
      expect((await cli(['doctor'], repo.root)).stdout, JSON.stringify(conditions)).toContain("\nplugin  spec-brief loads spec-harness's plugin (.spec-brief.json)");
    }
    // Node takes the first key an import meets, in the object's order, and stops at a null one.
    exported({ default: './plugin.js', import: './other.js' });
    expect((await cli(['doctor'], repo.root)).stdout).toContain("\nplugin  spec-brief loads spec-harness's plugin (.spec-brief.json)");
    exported({ import: null, default: './plugin.js' });
    expect((await cli(['doctor'], repo.root)).stdout).toContain("\nplugin  spec-brief does not load spec-harness's plugin");
    // The installed copy names a file it does not have, and the configuration one that is not there: neither is the plugin.
    exported('./gone.js');
    repo.write('.spec-brief.json', JSON.stringify({ plugins: ['./missing.js'] }));
    expect((await cli(['doctor'], repo.root)).stdout).toContain("\nplugin  spec-brief does not load spec-harness's plugin");
  });
});

describe('the built command line', () => {
  it('runs as a person runs it: version, and a refusal with exit 1', () => {
    expect(spawnBin(['--version'], ROOT)).toEqual({ code: 0, stdout: `${VERSION}\n`, stderr: '' });
    const repo = repository({ [BRIEF_FILE]: brief({ protected: ['src/db/schema.ts'] }), 'src/db/schema.ts': 'x\n' });
    const refused = spawnBin(['guard', 'src/db/schema.ts', '--brief', '1'], repo.root);
    expect(refused.code).toBe(1);
    expect(refused.stdout).toContain('refused  brief 001 does not empower this round to change src/db/schema.ts');
    const hook = spawnBin(['hook', 'claude', '--brief', '1'], repo.root, JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Edit', cwd: repo.root, tool_input: { file_path: 'src/db/schema.ts' } }));
    expect(hook.code).toBe(0);
    expect(JSON.parse(hook.stdout).hookSpecificOutput.permissionDecision).toBe('deny');
  });

  // run answers what it awaits, in process (above). An error thrown from a
  // callback - a stream's, a timer's, a child's - reaches no promise, and
  // only the launcher can answer it. Node's own answer is exit 1.
  it('ends an error nothing awaits with exit 2 and its stack on stderr', () => {
    // Loaded before the launcher: when the run has nothing left to do, it
    // throws where no promise holds the error.
    const stray = 'process.once("beforeExit", () => setImmediate(() => { throw new Error("thrown where nothing awaits"); }));';
    const result = spawnSync(process.execPath, ['--import', `data:text/javascript,${encodeURIComponent(stray)}`, BIN, '--version'], { cwd: ROOT, encoding: 'utf8' });
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/^spec-harness: unexpected error: Error: thrown where nothing awaits\n {4}at /);
    // The run had answered by then, and its answer is not printed twice.
    expect(result.stdout).toBe(`${VERSION}\n`);
  });

  describe('with an output its reader closed', () => {
    // The process's own streams never throw this where run awaits it (held
    // in process, above): the write fails, and the stream reports it as an
    // event, which only the launcher can answer.
    const CLOSED = 'spec-harness: stdout was closed before all of the output was written\n';

    /**
     * The launcher with one of its outputs closed by its reader before the run
     * writes to it, as stdout is behind `| head` once head has left. What the
     * other output was sent is the answer. A server that outlives the test is
     * ended by the handle the test holds.
     */
    function closing(stream: 'stdout' | 'stderr', args: readonly string[], input?: string): Promise<{ code: number; read: string }> {
      return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [BIN, ...args], {
          cwd: ROOT,
          env: { ...process.env, SPEC_BRIEF: '' },
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
        });
        child[stream].destroy();
        const open = stream === 'stdout' ? child.stderr : child.stdout;
        let read = '';
        open.setEncoding('utf8');
        open.on('data', (chunk: string) => (read += chunk));
        const overdue = setTimeout(() => child.kill(), 60_000);
        child.once('error', reject);
        child.once('close', (code) => {
          clearTimeout(overdue);
          resolve({ code: code ?? -1, read });
        });
        // Held open after a request, so that only the closed output ends a server.
        child.stdin.on('error', () => {});
        if (input === undefined) child.stdin.end();
        else child.stdin.write(input);
      });
    }

    it('ends with exit 2 and one line on stderr, with no stack', async () => {
      for (const args of [['--help'], ['guard', 'README.md'], ['doctor', '--format', 'json']]) {
        expect(await closing('stdout', args), args.join(' ')).toEqual({ code: 2, read: CLOSED });
      }
    });

    it('ends the server the same way, at the first answer it cannot write', async () => {
      const initialize = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } } });
      expect(await closing('stdout', ['mcp'], `${initialize}\n`)).toEqual({ code: 2, read: CLOSED });
    });

    it('says nothing when stderr is the one that closed, on stdout either, and still exits 2', async () => {
      // Left to Node, the error of that write is exit 1.
      expect(await closing('stderr', ['guard', '--frobnicate'])).toEqual({ code: 2, read: '' });
    });

    // A shell's pipe, where Node's own child is a socket pair: the reader has
    // left by the time the run writes. Without a shell there is no pipeline
    // to make, and cmd's has no way to hand back the exit code of its left side.
    it.skipIf(process.platform === 'win32')('says so behind a shell pipe whose reader has left', () => {
      const pipeline = '{ sleep 1; "$0" "$1" --help; echo "exit $?" >&2; } | true';
      const result = spawnSync('sh', ['-c', pipeline, process.execPath, BIN], { cwd: ROOT, encoding: 'utf8' });
      expect(result.stderr).toBe(`${CLOSED}exit 2\n`);
    });
  });
});
