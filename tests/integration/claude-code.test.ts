/**
 * The hooks and the MCP server as Claude Code starts them: the plugin's files
 * and those init writes, their placeholders substituted as Claude Code
 * substitutes them, started from a directory that is not the project - the
 * plugin's own, for a plugin's server, and wherever the session stands, for a
 * hook.
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { mergeClaudeSettings, mergeMcp } from '../../src/configure.js';
import { brief, BRIEF_FILE, cleanup, repository, ROOT, temp, write, type Repository } from './helpers.js';

afterAll(cleanup);

interface Command {
  readonly command: string;
  readonly args: readonly string[];
}

let repo: Repository;

beforeAll(() => {
  if (!existsSync(join(ROOT, 'dist', 'cli.js'))) throw new Error('dist/cli.js is missing: run "npm run build" before the suite');
  repo = repository({ [BRIEF_FILE]: brief({ affected: ['src/auth/**'], protected: ['src/db/**'] }), 'src/db/schema.ts': 'table;\n' });
  repo.git('checkout', '-q', '-b', 'brief/001-rotate');
  // The project's install of this package, where the configurations point: a
  // launcher for this checkout's command line.
  const installed = 'node_modules/@descent-vtt/spec-harness';
  write(repo.root, `${installed}/package.json`, `${JSON.stringify({ name: '@descent-vtt/spec-harness', type: 'module' })}\n`);
  write(repo.root, `${installed}/bin/spec-harness.js`, `await import(${JSON.stringify(pathToFileURL(join(ROOT, 'bin', 'spec-harness.js')).href)});\n`);
});

/** A command as Claude Code runs it: its placeholders substituted, `node` found on PATH. */
function substituted(entry: Command, project: string): Command {
  const expand = (value: string): string => value.split('${CLAUDE_PROJECT_DIR:-.}').join('.').split('${CLAUDE_PROJECT_DIR}').join(project);
  return { command: entry.command === 'node' ? process.execPath : expand(entry.command), args: entry.args.map(expand) };
}

/** The environment Claude Code gives a process, with or without the project named. */
function environment(project: string | null): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, SPEC_BRIEF: '' };
  delete env['CLAUDE_PROJECT_DIR'];
  if (project !== null) env['CLAUDE_PROJECT_DIR'] = project;
  return env;
}

function hookOf(settings: unknown): Command {
  return (settings as { hooks: { PreToolUse: { hooks: Command[] }[] } }).hooks.PreToolUse[0]?.hooks[0] as Command;
}

function serverOf(file: unknown): Command {
  return (file as { mcpServers: Record<string, Command> }).mcpServers['spec-harness'] as Command;
}

function runHook(hook: Command, cwd: string): { code: number | null; stdout: string; stderr: string } {
  const input = JSON.stringify({
    session_id: 's',
    cwd: repo.root,
    hook_event_name: 'PreToolUse',
    tool_name: 'Edit',
    tool_input: { file_path: join(repo.root, 'src', 'db', 'schema.ts'), old_string: 'a', new_string: 'b' },
  });
  const run = substituted(hook, repo.root);
  const result = spawnSync(run.command, [...run.args], { cwd, input, encoding: 'utf8', env: environment(repo.root) });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** Starts the server, asks check_path about a protected file, and returns what it answered. */
async function askServer(server: Command, cwd: string, env: NodeJS.ProcessEnv): Promise<{ text: string; stderr: string }> {
  const child = spawn(server.command, [...server.args], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
  const messages = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'check_path', arguments: { paths: ['src/db/schema.ts'] } } },
  ];
  child.stdin.end(`${messages.map((m) => JSON.stringify(m)).join('\n')}\n`);
  await new Promise((resolve) => child.once('close', resolve));
  const answer = stdout
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as { id: number; result?: { content?: { text: string }[] }; error?: unknown })
    .find((message) => message.id === 2);
  return { text: answer?.result?.content?.[0]?.text ?? JSON.stringify(answer), stderr };
}

const DENIED = 'deny: brief 001 does not empower this round to change src/db/schema.ts';

describe('the guard hook', () => {
  it('runs the project\'s install from wherever the session stands, as the plugin configures it', () => {
    const plugin = hookOf(JSON.parse(readFileSync(join(ROOT, 'hooks', 'hooks.json'), 'utf8')));
    const result = runHook(plugin, temp());
    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny' } });
  });

  it('does the same as init writes it into the project\'s settings', () => {
    const result = runHook(hookOf(mergeClaudeSettings({})), join(repo.root, 'src'));
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ hookSpecificOutput: { permissionDecision: 'deny' } });
  });
});

describe('the MCP server', () => {
  it('answers for the project from the plugin\'s directory, as the plugin configures it', async () => {
    const plugin = serverOf(JSON.parse(readFileSync(join(ROOT, '.mcp.json'), 'utf8')));
    // The plugin's arguments name the project; nothing else has to.
    const answer = await askServer(substituted(plugin, repo.root), temp(), environment(null));
    expect(answer.stderr).toBe('');
    expect(answer.text.startsWith(DENIED)).toBe(true);
  });

  it('answers for the project init registers it in, started there', async () => {
    const answer = await askServer(substituted(serverOf(mergeMcp({})), repo.root), repo.root, environment(repo.root));
    expect(answer.stderr).toBe('');
    expect(answer.text.startsWith(DENIED)).toBe(true);
  });

  it('reads the project from CLAUDE_PROJECT_DIR when no root is named', async () => {
    const answer = await askServer({ command: process.execPath, args: [join(ROOT, 'bin', 'spec-harness.js'), 'mcp'] }, temp(), environment(repo.root));
    expect(answer.stderr).toBe('');
    expect(answer.text.startsWith(DENIED)).toBe(true);
  });
});
