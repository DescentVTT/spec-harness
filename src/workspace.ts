/**
 * What every command shares: exit codes, options, the repository a command
 * runs in, and which brief the round is working on.
 */

import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { findActive, type ActiveBrief } from './briefs.js';
import { briefIdFromBranch, ciBranch } from './branch.js';
import type { HarnessConfig } from './config.js';
import { loadConfig } from './fs.js';
import { commonDirectory, currentBranch, workTreeRoot } from './git.js';
import type { FindingFormat } from './formats.js';
import { createSiblings, type Siblings } from './siblings.js';
import type { BriefRow } from './types.js';

export const EXIT_OK = 0;
export const EXIT_FAILED = 1;
export const EXIT_ERROR = 2;

/** The version of the JSON documents this tool prints. Bumped when a field changes meaning. */
export const JSON_SCHEMA_VERSION = 1;

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

export interface CliIO {
  readonly stdout: { write(text: string): unknown };
  readonly stderr: { write(text: string): unknown };
  readonly stdin?: () => Promise<string>;
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
}

export function version(): string {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
  return manifest.version;
}

export interface Options {
  readonly command: string | undefined;
  readonly positionals: readonly string[];
  readonly brief: string | undefined;
  readonly base: string | undefined;
  readonly root: string | undefined;
  /** `gitlab`, `sarif` and `github` only for `audit` and `premises`, whose findings have places. */
  readonly format: 'pretty' | 'json' | FindingFormat;
  readonly strict: boolean;
  readonly help: boolean;
  readonly version: boolean;
  /** init: apply the plan instead of printing it. */
  readonly write: boolean;
  /** init: also install git's pre-commit hook. */
  readonly gitHook: boolean;
  /** escalate: the files the round needs, the reason, the options and the recommendation. */
  readonly paths: readonly string[];
  readonly reason: string | undefined;
  readonly options: readonly string[];
  readonly recommend: string | undefined;
  readonly list: boolean;
  readonly show: string | undefined;
  /** rule: the decision and what it allows. */
  readonly allow: boolean;
  readonly deny: boolean;
  readonly note: string | undefined;
  /** probe: which probe, and at which commit. */
  readonly id: string | undefined;
  readonly at: 'base' | 'head' | 'both' | undefined;
}

export function parseOptions(argv: readonly string[]): Options {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      strict: true,
      options: {
        brief: { type: 'string' },
        base: { type: 'string' },
        root: { type: 'string' },
        format: { type: 'string' },
        strict: { type: 'boolean' },
        write: { type: 'boolean' },
        'git-hook': { type: 'boolean' },
        path: { type: 'string', multiple: true },
        reason: { type: 'string' },
        option: { type: 'string', multiple: true },
        recommend: { type: 'string' },
        list: { type: 'boolean' },
        show: { type: 'string' },
        allow: { type: 'boolean' },
        deny: { type: 'boolean' },
        note: { type: 'string' },
        id: { type: 'string' },
        at: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
      },
    });
  } catch (error) {
    throw new UsageError((error as Error).message);
  }
  const { values, positionals } = parsed;
  const format = (values.format ?? 'pretty') as Options['format'];
  const formats: readonly Options['format'][] = ['pretty', 'json', 'gitlab', 'sarif', 'github'];
  if (!formats.includes(format)) throw new UsageError(`--format must be pretty, json, gitlab, sarif or github, not "${format}"`);
  const command = positionals[0];
  // Only the commands whose findings have places print them for a forge.
  if (command !== undefined && command !== 'audit' && command !== 'premises' && format !== 'pretty' && format !== 'json') {
    throw new UsageError(`--format ${format} is for audit and premises; ${command} prints pretty or json`);
  }
  const at = values.at;
  if (at !== undefined && at !== 'base' && at !== 'head' && at !== 'both') throw new UsageError(`--at must be base, head or both, not "${at}"`);
  return {
    command,
    positionals: positionals.slice(1),
    brief: values.brief,
    base: values.base,
    root: values.root,
    format,
    strict: values.strict === true,
    help: values.help === true,
    version: values.version === true,
    write: values.write === true,
    gitHook: values['git-hook'] === true,
    paths: values.path ?? [],
    reason: values.reason,
    options: values.option ?? [],
    recommend: values.recommend,
    list: values.list === true,
    show: values.show,
    allow: values.allow === true,
    deny: values.deny === true,
    note: values.note,
    id: values.id,
    at,
  };
}

/** Everything a command needs about the repository it runs in. */
export interface Workspace {
  readonly root: string;
  readonly commonDir: string;
  readonly config: HarnessConfig;
  readonly siblings: Siblings;
  /** The branch checked out, or on a detached head the one the forge's CI names; `null` when neither names one. */
  readonly branch: string | null;
  /** The CI variable that named the branch, on a detached head; absent when git named it. */
  readonly branchSource?: string | undefined;
  readonly cwd: string;
}

export async function openWorkspace(options: Options, io: CliIO): Promise<Workspace> {
  const cwd = options.root ?? io.cwd;
  const root = await workTreeRoot(cwd);
  if (root === null) throw new UsageError(`${cwd} is not inside a git work tree; spec-harness measures rounds by their commits`);
  const commonDir = (await commonDirectory(root)) ?? `${root}/.git`;
  const { config } = await loadConfig(root);
  // A branch checked out is the branch; only a head on none, as CI checks
  // out, asks the forge which branch the run builds.
  const checkedOut = await currentBranch(root);
  const ci = checkedOut === null ? ciBranch(io.env) : null;
  const named = ci === null ? { branch: checkedOut } : { branch: ci.branch, branchSource: ci.source };
  return { root, commonDir, config, siblings: createSiblings(root, config), ...named, cwd: io.cwd };
}

/** The id the flag, the environment or the branch names, without asking spec-brief anything. */
export function namedId(workspace: Workspace, options: Options, env: CliIO['env']): string | null {
  if (options.brief !== undefined && options.brief.trim() !== '') return options.brief.trim();
  const environment = env['SPEC_BRIEF'];
  if (environment !== undefined && environment.trim() !== '') return environment.trim();
  return workspace.branch === null ? null : briefIdFromBranch(workspace.config.branches, workspace.branch);
}

export async function activeBrief(workspace: Workspace, options: Options, env: CliIO['env']): Promise<ActiveBrief> {
  if (namedId(workspace, options, env) === null) {
    return findActive([], {});
  }
  const briefs = await workspace.siblings.briefs();
  const fromBranch = workspace.branch === null ? null : briefIdFromBranch(workspace.config.branches, workspace.branch);
  return findActive(briefs, { flag: options.brief, environment: env['SPEC_BRIEF'], branch: fromBranch });
}

export function describeActive(active: ActiveBrief): { brief: BriefRow | null; note: string | undefined; problem: string | null } {
  switch (active.kind) {
    case 'found':
      return { brief: active.brief, note: undefined, problem: null };
    case 'none':
      return { brief: null, note: active.reason, problem: null };
    case 'unknown':
      return { brief: null, note: undefined, problem: `the ${active.source} names brief ${active.id}, and spec-brief knows no such brief` };
    case 'archived':
      return {
        brief: null,
        note: undefined,
        problem: `the ${active.source} names brief ${active.brief.id}, which is archived; a closed round writes nothing`,
      };
  }
}

export function json(command: string, body: Record<string, unknown>): string {
  return `${JSON.stringify({ tool: 'spec-harness', version: version(), schemaVersion: JSON_SCHEMA_VERSION, command, ...body }, null, 2)}\n`;
}

