import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { HELP } from '../../src/cli.js';
import { brief, BRIEF_FILE, cleanup, cli, installFake, parsed, repository, ROOT, SPEC_BRIEF, spawnBin, temp, write } from './helpers.js';

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
    expect(await cli(['audit', '--format', 'xml'], ROOT)).toEqual({ code: 2, stdout: '', stderr: 'spec-harness: --format must be pretty or json, not "xml"\n' });
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
      '\nsigners .github/allowed_signers is not on main, so no ruling can count: commit it there, one line per person, "<email> namespaces="git" <public key>"\n',
    );
    expect(pretty.stdout).toContain('\nplugin  spec-brief has no configuration at the root, so it loads no plugin');
    expect(pretty.stdout).toContain(`found     spec-brief  node ${SPEC_BRIEF} (named in .spec-harness.json; its version is not checked)`);
    expect(pretty.stdout).toContain('absent    spec-graph  spec-graph is not installed here: npm install --save-dev @descent-vtt/spec-graph, or name its command under "tools" in .spec-harness.json');
    const json = parsed<{
      root: string;
      branch: string;
      brief: string;
      base: unknown;
      allowedSigners: unknown;
      plugin: unknown;
      siblings: { tool: string; state: string; version: string | null; minimum: string }[];
    }>(await cli(['doctor', '--format', 'json'], repo.root));
    expect(json.brief).toBe('001');
    expect(json.base).toEqual({ ref: 'main', source: 'config', mergeBase: repo.git('rev-parse', 'HEAD') });
    expect(json.allowedSigners).toMatchObject({ file: '.github/allowed_signers', onBase: false });
    expect(json.plugin).toMatchObject({ state: 'unconfigured', file: null });
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
