import { describe, expect, it } from 'vitest';

import type { Decision, Verdict } from '../../src/guard.js';
import { CALLABLE_TOOLS, claudeResponse, gitResponse, parseClaudeHook, SESSION_START, sessionResponse, WRITING_TOOLS } from '../../src/hooks.js';

function hook(fields: Record<string, unknown>): string {
  return JSON.stringify({ session_id: 's', hook_event_name: 'PreToolUse', tool_name: 'Write', cwd: '/repo', ...fields });
}

function decision(verdict: Verdict, path = 'a.ts'): Decision {
  return {
    path,
    verdict,
    reason: verdict === 'allow' ? 'in-scope' : verdict === 'deny' ? 'protected' : 'out-of-scope',
    because: [],
    message: `${path} is ${verdict}`,
    hint: `fix ${path}`,
  };
}

describe('reading a Claude Code hook', () => {
  it('reads the file a writing tool names under file_path, path or notebook_path', () => {
    expect(parseClaudeHook(hook({ tool_input: { file_path: '/repo/a.ts', content: 'x' } }))).toEqual({
      event: 'PreToolUse',
      tool: 'Write',
      cwd: '/repo',
      paths: ['/repo/a.ts'],
    });
    expect(parseClaudeHook(hook({ tool_name: 'Edit', tool_input: { path: 'b.ts' } }))).toMatchObject({ paths: ['b.ts'] });
    expect(parseClaudeHook(hook({ tool_name: 'NotebookEdit', tool_input: { notebook_path: '/repo/n.ipynb' } }))).toMatchObject({
      tool: 'NotebookEdit',
      paths: ['/repo/n.ipynb'],
    });
    expect(parseClaudeHook(hook({ tool_name: 'MultiEdit', tool_input: { file_path: 'm.ts', edits: [] } }))).toMatchObject({ paths: ['m.ts'] });
  });

  it('reads every field a tool fills, once each', () => {
    // A guard that read only the first field would allow whatever a renamed field named.
    const request = parseClaudeHook(hook({ tool_input: { file_path: 'a.ts', path: 'b.ts', notebook_path: 'a.ts' } }));
    expect(request).toMatchObject({ paths: ['a.ts', 'b.ts'] });
  });

  it('ignores empty and non-string paths', () => {
    expect(parseClaudeHook(hook({ tool_input: { file_path: '', path: 7, notebook_path: null } }))).toMatchObject({ paths: [] });
    expect(parseClaudeHook(hook({ tool_input: 'a.ts' }))).toMatchObject({ paths: [] });
    expect(parseClaudeHook(hook({ tool_input: ['a.ts'] }))).toMatchObject({ paths: [] });
    expect(parseClaudeHook(hook({}))).toMatchObject({ paths: [] });
  });

  it('reads no path from a tool that does not write files', () => {
    expect(WRITING_TOOLS).toEqual(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
    for (const tool of ['Read', 'Bash', 'Grep', 'write', 'WebFetch']) {
      expect(parseClaudeHook(hook({ tool_name: tool, tool_input: { file_path: '/repo/a.ts', path: '/repo' } }))).toMatchObject({ tool, paths: [] });
    }
  });

  it('calls callable the tools a supported Claude Code has, each one a tool the hook reads a path from', () => {
    expect(CALLABLE_TOOLS).toEqual(['Edit', 'Write', 'NotebookEdit']);
    for (const tool of CALLABLE_TOOLS) expect(WRITING_TOOLS, tool).toContain(tool);
    // The one name more is read all the same: a Claude Code that still has the tool is answered for it.
    const legacy = WRITING_TOOLS.filter((tool) => !CALLABLE_TOOLS.includes(tool));
    expect(legacy).toEqual(['MultiEdit']);
    for (const tool of legacy) expect(parseClaudeHook(hook({ tool_name: tool, tool_input: { file_path: '/repo/a.ts' } }))).toMatchObject({ tool, paths: ['/repo/a.ts'] });
  });

  it('reads the working directory only when it is a string', () => {
    expect(parseClaudeHook(hook({ cwd: 3, tool_input: { file_path: 'a' } }))).toMatchObject({ cwd: null });
    expect(parseClaudeHook(JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'Edit' }))).toEqual({
      event: 'PostToolUse',
      tool: 'Edit',
      cwd: null,
      paths: [],
    });
  });

  it('says why it cannot read malformed input', () => {
    expect(parseClaudeHook('{"hook_event_name":')).toEqual({ error: 'the hook input is not JSON' });
    expect(parseClaudeHook('')).toEqual({ error: 'the hook input is not JSON' });
    expect(parseClaudeHook('[1]')).toEqual({ error: 'the hook input is not a JSON object' });
    expect(parseClaudeHook('null')).toEqual({ error: 'the hook input is not a JSON object' });
    expect(parseClaudeHook(JSON.stringify({ tool_name: 'Write' }))).toEqual({ error: 'the hook input names no event or tool' });
    expect(parseClaudeHook(JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 3 }))).toEqual({ error: 'the hook input names no event or tool' });
  });
});

