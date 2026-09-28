import { describe, expect, it } from 'vitest';

import {
  chooseBase,
  describeBase,
  describeClaudeCode,
  describePlugin,
  describeGraph,
  describeSigners,
  describeSkipped,
  enabledPlugin,
  graphReadsBriefs,
  GUARD_HOOK,
  holdsGuard,
  loadsPlugin,
  mcpServer,
  mergeClaudeSettings,
  mergeMcp,
  measuresArchive,
  mergeSpecBrief,
  mergeSpecGraph,
  PLUGIN,
  PROJECT_DIR,
  PROJECT_DIR_OR_HERE,
  registersServer,
  SPEC_BRIEF_CONFIGS,
  SPEC_GRAPH_CONFIGS,
  wiringState,
} from '../../src/configure.js';

const SCRIPT = '${CLAUDE_PROJECT_DIR}/node_modules/@descent-vtt/spec-harness/bin/spec-harness.js';
const HOOK = { type: 'command', command: 'node', args: [SCRIPT, 'hook', 'claude'], timeout: 60 };
const GUARD = { matcher: 'Edit|Write|MultiEdit|NotebookEdit', hooks: [HOOK] };
const LEGACY = 'npx --no-install spec-harness hook claude';

describe('Claude Code settings', () => {
  it('runs the project\'s install with node, the path one argument, as the guard', () => {
    expect(PROJECT_DIR).toBe('${CLAUDE_PROJECT_DIR}');
    expect(GUARD_HOOK).toEqual(HOOK);
  });

  it('adds the guard to PreToolUse and PostToolUse of empty settings', () => {
    expect(mergeClaudeSettings({})).toEqual({ hooks: { PreToolUse: [GUARD], PostToolUse: [GUARD] } });
  });

  it('keeps every other setting and hook, adding after them', () => {
    const lint = { matcher: 'Write', hooks: [{ type: 'command', command: 'npm run lint' }] };
    const current = { model: 'x', permissions: { allow: ['Bash(ls)'] }, hooks: { PreToolUse: [lint], Stop: [{ hooks: [] }] } };
    expect(mergeClaudeSettings(current)).toEqual({
      model: 'x',
      permissions: { allow: ['Bash(ls)'] },
      hooks: { PreToolUse: [lint, GUARD], PostToolUse: [GUARD], Stop: [{ hooks: [] }] },
    });
    // The settings it was given are not changed under the caller.
    expect(current.hooks.PreToolUse).toEqual([lint]);
  });

  it('adds only the event that lacks the guard, and nothing when both have it', () => {
    const own = { matcher: 'Edit', hooks: [{ type: 'command', command: 'x' }, { ...HOOK, timeout: 5 }] };
    expect(mergeClaudeSettings({ hooks: { PreToolUse: [own] } })).toEqual({ hooks: { PreToolUse: [own], PostToolUse: [GUARD] } });
    expect(mergeClaudeSettings({ hooks: { PreToolUse: [own], PostToolUse: [GUARD] } })).toBeNull();
  });

  it('recognises the guard only by node and its exact arguments', () => {
    const similar = {
      hooks: [
        { type: 'command', command: 'npx spec-harness hook claude' },
        { type: 'command', command: 'nodejs', args: HOOK.args },
        { type: 'command', command: 'node', args: HOOK.args.slice(0, 2) },
        { type: 'command', command: 'node', args: [...HOOK.args, '--brief', '1'] },
        { type: 'command', command: 'node', args: ['bin/spec-harness.js', 'hook', 'claude'] },
        { type: 'command', command: 'node', args: 'a b' },
        'node',
      ],
    };
    expect(mergeClaudeSettings({ hooks: { PreToolUse: [similar], PostToolUse: [similar] } })).toEqual({
      hooks: { PreToolUse: [similar, GUARD], PostToolUse: [similar, GUARD] },
    });
  });

  it('replaces the npx guard 0.1 installed where it stands, keeping its other fields', () => {
    const lint = { type: 'command', command: 'npm run lint' };
    const old = { matcher: 'Edit|Write', hooks: [lint, { type: 'command', command: LEGACY, timeout: 30 }] };
    const merged = mergeClaudeSettings({ hooks: { PreToolUse: [old], PostToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: LEGACY }] }] } });
    expect(merged).toEqual({
      hooks: {
        PreToolUse: [{ matcher: 'Edit|Write', hooks: [lint, { type: 'command', command: 'node', args: HOOK.args, timeout: 30 }] }],
        PostToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: 'node', args: HOOK.args }] }],
      },
    });
    expect(mergeClaudeSettings(merged ?? {})).toBeNull();
    // Only 0.1's own command is replaced; the event that already has the guard keeps it.
    expect(mergeClaudeSettings({ hooks: { PreToolUse: [GUARD], PostToolUse: [{ hooks: [{ command: `${LEGACY} --x` }] }] } })).toEqual({
      hooks: { PreToolUse: [GUARD], PostToolUse: [{ hooks: [{ command: `${LEGACY} --x` }] }, GUARD] },
    });
  });

  it('replaces 0.1\'s guard in the one event that still has it, and changes nothing in the other', () => {
    const pre = [GUARD];
    const merged = mergeClaudeSettings({ hooks: { PreToolUse: pre, PostToolUse: [{ hooks: [{ command: LEGACY }] }] } });
    expect(merged).toEqual({ hooks: { PreToolUse: [GUARD], PostToolUse: [{ hooks: [{ command: 'node', args: HOOK.args }] }] } });
    expect((merged?.['hooks'] as Record<string, unknown>)['PreToolUse']).toBe(pre);
  });

  it('reads hooks of the wrong shape as none there, rather than failing', () => {
    expect(mergeClaudeSettings({ hooks: null })).toEqual({ hooks: { PreToolUse: [GUARD], PostToolUse: [GUARD] } });
    expect(mergeClaudeSettings({ hooks: 'x' })).toEqual({ hooks: { PreToolUse: [GUARD], PostToolUse: [GUARD] } });
    expect(mergeClaudeSettings({ hooks: { PreToolUse: 'x', PostToolUse: [{ matcher: 'Edit' }, { hooks: 'y' }, null] } })).toEqual({
      hooks: { PreToolUse: [GUARD], PostToolUse: [{ matcher: 'Edit' }, { hooks: 'y' }, null, GUARD] },
    });
  });

  it('never hands out its own guard, so a caller that edits the result changes nothing of it', () => {
    const merged = mergeClaudeSettings({}) as { hooks: { PreToolUse: { hooks: { args: string[] }[] }[] } };
    merged.hooks.PreToolUse[0]?.hooks[0]?.args.push('--x');
    expect(mergeClaudeSettings({})).toEqual({ hooks: { PreToolUse: [GUARD], PostToolUse: [GUARD] } });
  });
});

