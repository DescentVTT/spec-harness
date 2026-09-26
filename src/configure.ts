/**
 * What `init` writes into each tool's configuration, and what `doctor` says
 * of the result.
 *
 * Pure: `setup.ts` and the command line read the files and ask git, and
 * write what these return, so the core sweep holds these to the unit suite.
 * Each merge keeps what a person wrote and returns `null` when there is
 * nothing to add.
 */

import { parseGlobList } from './vendor/spec-core/pattern/index.js';

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null;
}

function sameStrings(value: unknown, expected: readonly string[]): boolean {
  return Array.isArray(value) && value.length === expected.length && value.every((item, index) => item === expected[index]);
}

/**
 * The command line as the project installed it. Claude Code starts a plugin's
 * server in the plugin's own directory and a hook wherever the session
 * stands, so neither can rely on `npx` finding the project's install; and on
 * Windows a server's command is started without a shell, where `npx` is a
 * shim that cannot start at all. `node` and the script's path work
 * everywhere.
 */
const BIN = 'node_modules/@descent-vtt/spec-harness/bin/spec-harness.js';

/** The project root, as Claude Code substitutes it in a hook's arguments and in a plugin server's. */
export const PROJECT_DIR = '${CLAUDE_PROJECT_DIR}';

/**
 * The project root in a project's own `.mcp.json`. Claude Code expands it
 * there from its own environment, which does not hold it, so it needs a
 * default; `.` is right, since a project's server starts in the project.
 */
export const PROJECT_DIR_OR_HERE = '${CLAUDE_PROJECT_DIR:-.}';

const HOOK_MATCHER = 'Edit|Write|MultiEdit|NotebookEdit';
const GUARDED_EVENTS = ['PreToolUse', 'PostToolUse'];
const GUARD_ARGS: readonly string[] = Object.freeze([`${PROJECT_DIR}/${BIN}`, 'hook', 'claude']);

/**
 * The guard as a Claude Code hook: exec form, `args` given, so the project's
 * path is one argument whatever it holds, and no shell is involved.
 */
export const GUARD_HOOK: Readonly<Json> = Object.freeze({ type: 'command', command: 'node', args: GUARD_ARGS, timeout: 60 });

/** What 0.1 installed: an npx command, found from wherever the session stood. */
const LEGACY_HOOK = 'npx --no-install spec-harness hook claude';
const LEGACY_SERVER_ARGS = ['--no-install', 'spec-harness', 'mcp'];

function isGuard(hook: unknown): boolean {
  return isObject(hook) && hook['command'] === 'node' && sameStrings(hook['args'], GUARD_ARGS);
}

function isLegacyGuard(hook: unknown): boolean {
  return isObject(hook) && hook['command'] === LEGACY_HOOK;
}

function hooksOf(group: unknown): unknown[] {
  return isObject(group) && Array.isArray(group['hooks']) ? group['hooks'] : [];
}

/** A group with 0.1's guard replaced where it stands, keeping its other fields; the group itself when it has none. */
function upgraded(group: unknown): unknown {
  const hooks = hooksOf(group);
  if (!hooks.some(isLegacyGuard)) return group;
  return { ...(group as Json), hooks: hooks.map((hook) => (isLegacyGuard(hook) ? { ...(hook as Json), command: 'node', args: [...GUARD_ARGS] } : hook)) };
}

/** `.claude/settings.json`, or the plugin's hooks, with the guard hooks merged in; `null` when they are already there. */
export function mergeClaudeSettings(current: Json): Json | null {
  const hooks = isObject(current['hooks']) ? current['hooks'] : {};
  let changed = false;
  const next: Json = { ...hooks };
  for (const event of GUARDED_EVENTS) {
    const listed = hooks[event];
    const before: unknown[] = Array.isArray(listed) ? listed : [];
    const groups = before.map(upgraded);
    const replaced = groups.some((group, index) => group !== before[index]);
    const present = groups.some((group) => hooksOf(group).some(isGuard));
    if (!present) groups.push({ matcher: HOOK_MATCHER, hooks: [{ ...GUARD_HOOK, args: [...GUARD_ARGS] }] });
    if (replaced || !present) {
      next[event] = groups;
      changed = true;
    }
  }
  return changed ? { ...current, hooks: next } : null;
}

