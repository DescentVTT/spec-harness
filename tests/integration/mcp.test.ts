import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { INSTRUCTIONS, prompts, tools } from '../../src/server.js';
import { createMcpServer, type JsonObject, type ToolDefinition } from '../../src/vendor/spec-core/jsonrpc/index.js';
import { openWorkspace, parseOptions, type Workspace } from '../../src/workspace.js';
import { BIN, brief, BRIEF_FILE, cleanup, repository, ROOT, type Repository } from './helpers.js';

afterAll(cleanup);

let repo: Repository;
let workspace: Workspace;

beforeAll(async () => {
  repo = repository({
    [BRIEF_FILE]: brief({ affected: ['src/auth/**'], protected: ['src/db/**'] }),
    'briefs/002_next.md': brief({ title: '002 - Next', dependsOn: ['1'] }),
    'briefs/archive/003_old.md': brief({ title: '003 - Old', status: 'archived' }),
    'src/db/schema.ts': 'table;\n',
  });
  repo.git('checkout', '-q', '-b', 'brief/001-rotate');
  workspace = await openWorkspace(parseOptions(['mcp']), { stdout: { write: () => true }, stderr: { write: () => true }, cwd: repo.root, env: {} });
});

function tool(name: string): ToolDefinition {
  const found = tools(workspace, {}).find((candidate) => candidate.descriptor.name === name);
  if (found === undefined) throw new Error(`no tool ${name}`);
  return found;
}