describe('the MCP server registration', () => {
  it('runs the project\'s install with node, reading the project it names', () => {
    expect(PROJECT_DIR_OR_HERE).toBe('${CLAUDE_PROJECT_DIR:-.}');
    expect(mcpServer(PROJECT_DIR)).toEqual({ command: 'node', args: [SCRIPT, 'mcp', '--root', '${CLAUDE_PROJECT_DIR}'] });
    expect(mcpServer('/p')).toEqual({ command: 'node', args: ['/p/node_modules/@descent-vtt/spec-harness/bin/spec-harness.js', 'mcp', '--root', '/p'] });
  });

  it('registers the server beside those already there, with the default a project file needs', () => {
    const server = {
      command: 'node',
      args: ['${CLAUDE_PROJECT_DIR:-.}/node_modules/@descent-vtt/spec-harness/bin/spec-harness.js', 'mcp', '--root', '${CLAUDE_PROJECT_DIR:-.}'],
    };
    const current = { mcpServers: { other: { command: 'x' } }, extra: true };
    expect(mergeMcp(current)).toEqual({ mcpServers: { other: { command: 'x' }, 'spec-harness': server }, extra: true });
    expect(mergeMcp({})).toEqual({ mcpServers: { 'spec-harness': server } });
    expect(mergeMcp({ mcpServers: null })).toEqual(mergeMcp({}));
    expect(mergeMcp({ mcpServers: 'x' })).toEqual(mergeMcp({}));
  });

  it('changes nothing when a server by that name is registered some other way', () => {
    expect(mergeMcp({ mcpServers: { 'spec-harness': { command: 'node', args: ['dist/cli.js', 'mcp'] } } })).toBeNull();
    expect(mergeMcp({ mcpServers: { 'spec-harness': { command: 'npx', args: ['spec-harness', 'mcp'] } } })).toBeNull();
    expect(mergeMcp({ mcpServers: { 'spec-harness': { command: 'bunx', args: ['--no-install', 'spec-harness', 'mcp'] } } })).toBeNull();
    expect(mergeMcp({ mcpServers: { 'spec-harness': null } })).toBeNull();
  });

  it('replaces the npx entry 0.1 registered, keeping its other fields', () => {
    const merged = mergeMcp({ mcpServers: { 'spec-harness': { type: 'stdio', command: 'npx', args: ['--no-install', 'spec-harness', 'mcp'], env: { A: '1' } } } });
    expect(merged).toEqual({ mcpServers: { 'spec-harness': { type: 'stdio', env: { A: '1' }, ...mcpServer(PROJECT_DIR_OR_HERE) } } });
    expect(mergeMcp(merged ?? {})).toBeNull();
  });
});