/** The server's entry, reading the project at `projectDir`: {@link PROJECT_DIR} for the plugin, {@link PROJECT_DIR_OR_HERE} for a project. */
export function mcpServer(projectDir: string): Json {
  return { command: 'node', args: [`${projectDir}/${BIN}`, 'mcp', '--root', projectDir] };
}

function isLegacyServer(server: unknown): boolean {
  return isObject(server) && server['command'] === 'npx' && sameStrings(server['args'], LEGACY_SERVER_ARGS);
}

/**
 * A project's `.mcp.json` with the harness's server merged in, or `null` when
 * one is registered. A server registered under the name some other way is
 * the person's, and stays; 0.1's npx entry is replaced, keeping its other
 * fields.
 */
export function mergeMcp(current: Json): Json | null {
  const servers = isObject(current['mcpServers']) ? current['mcpServers'] : {};
  const existing = servers['spec-harness'];
  if ('spec-harness' in servers && !isLegacyServer(existing)) return null;
  return { ...current, mcpServers: { ...servers, 'spec-harness': { ...(existing as Json | undefined), ...mcpServer(PROJECT_DIR_OR_HERE) } } };
}

/** The spec-brief plugin this package ships, as spec-brief's `plugins` names it. */
export const PLUGIN = '@descent-vtt/spec-harness/spec-brief-plugin';

/** spec-brief's configuration files, in the order spec-brief looks for them in a directory. */
export const SPEC_BRIEF_CONFIGS: readonly string[] = ['.spec-brief.json', 'spec-brief.json'];

/** Whether spec-brief's configuration loads the plugin, by name or as `{ module, options }`. */
export function loadsPlugin(config: Json): boolean {
  const plugins = config['plugins'];
  return Array.isArray(plugins) && plugins.some((entry) => entry === PLUGIN || (isObject(entry) && entry['module'] === PLUGIN));
}

/**
 * spec-brief's configuration with the plugin loaded, or `null` when it is.
 * spec-brief's archive refuses a round that changed a protected file, and
 * learns that a signed ruling allows it only by asking the plugin (ADR-0006).
 */
export function mergeSpecBrief(current: Json): Json | null {
  if (loadsPlugin(current)) return null;
  const plugins: unknown[] = Array.isArray(current['plugins']) ? current['plugins'] : [];
  return { ...current, plugins: [...plugins, PLUGIN] };
}

/** Whether spec-brief loads the plugin, as its configuration at the root says. */
export type PluginState =
  | { readonly kind: 'loaded' | 'not-loaded' | 'unreadable'; readonly file: string }
  | { readonly kind: 'unconfigured' };

/** What a person reads about the plugin, and what to do when it is not loaded. */
export function describePlugin(state: PluginState): string {
  switch (state.kind) {
    case 'loaded':
      return `spec-brief loads spec-harness's plugin (${state.file}): its archive accepts a protected file a signed ruling allows`;
    case 'not-loaded':
      return `spec-brief does not load spec-harness's plugin, so its archive refuses a protected file whatever ruling is signed: add "${PLUGIN}" to "plugins" in ${state.file}, or run spec-harness init --write`;
    case 'unreadable':
      return `${state.file} cannot be read as JSON, so whether spec-brief loads spec-harness's plugin is unknown`;
    case 'unconfigured':
      return "spec-brief has no configuration at the root, so it loads no plugin: spec-harness init --write writes one that loads spec-harness's";
  }
}

/** What git says that tells a base apart. */
export interface BaseFacts {
  /** The remote's default branch as a local ref, such as `origin/main`, or `null`. */
  readonly remoteDefault: string | null;
  /** The branch checked out, or `null` on a detached head. */
  readonly branch: string | null;
  /** Every local branch. */
  readonly branches: readonly string[];
}

/** The base `init` names, and why; `base` is `null` when none can be told. */
export interface BaseChoice {
  readonly base: string | null;
  readonly detail: string;
}

/**
 * The base `init` writes into `.spec-harness.json`. Every ruling is verified
 * against the allowed signers on it, so it is named rather than left to be
 * found. The remote's default branch comes first, but git records it when
 * it clones, and before 2.48 not on a fetch: a repository made with `git
 * init` and pushed to a remote often has none. There the branch init runs on
 * is the base when it is `main` or `master`, or the only branch; otherwise
 * the person names it.
 */