describe('answering Claude Code', () => {
  it('refuses before the write, with every refused path, its reason and the next step', () => {
    const response = claudeResponse('PreToolUse', [decision('allow'), decision('deny', 'x.ts'), decision('ask', 'y.ts'), decision('deny', 'z.ts')]);
    expect(response.exitCode).toBe(0);
    expect(response.stdout.endsWith('\n')).toBe(true);
    expect(JSON.parse(response.stdout)).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'spec-harness: x.ts is deny. Next: fix x.ts.\nspec-harness: z.ts is deny. Next: fix z.ts.',
      },
    });
  });

  it('asks the person when nothing is refused and something is to be asked', () => {
    const response = claudeResponse('PreToolUse', [decision('warn'), decision('ask', 'y.ts')]);
    expect(JSON.parse(response.stdout)).toEqual({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: 'spec-harness: y.ts is ask. Next: fix y.ts.' },
    });
  });

  it('says nothing before a write it allows or only warns about: never "allow"', () => {
    // "allow" would skip the person's own permission prompt.
    expect(claudeResponse('PreToolUse', [decision('allow'), decision('warn')])).toEqual({ stdout: '', exitCode: 0 });
    expect(claudeResponse('PreToolUse', [])).toEqual({ stdout: '', exitCode: 0 });
    for (const verdicts of [['allow'], ['warn'], ['ask'], ['deny'], ['allow', 'warn', 'ask', 'deny']] as Verdict[][]) {
      for (const event of ['PreToolUse', 'PostToolUse', 'Stop']) {
        expect(claudeResponse(event, verdicts.map((v) => decision(v))).stdout).not.toContain('"allow"');
      }
    }
  });

  it('warns after a write outside the scope, as context for the model', () => {
    const response = claudeResponse('PostToolUse', [decision('allow'), decision('warn', 'w.ts'), decision('deny', 'd.ts')]);
    expect(response.exitCode).toBe(0);
    expect(JSON.parse(response.stdout)).toEqual({
      hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: 'spec-harness: w.ts is warn. Next: fix w.ts.' },
    });
  });

  it('says nothing after a write it has nothing to warn about, and nothing to other events', () => {
    expect(claudeResponse('PostToolUse', [decision('allow'), decision('deny')])).toEqual({ stdout: '', exitCode: 0 });
    expect(claudeResponse('UserPromptSubmit', [decision('deny'), decision('warn')])).toEqual({ stdout: '', exitCode: 0 });
  });
});

describe('answering git', () => {
  it('stops a commit that changes a refused path, and one that would need a question', () => {
    const response = gitResponse([decision('allow'), decision('deny', 'x.ts'), decision('ask', 'y.ts')]);
    expect(response.exitCode).toBe(1);
    expect(response.text).toBe(
      [
        'refused  x.ts is deny',
        '         fix x.ts',
        'refused  y.ts is ask',
        '         fix y.ts',
        "spec-harness: 2 file(s) this round may not change; the commit was stopped",
        '',
      ].join('\n'),
    );
  });

  it('lets a commit through with a warning for a path outside the scope', () => {
    const response = gitResponse([decision('warn', 'w.ts'), decision('allow')]);
    expect(response).toEqual({ text: 'warning  w.ts is warn\n         fix w.ts\n', exitCode: 0 });
  });

  it('says nothing about a commit it allows', () => {
    expect(gitResponse([decision('allow'), decision('allow')])).toEqual({ text: '', exitCode: 0 });
    expect(gitResponse([])).toEqual({ text: '', exitCode: 0 });
  });
});

describe('the hook as a session starts', () => {
  it('reads a SessionStart question, which names no tool and no file, and no other event without a tool', () => {
    expect(SESSION_START).toBe('SessionStart');
    expect(parseClaudeHook(JSON.stringify({ hook_event_name: 'SessionStart', cwd: '/repo', source: 'resume' }))).toEqual({ event: 'SessionStart', tool: '', cwd: '/repo', paths: [] });
    // A tool named beside it is read as named, and a file only a writing tool's.
    expect(parseClaudeHook(JSON.stringify({ hook_event_name: 'SessionStart', tool_name: 'Edit', tool_input: { file_path: '/repo/a.ts' } }))).toEqual({ event: 'SessionStart', tool: 'Edit', cwd: null, paths: ['/repo/a.ts'] });
    expect(parseClaudeHook(JSON.stringify({ hook_event_name: 'SessionStart', tool_name: 7, tool_input: { file_path: '/repo/a.ts' } }))).toEqual({ event: 'SessionStart', tool: '', cwd: null, paths: [] });
    for (const event of ['UserPromptSubmit', 'sessionstart', 'Stop']) expect(parseClaudeHook(JSON.stringify({ hook_event_name: event })), event).toEqual({ error: 'the hook input names no event or tool' });
    expect(parseClaudeHook(JSON.stringify({ tool_name: 'Edit' }))).toEqual({ error: 'the hook input names no event or tool' });
  });

  it('says a problem once for the person and once for Claude, exit 0, and nothing where there is none', () => {
    expect(sessionResponse(null)).toEqual({ stdout: '', exitCode: 0 });
    const said = sessionResponse('every write is held');
    expect(said.exitCode).toBe(0);
    expect(said.stdout.endsWith('}\n')).toBe(true);
    expect(JSON.parse(said.stdout)).toEqual({ systemMessage: 'spec-harness: every write is held', hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'spec-harness: every write is held' } });
  });
});