describe('the Claude Code plugin beside init\'s entries (ADR-0012)', () => {
  const USER = '/home/p/.claude/settings.json';
  const on = (file: string, plugins: Record<string, unknown>) => ({ file, settings: { enabledPlugins: plugins } });

  it('finds the guard hooks in settings, as this release or 0.1 wrote them, in either event', () => {
    expect(holdsGuard({ hooks: { PreToolUse: [GUARD] } })).toBe(true);
    expect(holdsGuard({ hooks: { PostToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: 'x' }, HOOK] }] } })).toBe(true);
    expect(holdsGuard({ hooks: { PostToolUse: [{ hooks: [{ type: 'command', command: LEGACY }] }] } })).toBe(true);
    expect(holdsGuard({ hooks: { PreToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: 'npm run lint' }] }, GUARD] } })).toBe(true);
  });

  it('finds no guard in a hook that only resembles it, under another event, or in hooks of the wrong shape', () => {
    const similar = [
      { type: 'command', command: 'npx spec-harness hook claude' },
      { type: 'command', command: 'node', args: HOOK.args.slice(0, 2) },
      { type: 'command', command: `${LEGACY} --x` },
    ];
    expect(holdsGuard({ hooks: { PreToolUse: [{ hooks: similar }], PostToolUse: [{ hooks: similar }] } })).toBe(false);
    expect(holdsGuard({ hooks: { Stop: [GUARD], SessionStart: [GUARD] } })).toBe(false);
    expect(holdsGuard({ hooks: { PreToolUse: 'x', PostToolUse: [null, { hooks: 'y' }] } })).toBe(false);
    expect(holdsGuard({ hooks: null })).toBe(false);
    expect(holdsGuard({})).toBe(false);
    // A file that is missing, or that JSON cannot read, holds nothing.
    expect(holdsGuard(null)).toBe(false);
    expect(holdsGuard('unreadable')).toBe(false);
  });

  it('finds the server in .mcp.json under its name, however it is run', () => {
    expect(registersServer(mergeMcp({}) ?? {})).toBe(true);
    expect(registersServer({ mcpServers: { 'spec-harness': { command: 'npx', args: ['--no-install', 'spec-harness', 'mcp'] } } })).toBe(true);
    expect(registersServer({ mcpServers: { 'spec-harness': null } })).toBe(true);
    expect(registersServer({ mcpServers: { other: { command: 'node', args: ['spec-harness.js', 'mcp'] } } })).toBe(false);
    expect(registersServer({ mcpServers: 'spec-harness' })).toBe(false);
    expect(registersServer({ 'spec-harness': {} })).toBe(false);
    expect(registersServer(null)).toBe(false);
    expect(registersServer('unreadable')).toBe(false);
  });

  it('reads the plugin as on when a settings file enables it, from any marketplace that names it spec-harness', () => {
    expect(enabledPlugin([on(USER, { 'spec-harness@spec-tools': true })])).toEqual({ id: 'spec-harness@spec-tools', file: USER });
    expect(enabledPlugin([on('.claude/settings.json', { 'spec-harness@team': true })])).toEqual({ id: 'spec-harness@team', file: '.claude/settings.json' });
  });

  it('lets the later file decide an id, as Claude Code does: user, then project, then local', () => {
    const user = on(USER, { 'spec-harness@spec-tools': true });
    expect(enabledPlugin([user, on('.claude/settings.local.json', { 'spec-harness@spec-tools': false })])).toBeNull();
    expect(enabledPlugin([on(USER, { 'spec-harness@spec-tools': false }), on('.claude/settings.json', { 'spec-harness@spec-tools': true })])).toEqual({
      id: 'spec-harness@spec-tools',
      file: '.claude/settings.json',
    });
    // A file that does not name the id leaves the earlier file's answer.
    expect(enabledPlugin([user, on('.claude/settings.json', { 'other@spec-tools': false }), { file: '.claude/settings.local.json', settings: {} }])).toEqual({
      id: 'spec-harness@spec-tools',
      file: USER,
    });
    // Two marketplaces' plugins are two plugins: turning one off leaves the other on.
    expect(enabledPlugin([on(USER, { 'spec-harness@a': true }), on('.claude/settings.local.json', { 'spec-harness@b': false })])).toEqual({ id: 'spec-harness@a', file: USER });
  });

  it('reads no other plugin as this one, and a value that is not true or false as deciding nothing', () => {
    const others = { 'spec-harness-extra@spec-tools': true, 'other@spec-tools': true, 'spec-harness': true, 'spec-harness@': true, 'x@spec-harness@y': true, 'spec-harness@a@b': true };
    expect(enabledPlugin([on(USER, others)])).toBeNull();
    expect(enabledPlugin([on(USER, { 'spec-harness@spec-tools': 'true' })])).toBeNull();
    expect(enabledPlugin([on(USER, { 'spec-harness@spec-tools': true }), on('.claude/settings.local.json', { 'spec-harness@spec-tools': 'false' })])).toEqual({
      id: 'spec-harness@spec-tools',
      file: USER,
    });
    expect(enabledPlugin([{ file: USER, settings: { enabledPlugins: ['spec-harness@spec-tools'] } }, { file: USER, settings: { enabledPlugins: null } }])).toBeNull();
    expect(enabledPlugin([])).toBeNull();
    // A file that is missing, or that JSON cannot read, turns nothing on or off.
    expect(enabledPlugin([{ file: USER, settings: null }, { file: '.claude/settings.json', settings: 'unreadable' }])).toBeNull();
    expect(enabledPlugin([on(USER, { 'spec-harness@spec-tools': true }), { file: '.claude/settings.local.json', settings: 'unreadable' }])).toEqual({
      id: 'spec-harness@spec-tools',
      file: USER,
    });
  });

  it('says why init writes no hook or server while the plugin is on, and how to have init\'s instead', () => {
    const plugin = { id: 'spec-harness@spec-tools', file: USER };
    const off = 'turn the plugin off for this project with claude plugin disable spec-harness@spec-tools --scope local';
    expect(describeSkipped(plugin, 'hooks', false)).toBe(
      `the spec-harness plugin is on (spec-harness@spec-tools in ${USER}) and brings the guard hooks, so init writes none: with both, every write is guarded twice. To have them here instead, for every clone of the repository, ${off} and run init again`,
    );
    expect(describeSkipped(plugin, 'server', false)).toBe(
      `the spec-harness plugin is on (spec-harness@spec-tools in ${USER}) and brings the server, so init registers none: with both, the server is registered twice. To have it here instead, for every clone of the repository, ${off} and run init again`,
    );
  });

  it('says that a file holding init\'s entry beside the plugin is a double install, and how to keep one', () => {
    const plugin = { id: 'spec-harness@team', file: '.claude/settings.json' };
    const off = 'turn the plugin off for this project with claude plugin disable spec-harness@team --scope local';
    expect(describeSkipped(plugin, 'hooks', true)).toBe(
      `the spec-harness plugin is on (spec-harness@team in .claude/settings.json) and brings the guard hooks this file holds as well, so every write is guarded twice: take spec-harness's hooks out of this file, or ${off}`,
    );
    expect(describeSkipped(plugin, 'server', true)).toBe(
      `the spec-harness plugin is on (spec-harness@team in .claude/settings.json) and brings the server this file holds as well, so the server is registered twice: take the spec-harness server out of this file, or ${off}`,
    );
  });

  it('tells the plugin, init\'s entries, both and neither apart, either of init\'s entries counting', () => {
    const plugin = { id: 'spec-harness@spec-tools', file: USER };
    expect(wiringState({ plugin: null, hooks: [], server: false })).toBe('none');
    expect(wiringState({ plugin: null, hooks: ['.claude/settings.json'], server: false })).toBe('init');
    expect(wiringState({ plugin: null, hooks: [], server: true })).toBe('init');
    expect(wiringState({ plugin, hooks: [], server: false })).toBe('plugin');
    expect(wiringState({ plugin, hooks: ['.claude/settings.local.json'], server: false })).toBe('both');
    expect(wiringState({ plugin, hooks: [], server: true })).toBe('both');
  });

  it('says in doctor what wires Claude Code, and what doubles', () => {
    const plugin = { id: 'spec-harness@spec-tools', file: USER };
    const off = 'turn the plugin off for this project with claude plugin disable spec-harness@spec-tools --scope local';
    const on = `the spec-harness plugin is on (spec-harness@spec-tools in ${USER})`;
    expect(describeClaudeCode({ plugin: null, hooks: [], server: false })).toBe(
      'neither the spec-harness plugin nor the hooks init writes, so Claude Code guards no write: run spec-harness init --write, or install the plugin',
    );
    expect(describeClaudeCode({ plugin: null, hooks: ['.claude/settings.json'], server: true })).toBe("init's entries: the guard hooks in .claude/settings.json, the server in .mcp.json");
    expect(describeClaudeCode({ plugin: null, hooks: [], server: true })).toBe("init's entries: the server in .mcp.json");
    expect(describeClaudeCode({ plugin, hooks: [], server: false })).toBe(`${on} and brings the guard hooks and the server`);
    expect(describeClaudeCode({ plugin, hooks: ['.claude/settings.json', '.claude/settings.local.json'], server: true })).toBe(
      `${on}, beside the guard hooks in .claude/settings.json, the guard hooks in .claude/settings.local.json, the server in .mcp.json: every write is guarded twice and the server is registered twice. Keep one: take spec-harness's entries out of those files, or ${off}`,
    );
    expect(describeClaudeCode({ plugin, hooks: ['.claude/settings.json'], server: false })).toBe(
      `${on}, beside the guard hooks in .claude/settings.json: every write is guarded twice. Keep one: take spec-harness's entries out of those files, or ${off}`,
    );
    expect(describeClaudeCode({ plugin, hooks: [], server: true })).toBe(
      `${on}, beside the server in .mcp.json: the server is registered twice. Keep one: take spec-harness's entries out of those files, or ${off}`,
    );
  });
});

