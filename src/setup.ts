/**
 * `spec-harness init`: the family configured to agree, from the first day.
 *
 * The integration faults found when the tools were first run together were all
 * configuration: spec-graph read an archived brief as a retired decision and
 * reported every brief that depended on one; spec-guard executed an archived
 * brief's assertions. Each tool can be told the truth; `init` tells each of
 * them the same truth, derived from spec-brief's own settings.
 *
 * It prints a plan and changes nothing until `--write`. It merges into files
 * that exist and never replaces what a person wrote; a git hook the
 * repository already has is left alone, with the line to add printed instead.
 */

import { existsSync } from 'node:fs';
import { chmod, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { CONFIG_FILE } from './config.js';
import { GUARD_HOOK, mergeClaudeSettings, mergeMcp, mergeSpecGraph } from './configure.js';
import { writeAtomic } from './fs.js';
import { git, remoteDefault } from './git.js';
import { runSibling } from './siblings.js';
import { EXIT_ERROR, EXIT_OK, json, openWorkspace, type CliIO, type Options, type Workspace } from './workspace.js';

export type Action = 'create' | 'update' | 'keep' | 'run' | 'advise';

export interface Step {
  readonly file: string;
  readonly action: Action;
  readonly detail: string;
  apply?: () => Promise<void>;
}

type Json = Record<string, unknown>;

async function readJson(file: string): Promise<Json | null | 'unreadable'> {
  if (!existsSync(file)) return null;
  try {
    const value = JSON.parse(await readFile(file, 'utf8')) as unknown;
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : 'unreadable';
  } catch {
    return 'unreadable';
  }
}

function stringify(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

const PRE_COMMIT = `#!/bin/sh
# spec-harness: refuse a commit that changes what the active brief protects.
exec npx --no-install spec-harness hook git
`;

export async function plan(workspace: Workspace, options: Options): Promise<Step[]> {
  const { root } = workspace;
  const steps: Step[] = [];

  // spec-brief first: every other setting is derived from its directories.
  const briefConfigFile = ['.spec-brief.json', 'spec-brief.json'].map((name) => join(root, name)).find((file) => existsSync(file));
  const brief = workspace.siblings.locate('spec-brief');
  let briefs = 'briefs';
  let archive = 'briefs/archive';
  if (briefConfigFile === undefined) {
    if (brief.kind === 'found') {
      const command = brief.command;
      steps.push({
        file: '.spec-brief.json',
        action: 'run',
        detail: 'spec-brief init: the brief and archive directories, every default spelled out',
        apply: async () => {
          const run = await runSibling(command, ['init'], root);
          if (run.code !== 0) throw new Error(`spec-brief init failed: ${run.stderr.trim()}`);
        },
      });
    } else {
      steps.push({ file: '.spec-brief.json', action: 'advise', detail: brief.reason });
    }
  } else {
    const config = await readJson(briefConfigFile);
    if (config !== null && config !== 'unreadable') {
      if (typeof config['briefs'] === 'string') briefs = config['briefs'];
      archive = typeof config['archive'] === 'string' ? config['archive'] : `${briefs}/archive`;
    }
    steps.push({ file: briefConfigFile.slice(root.length + 1), action: 'keep', detail: `briefs in ${briefs}/, the archive in ${archive}/` });
  }

  // spec-graph: an archived brief is a record, not a retired decision.
  const graphFile = join(root, '.spec-graph.json');
  const graph = workspace.siblings.locate('spec-graph');
  if (graph.kind === 'outdated') steps.push({ file: '.spec-graph.json', action: 'advise', detail: graph.reason });
  if (graph.kind === 'found') {
    const current = await readJson(graphFile);
    const archiveGlob = `${archive}/**`;
    if (current === 'unreadable') {
      steps.push({ file: '.spec-graph.json', action: 'advise', detail: 'cannot be read as JSON; add "historyPatterns": ["' + archiveGlob + '"] by hand' });
    } else {
      const merged = mergeSpecGraph(current ?? {}, archiveGlob);
      if (merged === null) steps.push({ file: '.spec-graph.json', action: 'keep', detail: `${archiveGlob} is already history` });
      else steps.push({ file: '.spec-graph.json', action: current === null ? 'create' : 'update', detail: `read ${archiveGlob} as history, so a brief that depends on an archived one is not a stale premise`, apply: () => writeAtomic(graphFile, stringify(merged)) });
    }
  }

  // spec-harness's own file, naming the base the rounds merge into.
  const harnessFile = join(root, CONFIG_FILE);
  if (!existsSync(harnessFile)) {
    const base = await remoteDefault(root);
    const content: Json = base === null ? {} : { base };
    steps.push({ file: CONFIG_FILE, action: 'create', detail: base === null ? 'the defaults' : `rounds are measured from ${base}`, apply: () => writeAtomic(harnessFile, stringify(content)) });
  } else {
    steps.push({ file: CONFIG_FILE, action: 'keep', detail: 'already configured' });
  }

  // The agent's hook and server.
  const settingsFile = join(root, '.claude', 'settings.json');
  const settings = await readJson(settingsFile);
  if (settings === 'unreadable') {
    steps.push({ file: '.claude/settings.json', action: 'advise', detail: `cannot be read as JSON; add the guard as a PreToolUse and a PostToolUse hook by hand: ${JSON.stringify(GUARD_HOOK)}` });
  } else {
    const merged = mergeClaudeSettings(settings ?? {});
    if (merged === null) steps.push({ file: '.claude/settings.json', action: 'keep', detail: 'the guard hooks are installed' });
    else
      steps.push({
        file: '.claude/settings.json',
        action: settings === null ? 'create' : 'update',
        detail: 'the guard hooks, run with node from the project\'s install: a PreToolUse hook refuses writes to protected files; a PostToolUse hook warns about writes outside the scope',
        apply: () => writeAtomic(settingsFile, stringify(merged)),
      });
  }
  const mcpFile = join(root, '.mcp.json');
  const mcp = await readJson(mcpFile);
  if (mcp === 'unreadable') {
    steps.push({ file: '.mcp.json', action: 'advise', detail: 'cannot be read as JSON; add the spec-harness server by hand' });
  } else {
    const merged = mergeMcp(mcp ?? {});
    if (merged === null) steps.push({ file: '.mcp.json', action: 'keep', detail: 'the spec-harness server is registered' });
    else
      steps.push({
        file: '.mcp.json',
        action: mcp === null ? 'create' : 'update',
        detail: 'the spec-harness MCP server, run with node from the project\'s install: start_round, check_path, request_escalation, audit_round, list_rounds',
        apply: () => writeAtomic(mcpFile, stringify(merged)),
      });
  }

  // git's hook, only when asked: it is configuration outside the tree.
  if (options.gitHook) {
    const hooksPath = (await git(['config', '--get', 'core.hooksPath'], root)).stdout.trim();
    const hookFile = hooksPath === '' ? join(workspace.commonDir, 'hooks', 'pre-commit') : join(root, hooksPath, 'pre-commit');
    if (existsSync(hookFile)) {
      const text = await readFile(hookFile, 'utf8');
      steps.push(
        text.includes('spec-harness')
          ? { file: hookFile, action: 'keep', detail: 'already runs spec-harness' }
          : { file: hookFile, action: 'advise', detail: 'a pre-commit hook exists; add the line "npx --no-install spec-harness hook git" to it' },
      );
    } else {
      steps.push({
        file: hookFile,
        action: 'create',
        detail: 'refuse a commit that changes what the active brief protects',
        apply: async () => {
          await mkdir(dirname(hookFile), { recursive: true });
          await writeAtomic(hookFile, PRE_COMMIT);
          await chmod(hookFile, 0o755);
        },
      });
    }
  }

  steps.push({
    file: '.github/allowed_signers',
    action: 'advise',
    detail:
      'rulings count only when signed by a key listed here on the base branch: one line per person, "<email> namespaces=\\"git\\" <public key>"; protect it, the ADRs and the tool configurations with CODEOWNERS',
  });
  return steps;
}

export async function initCommand(options: Options, io: CliIO): Promise<number> {
  const workspace = await openWorkspace(options, io);
  const steps = await plan(workspace, options);
  if (options.write) {
    for (const step of steps) {
      if (step.apply !== undefined) {
        try {
          await step.apply();
        } catch (error) {
          io.stderr.write(`spec-harness: ${step.file}: ${(error as Error).message}\n`);
          return EXIT_ERROR;
        }
      }
    }
  }
  if (options.format === 'json') {
    io.stdout.write(json('init', { written: options.write, steps: steps.map(({ file, action, detail }) => ({ file, action, detail })) }));
  } else {
    for (const step of steps) io.stdout.write(`${step.action.padEnd(6)}  ${step.file}\n        ${step.detail}\n`);
    if (!options.write && steps.some((step) => step.apply !== undefined)) io.stdout.write('\nNothing was changed. Run again with --write to apply the plan.\n');
  }
  return EXIT_OK;
}
