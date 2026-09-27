import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { GUARD_HOOK, mcpServer, mergeMcp, PLUGIN, PROJECT_DIR_OR_HERE } from '../../src/configure.js';
import { claudeSettingsFiles } from '../../src/round.js';
import { cleanup, cli, install, installFake, parsed, repository, siblings, temp, write, type Repository } from './helpers.js';

afterAll(cleanup);

/** A repository with spec-brief installed where `locate()` looks for it, and no configuration of its own. */
function installed(): Repository {
  const repo = repository({ 'README.md': '# x\n' }, null);
  install(repo.root, 'spec-brief');
  return repo;
}

/** Every file in the work tree but .git and node_modules, with its content. */
function snapshot(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (directory: string, prefix: string): void => {
    for (const name of readdirSync(directory)) {
      if (name === '.git' || name === 'node_modules') continue;
      const path = join(directory, name);
      if (statSync(path).isDirectory()) walk(path, `${prefix}${name}/`);
      else out[`${prefix}${name}`] = `${statSync(path).size}`;
    }
  };
  walk(root, '');
  return out;
}

interface Step {
  file: string;
  action: string;
  detail: string;
}

describe('init', () => {
  it('prints the plan and changes nothing without --write', async () => {
    const repo = installed();
    const before = snapshot(repo.root);
    const result = await cli(['init'], repo.root);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('run     .spec-brief.json\n        spec-brief init');
    expect(result.stdout).toContain(
      `update  .spec-brief.json\n        load spec-harness's plugin, "${PLUGIN}": spec-brief's archive asks it whether a signed ruling allows a protected file, and refuses the file without it; measure the archive from main, as spec-harness does: without a base, spec-brief's archive warns that the scope went unmeasured and checks no protected file\n`,
    );
    expect(result.stdout).toContain(
      'create  .spec-harness.json\n        rounds are measured from main, the branch init runs on: no remote records a default branch (refs/remotes/origin/HEAD); change "base" if rounds merge into another\n',
    );
    expect(result.stdout).toContain('create  .claude/settings.json');
    expect(result.stdout).toContain('create  .mcp.json');
    expect(result.stdout).toContain('advise  .github/allowed_signers');
    expect(result.stdout.endsWith('\nNothing was changed. Run again with --write to apply the plan.\n')).toBe(true);
    expect(snapshot(repo.root)).toEqual(before);
  });

  it('applies the plan with --write, and a second run changes nothing', async () => {
    const repo = installed();
    const first = await cli(['init', '--write', '--format', 'json'], repo.root);
    expect(first.code).toBe(0);
    const steps = parsed<{ written: boolean; steps: Step[] }>(first);
    expect(steps.written).toBe(true);
    expect(steps.steps.map((s) => [s.file, s.action])).toEqual([
      ['.spec-brief.json', 'run'],
      ['.spec-brief.json', 'update'],
      ['.spec-harness.json', 'create'],
      ['.claude/settings.json', 'create'],
      ['.mcp.json', 'create'],
      ['.github/allowed_signers', 'advise'],
    ]);
    const briefConfig = JSON.parse(repo.read('.spec-brief.json'));
    expect(briefConfig.plugins).toEqual([PLUGIN]);
    // Everything spec-brief init spelled out is still there.
    expect(briefConfig).toMatchObject({ briefs: 'briefs', archive: 'briefs/archive' });
    expect(JSON.parse(repo.read('.spec-harness.json'))).toEqual({ base: 'main' });
    const settings = JSON.parse(repo.read('.claude/settings.json'));
    expect(settings.hooks.PreToolUse[0].hooks[0]).toEqual(GUARD_HOOK);
    expect(settings.hooks.PostToolUse[0].hooks[0]).toEqual(GUARD_HOOK);
    expect(JSON.parse(repo.read('.mcp.json'))).toEqual({ mcpServers: { 'spec-harness': mcpServer(PROJECT_DIR_OR_HERE) } });

    const settled = snapshot(repo.root);
    const contents = ['.spec-brief.json', '.spec-harness.json', '.claude/settings.json', '.mcp.json'].map((file) => repo.read(file));
    const second = await cli(['init', '--write'], repo.root);
    expect(second.code).toBe(0);
    expect(second.stdout).toContain('keep    .spec-brief.json\n        briefs in briefs/, the archive in briefs/archive/');
    expect(second.stdout).toContain("keep    .spec-brief.json\n        spec-harness's plugin is loaded, and the archive is measured from main\n");
    expect(second.stdout).toContain('keep    .claude/settings.json\n        the guard hooks are installed');
    expect(second.stdout).toContain('keep    .mcp.json\n        the spec-harness server is registered');
    expect(second.stdout).not.toContain('Nothing was changed');
    expect(snapshot(repo.root)).toEqual(settled);
    expect(['.spec-brief.json', '.spec-harness.json', '.claude/settings.json', '.mcp.json'].map((file) => repo.read(file))).toEqual(contents);
  });

  it('merges into settings that exist, keeping the person\'s own hooks and servers', async () => {
    const lint = { matcher: 'Write', hooks: [{ type: 'command', command: 'npm run lint' }] };
    const repo = repository({
      '.spec-brief.json': JSON.stringify({ briefs: 'docs/briefs' }),
      '.claude/settings.json': JSON.stringify({ permissions: { allow: ['Bash(ls)'] }, hooks: { PreToolUse: [lint] } }),
      '.mcp.json': JSON.stringify({ mcpServers: { other: { command: 'x' } } }),
    });
    const result = await cli(['init', '--write'], repo.root);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('keep    .spec-brief.json\n        briefs in docs/briefs/, the archive in docs/briefs/archive/');
    expect(result.stdout).toContain("update  .spec-brief.json\n        load spec-harness's plugin");
    expect(JSON.parse(repo.read('.spec-brief.json'))).toEqual({ briefs: 'docs/briefs', plugins: [PLUGIN], archiving: { base: 'main' } });
    expect(result.stdout).toContain('keep    .spec-harness.json\n        rounds are measured from main\n');
    const settings = JSON.parse(repo.read('.claude/settings.json'));
    expect(settings.permissions).toEqual({ allow: ['Bash(ls)'] });
    expect(settings.hooks.PreToolUse).toHaveLength(2);
    expect(settings.hooks.PreToolUse[0]).toEqual(lint);
    expect(settings.hooks.PreToolUse[1].hooks[0]).toEqual(GUARD_HOOK);
    expect(JSON.parse(repo.read('.mcp.json')).mcpServers.other).toEqual({ command: 'x' });
    expect((await cli(['init'], repo.root)).stdout).toContain('keep    .claude/settings.json');
  });

  it('advises by hand for a file it cannot read, and leaves it alone', async () => {
    const repo = repository({ '.claude/settings.json': '{ not json', '.mcp.json': '[]', '.spec-brief.json': '{', '.spec-graph.json': 'x' }, { tools: { ...siblings(), 'spec-graph': ['node', 'graph.js'] } });
    const result = await cli(['init', '--write'], repo.root);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(`advise  .claude/settings.json\n        cannot be read as JSON; add the guard as a PreToolUse and a PostToolUse hook by hand: ${JSON.stringify(GUARD_HOOK)}`);
    expect(result.stdout).toContain('advise  .mcp.json\n        cannot be read as JSON; add the spec-harness server by hand');
    expect(result.stdout).toContain('advise  .spec-graph.json\n        cannot be read as JSON; add "historyPatterns": ["briefs/archive/**"] by hand');
    expect(repo.read('.spec-graph.json')).toBe('x');
    expect(result.stdout).toContain('keep    .spec-brief.json\n        briefs in briefs/, the archive in briefs/archive/');
    expect(result.stdout).toContain(`advise  .spec-brief.json\n        cannot be read as JSON; add "plugins": ["${PLUGIN}"], and "archiving": { "base": "main" } by hand`);
    expect(repo.read('.spec-brief.json')).toBe('{');
    expect(repo.read('.claude/settings.json')).toBe('{ not json');
    expect(repo.read('.mcp.json')).toBe('[]');
  });

  it('loads the plugin in spec-brief.json when that is the configuration spec-brief reads', async () => {
    const repo = repository({ 'spec-brief.json': JSON.stringify({ plugins: [{ module: './x.mjs' }] }) });
    const result = await cli(['init', '--write', '--format', 'json'], repo.root);
    expect(parsed<{ steps: Step[] }>(result).steps.filter((step) => step.file.endsWith('spec-brief.json')).map((step) => [step.file, step.action])).toEqual([
      ['spec-brief.json', 'keep'],
      ['spec-brief.json', 'update'],
    ]);
    expect(JSON.parse(repo.read('spec-brief.json'))).toEqual({ plugins: [{ module: './x.mjs' }, PLUGIN], archiving: { base: 'main' } });
    expect(existsSync(join(repo.root, '.spec-brief.json'))).toBe(false);
  });

  it('tells spec-graph that the archive is history, and says it reads no brief where its patterns miss them', async () => {
    const graph = { tools: { ...siblings(), 'spec-graph': ['node', 'graph.js'] } };
    const repo = repository({ '.spec-brief.json': JSON.stringify({ briefs: 'b', archive: 'old' }) }, graph);
    const result = await cli(['init', '--write'], repo.root);
    expect(result.stdout).toContain(
      'create  .spec-graph.json\n        read old/** as history, for when spec-graph reads the briefs; its patterns do not reach b/, so it checks none of them now: add "b/**/*.md" to its "patterns" if it should\n',
    );
    expect(JSON.parse(repo.read('.spec-graph.json'))).toEqual({ historyPatterns: ['old/**'] });
    expect((await cli(['init'], repo.root)).stdout).toContain('keep    .spec-graph.json\n        old/** is history, for when spec-graph reads the briefs');

    const read = repository({ '.spec-brief.json': JSON.stringify({ briefs: 'docs/briefs' }) }, graph);
    expect((await cli(['init'], read.root)).stdout).toContain(
      'create  .spec-graph.json\n        read docs/briefs/archive/** as history: an archived brief is a record whatever its status says, so a live brief that depends on one is not a stale premise\n',
    );
  });

  it('merges into the configuration spec-graph reads, and never shadows the key in package.json', async () => {
    const graph = { tools: { ...siblings(), 'spec-graph': ['node', 'graph.js'] } };
    const named = repository({ 'spec-graph.config.json': JSON.stringify({ patterns: ['briefs/**/*.md'] }) }, graph);
    const result = await cli(['init', '--write'], named.root);
    expect(result.stdout).toContain('update  spec-graph.config.json\n        read briefs/archive/** as history: an archived brief is a record');
    expect(JSON.parse(named.read('spec-graph.config.json'))).toEqual({ patterns: ['briefs/**/*.md'], historyPatterns: ['briefs/archive/**'] });
    expect(existsSync(join(named.root, '.spec-graph.json'))).toBe(false);

    const keyed = repository({ 'package.json': JSON.stringify({ name: 'x', 'spec-graph': { patterns: ['docs/**/*.md'] } }) }, graph);
    const advised = await cli(['init', '--write'], keyed.root);
    expect(advised.stdout).toContain(
      'advise  package.json\n        spec-graph reads its configuration from the "spec-graph" key here, which init does not edit: add "briefs/archive/**" to its "historyPatterns" by hand\n',
    );
    expect(existsSync(join(keyed.root, '.spec-graph.json'))).toBe(false);
    // A package.json without the key is spec-graph's defaults, and gets a file.
    const plain = repository({ 'package.json': JSON.stringify({ name: 'x' }) }, graph);
    expect((await cli(['init'], plain.root)).stdout).toContain('create  .spec-graph.json\n');
  });

  it('replaces the npx hooks and server 0.1 installed, keeping everything else', async () => {
    const legacy = { type: 'command', command: 'npx --no-install spec-harness hook claude', timeout: 60 };
    const repo = repository({
      '.claude/settings.json': JSON.stringify({ model: 'm', hooks: { PreToolUse: [{ matcher: 'Edit|Write|MultiEdit|NotebookEdit', hooks: [legacy] }], PostToolUse: [{ matcher: 'Edit|Write|MultiEdit|NotebookEdit', hooks: [legacy] }] } }),
      '.mcp.json': JSON.stringify({ mcpServers: { other: { command: 'x' }, 'spec-harness': { command: 'npx', args: ['--no-install', 'spec-harness', 'mcp'] } } }),
    });
    const result = await cli(['init', '--write'], repo.root);
    expect(result.stdout).toContain('update  .claude/settings.json\n        the guard hooks, run with node from the project\'s install');
    expect(result.stdout).toContain('update  .mcp.json\n        the spec-harness MCP server, run with node from the project\'s install');
    const settings = JSON.parse(repo.read('.claude/settings.json'));
    expect(settings.model).toBe('m');
    expect(settings.hooks.PreToolUse).toEqual([{ matcher: 'Edit|Write|MultiEdit|NotebookEdit', hooks: [GUARD_HOOK] }]);
    expect(settings.hooks.PostToolUse).toEqual([{ matcher: 'Edit|Write|MultiEdit|NotebookEdit', hooks: [GUARD_HOOK] }]);
    expect(JSON.parse(repo.read('.mcp.json'))).toEqual({ mcpServers: { other: { command: 'x' }, 'spec-harness': mcpServer(PROJECT_DIR_OR_HERE) } });
  });

  it('advises installing spec-brief when it is not there to ask', async () => {
    const repo = repository({}, null);
    const result = await cli(['init'], repo.root);
    expect(result.stdout).toContain('advise  .spec-brief.json\n        spec-brief is not installed here: npm install --save-dev @descent-vtt/spec-brief');
  });

  it('advises upgrading a sibling older than this release runs, and runs nothing of it', async () => {
    const repo = repository({}, null);
    installFake(repo.root, 'spec-brief', JSON.stringify({ version: '0.1.0' }));
    installFake(repo.root, 'spec-graph', JSON.stringify({ version: '0.8.0' }));
    const result = await cli(['init', '--write', '--format', 'json'], repo.root);
    expect(result.code).toBe(0);
    const steps = parsed<{ steps: Step[] }>(result).steps;
    expect(steps.filter((step) => step.file === '.spec-brief.json' || step.file === '.spec-graph.json')).toEqual([
      {
        file: '.spec-brief.json',
        action: 'advise',
        detail: 'spec-brief 0.1.0 is installed here; spec-harness needs 0.2.0 or later: npm install --save-dev @descent-vtt/spec-brief@latest',
      },
      {
        file: '.spec-graph.json',
        action: 'advise',
        detail: 'spec-graph 0.8.0 is installed here; spec-harness needs 0.9.0 or later: npm install --save-dev @descent-vtt/spec-graph@latest',
      },
    ]);
    expect(existsSync(join(repo.root, '.spec-brief.json'))).toBe(false);
    expect(existsSync(join(repo.root, '.spec-graph.json'))).toBe(false);
  });

  it('names the remote\'s default branch as the base', async () => {
    const repo = repository({}, null);
    repo.git('update-ref', 'refs/remotes/origin/trunk', 'HEAD');
    repo.git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk');
    const result = await cli(['init', '--write'], repo.root);
    expect(result.stdout).toContain('create  .spec-harness.json\n        rounds are measured from origin/trunk');
    expect(JSON.parse(repo.read('.spec-harness.json'))).toEqual({ base: 'origin/trunk' });
  });

  it('names main when a remote was added and pushed to, which records no default branch', async () => {
    const remote = temp();
    execFileSync('git', ['init', '-q', '--bare', remote]);
    const repo = repository({}, null);
    repo.git('remote', 'add', 'origin', remote);
    repo.git('push', '-q', '-u', 'origin', 'main');
    repo.git('fetch', '-q', 'origin');
    // git 2.48 and later record the remote's HEAD when they fetch; earlier
    // releases, and a push alone, leave none. The repository is left as those do.
    repo.git('update-ref', '--no-deref', '-d', 'refs/remotes/origin/HEAD');
    expect(() => repo.git('rev-parse', '--verify', '--quiet', 'refs/remotes/origin/HEAD')).toThrow();
    expect(repo.git('rev-parse', '--verify', '--quiet', 'refs/remotes/origin/main')).toBe(repo.git('rev-parse', 'HEAD'));
    const result = await cli(['init', '--write'], repo.root);
    expect(result.stdout).toContain('create  .spec-harness.json\n        rounds are measured from main, the branch init runs on');
    expect(JSON.parse(repo.read('.spec-harness.json'))).toEqual({ base: 'main' });
  });

  it('names the only branch, whatever it is called', async () => {
    const repo = repository({}, null);
    repo.git('branch', '-m', 'main', 'trunk');
    const result = await cli(['init', '--write'], repo.root);
    expect(result.stdout).toContain('create  .spec-harness.json\n        rounds are measured from trunk, the only branch');
    expect(JSON.parse(repo.read('.spec-harness.json'))).toEqual({ base: 'trunk' });
  });

  it('asks the person for the base when it cannot tell one, and writes nothing for it', async () => {
    const repo = repository({}, null);
    repo.git('checkout', '-q', '-b', 'brief/001-x');
    const result = await cli(['init', '--write'], repo.root);
    expect(result.stdout).toContain(
      'advise  .spec-harness.json\n        no base can be told: no remote records a default branch (refs/remotes/origin/HEAD), and brief/001-x is not main, master or the only branch; set "base" to the branch rounds merge into, or run git remote set-head origin --auto and init again\n',
    );
    expect(existsSync(join(repo.root, '.spec-harness.json'))).toBe(false);
  });

  it('adds the base to a configuration that names none, keeping the rest', async () => {
    const repo = repository({ '.spec-brief.json': '{}' }, null);
    repo.write('.spec-harness.json', '{ "outOfScope": "ask", "base": null }\n');
    const result = await cli(['init', '--write'], repo.root);
    expect(result.stdout).toContain('update  .spec-harness.json\n        rounds are measured from main, the branch init runs on');
    expect(JSON.parse(repo.read('.spec-harness.json'))).toEqual({ outOfScope: 'ask', base: 'main' });
  });

  it('adds git\'s pre-commit hook only when asked, and never over one that exists', async () => {
    const repo = repository({});
    const hook = join(repo.git('rev-parse', '--path-format=absolute', '--git-common-dir'), 'hooks', 'pre-commit');
    expect((await cli(['init'], repo.root)).stdout).not.toContain('pre-commit');
    const planned = await cli(['init', '--git-hook', '--write'], repo.root);
    expect(planned.stdout).toContain('refuse a commit that changes what the active brief protects');
    expect(repo.read('.git/hooks/pre-commit')).toBe(
      '#!/bin/sh\n# spec-harness: refuse a commit that changes what the active brief protects.\nexec npx --no-install spec-harness hook git\n',
    );
    expect(existsSync(hook)).toBe(true);
    expect((await cli(['init', '--git-hook'], repo.root)).stdout).toContain('already runs spec-harness');

    const other = repository({});
    other.write('.git/hooks/pre-commit', '#!/bin/sh\nnpm test\n');
    const advised = await cli(['init', '--git-hook', '--write'], other.root);
    expect(advised.stdout).toContain('a pre-commit hook exists; add the line "npx --no-install spec-harness hook git" to it');
    expect(other.read('.git/hooks/pre-commit')).toBe('#!/bin/sh\nnpm test\n');
  });

  it('writes the hook where core.hooksPath points', async () => {
    const repo = repository({});
    repo.git('config', 'core.hooksPath', '.githooks');
    await cli(['init', '--git-hook', '--write'], repo.root);
    expect(repo.read('.githooks/pre-commit')).toContain('spec-harness hook git');
  });

  it('writes no hook and no server while the Claude Code plugin is on, and says how to have them instead', async () => {
    const user = temp();
    write(user, 'settings.json', JSON.stringify({ enabledPlugins: { 'spec-harness@spec-tools': true } }));
    const env = { CLAUDE_CONFIG_DIR: user };
    const repo = installed();
    const result = await cli(['init', '--write', '--format', 'json'], repo.root, { env });
    expect(result.code).toBe(0);
    const settingsFile = join(user, 'settings.json');
    const off = 'turn the plugin off for this project with claude plugin disable spec-harness@spec-tools --scope local and run init again';
    expect(parsed<{ steps: Step[] }>(result).steps.filter((step) => step.file === '.claude/settings.json' || step.file === '.mcp.json')).toEqual([
      {
        file: '.claude/settings.json',
        action: 'skip',
        detail: `the spec-harness plugin is on (spec-harness@spec-tools in ${settingsFile}) and brings the guard hooks, so init writes none: with both, every write is guarded twice. To have them here instead, for every clone of the repository, ${off}`,
      },
      {
        file: '.mcp.json',
        action: 'skip',
        detail: `the spec-harness plugin is on (spec-harness@spec-tools in ${settingsFile}) and brings the server, so init registers none: with both, the server is registered twice. To have it here instead, for every clone of the repository, ${off}`,
      },
    ]);
    expect(existsSync(join(repo.root, '.claude'))).toBe(false);
    expect(existsSync(join(repo.root, '.mcp.json'))).toBe(false);
    // The rest of the family is configured as before.
    expect(JSON.parse(repo.read('.spec-harness.json'))).toEqual({ base: 'main' });
    expect(JSON.parse(repo.read('.spec-brief.json')).plugins).toEqual([PLUGIN]);
    // Nothing is advised by hand for a file the plugin makes unnecessary.
    const unreadable = repository({ '.claude/settings.json': '{ not json' });
    expect((await cli(['init'], unreadable.root, { env })).stdout).toContain('skip    .claude/settings.json\n        the spec-harness plugin is on');
    // A repository that turns the plugin on in its own settings, beside other entries, keeps both files as they are.
    const settings = JSON.stringify({ enabledPlugins: { 'spec-harness@spec-tools': true }, permissions: { allow: ['Bash(ls)'] } });
    const servers = JSON.stringify({ mcpServers: { other: { command: 'x' } } });
    const committed = repository({ '.claude/settings.json': settings, '.mcp.json': servers });
    const plan = await cli(['init', '--write', '--format', 'json'], committed.root);
    expect(parsed<{ steps: Step[] }>(plan).steps.filter((step) => step.file === '.claude/settings.json' || step.file === '.mcp.json').map((step) => step.action)).toEqual([
      'skip',
      'skip',
    ]);
    expect(committed.read('.claude/settings.json')).toBe(settings);
    expect(committed.read('.mcp.json')).toBe(servers);
  });

  it('reports init\'s entries beside the plugin as a double install, and changes neither file', async () => {
    const legacy = { type: 'command', command: 'npx --no-install spec-harness hook claude', timeout: 60 };
    const settings = JSON.stringify({ enabledPlugins: { 'spec-harness@team': true }, hooks: { PostToolUse: [{ matcher: 'Write', hooks: [legacy] }] } });
    const mcp = JSON.stringify(mergeMcp({}));
    const repo = repository({ '.claude/settings.json': settings, '.mcp.json': mcp });
    const result = await cli(['init', '--write'], repo.root);
    expect(result.code).toBe(0);
    const off = 'turn the plugin off for this project with claude plugin disable spec-harness@team --scope local';
    expect(result.stdout).toContain(
      `advise  .claude/settings.json\n        the spec-harness plugin is on (spec-harness@team in .claude/settings.json) and brings the guard hooks this file holds as well, so every write is guarded twice: take spec-harness's hooks out of this file, or ${off}\n`,
    );
    expect(result.stdout).toContain(
      `advise  .mcp.json\n        the spec-harness plugin is on (spec-harness@team in .claude/settings.json) and brings the server this file holds as well, so the server is registered twice: take the spec-harness server out of this file, or ${off}\n`,
    );
    // 0.1's hook stays as it was: init neither upgrades nor removes an entry the plugin doubles.
    expect(repo.read('.claude/settings.json')).toBe(settings);
    expect(repo.read('.mcp.json')).toBe(mcp);
  });

  it('writes the hooks and the server once the plugin is off for the project, whatever the user\'s settings say', async () => {
    const user = temp();
    write(user, 'settings.json', JSON.stringify({ enabledPlugins: { 'spec-harness@spec-tools': true } }));
    const repo = repository({ '.claude/settings.local.json': JSON.stringify({ enabledPlugins: { 'spec-harness@spec-tools': false } }) });
    const result = await cli(['init', '--write'], repo.root, { env: { CLAUDE_CONFIG_DIR: user } });
    expect(result.stdout).toContain('create  .claude/settings.json\n        the guard hooks');
    expect(result.stdout).toContain('create  .mcp.json\n        the spec-harness MCP server');
    expect(JSON.parse(repo.read('.claude/settings.json')).hooks.PreToolUse[0].hooks[0]).toEqual(GUARD_HOOK);
    expect(JSON.parse(repo.read('.mcp.json'))).toEqual({ mcpServers: { 'spec-harness': mcpServer(PROJECT_DIR_OR_HERE) } });
  });

  it('reads the user\'s settings under the home directory, unless CLAUDE_CONFIG_DIR names another place', async () => {
    const home = temp();
    write(home, '.claude/settings.json', JSON.stringify({ enabledPlugins: { 'spec-harness@spec-tools': true } }));
    const repo = repository({});
    // HOME on macOS and Linux, USERPROFILE on Windows: both name the same place here.
    const fromHome = await cli(['init'], repo.root, { env: { HOME: home, USERPROFILE: home } });
    expect(fromHome.stdout).toContain(`skip    .claude/settings.json\n        the spec-harness plugin is on (spec-harness@spec-tools in ${join(home, '.claude', 'settings.json')})`);
    const elsewhere = await cli(['init'], repo.root, { env: { HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: temp() } });
    expect(elsewhere.stdout).toContain('create  .claude/settings.json\n');
  });

  it('stops with exit 2 when a step it applies fails', async () => {
    const repo = repository({}, { tools: { 'spec-brief': ['node', '-e', 'process.stderr.write("init refused"); process.exit(1)'] } });
    const result = await cli(['init', '--write'], repo.root);
    expect(result).toMatchObject({ code: 2, stderr: 'spec-harness: .spec-brief.json: spec-brief init failed: init refused\n' });
  });
});