describe('spec-brief\'s plugins', () => {
  it('names the plugin by the subpath this package exports, and spec-brief\'s files in its order', () => {
    expect(PLUGIN).toBe('@descent-vtt/spec-harness/spec-brief-plugin');
    expect(SPEC_BRIEF_CONFIGS).toEqual(['.spec-brief.json', 'spec-brief.json']);
  });

  it('reads the plugin as loaded by name or as a module with options, and only so', () => {
    expect(loadsPlugin({ plugins: [PLUGIN] })).toBe(true);
    expect(loadsPlugin({ plugins: ['./tools/x.mjs', { module: PLUGIN, options: {} }] })).toBe(true);
    expect(loadsPlugin({})).toBe(false);
    expect(loadsPlugin({ plugins: PLUGIN })).toBe(false);
    expect(loadsPlugin({ plugins: ['@descent-vtt/spec-harness', { module: '@descent-vtt/spec-harness' }, null, { name: PLUGIN }] })).toBe(false);
  });

  it('loads the plugin after those already there, keeping every other setting', () => {
    expect(mergeSpecBrief({})).toEqual({ plugins: [PLUGIN] });
    const current = { briefs: 'docs/briefs', plugins: ['./tools/x.mjs'], archiving: { base: null } };
    expect(mergeSpecBrief(current)).toEqual({ briefs: 'docs/briefs', plugins: ['./tools/x.mjs', PLUGIN], archiving: { base: null } });
    expect(current.plugins).toEqual(['./tools/x.mjs']);
    expect(mergeSpecBrief({ plugins: 'x' })).toEqual({ plugins: [PLUGIN] });
  });

  it('changes nothing when the plugin is loaded', () => {
    expect(mergeSpecBrief({ plugins: [PLUGIN] })).toBeNull();
    expect(mergeSpecBrief({ plugins: [PLUGIN] }, 'main')).toEqual({ plugins: [PLUGIN], archiving: { base: 'main' } });
    expect(mergeSpecBrief({ plugins: [PLUGIN], archiving: { base: null, rewriteLinks: true } }, 'origin/main')).toEqual({
      plugins: [PLUGIN],
      archiving: { base: 'origin/main', rewriteLinks: true },
    });
    // A base a person wrote is theirs, whatever init would have named.
    expect(mergeSpecBrief({ plugins: [PLUGIN], archiving: { base: 'develop' } }, 'main')).toBeNull();
    expect(mergeSpecBrief({ archiving: { base: 'develop' } }, 'main')).toEqual({ archiving: { base: 'develop' }, plugins: [PLUGIN] });
    expect(measuresArchive({ archiving: { base: 'main' } })).toBe(true);
    expect(measuresArchive({ archiving: { base: null } })).toBe(false);
    expect(measuresArchive({ archiving: 'main' })).toBe(false);
    expect(measuresArchive({})).toBe(false);
    expect(mergeSpecBrief({ plugins: [{ module: PLUGIN }] })).toBeNull();
  });

  it('says whether the plugin is loaded, and what to do when it is not', () => {
    expect(describePlugin({ kind: 'loaded', file: '.spec-brief.json' })).toBe(
      "spec-brief loads spec-harness's plugin (.spec-brief.json): its archive accepts a protected file a signed ruling allows",
    );
    expect(describePlugin({ kind: 'not-loaded', file: 'spec-brief.json' })).toBe(
      'spec-brief does not load spec-harness\'s plugin, so its archive refuses a protected file whatever ruling is signed: add "@descent-vtt/spec-harness/spec-brief-plugin" to "plugins" in spec-brief.json, or run spec-harness init --write',
    );
    expect(describePlugin({ kind: 'unreadable', file: '.spec-brief.json' })).toBe(
      ".spec-brief.json cannot be read as JSON, so whether spec-brief loads spec-harness's plugin is unknown",
    );
    expect(describePlugin({ kind: 'unconfigured' })).toBe(
      "spec-brief has no configuration at the root, so it loads no plugin: spec-harness init --write writes one that loads spec-harness's",
    );
  });
});

