import { runInNewContext } from 'node:vm';

import { describe, expect, it } from 'vitest';

import {
  chooseBase,
  describeBase,
  describeClaudeCode,
  describeClaudeRelease,
  describeGitHook,
  GIT_HOOK_LINE,
  gitHookNote,
  describePlugin,
  describeSignerKeys,
  describeSignerProblem,
  describeGraph,
  describeSigners,
  describeSkipped,
  enabledPlugin,
  exportedFile,
  graphReadsBriefs,
  GUARD_HOOK,
  handedLines,
  isStarted,
  loadsPlugin,
  mcpServer,
  mergeClaudeSettings,
  mergeMcp,
  measuresArchive,
  mergeSpecBrief,
  mergeSpecGraph,
  missingGitHook,
  PLUGIN,
  PRE_COMMIT,
  PROTECT_RULE_FILES,
  PROJECT_DIR,
  PROJECT_DIR_OR_HERE,
  registersServer,
  reportHooks,
  SPEC_BRIEF_CONFIGS,
  SPEC_GRAPH_CONFIGS,
  wiringState,
  writtenHooks,
} from '../../src/configure.js';
import { claudeHookLine, heldHookLine } from '../../src/usage.js';
import { parseOptions } from '../../src/workspace.js';

const SCRIPT = '${CLAUDE_PROJECT_DIR}/node_modules/@descent-vtt/spec-harness/bin/spec-harness.js';

