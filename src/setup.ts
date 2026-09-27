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
import {
  chooseBase,
  describeGraph,
  describeSkipped,
  enabledPlugin,
  graphReadsBriefs,
  GUARD_HOOK,
  holdsGuard,
  loadsPlugin,
  measuresArchive,
  mergeClaudeSettings,
  mergeMcp,
  mergeSpecBrief,
  mergeSpecGraph,
  PLUGIN,
  registersServer,
  SPEC_BRIEF_CONFIGS,
  SPEC_GRAPH_CONFIGS,
} from './configure.js';
import { readJsonObject as readJson, writeAtomic } from './fs.js';
import { git, localBranches, remoteDefault } from './git.js';
import { claudeSettings } from './round.js';
import { runSibling } from './siblings.js';
import { EXIT_ERROR, EXIT_OK, json, openWorkspace, type CliIO, type Options, type Workspace } from './workspace.js';

/** `skip`: a file init would write, left alone because Claude Code's plugin brings what init would add. */
export type Action = 'create' | 'update' | 'keep' | 'skip' | 'run' | 'advise';

export interface Step {
  readonly file: string;
  readonly action: Action;
  readonly detail: string;
  apply?: () => Promise<void>;
}

type Json = Record<string, unknown>;

function stringify(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

const PLUGIN_DETAIL = `load spec-harness's plugin, "${PLUGIN}": spec-brief's archive asks it whether a signed ruling allows a protected file, and refuses the file without it`;

/** What init adds to spec-brief's configuration, said once for the plan. */
function specBriefDetail(plugin: boolean, base: string | null): string {
  const parts = plugin ? [PLUGIN_DETAIL] : [];
  if (base !== null) parts.push(`measure the archive from ${base}, as spec-harness does: without a base, spec-brief's archive warns that the scope went unmeasured and checks no protected file`);
  return parts.join('; ');
}

const PRE_COMMIT = `#!/bin/sh
# spec-harness: refuse a commit that changes what the active brief protects.
exec npx --no-install spec-harness hook git
`;

export async function plan(workspace: Workspace, options: Options, env: CliIO['env']): Promise<Step[]> {
  const { root } = workspace;
  const steps: Step[] = [];

  // The base rounds merge into, decided once: spec-harness verifies rulings
  // against the allowed signers on it, and spec-brief's archive measures the
  // round from it. A base a person wrote, in either file, is kept.
  const harnessFile = join(root, CONFIG_FILE);
  const harness = await readJson(harnessFile);
  const namedBase = harness !== null && harness !== 'unreadable' && typeof harness['base'] === 'string' ? harness['base'] : null;
  const choice =
    harness === 'unreadable' || namedBase !== null
      ? null
      : chooseBase({ remoteDefault: await remoteDefault(root), branch: workspace.branch, branches: await localBranches(root) });
  const base = namedBase ?? choice?.base ?? null;

  // spec-brief first: every other setting is derived from its directories.
  const briefConfig = SPEC_BRIEF_CONFIGS.find((name) => existsSync(join(root, name)));
  const brief = workspace.siblings.locate('spec-brief');
  let briefs = 'briefs';
  let archive = 'briefs/archive';
  if (briefConfig === undefined) {
    if (brief.kind === 'found') {
      const command = brief.command;
      const created = join(root, '.spec-brief.json');
      steps.push({
        file: '.spec-brief.json',
        action: 'run',
        detail: 'spec-brief init: the brief and archive directories, every default spelled out',
        apply: async () => {
          const run = await runSibling(command, ['init'], root);
          if (run.code !== 0) throw new Error(`spec-brief init failed: ${run.stderr.trim()}`);
        },
      });
      steps.push({
        file: '.spec-brief.json',
        action: 'update',
        detail: specBriefDetail(true, base),
        apply: async () => {
          const written = await readJson(created);
          if (written === null || written === 'unreadable') throw new Error('spec-brief init wrote no configuration JSON can read');
          const merged = mergeSpecBrief(written, base);
          if (merged !== null) await writeAtomic(created, stringify(merged));
        },
      });
    } else {
      steps.push({ file: '.spec-brief.json', action: 'advise', detail: brief.reason });
    }
  } else {
    const file = join(root, briefConfig);
    const config = await readJson(file);
    if (config !== null && config !== 'unreadable') {
      if (typeof config['briefs'] === 'string') briefs = config['briefs'];
      archive = typeof config['archive'] === 'string' ? config['archive'] : `${briefs}/archive`;
    }
    steps.push({ file: briefConfig, action: 'keep', detail: `briefs in ${briefs}/, the archive in ${archive}/` });
    // spec-brief's archive learns that a signed ruling allows a protected file
    // only from this package's plugin (ADR-0006).
    if (config === 'unreadable' || config === null) {
      const measure = base === null ? '' : `, and "archiving": { "base": "${base}" }`;
      steps.push({ file: briefConfig, action: 'advise', detail: `cannot be read as JSON; add "plugins": ["${PLUGIN}"]${measure} by hand` });
    } else {
      const merged = mergeSpecBrief(config, base);
      const measured = measuresArchive(config);
      if (merged === null) {
        const from = measured ? `, and the archive is measured from ${String((config['archiving'] as Json)['base'])}` : '';
        steps.push({ file: briefConfig, action: 'keep', detail: `spec-harness's plugin is loaded${from}` });
      } else {
        const detail = specBriefDetail(!loadsPlugin(config), measured ? null : base);
        steps.push({ file: briefConfig, action: 'update', detail, apply: () => writeAtomic(file, stringify(merged)) });
      }
    }
  }

  // spec-graph: an archived brief is a record, not a retired decision. Its
  // configuration is the first of its files, then a key in package.json; a
  // file written beside that key would shadow it.
  const graph = workspace.siblings.locate('spec-graph');
  if (graph.kind === 'outdated') steps.push({ file: '.spec-graph.json', action: 'advise', detail: graph.reason });
  if (graph.kind === 'found') {
    const archiveGlob = `${archive}/**`;
    const graphName = SPEC_GRAPH_CONFIGS.find((name) => existsSync(join(root, name)));
    const manifest = graphName === undefined ? await readJson(join(root, 'package.json')) : null;
    if (manifest !== null && manifest !== 'unreadable' && 'spec-graph' in manifest) {
      steps.push({ file: 'package.json', action: 'advise', detail: `spec-graph reads its configuration from the "spec-graph" key here, which init does not edit: add "${archiveGlob}" to its "historyPatterns" by hand` });
    } else {
      const file = graphName ?? '.spec-graph.json';
      const current = await readJson(join(root, file));
      if (current === 'unreadable') {
        steps.push({ file, action: 'advise', detail: `cannot be read as JSON; add "historyPatterns": ["${archiveGlob}"] by hand` });
      } else {
        const merged = mergeSpecGraph(current ?? {}, archiveGlob);
        const detail = describeGraph(archiveGlob, briefs, graphReadsBriefs(current ?? {}, briefs), merged !== null);
        if (merged === null) steps.push({ file, action: 'keep', detail });
        else steps.push({ file, action: current === null ? 'create' : 'update', detail, apply: () => writeAtomic(join(root, file), stringify(merged)) });
      }
    }
  }

  // spec-harness's own file, naming the base the rounds merge into: every
  // ruling is verified against the allowed signers on it.
  if (harness === 'unreadable') {
    steps.push({ file: CONFIG_FILE, action: 'advise', detail: 'cannot be read as JSON; name the base rounds merge into as "base" by hand' });
  } else if (namedBase !== null) {
    steps.push({ file: CONFIG_FILE, action: 'keep', detail: `rounds are measured from ${namedBase}` });
  } else if (base === null || choice === null) {
    steps.push({ file: CONFIG_FILE, action: 'advise', detail: choice?.detail ?? 'name the base rounds merge into as "base"' });
  } else {
    const content: Json = { ...harness, base };
    steps.push({ file: CONFIG_FILE, action: harness === null ? 'create' : 'update', detail: choice.detail, apply: () => writeAtomic(harnessFile, stringify(content)) });
  }

  // The agent's hooks and server, unless the plugin brings them: Claude Code
  // runs a plugin's hook beside the same hook in settings, so both would
  // guard every write twice (ADR-0012).
  const plugin = enabledPlugin(await claudeSettings(root, env));
  const settingsFile = join(root, '.claude', 'settings.json');
  const settings = await readJson(settingsFile);
  if (plugin !== null) {
    const present = holdsGuard(settings);
    steps.push({ file: '.claude/settings.json', action: present ? 'advise' : 'skip', detail: describeSkipped(plugin, 'hooks', present) });
  } else if (settings === 'unreadable') {
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
  if (plugin !== null) {
    const present = registersServer(mcp);
    steps.push({ file: '.mcp.json', action: present ? 'advise' : 'skip', detail: describeSkipped(plugin, 'server', present) });
  } else if (mcp === 'unreadable') {
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
      'rulings count only when signed by a key listed here on the base branch: one line per person, <email> namespaces="git" <public key>; protect it, the ADRs and the tool configurations with CODEOWNERS',
  });
  return steps;
}

export async function initCommand(options: Options, io: CliIO): Promise<number> {
  const workspace = await openWorkspace(options, io);
  const steps = await plan(workspace, options, io.env);
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