describe('the base init names', () => {
  const unrecorded = 'no remote records a default branch (refs/remotes/origin/HEAD)';

  it('is the remote\'s default branch, wherever git recorded one', () => {
    expect(chooseBase({ remoteDefault: 'origin/trunk', branch: 'brief/001-x', branches: ['brief/001-x', 'main'] })).toEqual({
      base: 'origin/trunk',
      detail: "rounds are measured from origin/trunk, the remote's default branch",
    });
  });

  it('is main or master when init runs on it and no remote records a default', () => {
    for (const branch of ['main', 'master']) {
      expect(chooseBase({ remoteDefault: null, branch, branches: [branch, 'brief/001-x'] })).toEqual({
        base: branch,
        detail: `rounds are measured from ${branch}, the branch init runs on: ${unrecorded}; change "base" if rounds merge into another`,
      });
    }
  });

  it('is the only branch, born or not', () => {
    const only = (branch: string) => `rounds are measured from ${branch}, the only branch: ${unrecorded}; change "base" if rounds merge into another`;
    expect(chooseBase({ remoteDefault: null, branch: 'trunk', branches: ['trunk'] })).toEqual({ base: 'trunk', detail: only('trunk') });
    expect(chooseBase({ remoteDefault: null, branch: 'trunk', branches: [] })).toEqual({ base: 'trunk', detail: only('trunk') });
  });

  it('is left to the person otherwise, with how to name it', () => {
    const advice = 'set "base" to the branch rounds merge into, or run git remote set-head origin --auto and init again';
    expect(chooseBase({ remoteDefault: null, branch: 'brief/001-x', branches: ['brief/001-x', 'main'] })).toEqual({
      base: null,
      detail: `no base can be told: ${unrecorded}, and brief/001-x is not main, master or the only branch; ${advice}`,
    });
    const detached = { base: null, detail: `no base can be told: ${unrecorded}, and HEAD is detached; ${advice}` };
    expect(chooseBase({ remoteDefault: null, branch: null, branches: ['main'] })).toEqual(detached);
    expect(chooseBase({ remoteDefault: null, branch: null, branches: [] })).toEqual(detached);
  });
});