export function chooseBase(facts: BaseFacts): BaseChoice {
  const { remoteDefault, branch } = facts;
  if (remoteDefault !== null) return { base: remoteDefault, detail: `rounds are measured from ${remoteDefault}, the remote's default branch` };
  const unrecorded = 'no remote records a default branch (refs/remotes/origin/HEAD)';
  if (branch !== null) {
    const conventional = branch === 'main' || branch === 'master';
    if (conventional || facts.branches.every((name) => name === branch)) {
      const which = conventional ? 'the branch init runs on' : 'the only branch';
      return { base: branch, detail: `rounds are measured from ${branch}, ${which}: ${unrecorded}; change "base" if rounds merge into another` };
    }
  }
  const where = branch === null ? 'HEAD is detached' : `${branch} is not main, master or the only branch`;
  return {
    base: null,
    detail: `no base can be told: ${unrecorded}, and ${where}; set "base" to the branch rounds merge into, or run git remote set-head origin --auto and init again`,
  };
}

/** Where a base came from: `--base`, the configuration, or the remote. */
export type BaseSource = 'flag' | 'config' | 'remote';

const SOURCES: Readonly<Record<BaseSource, string>> = { flag: '--base', config: '.spec-harness.json', remote: "the remote's default branch" };

/** The base a command resolved, and how; or why there is none. */
export function describeBase(base: { readonly ref: string; readonly source: BaseSource; readonly mergeBase: string } | { readonly reason: string }): string {
  if ('reason' in base) return `none: ${base.reason}`;
  return `${base.ref} (${SOURCES[base.source]}), merge base ${base.mergeBase.slice(0, 12)}`;
}

/** Whether the allowed-signers file is on the base, where every ruling's signature is checked against it. */
export function describeSigners(file: string, base: string | null, onBase: boolean): string {
  if (base === null) return `${file}, read from the base, which could not be resolved: no ruling can count`;
  if (onBase) return `${file} is on ${base}`;
  return `${file} is not on ${base}, so no ruling can count: commit it there, one line per person, "<email> namespaces="git" <public key>"`;
}

/** spec-graph's configuration files, in the order spec-graph reads them; then a "spec-graph" key in package.json. */
export const SPEC_GRAPH_CONFIGS: readonly string[] = ['.spec-graph.json', 'spec-graph.config.json'];

/**
 * spec-graph's own patterns when its configuration names none, its
 * DEFAULT_PATTERNS as of 0.9.0. They decide only what init says, never what
 * it writes: `patterns` in the configuration replaces them, so writing the
 * briefs into it would freeze spec-graph's defaults into the file.
 */
const SPEC_GRAPH_DEFAULTS: readonly string[] = ['docs/**/*.md', 'doc/**/*.md', 'adr/**/*.md', 'rfcs/**/*.md', 'specs/**/*.md', '*.md'];

/** Whether spec-graph, configured as `config` says, reads the briefs in the directory `briefs`. */
export function graphReadsBriefs(config: Json, briefs: string): boolean {
  const configured = Array.isArray(config['patterns']) ? config['patterns'].filter((pattern): pattern is string => typeof pattern === 'string') : [];
  const list = parseGlobList(configured.length > 0 ? configured : SPEC_GRAPH_DEFAULTS, { dialect: 'path', caseSensitive: true, backslash: 'separator' });
  return list.ok && list.list.match(`${briefs}/001_brief.md`);
}

/**
 * What the history entry does. spec-graph reads a brief whose status says
 * `archived` as a record already; the entry makes one a record whatever word
 * its status uses, or none - and it does anything only where spec-graph
 * reads the briefs, which its defaults do not in `briefs/`.
 */
export function describeGraph(archiveGlob: string, briefs: string, reads: boolean, added: boolean): string {
  const history = added ? `read ${archiveGlob} as history` : `${archiveGlob} is history`;
  if (reads) return `${history}: an archived brief is a record whatever its status says, so a live brief that depends on one is not a stale premise`;
  return `${history}, for when spec-graph reads the briefs; its patterns do not reach ${briefs}/, so it checks none of them now: add "${briefs}/**/*.md" to its "patterns" if it should`;
}

/** spec-graph's configuration with the archive read as history, or `null` when it already is. */
export function mergeSpecGraph(current: Json, archiveGlob: string): Json | null {
  const history = Array.isArray(current['historyPatterns']) ? (current['historyPatterns'] as unknown[]).filter((p): p is string => typeof p === 'string') : [];
  if (history.includes(archiveGlob)) return null;
  return { ...current, historyPatterns: [...history, archiveGlob] };
}
