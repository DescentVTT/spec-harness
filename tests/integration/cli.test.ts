import { chmodSync, copyFileSync, linkSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { HELP } from '../../src/cli.js';
import { mergeClaudeSettings, mergeMcp } from '../../src/configure.js';
import { brief, BRIEF_FILE, cleanup, cli, installFake, installHarness, parsed, repository, ROOT, SPEC_BRIEF, spawnBin, temp, write, type Repository } from './helpers.js';

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
    expect(json.gitHook).toEqual({ state: 'runs', file: '.git/hooks/pre-commit', detail: '.git/hooks/pre-commit runs spec-harness' });
    const other = repository({});
    other.git('config', 'core.hooksPath', '.githooks');
    other.write('.githooks/pre-commit', '#!/bin/sh\nnpm test\n');
    expect((await cli(['doctor'], other.root)).stdout).toContain(
      '\ngit     .githooks/pre-commit does not run spec-harness: add the line "npx --no-install spec-harness hook git" to it\n',
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
});
