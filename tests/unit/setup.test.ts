import { describe, expect, it } from 'vitest';

import { HOOK_COMMAND, mergeClaudeSettings, mergeMcp, mergeSpecGraph } from '../../src/setup.js';

const GUARD = { matcher: 'Edit|Write|MultiEdit|NotebookEdit', hooks: [{ type: 'command', command: HOOK_COMMAND, timeout: 60 }] };

describe('Claude Code settings', () => {
  it('adds the guard to PreToolUse and PostToolUse of empty settings', () => {
    expect(HOOK_COMMAND).toBe('npx --no-install spec-harness hook claude');
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
    const own = { matcher: 'Edit', hooks: [{ type: 'command', command: 'x' }, { type: 'command', command: HOOK_COMMAND }] };
    expect(mergeClaudeSettings({ hooks: { PreToolUse: [own] } })).toEqual({ hooks: { PreToolUse: [own], PostToolUse: [GUARD] } });
    expect(mergeClaudeSettings({ hooks: { PreToolUse: [own], PostToolUse: [GUARD] } })).toBeNull();
  });

  it('recognises the guard only by its exact command', () => {
    const similar = { hooks: [{ type: 'command', command: 'npx spec-harness hook claude' }] };
    expect(mergeClaudeSettings({ hooks: { PreToolUse: [similar], PostToolUse: [similar] } })).toEqual({
      hooks: { PreToolUse: [similar, GUARD], PostToolUse: [similar, GUARD] },
    });
  });

  it('reads hooks of the wrong shape as none there, rather than failing', () => {
    expect(mergeClaudeSettings({ hooks: null })).toEqual({ hooks: { PreToolUse: [GUARD], PostToolUse: [GUARD] } });
    expect(mergeClaudeSettings({ hooks: { PreToolUse: 'x', PostToolUse: [{ matcher: 'Edit' }, { hooks: 'y' }] } })).toEqual({
      hooks: { PreToolUse: [GUARD], PostToolUse: [{ matcher: 'Edit' }, { hooks: 'y' }, GUARD] },
    });
  });
});

describe('the MCP server registration', () => {
  it('registers the server beside those already there', () => {
    const current = { mcpServers: { other: { command: 'x' } }, extra: true };
    expect(mergeMcp(current)).toEqual({
      mcpServers: { other: { command: 'x' }, 'spec-harness': { command: 'npx', args: ['--no-install', 'spec-harness', 'mcp'] } },
      extra: true,
    });
    expect(mergeMcp({})).toEqual({ mcpServers: { 'spec-harness': { command: 'npx', args: ['--no-install', 'spec-harness', 'mcp'] } } });
    expect(mergeMcp({ mcpServers: null })).toEqual(mergeMcp({}));
  });

  it('changes nothing when a server by that name is registered, however it is configured', () => {
    expect(mergeMcp({ mcpServers: { 'spec-harness': { command: 'node', args: ['dist/cli.js', 'mcp'] } } })).toBeNull();
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
