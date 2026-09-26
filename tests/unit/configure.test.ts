import { describe, expect, it } from 'vitest';

import { GUARD_HOOK, mcpServer, mergeClaudeSettings, mergeMcp, mergeSpecGraph, PROJECT_DIR, PROJECT_DIR_OR_HERE } from '../../src/configure.js';

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
});