describe('what doctor says of the base and the signers', () => {
  const sha = '0123456789abcdef0123456789abcdef01234567';

  it('names the base, where it came from and the merge base', () => {
    expect(describeBase({ ref: 'main', source: 'config', mergeBase: sha })).toBe('main (.spec-harness.json), merge base 0123456789ab');
    expect(describeBase({ ref: 'origin/main', source: 'remote', mergeBase: sha })).toBe("origin/main (the remote's default branch), merge base 0123456789ab");
    expect(describeBase({ ref: 'dev', source: 'flag', mergeBase: sha })).toBe('dev (--base), merge base 0123456789ab');
    expect(describeBase({ reason: '"x" names no commit' })).toBe('none: "x" names no commit');
  });

  it('says whether the allowed signers are on the base, and what no ruling can do without them', () => {
    expect(describeSigners('.github/allowed_signers', 'main', true)).toBe('.github/allowed_signers is on main');
    expect(describeSigners('.github/allowed_signers', 'main', false)).toBe(
      '.github/allowed_signers is not on main, so no ruling can count: commit it there, one line per person: <email> namespaces="git" <public key>',
    );
    expect(describeSigners('signers', null, false)).toBe('signers, read from the base, which could not be resolved: no ruling can count');
    expect(describeSigners('signers', null, true)).toBe('signers, read from the base, which could not be resolved: no ruling can count');
  });
});