describe('the tools', () => {
  it('are the five a round needs, each described with its schema', () => {
    const list = tools(workspace, {});
    expect(list.map((t) => t.descriptor.name)).toEqual(['start_round', 'check_path', 'request_escalation', 'audit_round', 'list_rounds']);
    for (const t of list) expect(t.descriptor['inputSchema']).toMatchObject({ type: 'object', additionalProperties: false });
    expect(list.find((t) => t.descriptor.name === 'request_escalation')?.descriptor['annotations']).toMatchObject({ readOnlyHint: false });
    expect(list.find((t) => t.descriptor.name === 'check_path')?.descriptor['annotations']).toMatchObject({ readOnlyHint: true });
  });

  it('start_round gives the context packet of the brief the branch names', async () => {
    const outcome = await tool('start_round').call({});
    expect(outcome.isError).toBeUndefined();
    expect(outcome.text.startsWith('# Round 001: Rotate tokens\n')).toBe(true);
    expect(outcome.structured).toEqual({ brief: '001', included: [], omitted: [], unresolved: [] });
    expect((await tool('start_round').call({ brief: '2' })).structured).toMatchObject({ brief: '002' });
  });

  it('check_path decides each path, relative to the project, with the next step', async () => {
    const outcome = await tool('check_path').call({ paths: ['src/db/schema.ts', 'src/auth/a.ts', 'README.md'] });
    expect(outcome.text.split('\n')).toEqual([
      'deny: brief 001 does not empower this round to change src/db/schema.ts (protectedFiles: src/db/**). Next: if the round cannot be done without it, stop and ask for a ruling: spec-harness escalate --path <file> --reason <why>, or the request_escalation tool',
      "allow: src/auth/a.ts is in brief 001's scope (src/auth/**)",
      "warn: README.md is outside brief 001's scope, which covers src/auth/**. Next: if the round needs it, say so in briefs/001_rotate-tokens.md and add it to affectedFiles; the archive reports every file outside the scope",
    ]);
    const decisions = (outcome.structured as { decisions: { verdict: string }[] }).decisions;
    expect(decisions.map((d) => d.verdict)).toEqual(['deny', 'allow', 'warn']);
  });

  it('check_path refuses arguments it does not take', async () => {
    expect(await tool('check_path').call({ paths: [] })).toEqual({ text: '"paths" must be a non-empty array of strings.', isError: true });
    expect(await tool('check_path').call({ paths: 'a.ts' })).toEqual({ text: '"paths" must be a non-empty array of strings.', isError: true });
    expect(await tool('check_path').call({ paths: [1] })).toEqual({ text: '"paths" must be a non-empty array of strings.', isError: true });
    expect(await tool('check_path').call({ paths: ['a'], path: 'b' })).toEqual({ text: 'Unknown argument "path"; this tool takes paths and brief.', isError: true });
    expect(await tool('check_path').call({ paths: ['a'], brief: 1 })).toEqual({ text: '"brief" must be a string.', isError: true });
    expect(await tool('check_path').call({ paths: ['a'], brief: '404' })).toEqual({ text: 'the flag names brief 404, and spec-brief knows no such brief', isError: true });
    expect(await tool('start_round').call({ brief: '3' })).toEqual({ text: 'the flag names brief 003, which is archived; a closed round writes nothing', isError: true });
  });

  it('request_escalation records the request and tells the agent to stop', async () => {
    const outcome = await tool('request_escalation').call({
      paths: ['src/db/schema.ts'],
      reason: 'Rotation needs a column.',
      options: [{ label: 'Allow', consequence: 'one column' }, { label: 'Refuse' }],
      recommendation: 'Allow.',
    });
    expect(outcome.isError).toBeUndefined();
    expect(outcome.structured).toEqual({ id: 'E-001-1' });
    expect(outcome.text).toContain('# Escalation E-001-1');
    expect(outcome.text).toContain('1. **Allow** - one column\n2. **Refuse** - \n');
    expect(outcome.text.endsWith('\nStop here until a person rules on E-001-1.')).toBe(true);
    const state = join(workspace.commonDir, 'spec-harness', 'escalations');
    expect(existsSync(state) ? readdirSync(state) : []).toContain('E-001-1.json');
  });

  it('request_escalation refuses what it cannot record', async () => {
    const call = (args: JsonObject) => tool('request_escalation').call(args);
    expect(await call({ reason: 'r' })).toEqual({ text: '"paths" must be a non-empty array of strings.', isError: true });
    expect(await call({ paths: ['a'], reason: ' ' })).toEqual({ text: '"reason" is required.', isError: true });
    expect(await call({ paths: ['a'] })).toEqual({ text: '"reason" is required.', isError: true });
    expect(await call({ paths: ['a'], reason: 'r', options: 'x' })).toEqual({ text: '"options" must be an array.', isError: true });
    expect(await call({ paths: ['a'], reason: 'r', recommendation: 3 })).toEqual({ text: '"recommendation" must be a string.', isError: true });
    expect((await call({ paths: ['a'], reason: 'r', why: 'x' })).isError).toBe(true);
  });

  it('audit_round reports the audit\'s findings and counts', async () => {
    const outcome = await tool('audit_round').call({});
    expect(outcome.text).toContain('warning unmeasured: the round\'s changes were not measured: main and HEAD are the same commit');
    expect(outcome.text).toMatch(/\n\n\d+ error\(s\), \d+ warning\(s\), \d+ note\(s\)$/);
    expect((outcome.structured as { counts: Record<string, number> }).counts.warning).toBeGreaterThanOrEqual(1);
    expect(await tool('audit_round').call({ base: 7 })).toEqual({ text: '"base" must be a string.', isError: true });
    const unbased = await tool('audit_round').call({ base: 'nowhere' });
    expect(unbased.text).toContain('"nowhere" names no commit');
  });

  it('list_rounds lists the live briefs and what each waits on', async () => {
    const outcome = await tool('list_rounds').call({});
    expect(outcome.text).toBe('001 001 - Rotate tokens - active, wave -, ready\n002 002 - Next - active, wave -, waits on 1');
    expect((outcome.structured as { briefs: { id: string }[] }).briefs.map((b) => b.id)).toEqual(['001', '002']);
    expect(await tool('list_rounds').call({ all: true })).toEqual({ text: 'Unknown argument "all"; this tool takes no arguments.', isError: true });
  });

  it('list_rounds says when there is no live brief', async () => {
    const empty = repository({ 'briefs/archive/001_x.md': brief({ status: 'archived' }) });
    const other = await openWorkspace(parseOptions(['mcp']), { stdout: { write: () => true }, stderr: { write: () => true }, cwd: empty.root, env: {} });
    const listed = tools(other, {}).find((t) => t.descriptor.name === 'list_rounds');
    expect(await listed?.call({})).toEqual({ text: 'No live brief.', structured: { briefs: [] } });
  });

  it('reads the brief SPEC_BRIEF names when the branch names none', async () => {
    const plain = repository({ [BRIEF_FILE]: brief() });
    const other = await openWorkspace(parseOptions(['mcp']), { stdout: { write: () => true }, stderr: { write: () => true }, cwd: plain.root, env: {} });
    const start = (env: Record<string, string>) => tools(other, env).find((t) => t.descriptor.name === 'start_round')?.call({});
    expect((await start({ SPEC_BRIEF: '1' }))?.structured).toMatchObject({ brief: '001' });
    expect((await start({}))?.text).toContain('no brief is named');
  });
});