describe('the Claude Code settings init and doctor read', () => {
  const project = (root: string) => [
    { file: '.claude/settings.json', path: join(root, '.claude', 'settings.json') },
    { file: '.claude/settings.local.json', path: join(root, '.claude', 'settings.local.json') },
  ];

  it('are the user\'s under the home directory Claude Code uses, then the project\'s and the local ones', () => {
    const env = { HOME: join('h', 'posix'), USERPROFILE: join('h', 'windows') };
    const user = (home: string) => ({ file: join(home, '.claude', 'settings.json'), path: join(home, '.claude', 'settings.json') });
    expect(claudeSettingsFiles('r', env, 'win32')).toEqual([user(join('h', 'windows')), ...project('r')]);
    expect(claudeSettingsFiles('r', env, 'linux')).toEqual([user(join('h', 'posix')), ...project('r')]);
    expect(claudeSettingsFiles('r', env, 'darwin')).toEqual([user(join('h', 'posix')), ...project('r')]);
  });

  it('put CLAUDE_CONFIG_DIR before the home directory, and leave the user\'s out when neither is named', () => {
    const settings = join('c', 'settings.json');
    expect(claudeSettingsFiles('r', { CLAUDE_CONFIG_DIR: 'c', HOME: 'h' }, 'linux')).toEqual([{ file: settings, path: settings }, ...project('r')]);
    expect(claudeSettingsFiles('r', { CLAUDE_CONFIG_DIR: '', HOME: 'h' }, 'linux')[0]?.path).toBe(join('h', '.claude', 'settings.json'));
    expect(claudeSettingsFiles('r', { HOME: '' }, 'linux')).toEqual(project('r'));
    expect(claudeSettingsFiles('r', { HOME: 'h' }, 'win32')).toEqual(project('r'));
    expect(claudeSettingsFiles('r', {}, 'linux')).toEqual(project('r'));
  });
});
