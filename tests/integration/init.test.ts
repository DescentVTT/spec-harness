import { cpSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { HOOK_COMMAND } from '../../src/setup.js';
import { cleanup, cli, parsed, repository, ROOT, siblings, type Repository } from './helpers.js';

afterAll(cleanup);

/** A repository with spec-brief installed where `locate()` looks for it, and no configuration of its own. */
function installed(): Repository {
  const repo = repository({ 'README.md': '# x\n' }, null);
  cpSync(join(ROOT, 'node_modules', '@descent-vtt', 'spec-brief'), join(repo.root, 'node_modules', '@descent-vtt', 'spec-brief'), { recursive: true });
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
    expect(result.stdout).toContain('create  .spec-harness.json\n        the defaults');
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
      ['.spec-harness.json', 'create'],
      ['.claude/settings.json', 'create'],
      ['.mcp.json', 'create'],
      ['.github/allowed_signers', 'advise'],
    ]);
    expect(existsSync(join(repo.root, '.spec-brief.json'))).toBe(true);
    expect(JSON.parse(repo.read('.spec-harness.json'))).toEqual({});
    const settings = JSON.parse(repo.read('.claude/settings.json'));
    expect(settings.hooks.PreToolUse[0].hooks[0].command).toBe(HOOK_COMMAND);
    expect(settings.hooks.PostToolUse[0].hooks[0].command).toBe(HOOK_COMMAND);
    expect(JSON.parse(repo.read('.mcp.json'))).toEqual({ mcpServers: { 'spec-harness': { command: 'npx', args: ['--no-install', 'spec-harness', 'mcp'] } } });

    const settled = snapshot(repo.root);
    const contents = ['.spec-brief.json', '.spec-harness.json', '.claude/settings.json', '.mcp.json'].map((file) => repo.read(file));
    const second = await cli(['init', '--write'], repo.root);
    expect(second.code).toBe(0);
    expect(second.stdout).toContain('keep    .spec-brief.json\n        briefs in briefs/, the archive in briefs/archive/');
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
    expect(result.stdout).toContain('keep    .spec-harness.json\n        already configured');
    const settings = JSON.parse(repo.read('.claude/settings.json'));
    expect(settings.permissions).toEqual({ allow: ['Bash(ls)'] });
    expect(settings.hooks.PreToolUse).toHaveLength(2);
    expect(settings.hooks.PreToolUse[0]).toEqual(lint);
    expect(settings.hooks.PreToolUse[1].hooks[0].command).toBe(HOOK_COMMAND);
    expect(JSON.parse(repo.read('.mcp.json')).mcpServers.other).toEqual({ command: 'x' });
    expect((await cli(['init'], repo.root)).stdout).toContain('keep    .claude/settings.json');
  });

  it('advises by hand for a file it cannot read, and leaves it alone', async () => {
    const repo = repository({ '.claude/settings.json': '{ not json', '.mcp.json': '[]', '.spec-brief.json': '{', '.spec-graph.json': 'x' }, { tools: { ...siblings(), 'spec-graph': ['node', 'graph.js'] } });
    const result = await cli(['init', '--write'], repo.root);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(`advise  .claude/settings.json\n        cannot be read as JSON; add a PreToolUse and a PostToolUse hook running "${HOOK_COMMAND}" by hand`);
    expect(result.stdout).toContain('advise  .mcp.json\n        cannot be read as JSON; add the spec-harness server by hand');
    expect(result.stdout).toContain('advise  .spec-graph.json\n        cannot be read as JSON; add "historyPatterns": ["briefs/archive/**"] by hand');
    expect(result.stdout).toContain('keep    .spec-brief.json\n        briefs in briefs/, the archive in briefs/archive/');
    expect(repo.read('.claude/settings.json')).toBe('{ not json');
    expect(repo.read('.mcp.json')).toBe('[]');
  });

  it('tells spec-graph that the archive is history, when spec-graph is there', async () => {
    const repo = repository({ '.spec-brief.json': JSON.stringify({ briefs: 'b', archive: 'old' }) }, { tools: { ...siblings(), 'spec-graph': ['node', 'graph.js'] } });
    const result = await cli(['init', '--write'], repo.root);
    expect(result.stdout).toContain('create  .spec-graph.json\n        read old/** as history');
    expect(JSON.parse(repo.read('.spec-graph.json'))).toEqual({ historyPatterns: ['old/**'] });
    expect((await cli(['init'], repo.root)).stdout).toContain('keep    .spec-graph.json\n        old/** is already history');
  });

  it('advises installing spec-brief when it is not there to ask', async () => {
    const repo = repository({}, null);
    const result = await cli(['init'], repo.root);
    expect(result.stdout).toContain('advise  .spec-brief.json\n        spec-brief is not installed here: npm install --save-dev @descent-vtt/spec-brief');
  });

  it('names the remote\'s default branch as the base', async () => {
    const repo = repository({}, null);
    repo.git('update-ref', 'refs/remotes/origin/trunk', 'HEAD');
    repo.git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk');
    const result = await cli(['init', '--write'], repo.root);
    expect(result.stdout).toContain('create  .spec-harness.json\n        rounds are measured from origin/trunk');
    expect(JSON.parse(repo.read('.spec-harness.json'))).toEqual({ base: 'origin/trunk' });
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

  it('stops with exit 2 when a step it applies fails', async () => {
    const repo = repository({}, { tools: { 'spec-brief': ['node', '-e', 'process.stderr.write("init refused"); process.exit(1)'] } });
    const result = await cli(['init', '--write'], repo.root);
    expect(result).toMatchObject({ code: 2, stderr: 'spec-harness: .spec-brief.json: spec-brief init failed: init refused\n' });
  });
});