describe('the file an exports target names for an import, as Node resolves it', () => {
  it('is a string that starts with ./, and nothing else', () => {
    expect(exportedFile('./dist/plugin.js')).toBe('./dist/plugin.js');
    for (const target of ['dist/plugin.js', '../plugin.js', '/plugin.js', 7, true, undefined]) expect(exportedFile(target), String(target)).toBeNull();
  });

  it('is the target of the first key an import meets, node, import or default, in the object\'s own order', () => {
    expect(exportedFile({ types: './a.d.ts', require: './a.cjs', import: './a.mjs', default: './a.js' })).toBe('./a.mjs');
    expect(exportedFile({ default: './a.js', import: './a.mjs' })).toBe('./a.js');
    expect(exportedFile({ node: './n.js', import: './a.mjs' })).toBe('./n.js');
    expect(exportedFile({ require: './a.cjs', browser: './b.js' })).toBeNull();
    // A key whose own conditions an import does not meet lets the search go on.
    expect(exportedFile({ node: { require: './a.cjs' }, default: './a.js' })).toBe('./a.js');
    expect(exportedFile({ node: { import: './n.mjs' }, default: './a.js' })).toBe('./n.mjs');
  });

  it('stops at a null target, which is not exported, as Node stops', () => {
    expect(exportedFile({ import: null, default: './a.js' })).toBeNull();
    expect(exportedFile({ node: { import: null }, default: './a.js' })).toBeNull();
    expect(exportedFile(null)).toBeNull();
  });

  it('is the first item of an array that resolves, one Node refuses passed over', () => {
    expect(exportedFile(['a.js', './b.js'])).toBe('./b.js');
    // A number is a target Node refuses too, where null is one it resolves, to nothing.
    expect(exportedFile([7, './b.js'])).toBe('./b.js');
    expect(exportedFile([{ require: './a.cjs' }, './b.js'])).toBe('./b.js');
    expect(exportedFile([{ import: 'a.mjs' }, './b.js'])).toBe('./b.js');
    expect(exportedFile({ import: ['a.mjs', './b.mjs'] })).toBe('./b.mjs');
    expect(exportedFile([null, './b.js'])).toBeNull();
    expect(exportedFile([])).toBeNull();
    // An empty array is not exported either, and ends the search as null does.
    expect(exportedFile({ import: [], default: './a.js' })).toBeNull();
    expect(exportedFile(['a.js'])).toBeNull();
  });

  it('refuses the whole target when a key an import meets names one Node refuses', () => {
    expect(exportedFile({ import: 'a.mjs', default: './a.js' })).toBeNull();
  });
});
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

  /** Whether words are the line of Claude Code's hook, by the hook's own reading, as init asks it. */
  const isHook = (words: readonly string[]): boolean => claudeHookLine(words, parseOptions, '/p', () => true) !== null;

  it("writes no line beside one of the hook's that Claude Code starts for a write, however a person wrote it", () => {
    for (const hook of [
      { type: 'command', command: 'node', args: [...HOOK.args, '--root', PROJECT_DIR] },
      { type: 'command', command: 'node', args: ['node_modules/@descent-vtt/spec-harness/bin/spec-harness.js', 'hook', 'claude'] },
      { type: 'command', command: `node ${SCRIPT} hook claude --brief 404` },
      // A line the hook cannot read is its line all the same, and the person's to mend.
      { type: 'command', command: 'node', args: [...HOOK.args, '--nope'] },
    ]) {
      const changed = { matcher: 'Edit|Write', hooks: [hook] };
      expect(mergeClaudeSettings({ hooks: { PreToolUse: [changed], PostToolUse: [changed] } }, isHook), JSON.stringify(hook)).toBeNull();
      // Without the hook's reading only init's own line is known, as it was.
      expect(mergeClaudeSettings({ hooks: { PreToolUse: [changed], PostToolUse: [changed] } }), JSON.stringify(hook)).toEqual({ hooks: { PreToolUse: [changed, GUARD], PostToolUse: [changed, GUARD] } });
    }
    // Under one event alone it is still a person's line in the file: init adds none under the other, and leaves 0.1's beside it as it is.
    const before = { hooks: [{ type: 'command', command: 'node', args: [...HOOK.args, '--root', PROJECT_DIR] }] };
    expect(mergeClaudeSettings({ hooks: { PreToolUse: [before] } }, isHook)).toBeNull();
    expect(mergeClaudeSettings({ hooks: { PostToolUse: [before] } }, isHook)).toBeNull();
    expect(mergeClaudeSettings({ hooks: { PreToolUse: [before], PostToolUse: [{ hooks: [{ type: 'command', command: LEGACY }] }] } }, isHook)).toBeNull();
    // init's own line under one event is completed as it was, whatever the hook's reading knows.
    expect(mergeClaudeSettings({ hooks: { PostToolUse: [GUARD] } }, isHook)).toEqual({ hooks: { PostToolUse: [GUARD], PreToolUse: [GUARD] } });
    expect(mergeClaudeSettings({ hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: LEGACY }] }] } }, isHook)).toEqual({
      hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'node', args: HOOK.args }] }], PostToolUse: [GUARD] },
    });
    // Another command's line is not the hook's.
    const git = { hooks: [{ type: 'command', command: 'node', args: [SCRIPT, 'hook', 'git'] }] };
    expect(mergeClaudeSettings({ hooks: { PreToolUse: [git], PostToolUse: [git] } }, isHook)).toEqual({ hooks: { PreToolUse: [git, GUARD], PostToolUse: [git, GUARD] } });
  });

  it('writes its own beside a line Claude Code starts for no write, and leaves that line as it is', () => {
    const idle = { matcher: 'Bash', hooks: [HOOK] };
    expect(mergeClaudeSettings({ hooks: { PreToolUse: [idle], PostToolUse: [idle] } })).toEqual({ hooks: { PreToolUse: [idle, GUARD], PostToolUse: [idle, GUARD] } });
    // So beside a person's line that is started for none.
    const changed = { matcher: 'Bash', hooks: [{ type: 'command', command: 'node', args: [...HOOK.args, '--root', PROJECT_DIR] }] };
    expect(mergeClaudeSettings({ hooks: { PreToolUse: [changed], PostToolUse: [changed] } }, isHook)).toEqual({ hooks: { PreToolUse: [changed, GUARD], PostToolUse: [changed, GUARD] } });
    // In the background it refuses nothing before a write, and still tells the model after one.
    const background = { matcher: GUARD.matcher, hooks: [{ ...HOOK, async: true }] };
    expect(mergeClaudeSettings({ hooks: { PreToolUse: [background], PostToolUse: [background] } }, isHook)).toEqual({ hooks: { PreToolUse: [background, GUARD], PostToolUse: [background] } });
    // One whose writes cannot be told is taken as started: a second line would run beside it.
    const conditional = { matcher: GUARD.matcher, hooks: [{ ...HOOK, if: 'Edit(*.ts)' }] };
    expect(mergeClaudeSettings({ hooks: { PreToolUse: [conditional], PostToolUse: [conditional] } })).toBeNull();
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
    // Held by a file init does not write, it is the same double install, said of that file.
    expect(describeSkipped(plugin, 'hooks', false, ['.claude/settings.local.json'])).toBe(
      `the spec-harness plugin is on (spec-harness@team in .claude/settings.json) and brings the guard hooks .claude/settings.local.json holds as well, so every write is guarded twice: take spec-harness's hooks out there, or ${off}. init writes none here`,
    );
    expect(describeSkipped(plugin, 'hooks', false, [USER, '.claude/settings.local.json'])).toBe(
      `the spec-harness plugin is on (spec-harness@team in .claude/settings.json) and brings the guard hooks ${USER} and .claude/settings.local.json hold as well, so every write is guarded twice: take spec-harness's hooks out there, or ${off}. init writes none here`,
    );
    // This file's own entry is said first, whatever another holds.
    expect(describeSkipped(plugin, 'hooks', true, [USER])).toBe(describeSkipped(plugin, 'hooks', true));
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

  it("reads a path spec-brief loads as the plugin when it names the plugin's file, and asks about nothing else", () => {
    const asked: string[] = [];
    const isPluginFile = (path: string): boolean => {
      asked.push(path);
      return path.endsWith('plugin.js');
    };
    // A path starts with a dot or is absolute, as spec-brief reads one, alone or as a module.
    expect(loadsPlugin({ plugins: ['./node_modules/@descent-vtt/spec-harness/dist/plugin.js'] }, isPluginFile)).toBe(true);
    expect(loadsPlugin({ plugins: [{ module: '../shared/plugin.js' }] }, isPluginFile)).toBe(true);
    expect(loadsPlugin({ plugins: ['/opt/spec-harness/dist/plugin.js'] }, isPluginFile)).toBe(true);
    expect(loadsPlugin({ plugins: ['./tools/other.mjs', { module: './x.mjs' }] }, isPluginFile)).toBe(false);
    // A package name is never a path, and never asked about.
    asked.length = 0;
    expect(loadsPlugin({ plugins: ['some-plugin.js', { module: '@scope/plugin.js' }, 7] }, isPluginFile)).toBe(false);
    expect(asked).toEqual([]);
    // Without a way to read the disk, a path is not the plugin.
    expect(loadsPlugin({ plugins: ['./node_modules/@descent-vtt/spec-harness/dist/plugin.js'] })).toBe(false);
    // And init adds no second one.
    expect(mergeSpecBrief({ plugins: ['./dist/plugin.js'] }, null, isPluginFile)).toBeNull();
    expect(mergeSpecBrief({ plugins: ['./dist/plugin.js'] })).toEqual({ plugins: ['./dist/plugin.js', PLUGIN] });
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

describe("what doctor says of the keys, the Claude Code release and git's hook", () => {
  it('notes the signers whose key is not FIDO2, and says nothing when there is none', () => {
    expect(describeSignerKeys([])).toBeNull();
    expect(
      describeSignerKeys([
        { line: 1, principals: ['a@example.com', 'b@example.com'], keyType: 'ssh-ed25519' },
        { line: 4, principals: ['c@example.com'], keyType: 'ssh-rsa' },
      ]),
    ).toBe(
      "note: signers whose key is not a FIDO2 key: a@example.com,b@example.com (ssh-ed25519, line 1), c@example.com (ssh-rsa, line 4). Where an agent runs as the person, ADR-0006 recommends a FIDO2 key, ssh-keygen -t ed25519-sk, whose signature needs a touch no process can supply, or a key the agent's account cannot read; a PIV or PKCS#11 hardware key reads as a plain ssh-rsa or ecdsa line, so this is a note, not a failure",
    );
    expect(describeSignerProblem({ line: 3, message: 'm' })).toBe('note: line 3 is not a signer: m');
  });

  it('says whether the Claude Code on PATH runs the hooks, and never that one it cannot tell is fine', () => {
    expect(describeClaudeRelease({ state: 'ok', version: '2.1.200' })).toBe('Claude Code 2.1.200 runs the hooks, which need 2.1.139 or later');
    expect(describeClaudeRelease({ state: 'outdated', version: '2.1.100' })).toBe(
      "Claude Code 2.1.100 is older than 2.1.139, which the hooks need: it ignores a hook's args and runs a bare node, which fails, and a PreToolUse hook that fails blocks nothing, so every write passes unguarded: update Claude Code, with claude update",
    );
    // Read from the package a Windows shim runs, rather than asked: the file says where.
    const file = 'C:\\npm\\node_modules\\@anthropic-ai\\claude-code\\package.json';
    expect(describeClaudeRelease({ state: 'ok', version: '2.1.285', file })).toBe(`Claude Code 2.1.285 (as ${file} declares) runs the hooks, which need 2.1.139 or later`);
    expect(describeClaudeRelease({ state: 'outdated', version: '2.1.100', file })).toBe(
      `Claude Code 2.1.100 (as ${file} declares) is older than 2.1.139, which the hooks need: it ignores a hook's args and runs a bare node, which fails, and a PreToolUse hook that fails blocks nothing, so every write passes unguarded: update Claude Code, with claude update`,
    );
    expect(describeClaudeRelease({ state: 'unknown', reason: 'no claude is on PATH' })).toBe(
      'whether Claude Code is 2.1.139 or later, which the hooks need, cannot be told: no claude is on PATH; an older release lets every write pass unguarded, so check claude --version where Claude Code runs',
    );
  });

  it("says whether git's pre-commit hook runs spec-harness, and what to do when it does not", () => {
    expect(describeGitHook({ state: 'runs', file: '.git/hooks/pre-commit' })).toBe('.git/hooks/pre-commit runs spec-harness');
    expect(describeGitHook({ state: 'inert', file: '.githooks/pre-commit' })).toBe(
      '.githooks/pre-commit runs spec-harness, but is not executable, so git skips it: chmod +x .githooks/pre-commit',
    );
    expect(describeGitHook({ state: 'other', file: '.git/hooks/pre-commit' })).toBe(
      '.git/hooks/pre-commit does not run spec-harness: add the line "node node_modules/@descent-vtt/spec-harness/bin/spec-harness.js hook git" to it',
    );
    expect(describeGitHook({ state: 'absent', file: '.git/hooks/pre-commit' })).toBe(missingGitHook('.git/hooks/pre-commit'));
    expect(missingGitHook('.git/hooks/pre-commit')).toBe(
      "no pre-commit hook runs spec-harness (.git/hooks/pre-commit): one refuses a commit that changes what the active brief protects, for any agent or none, a shell's writes included; run spec-harness init --git-hook --write to add it",
    );
    expect(missingGitHook(null)).toBe(
      "no pre-commit hook runs spec-harness: one refuses a commit that changes what the active brief protects, for any agent or none, a shell's writes included; run spec-harness init --git-hook --write to add it",
    );
    expect(describeGitHook({ state: 'unknown', reason: 'r' })).toBe('where git runs its hooks cannot be told: r');
  });

  it('runs git\'s hook with node and the script in the project\'s install, as it runs Claude Code\'s, read from the top of the work tree', () => {
    expect(GIT_HOOK_LINE).toBe('node node_modules/@descent-vtt/spec-harness/bin/spec-harness.js hook git');
    // The script the Claude Code hooks name under the project, here under the directory git starts the hook in.
    expect(`${PROJECT_DIR}/${GIT_HOOK_LINE.split(' ')[1]}`).toBe(SCRIPT);
  });

  it('writes a pre-commit hook in POSIX sh that says what is missing where the install is not, and otherwise runs it', () => {
    expect(PRE_COMMIT).toBe(
      [
        '#!/bin/sh',
        '# spec-harness: refuse a commit that changes what the active brief protects.',
        "# git runs this at the top of the work tree it commits in, a linked worktree's",
        "# own, wherever the hook is kept: the project's install is read from there.",
        'bin=node_modules/@descent-vtt/spec-harness/bin/spec-harness.js',
        'if [ ! -f "$bin" ]; then',
        `  printf '%s\\n' "spec-harness: $bin is not in $PWD, the work tree git commits in: install the project's dependencies there, as with npm ci, and commit again" >&2`,
        '  exit 2',
        'fi',
        'exec node "$bin" hook git',
        '',
      ].join('\n'),
    );
    // What it runs is the line advised for a hook of the repository's own, the script by the name it checked.
    expect(PRE_COMMIT.endsWith(`\nexec ${GIT_HOOK_LINE.replace('node_modules/@descent-vtt/spec-harness/bin/spec-harness.js', '"$bin"')}\n`)).toBe(true);
    // doctor and init find the harness in it by name, and no npx.
    expect(PRE_COMMIT).toContain('spec-harness');
    expect(gitHookNote(PRE_COMMIT)).toBeNull();
  });

  describe('a hook that runs the harness through npx', () => {
    const NOTE =
      'it runs spec-harness through npx, which starts npm to start node on every commit, and under npm 12 prints two "npm notice run" lines each time: ' +
      'to run it with node from the project\'s install, as Claude Code\'s hooks are, replace the npx command there with "node node_modules/@descent-vtt/spec-harness/bin/spec-harness.js hook git"';

    it.each([
      ['the hook init wrote through 0.9.1', '#!/bin/sh\n# spec-harness: refuse a commit that changes what the active brief protects.\nexec npx --no-install spec-harness hook git\n'],
      ['the line init advised, in a hook of the repository\'s own', '#!/bin/sh\nnpm test || exit 1\nnpx --no-install spec-harness hook git\n'],
      ['npx without --no-install', '#!/bin/sh\nnpx spec-harness hook git\n'],
      ['the package by its full name', '#!/bin/sh\nexec npx --no-install @descent-vtt/spec-harness hook git\n'],
      ['a comment after the command', '#!/bin/sh\nnpx --no-install spec-harness hook git # the guard\n'],
      ['an indented line, and more spaces than one', '#!/bin/sh\nif true; then\n  npx  --no-install  spec-harness  hook  git\nfi\n'],
      ['Windows line endings', '#!/bin/sh\r\nexec npx --no-install spec-harness hook git\r\n'],
      ['no newline at its end', 'npx --no-install spec-harness hook git'],
    ])('is noted, with the line that runs it with node: %s', (_, text) => {
      expect(gitHookNote(text)).toBe(NOTE);
    });

    it.each([
      ['the hook init writes', PRE_COMMIT],
      ['the line init advises, in a hook of the repository\'s own', `#!/bin/sh\nnpm test || exit 1\n${GIT_HOOK_LINE}\n`],
      ['a comment that names the npx command', '#!/bin/sh\n# was: npx --no-install spec-harness hook git\nexec node node_modules/@descent-vtt/spec-harness/bin/spec-harness.js hook git\n'],
      ['npx running something else, and the harness run with node', '#!/bin/sh\nnpx --no-install lint-staged\nnode node_modules/@descent-vtt/spec-harness/bin/spec-harness.js hook git\n'],
      ['npx running the harness\'s other hook', '#!/bin/sh\nnpx --no-install spec-harness hook claude\n'],
      ['npx running another of its commands', '#!/bin/sh\nnpx --no-install spec-harness doctor\n'],
      ['another runner, which is the repository\'s to choose', '#!/bin/sh\npnpm exec spec-harness hook git\nyarn spec-harness hook git\nbunx spec-harness hook git\n'],
      ['a word that only holds npx', '#!/bin/sh\nmynpx spec-harness hook git\nnpxx spec-harness hook git\n'],
      ['npx after the command', '#!/bin/sh\nnode node_modules/@descent-vtt/spec-harness/bin/spec-harness.js hook git || npx --no-install lint-staged\n'],
      ['a command whose name only starts as the hook\'s does', '#!/bin/sh\nnpx --no-install spec-harness hook gitlab\n'],
      ['a tool whose name only starts as the harness\'s does', '#!/bin/sh\nnpx --no-install spec-harness-hook git\nnpx --no-install spec-harnesshook git\n'],
      ['a tool whose name only ends as the harness\'s does', '#!/bin/sh\nnpx --no-install inspec-harness hook git\n'],
      ['a hook that does not run it', '#!/bin/sh\nnpm test\n'],
      ['an empty hook', ''],
    ])('is not noted: %s', (_, text) => {
      expect(gitHookNote(text)).toBeNull();
    });
  });

  it('says how each forge protects the rule files, GitLab Free without Code Owners (spec-core ADR-0005)', () => {
    expect(PROTECT_RULE_FILES).toContain('on GitHub, CODEOWNERS and a protected branch; on GitLab Premium, Code Owners; on GitLab Free, a protected branch no one pushes to, merged by Maintainers, agents as Developers, and pipelines that must succeed');
    expect(PROTECT_RULE_FILES).toContain("check each change in CI against the base branch's rules");
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
    // A leading slash inside braces roots that alternative, as one written
    // alone does, where {/briefs/**/*.md,x} read as briefs/**/*.md.
    expect(graphReadsBriefs({ patterns: ['{/briefs/**/*.md,docs/**/*.md}'] }, 'briefs')).toBe(false);
    expect(graphReadsBriefs({ patterns: ['/briefs/**/*.md'] }, 'briefs')).toBe(false);
    expect(graphReadsBriefs({ patterns: ['{/briefs/**/*.md,docs/**/*.md}'] }, 'docs/briefs')).toBe(true);
    // The slashes after a leading ./ go with it, where .//briefs/**/*.md read as /briefs/**/*.md.
    expect(graphReadsBriefs({ patterns: ['.//briefs/**/*.md'] }, 'briefs')).toBe(true);
    expect(graphReadsBriefs({ patterns: ['{.//briefs/**/*.md,docs/**/*.md}'] }, 'briefs')).toBe(true);
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

describe("the lines of Claude Code's hook in its settings, and what doctor says of each (ADR-0005)", () => {
  const FILE = '.claude/settings.json';
  const BOTH = ['PreToolUse', 'PostToolUse'];
  const exec = (...rest: string[]) => ({ type: 'command', command: 'node', args: [SCRIPT, 'hook', 'claude', ...rest], timeout: 60 });
  const shell = (line: string) => ({ type: 'command', command: line });
  /** Settings that hold the hooks under both events, as init writes its own. */
  const settings = (...hooks: unknown[]) => ({ hooks: { PreToolUse: [{ matcher: GUARD.matcher, hooks }], PostToolUse: [{ matcher: GUARD.matcher, hooks }] } });
  /** The tools that write a file and a supported Claude Code can call: the hook reads MultiEdit too, which none has. */
  const TOOLS = ['Edit', 'Write', 'NotebookEdit'];
  /** Started before every tool that writes and after each, as init's own entries are: nothing to say of it. */
  const EVERY = { before: TOOLS, after: TOOLS, cover: null };
  const line = (words: string[], more: { shell?: boolean; blocks?: boolean; events?: string[] } = {}) => ({ events: more.events ?? BOTH, words, shell: more.shell ?? false, blocks: more.blocks ?? false });

  it('knows the harness by its command, the script or the name at the end of a path, and gives what follows it', () => {
    expect(writtenHooks(settings(HOOK))).toEqual([line(['hook', 'claude'])]);
    expect(writtenHooks(settings(exec('--root', PROJECT_DIR, '--brief', '001')))).toEqual([line(['hook', 'claude', '--root', PROJECT_DIR, '--brief', '001'])]);
    for (const hook of [
      { type: 'command', command: '${CLAUDE_PROJECT_DIR}/node_modules/.bin/spec-harness', args: ['hook', 'claude', 'extra'] },
      { type: 'command', command: 'npx', args: ['--no-install', '@descent-vtt/spec-harness', 'hook', 'claude', 'extra'] },
      { type: 'command', command: 'C:\\Program Files\\nodejs\\node.exe', args: ['C:\\p\\node_modules\\@descent-vtt\\spec-harness\\bin\\spec-harness.js', 'hook', 'claude', 'extra'] },
      { type: 'command', command: 'node', args: ['--no-warnings', 'node_modules/@descent-vtt/spec-harness/bin/spec-harness.js', 'hook', 'claude', 'extra'] },
    ]) {
      expect(writtenHooks(settings(hook)), JSON.stringify(hook)).toEqual([line(['hook', 'claude', 'extra'])]);
    }
    // Whatever follows the command, the guard's line or not: the reader says whose it is.
    expect(writtenHooks(settings({ type: 'command', command: 'node', args: [SCRIPT, 'hook', 'git'] }))).toEqual([line(['hook', 'git'])]);
    expect(writtenHooks(settings({ type: 'command', command: 'node', args: [SCRIPT] }))).toEqual([line([])]);
  });

  it('reads a line with no args as the shell splits it, and says where the shell would change what follows', () => {
    expect(writtenHooks(settings(shell(LEGACY)))).toEqual([line(['hook', 'claude'])]);
    expect(writtenHooks(settings(shell(`  node   "${SCRIPT}"  hook claude `)))).toEqual([line(['hook', 'claude'])]);
    expect(writtenHooks(settings(shell(`node '${SCRIPT}' hook claude --brief 001 --root packages/app`)))).toEqual([line(['hook', 'claude', '--brief', '001', '--root', 'packages/app'])]);
    // A quote, a variable, a redirection, a pattern: each is the shell's to read first.
    for (const rest of ['--root "${CLAUDE_PROJECT_DIR}"', '--root $PWD', "--brief '001'", '--root ~/work', '2>/dev/null', '--brief 00*', '--root a\\b', '&& true']) {
      expect(writtenHooks(settings(shell(`${LEGACY} ${rest}`))), rest).toEqual([line(['hook', 'claude', ...rest.split(' ')], { shell: true })]);
    }
    // With args no shell reads a word, whatever it holds.
    expect(writtenHooks(settings(exec('--root', '"$PWD"')))).toEqual([line(['hook', 'claude', '--root', '"$PWD"'])]);
  });

  it('finds no line of the harness in another program\'s hook, in arguments that are not text, or under another event', () => {
    for (const hook of [
      { type: 'command', command: 'node', args: ['${CLAUDE_PROJECT_DIR}/.claude/hooks/check.js', 'hook', 'claude'] },
      { type: 'command', command: 'node', args: ['node_modules/my-spec-harness.js', 'hook', 'claude'] },
      // With args a quote is part of the word, and no file of the harness's is named with one.
      { type: 'command', command: 'node', args: [`"${SCRIPT}"`, 'hook', 'claude'] },
      { type: 'command', command: 'npx --no-install spec-harness-lint hook claude' },
      { type: 'command', command: 'npm run lint' },
      { type: 'command', command: 'node', args: [SCRIPT, 'hook', 7] },
      { type: 'command', command: 'node', args: `${SCRIPT} hook claude` },
      { type: 'command', command: 'node', args: null },
      { type: 'command', command: 7, args: [SCRIPT, 'hook', 'claude'] },
      { type: 'http', url: 'https://example.com/spec-harness' },
      'spec-harness hook claude',
      null,
    ]) {
      expect(writtenHooks(settings(hook)), JSON.stringify(hook)).toEqual([]);
    }
    expect(writtenHooks({ hooks: { Stop: [GUARD], SessionStart: [GUARD] } })).toEqual([]);
    expect(writtenHooks({ hooks: { PreToolUse: 'x', PostToolUse: [null, { hooks: 'y' }] } })).toEqual([]);
    for (const none of [{ hooks: null }, {}, null, 'unreadable']) expect(writtenHooks(none)).toEqual([]);
  });

  it('has a line under both events once, one under either with its event, and a line that differs as another', () => {
    expect(writtenHooks({ hooks: { PreToolUse: [GUARD] } })).toEqual([line(['hook', 'claude'], { events: ['PreToolUse'] })]);
    expect(writtenHooks({ hooks: { PostToolUse: [GUARD, GUARD] } })).toEqual([line(['hook', 'claude'], { events: ['PostToolUse'] })]);
    // Other hooks beside it, in a group of their own or in its group.
    expect(writtenHooks({ hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'npm run lint' }] }, { hooks: [{ type: 'command', command: 'x' }, HOOK] }], PostToolUse: [GUARD] } })).toEqual([line(['hook', 'claude'])]);
    expect(writtenHooks({ hooks: { PreToolUse: [{ hooks: [exec('--brief', '1')] }], PostToolUse: [{ hooks: [exec('--brief', '2'), exec('--brief', '1')] }] } })).toEqual([
      line(['hook', 'claude', '--brief', '1']),
      line(['hook', 'claude', '--brief', '2'], { events: ['PostToolUse'] }),
    ]);
    // The same words, written for a shell and for none, or with and without onFailure, are lines apart.
    expect(writtenHooks(settings(HOOK, { ...HOOK, onFailure: 'block' }, { ...HOOK, onFailure: 'continue' }))).toEqual([line(['hook', 'claude']), line(['hook', 'claude'], { blocks: true })]);
    expect(writtenHooks(settings(exec('--root', '$PWD'), shell(`${LEGACY} --root $PWD`)))).toEqual([line(['hook', 'claude', '--root', '$PWD']), line(['hook', 'claude', '--root', '$PWD'], { shell: true })]);
  });

  const PROJECT = '/the/project';
  const DIRECTORIES = [PROJECT, `${PROJECT}/packages/app`];
  /** The hook's own reading, in a session started at the project. */
  const read = (words: readonly string[]) => claudeHookLine(words, parseOptions, PROJECT, (path) => DIRECTORIES.includes(path));
  const reported = (hooks: unknown, file = FILE) => reportHooks([{ file, settings: hooks }], PROJECT, read);
  const OFF = "so the guard is off and no write is checked; mend it in Claude Code's settings, where init writes \"hook claude\" and nothing after it";
  const NO_ROOT = "so the guard is off and no write is checked; give the hook's line a directory that exists, or leave --root out for the project Claude Code names";

  it('has nothing to say of the line a release wrote, which guards', () => {
    const released = { file: FILE, events: BOTH, line: ['hook', 'claude'], state: 'guards', onFailure: null, detail: null, ...EVERY, note: null };
    expect(reported(settings(HOOK))).toEqual([released]);
    expect(reported(settings(shell(LEGACY)))).toEqual([released]);
    expect(reported(mergeClaudeSettings({}))).toEqual([released]);
    // By another path to the script, or with another timeout, it is still that line.
    expect(reported(settings({ type: 'command', command: 'node', args: ['node_modules/@descent-vtt/spec-harness/bin/spec-harness.js', 'hook', 'claude'], timeout: 5 }))).toEqual([released]);
  });

  it('says a line with more on it as it is, and that it guards, with the root where the line gives one', () => {
    expect(reported(settings(exec('--root', PROJECT_DIR)))).toEqual([
      {
        file: FILE,
        events: BOTH,
        line: ['hook', 'claude', '--root', PROJECT_DIR],
        state: 'guards',
        onFailure: null,
        detail: '"hook claude --root ${CLAUDE_PROJECT_DIR}" in .claude/settings.json is more than init writes, and guards: the hook reads the line, and its root, /the/project, is a directory',
        ...EVERY,
        note: null,
      },
    ]);
    const said = (...rest: string[]) => reported(settings(exec(...rest)))[0];
    expect(said('--brief', '001', '--base', 'main')).toMatchObject({ state: 'guards', detail: '"hook claude --brief 001 --base main" in .claude/settings.json is more than init writes, and guards: the hook reads the line' });
    expect(said('extra', '--strict', '--format', 'json')).toMatchObject({ state: 'guards', detail: '"hook claude extra --strict --format json" in .claude/settings.json is more than init writes, and guards: the hook reads the line' });
    expect(said('--root', `${PROJECT_DIR}/packages/app`)).toMatchObject({ state: 'guards', detail: expect.stringContaining(', and its root, /the/project/packages/app, is a directory') });
    // An empty root is the directory the hook is started in.
    expect(said('--root', '')).toMatchObject({ state: 'guards', detail: '"hook claude --root \'\'" in .claude/settings.json is more than init writes, and guards: the hook reads the line, and its root, /the/project, is a directory' });
  });

  it('says a line the hook cannot read, and a root that is no directory, as a guard that is off, in the hook\'s words', () => {
    expect(reported(settings(exec('--format', 'xml')))).toEqual([
      {
        file: FILE,
        events: BOTH,
        line: ['hook', 'claude', '--format', 'xml'],
        state: 'off',
        onFailure: null,
        detail: `"hook claude --format xml" in .claude/settings.json: the hook's line cannot be read (--format must be pretty, json, gitlab, sarif or github, not "xml"), ${OFF}`,
        ...EVERY,
        note: null,
      },
    ]);
    expect(reported(settings(exec('--nope')))[0]).toMatchObject({ state: 'off', detail: expect.stringMatching(/^"hook claude --nope" in \.claude\/settings\.json: the hook's line cannot be read \(Unknown option '--nope'/) });
    expect(reported(settings(exec('--root')))[0]).toMatchObject({ state: 'off', detail: expect.stringContaining("(Option '--root <value>' argument missing), so the guard is off") });
    expect(reported(settings(exec('--root', '/nowhere')))[0]).toMatchObject({
      state: 'off',
      detail: `"hook claude --root /nowhere" in .claude/settings.json: --root is "/nowhere", which is not a directory, ${NO_ROOT}`,
    });
    // The root is the one Claude Code hands the hook: the placeholder filled with the project.
    expect(reported(settings(exec('--root', `${PROJECT_DIR}/nowhere`)))[0]).toMatchObject({
      state: 'off',
      detail: `"hook claude --root \${CLAUDE_PROJECT_DIR}/nowhere" in .claude/settings.json: --root is "/the/project/nowhere", which is not a directory, ${NO_ROOT}`,
    });
    // A variable no shell is there to fill is no directory.
    expect(reported(settings(exec('--root', '$CLAUDE_PROJECT_DIR')))[0]).toMatchObject({ state: 'off' });
  });

  it('hands the hook\'s reading the words Claude Code hands the hook: what follows the command, the project filled in', () => {
    const handed: (readonly string[])[] = [];
    reportHooks([{ file: FILE, settings: settings(exec('--root', `${PROJECT_DIR}/a`, '--brief', PROJECT_DIR, '--base', '${CLAUDE_PROJECT_DIR:-.}')) }], 'C:\\the project', (words) => {
      handed.push(words);
      return null;
    });
    expect(handed).toEqual([['hook', 'claude', '--root', 'C:\\the project/a', '--brief', 'C:\\the project', '--base', '${CLAUDE_PROJECT_DIR:-.}']]);
  });

  it('cannot tell what a shell hands the hook, and says how the line is written so that it can', () => {
    const written = `node "${SCRIPT}" hook claude --root "${PROJECT_DIR}"`;
    expect(reported(settings(shell(written)))).toEqual([
      {
        file: FILE,
        events: BOTH,
        line: ['hook', 'claude', '--root', '"${CLAUDE_PROJECT_DIR}"'],
        state: 'unknown',
        onFailure: null,
        detail:
          '"hook claude --root "${CLAUDE_PROJECT_DIR}"" in .claude/settings.json is a shell\'s to read before the hook is handed it, so what the hook does with it cannot be told here: written with "args", each word reaches the hook as it stands',
        ...EVERY,
        note: null,
      },
    ]);
    // Read as it stands it would be a root that is no directory, or a line that cannot be read: neither is said of it.
    expect(reported(settings(shell(`${LEGACY} --root "/nowhere"`)))[0]).toMatchObject({ state: 'unknown' });
    expect(reported(settings(shell(`${LEGACY} --format 'xml'`)))[0]).toMatchObject({ state: 'unknown' });
    // A shell's line that holds nothing a shell changes is read as written.
    expect(reported(settings(shell(`${LEGACY} --root /nowhere`)))[0]).toMatchObject({ state: 'off' });
    expect(reported(settings(shell(`${LEGACY} --brief 001`)))[0]).toMatchObject({ state: 'guards' });
  });

  it('reports no line that is not the hook\'s, whatever of the harness it runs', () => {
    for (const rest of [['hook', 'git'], ['guard', 'src/a.ts'], ['mcp', '--root', PROJECT_DIR], ['doctor'], ['hook'], [], ['hook', 'git', '--nope'], ['--nope']]) {
      expect(reported(settings({ type: 'command', command: 'node', args: [SCRIPT, ...rest] })), rest.join(' ')).toEqual([]);
    }
    expect(reported(settings(shell(`${LEGACY.replace('hook claude', 'hook git')} "$1"`)))).toEqual([]);
  });

  it('names the event of a line that stands under one alone, and every file that holds a line, in the order given', () => {
    const pre = { hooks: { PreToolUse: [{ hooks: [exec('--brief', '001')] }], PostToolUse: [{ hooks: [exec('--format', 'xml')] }] } };
    const user = '/home/p/.claude/settings.json';
    const all = reportHooks(
      [
        { file: user, settings: settings(HOOK) },
        { file: FILE, settings: pre },
        { file: '.claude/settings.local.json', settings: 'unreadable' },
      ],
      PROJECT,
      read,
    );
    expect(all.map((report) => [report.file, report.events, report.state])).toEqual([
      [user, BOTH, 'guards'],
      [FILE, ['PreToolUse'], 'guards'],
      [FILE, ['PostToolUse'], 'off'],
    ]);
    expect(all[1]?.detail).toBe('"hook claude --brief 001" in .claude/settings.json (under PreToolUse alone) is more than init writes, and guards: the hook reads the line');
    expect(all[2]?.detail?.startsWith('"hook claude --format xml" in .claude/settings.json (under PostToolUse alone): the hook\'s line cannot be read (')).toBe(true);
  });

  it('says what onFailure "block" changes: a write held when the hook fails, which is every write where its line turns the guard off', () => {
    const HOLDS = 'sets onFailure to "block", so Claude Code 2.1.295 or later holds a write when the hook fails';
    expect(reported(settings({ ...HOOK, onFailure: 'block' }))).toEqual([
      {
        file: FILE,
        events: BOTH,
        line: ['hook', 'claude'],
        state: 'guards',
        onFailure: 'block',
        detail: null,
        ...EVERY,
        note: `"hook claude" in .claude/settings.json ${HOLDS}, where it lets the write go ahead without it: by its exit 1 for a question it cannot read, by not starting, or by running past its timeout`,
      },
    ]);
    expect(reported(settings({ ...exec('--root', '/nowhere'), onFailure: 'block' }))[0]).toMatchObject({
      state: 'off',
      onFailure: 'block',
      note: `"hook claude --root /nowhere" in .claude/settings.json ${HOLDS}, which with this line is every write, the one that mends the line among them: mend it by hand`,
    });
    expect(reported(settings({ ...exec('--format', 'xml'), onFailure: 'block' }))[0]?.note).toContain('which with this line is every write');
    // A line with more on it that guards is told as the line a release wrote is.
    expect(reported(settings({ ...exec('--brief', '001'), onFailure: 'block' }))[0]).toMatchObject({
      state: 'guards',
      note: expect.stringMatching(/^"hook claude --brief 001" in \.claude\/settings\.json sets onFailure to "block", .* where it lets the write go ahead without it: /),
    });
    // Under one event alone, the note names the event as the line's own sentence does.
    expect(reported({ hooks: { PreToolUse: [{ hooks: [{ ...HOOK, onFailure: 'block' }] }] } })[0]?.note?.startsWith('"hook claude" in .claude/settings.json (under PreToolUse alone) sets onFailure to "block", ')).toBe(true);
    expect(reported(settings({ ...shell(`${LEGACY} --root "$PWD"`), onFailure: 'block' }))[0]).toMatchObject({ state: 'unknown', onFailure: 'block', note: expect.stringContaining('where it lets the write go ahead without it') });
    // Any other value is Claude Code's default, or not one it reads.
    for (const value of ['continue', 'Block', true, undefined]) expect(reported(settings({ ...HOOK, onFailure: value }))[0], String(value)).toMatchObject({ onFailure: null, note: null });
  });

  const W = '"hook claude" in .claude/settings.json';
  const group = (matcher: unknown, ...hooks: unknown[]) => (matcher === undefined ? { hooks } : { matcher, hooks });
  /** One entry under each event, in a group with the matcher given, or with none. */
  const both = (matcher: unknown, hook: unknown = HOOK) => ({ hooks: { PreToolUse: [group(matcher, hook)], PostToolUse: [group(matcher, hook)] } });
  /** The writing tools the one line of `hooks` is waited on before a write by, and started after one by. */
  const started = (hooks: unknown): unknown => {
    const [report] = reported(hooks);
    return [report?.before, report?.after];
  };

  it("reads a matcher as Claude Code's hooks reference has it: every tool, the tools it names, or a pattern anywhere in a name", () => {
    const cases: readonly (readonly [unknown, readonly string[] | null])[] = [
      // Left out, empty, or a star alone: every tool.
      [undefined, TOOLS],
      ['', TOOLS],
      ['*', TOOLS],
      // Letters, digits, _, -, spaces, commas and bars alone: the tools it names, exactly.
      ['Edit', ['Edit']],
      ['Write|Edit', ['Edit', 'Write']],
      ['Edit, Write ,NotebookEdit', ['Edit', 'Write', 'NotebookEdit']],
      ['Edit | Write', ['Edit', 'Write']],
      ['Edit|', ['Edit']],
      ['Edit|Write-2|x_y', ['Edit']],
      ['Bash', []],
      ['edit|write', []],
      ['Edit Write', []],
      // A name no supported Claude Code has a tool for adds none, and takes none away.
      ['Edit|Write|NotebookEdit', TOOLS],
      ['Edit|Write|MultiEdit|NotebookEdit', TOOLS],
      ['Write|MultiEdit', ['Write']],
      ['MultiEdit', []],
      // Any other character in it: a pattern, which may match anywhere in a name.
      ['Edit.*', ['Edit', 'NotebookEdit']],
      ['^Edit', ['Edit']],
      ['Edit$', ['Edit', 'NotebookEdit']],
      ['^(Edit|Write)$', ['Edit', 'Write']],
      ['^(Edit|Write|NotebookEdit)$', TOOLS],
      ['^Multi', []],
      ['.*', TOOLS],
      ['Notebook.', ['NotebookEdit']],
      ['^Bash$', []],
      // What the reference does not describe: a matcher that is not text, or is no pattern.
      ['(', null],
      [7, null],
      [null, null],
      [['Edit'], null],
    ];
    for (const [matcher, tools] of cases) expect(started(both(matcher)), JSON.stringify(matcher)).toEqual([tools, tools]);
  });

  it('is waited on before no write where its entry runs in the background, and cannot be told where the entry has an "if"', () => {
    expect(started(both(GUARD.matcher, { ...HOOK, async: true }))).toEqual([[], TOOLS]);
    expect(started(both(GUARD.matcher, { ...HOOK, asyncRewake: true }))).toEqual([[], TOOLS]);
    // Only true turns either on.
    expect(started(both(GUARD.matcher, { ...HOOK, async: 'true', asyncRewake: 1 }))).toEqual([TOOLS, TOOLS]);
    expect(started(both(GUARD.matcher, { ...HOOK, if: 'Edit(*.ts)' }))).toEqual([null, null]);
    // In the background it refuses nothing, whatever its rule matches.
    expect(started(both(GUARD.matcher, { ...HOOK, async: true, if: 'Edit(*.ts)' }))).toEqual([[], null]);
  });

  it('adds up the entries that hold one line, and cannot tell only where an entry that cannot be told might add a tool', () => {
    const split = { hooks: { PreToolUse: [group('Edit', HOOK), group('Write|MultiEdit|NotebookEdit', HOOK)], PostToolUse: [group('Write', HOOK), group('Bash', HOOK)] } };
    expect(started(split)).toEqual([TOOLS, ['Write']]);
    const conditional = { ...HOOK, if: 'Edit(*.ts)' };
    expect(started({ hooks: { PreToolUse: [GUARD, group(GUARD.matcher, conditional)], PostToolUse: [group('Edit', HOOK), group('Write', conditional)] } })).toEqual([TOOLS, null]);
  });

  it("reads each line by the entries that hold it, and by no other line's", () => {
    const longer = exec('--base', 'main');
    const two = { hooks: { PreToolUse: [group('Bash', HOOK), group(GUARD.matcher, longer)], PostToolUse: [group(GUARD.matcher, longer)] } };
    expect(reported(two).map((report) => [report.line.join(' '), report.state, report.before, report.after])).toEqual([
      ['hook claude', 'unstarted', [], []],
      ['hook claude --base main', 'guards', TOOLS, TOOLS],
    ]);
  });

  it('is not the guard where Claude Code waits on it before no write, and says what it stands under', () => {
    expect(reported({ hooks: { PostToolUse: [GUARD] } })).toEqual([
      {
        file: FILE,
        events: ['PostToolUse'],
        line: ['hook', 'claude'],
        state: 'unstarted',
        onFailure: null,
        detail: null,
        before: [],
        after: TOOLS,
        cover: `${W} (under PostToolUse alone): Claude Code waits on it before no write, so it is not the guard and refuses none (it stands under no PreToolUse)`,
        note: null,
      },
    ]);
    expect(reported(both('Bash'))[0]).toMatchObject({
      state: 'unstarted',
      detail: null,
      before: [],
      after: [],
      cover: `${W}: Claude Code waits on it before no write, so it is not the guard and refuses none (under PreToolUse it has the matcher "Bash"); it is started after no write, so it warns of none (under PostToolUse it has the matcher "Bash")`,
    });
    expect(reported(both(GUARD.matcher, { ...HOOK, async: true }))[0]).toMatchObject({
      state: 'unstarted',
      cover: `${W}: Claude Code waits on it before no write, so it is not the guard and refuses none (under PreToolUse it has the matcher "Edit|Write|MultiEdit|NotebookEdit" in the background)`,
    });
    // What the hook would do with such a line is not said: it is never asked before a write.
    expect(reported(both('Bash', exec('--root', PROJECT_DIR)))[0]).toMatchObject({ state: 'unstarted', detail: null });
    expect(reportHooks([{ file: FILE, settings: both('Bash', exec('--brief', '404')) }], PROJECT, () => heldHookLine('x'))[0]).toMatchObject({ state: 'unstarted', detail: null });
    // A line the hook cannot read is said as off all the same: it fails after every write it is started for.
    expect(reported({ hooks: { PostToolUse: [group(undefined, exec('--nope'))] } })[0]).toMatchObject({ state: 'off', before: [], after: TOOLS });
  });

  it('guards the writes Claude Code waits on it before, and says which it leaves unchecked', () => {
    expect(reported(both('Write|Edit'))[0]).toMatchObject({
      state: 'guards',
      detail: null,
      before: ['Edit', 'Write'],
      after: ['Edit', 'Write'],
      cover: `${W}: Claude Code waits on it before a write by Edit and Write, and before none by NotebookEdit, which goes unchecked (under PreToolUse it has the matcher "Write|Edit"); it is started after a write by Edit and Write alone (under PostToolUse it has the matcher "Write|Edit")`,
    });
    expect(reported(both('Edit'))[0]?.cover).toBe(
      `${W}: Claude Code waits on it before a write by Edit, and before none by Write and NotebookEdit, which goes unchecked (under PreToolUse it has the matcher "Edit"); it is started after a write by Edit alone (under PostToolUse it has the matcher "Edit")`,
    );
    expect(reported(both('Edit.*'))[0]?.cover).toBe(
      `${W}: Claude Code waits on it before a write by Edit and NotebookEdit, and before none by Write, which goes unchecked (under PreToolUse it has the matcher "Edit.*"); it is started after a write by Edit and NotebookEdit alone (under PostToolUse it has the matcher "Edit.*")`,
    );
    // Before every write and after none: only that is said.
    expect(reported({ hooks: { PreToolUse: [GUARD] } })[0]).toMatchObject({
      state: 'guards',
      detail: null,
      before: TOOLS,
      after: [],
      cover: `${W} (under PreToolUse alone): it is started after no write, so it warns of none (it stands under no PostToolUse)`,
    });
    // A line with more on it is said both ways: what the hook does with it, and which writes it is asked on.
    expect(reported(both('Edit', exec('--root', PROJECT_DIR)))[0]).toMatchObject({
      state: 'guards',
      detail: '"hook claude --root ${CLAUDE_PROJECT_DIR}" in .claude/settings.json is more than init writes, and guards: the hook reads the line, and its root, /the/project, is a directory',
      cover: expect.stringMatching(/^"hook claude --root \$\{CLAUDE_PROJECT_DIR\}" in \.claude\/settings\.json: Claude Code waits on it before a write by Edit, and before none by Write and NotebookEdit, /),
    });
  });

  it('names as unchecked only a tool a supported Claude Code can call: MultiEdit, which none has, is left unchecked by no line', () => {
    const every = { state: 'guards', detail: null, ...EVERY };
    // Edit, Write and NotebookEdit are every tool that writes: there is no more to say than of the matcher init writes.
    for (const matcher of ['Edit|Write|NotebookEdit', 'NotebookEdit, Write, Edit', '^(Edit|Write|NotebookEdit)$', GUARD.matcher]) expect(reported(both(matcher))[0], matcher).toMatchObject(every);
    // A matcher that names it beside others guards those, and the rest named are tools there are.
    expect(reported(both('Edit|Write|MultiEdit'))[0]).toMatchObject({
      state: 'guards',
      before: ['Edit', 'Write'],
      after: ['Edit', 'Write'],
      cover: `${W}: Claude Code waits on it before a write by Edit and Write, and before none by NotebookEdit, which goes unchecked (under PreToolUse it has the matcher "Edit|Write|MultiEdit"); it is started after a write by Edit and Write alone (under PostToolUse it has the matcher "Edit|Write|MultiEdit")`,
    });
    // Alone, it is a line Claude Code waits on before no write.
    expect(reported(both('MultiEdit'))[0]).toMatchObject({
      state: 'unstarted',
      before: [],
      after: [],
      cover: `${W}: Claude Code waits on it before no write, so it is not the guard and refuses none (under PreToolUse it has the matcher "MultiEdit"); it is started after no write, so it warns of none (under PostToolUse it has the matcher "MultiEdit")`,
    });
    // To init such a line is started for no write, whether its matcher names the tool or matches it: it writes its own beside it.
    for (const matcher of ['MultiEdit', '^MultiEdit$']) {
      const only = { matcher, hooks: [HOOK] };
      expect(mergeClaudeSettings({ hooks: { PreToolUse: [only], PostToolUse: [only] } }), matcher).toEqual({ hooks: { PreToolUse: [only, GUARD], PostToolUse: [only, GUARD] } });
    }
    // Whatever the matcher, the name stands in what is said only where the matcher itself is quoted.
    for (const matcher of ['Edit', 'Write|Edit', 'Bash', 'Edit.*', 'NotebookEdit', '^Write$', 7]) {
      const [report] = reported(both(matcher));
      expect([...(report?.before ?? []), ...(report?.after ?? [])], String(matcher)).not.toContain('MultiEdit');
      expect(report?.cover, String(matcher)).not.toContain('MultiEdit');
    }
  });

  it('cannot tell which writes a line is asked on where an entry has an "if" or a matcher the reference does not describe, and names each entry once', () => {
    const conditional = { ...HOOK, if: 'Edit(*.ts)' };
    expect(reported({ hooks: { PreToolUse: [group(undefined, conditional)] } })[0]).toMatchObject({
      state: 'unknown',
      detail: null,
      before: null,
      after: [],
      cover: `${W} (under PreToolUse alone): which writes Claude Code waits on it before cannot be told here (under PreToolUse it has no matcher with "if" "Edit(*.ts)"); it is started after no write, so it warns of none (it stands under no PostToolUse)`,
    });
    expect(reported(both(7))[0]).toMatchObject({
      state: 'unknown',
      cover: `${W}: which writes Claude Code waits on it before cannot be told here (under PreToolUse it has the matcher 7); which writes it is started after cannot be told here (under PostToolUse it has the matcher 7)`,
    });
    // With more on its line, nothing is said of what the hook does with it either: guards is not claimed.
    expect(reported(both(GUARD.matcher, { ...exec('--base', 'main'), if: 'Write' }))[0]).toMatchObject({ state: 'unknown', detail: null });
    const several = { hooks: { PreToolUse: [group('Bash', HOOK), group('Bash', HOOK), group('Read', { ...HOOK, asyncRewake: true }), group('Glob', HOOK)], PostToolUse: [GUARD] } };
    expect(reported(several)[0]?.cover).toBe(
      `${W}: Claude Code waits on it before no write, so it is not the guard and refuses none (under PreToolUse it has the matcher "Bash", the matcher "Read" in the background and the matcher "Glob")`,
    );
  });

  it('says a line under a brief that is not one as holding every write, in the words for the name', () => {
    const wrong = 'the flag names brief 404, and spec-brief knows no such brief';
    const held = (hooks: unknown) => reportHooks([{ file: FILE, settings: hooks }], PROJECT, () => heldHookLine(wrong));
    expect(held(settings(exec('--brief', '404')))).toEqual([
      {
        file: FILE,
        events: BOTH,
        line: ['hook', 'claude', '--brief', '404'],
        state: 'held',
        onFailure: null,
        detail: `"hook claude --brief 404" in .claude/settings.json: ${wrong}, so the hook holds every write until the line is mended: name a brief spec-brief lists, or take --brief off the line`,
        ...EVERY,
        note: null,
      },
    ]);
    // The hook holds the write itself there, so onFailure adds what it adds to a line that guards.
    expect(held(settings({ ...exec('--brief', '404'), onFailure: 'block' }))[0]).toMatchObject({ state: 'held', note: expect.stringContaining('where it lets the write go ahead without it') });
    // Where the writes it is asked on cannot be told, those it is asked on are held: that is said.
    expect(held(both(GUARD.matcher, { ...exec('--brief', '404'), if: 'Edit(*.ts)' }))[0]).toMatchObject({ state: 'held', before: null });
    // A shell's line is the shell's to read first, as it was.
    expect(held(settings(shell(`${LEGACY} --brief "404"`)))[0]).toMatchObject({ state: 'unknown', detail: expect.stringContaining("is a shell's to read") });
  });

  it("hands a caller the words of every line of the harness's, as the hook's reading is handed them", () => {
    const sources = [
      { file: 'a', settings: settings(exec('--root', PROJECT_DIR), { type: 'command', command: 'node', args: [SCRIPT, 'hook', 'git'] }) },
      { file: 'b', settings: 'unreadable' },
      { file: 'c', settings: { hooks: { PostToolUse: [GUARD] } } },
    ];
    expect(handedLines(sources, '/p')).toEqual([
      ['hook', 'claude', '--root', '/p'],
      ['hook', 'git'],
      ['hook', 'claude'],
    ]);
  });

  it('takes a line as started for a write unless it is waited on for none', () => {
    expect([isStarted(null), isStarted(['Edit']), isStarted([])]).toEqual([true, true, false]);
  });

  // Last in the file: it takes the budget, a tenth of a second, each time it
  // runs, and a sweep stops a mutant's tests at the first that fails.
  it('cannot tell from a pattern whose reading runs out its budget, and comes back at it', () => {
    // Five stars, each around the last: testing a tool's name against it does not end.
    const slow = '^((((([A-Za-z]*)*)*)*)*)*$X';
    const held = { hooks: { PreToolUse: [group(slow, HOOK)], PostToolUse: [GUARD] } };
    // A bound of the test's own around the whole reading. Were the reading's
    // taken away, this stops it after two seconds and the test fails, where
    // it would otherwise not come back at all.
    const found: unknown[] = runInNewContext('read()', { read: () => reported(held) }, { timeout: 2000 });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      state: 'unknown',
      detail: null,
      before: null,
      after: TOOLS,
      cover: `${W}: which writes Claude Code waits on it before cannot be told here (under PreToolUse it has the matcher ${JSON.stringify(slow)})`,
    });
  });
});