describe('spec-graph\'s history', () => {
  it('adds the archive to the history patterns, keeping the others', () => {
    expect(mergeSpecGraph({}, 'briefs/archive/**')).toEqual({ historyPatterns: ['briefs/archive/**'] });
    expect(mergeSpecGraph({ specs: ['docs/**'], historyPatterns: ['old/**', 3] }, 'briefs/archive/**')).toEqual({
      specs: ['docs/**'],
      historyPatterns: ['old/**', 'briefs/archive/**'],
    });
    expect(mergeSpecGraph({ historyPatterns: 'old/**' }, 'a/**')).toEqual({ historyPatterns: ['a/**'] });
  });

  it('changes nothing when the archive is already history', () => {
    expect(mergeSpecGraph({ historyPatterns: ['briefs/archive/**'] }, 'briefs/archive/**')).toBeNull();
  });

  it('looks for spec-graph\'s configuration where spec-graph does, in its order', () => {
    expect(SPEC_GRAPH_CONFIGS).toEqual(['.spec-graph.json', 'spec-graph.config.json']);
  });

  it('knows whether spec-graph reads the briefs: by its defaults, only where they are under docs/ and the like', () => {
    expect(graphReadsBriefs({}, 'briefs')).toBe(false);
    for (const briefs of ['docs/briefs', 'doc/briefs', 'adr/briefs', 'rfcs/briefs', 'specs/briefs', 'docs/work/briefs']) expect(graphReadsBriefs({}, briefs), briefs).toBe(true);
    expect(graphReadsBriefs({ patterns: [] }, 'docs/briefs')).toBe(true);
    expect(graphReadsBriefs({ patterns: 'briefs/**/*.md' }, 'briefs')).toBe(false);
  });

  it('reads the patterns spec-graph is given as spec-graph does: the last to match decides, a backslash separates', () => {
    expect(graphReadsBriefs({ patterns: ['docs/**/*.md', 'briefs/**/*.md'] }, 'briefs')).toBe(true);
    expect(graphReadsBriefs({ patterns: ['docs/**/*.md', 3] }, 'docs/briefs')).toBe(true);
    expect(graphReadsBriefs({ patterns: ['docs/**/*.md'] }, 'briefs')).toBe(false);
    expect(graphReadsBriefs({ patterns: ['docs/**/*.md', '!docs/briefs/**'] }, 'docs/briefs')).toBe(false);
    expect(graphReadsBriefs({ patterns: ['briefs\\*.md'] }, 'briefs')).toBe(true);
    expect(graphReadsBriefs({ patterns: ['Briefs/**'] }, 'briefs')).toBe(false);
    // A list spec-graph would refuse reads nothing.
    expect(graphReadsBriefs({ patterns: ['briefs/**', 'docs/[a'] }, 'briefs')).toBe(false);
    expect(graphReadsBriefs({ patterns: ['briefs/**', `${'{a,b}'.repeat(8)}/${'x'.repeat(300)}`] }, 'briefs')).toBe(false);
    // Braces that expand to no path are refused, where {./,docs/**/*.md} matched every path, the briefs included.
    expect(graphReadsBriefs({ patterns: ['{./,docs/**/*.md}'] }, 'briefs')).toBe(false);
  });

  it('says what the history entry does, and when it does nothing yet', () => {
    expect(describeGraph('docs/briefs/archive/**', 'docs/briefs', true, true)).toBe(
      'read docs/briefs/archive/** as history: an archived brief is a record whatever its status says, so a live brief that depends on one is not a stale premise',
    );
    expect(describeGraph('docs/briefs/archive/**', 'docs/briefs', true, false)).toBe(
      'docs/briefs/archive/** is history: an archived brief is a record whatever its status says, so a live brief that depends on one is not a stale premise',
    );
    expect(describeGraph('briefs/archive/**', 'briefs', false, true)).toBe(
      'read briefs/archive/** as history, for when spec-graph reads the briefs; its patterns do not reach briefs/, so it checks none of them now: add "briefs/**/*.md" to its "patterns" if it should',
    );
    expect(describeGraph('briefs/archive/**', 'briefs', false, false)).toBe(
      'briefs/archive/** is history, for when spec-graph reads the briefs; its patterns do not reach briefs/, so it checks none of them now: add "briefs/**/*.md" to its "patterns" if it should',
    );
  });
});