describe('the prompts', () => {
  it('are the four skills, without their front matter, with the argument appended', async () => {
    const list = prompts();
    expect(list.map((p) => p.descriptor.name)).toEqual(['draft-brief', 'split-goal', 'run-round', 'close-round']);
    const run = list.find((p) => p.descriptor.name === 'run-round');
    const message = (await run?.get({ brief: '012' })) as { description: string; messages: { role: string; content: { type: string; text: string } }[] };
    expect(message.description).toBe('Run a round');
    expect(message.messages[0]?.role).toBe('user');
    const text = message.messages[0]?.content.text ?? '';
    expect(text.startsWith('# Run a round')).toBe(true);
    expect(text).not.toContain('name: run-round');
    expect(text.endsWith('\n\nbrief: 012')).toBe(true);
    const bare = (await run?.get({ brief: '' })) as { messages: { content: { text: string } }[] };
    expect(bare.messages[0]?.content.text.endsWith('brief: ')).toBe(false);
  });
});

describe('the server', () => {
  const handle = () => createMcpServer({ name: 'spec-harness', version: '0.1.0', instructions: INSTRUCTIONS, tools: tools(workspace, {}), prompts: prompts() });

  it('answers initialize with its instructions and capabilities', async () => {
    const answer = await handle()({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
    expect(answer).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: { protocolVersion: '2025-06-18', capabilities: { tools: {}, prompts: {} }, serverInfo: { name: 'spec-harness' }, instructions: INSTRUCTIONS },
    });
    expect(INSTRUCTIONS).toContain('start_round');
  });

  it('lists its tools, calls check_path and gets a prompt', async () => {
    const server = handle();
    const list = (await server({ jsonrpc: '2.0', id: 2, method: 'tools/list' })) as unknown as { result: { tools: { name: string }[] } };
    expect(list.result.tools.map((t) => t.name)).toContain('check_path');
    const call = (await server({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'check_path', arguments: { paths: ['src/db/schema.ts'] } } })) as unknown as {
      result: { content: { type: string; text: string }[]; structuredContent: { decisions: { verdict: string; reason: string }[] }; isError?: boolean };
    };
    expect(call.result.isError).toBeUndefined();
    expect(call.result.content[0]?.text.startsWith('deny: brief 001 does not empower')).toBe(true);
    expect(call.result.structuredContent.decisions[0]).toMatchObject({ verdict: 'deny', reason: 'protected' });
    const prompt = (await server({ jsonrpc: '2.0', id: 4, method: 'prompts/get', params: { name: 'close-round', arguments: { brief: '001' } } })) as unknown as {
      result: { messages: { content: { text: string } }[] };
    };
    expect(prompt.result.messages[0]?.content.text).toContain('brief: 001');
  });

  it('reports a failing tool to the model, not as a protocol error', async () => {
    const broken = await openWorkspace(parseOptions(['mcp']), { stdout: { write: () => true }, stderr: { write: () => true }, cwd: repo.root, env: {} });
    const server = createMcpServer({
      name: 'spec-harness',
      version: '0',
      instructions: '',
      tools: tools({ ...broken, siblings: { ...broken.siblings, briefs: async () => Promise.reject(new Error('spec-brief is gone')) } }, {}),
    });
    const answer = (await server({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'list_rounds', arguments: {} } })) as unknown as { result: { isError: boolean; content: { text: string }[] } };
    expect(answer.result).toMatchObject({ isError: true, content: [{ type: 'text', text: 'spec-harness failed: spec-brief is gone' }] });
  });
});

describe('over stdio, as a client runs it', () => {
  it('serves initialize, tools/list and a check_path call from the built command line', async () => {
    if (!existsSync(join(ROOT, 'dist', 'cli.js'))) throw new Error('dist/cli.js is missing: run "npm run build" before the suite');
    const child = spawn(process.execPath, [BIN, 'mcp'], { cwd: repo.root, env: { ...process.env, SPEC_BRIEF: '' }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    const messages = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'check_path', arguments: { paths: ['src/db/schema.ts', 'src/auth/x.ts'] } } },
    ];
    child.stdin.end(`${messages.map((m) => JSON.stringify(m)).join('\n')}\n`);
    const code = await new Promise<number | null>((resolve) => child.once('close', resolve));
    expect(stderr).toBe('');
    expect(code).toBe(0);
    const answers = stdout
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { id: number; result: Record<string, unknown> })
      .sort((a, b) => a.id - b.id);
    expect(answers.map((a) => a.id)).toEqual([1, 2, 3]);
    expect(answers[0]?.result).toMatchObject({ serverInfo: { name: 'spec-harness' }, instructions: INSTRUCTIONS });
    expect((answers[1]?.result['tools'] as { name: string }[]).map((t) => t.name)).toEqual(['start_round', 'check_path', 'request_escalation', 'audit_round', 'list_rounds']);
    const decisions = (answers[2]?.result['structuredContent'] as { decisions: { verdict: string }[] }).decisions;
    expect(decisions.map((d) => d.verdict)).toEqual(['deny', 'allow']);
  });
});
