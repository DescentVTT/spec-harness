/**
 * What `init` writes into each tool's configuration, and what `doctor` says
 * of the result.
 *
 * Pure: `setup.ts` and the command line read the files and ask git, and
 * write what these return, so the core sweep holds these to the unit suite.
 * Each merge keeps what a person wrote and returns `null` when there is
 * nothing to add.
 */

import { isAbsolute } from 'node:path';

import type { AllowedSigner } from './signers.js';
import { parseGlobList } from './vendor/spec-core/pattern/index.js';
import { CLAUDE_CODE_MINIMUM, type ClaudeCodeCheck } from './versions.js';

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

/** A key of a file read as JSON; a file that is missing, or is not a JSON object, holds nothing. */
function field(file: unknown, key: string): unknown {
  return isObject(file) ? file[key] : undefined;
}

/** Whether Claude Code settings hold the guard hooks, as this release or 0.1 wrote them. */
export function holdsGuard(settings: unknown): boolean {
  const hooks = field(settings, 'hooks');
  if (!isObject(hooks)) return false;
  return GUARDED_EVENTS.some((event) => {
    const groups = hooks[event];
    return Array.isArray(groups) && groups.some((group) => hooksOf(group).some((hook) => isGuard(hook) || isLegacyGuard(hook)));
  });
}

/** Whether a project's `.mcp.json` registers a server under the harness's name, however it runs it. */
export function registersServer(mcp: unknown): boolean {
  const servers = field(mcp, 'mcpServers');
  return isObject(servers) && 'spec-harness' in servers;
}

/** A Claude Code settings file, named as a person finds it, and what reading it gave: an object, or nothing usable. */
export interface ClaudeSettings {
  readonly file: string;
  readonly settings: unknown;
}

/** The plugin's id in `enabledPlugins`, and the settings file that turns it on. */
export interface EnabledPlugin {
  readonly id: string;
  readonly file: string;
}

/** `enabledPlugins` keys a plugin `<name>@<marketplace>`; this repository's marketplace lists the plugin as `spec-harness`. */
const PLUGIN_ID = /^spec-harness@[^@]+$/;

/**
 * Whether Claude Code runs this package's plugin, from its settings files
 * given lowest precedence first: user, project, local. Claude Code merges
 * `enabledPlugins` key by key, so for each id the last file that sets it to
 * `true` or `false` decides. A plugin named `spec-harness` counts from any
 * marketplace, since another can list this repository. `null` when no file
 * turns it on.
 */
export function enabledPlugin(sources: readonly ClaudeSettings[]): EnabledPlugin | null {
  const decided = new Map<string, EnabledPlugin | null>();
  for (const { file, settings } of sources) {
    const plugins = field(settings, 'enabledPlugins');
    if (!isObject(plugins)) continue;
    for (const [id, on] of Object.entries(plugins)) {
      if (PLUGIN_ID.test(id) && typeof on === 'boolean') decided.set(id, on ? { id, file } : null);
    }
  }
  return [...decided.values()].find((entry) => entry !== null) ?? null;
}

/** Where the plugin is on, as a person would look it up. */
function isOn(plugin: EnabledPlugin): string {
  return `the spec-harness plugin is on (${plugin.id} in ${plugin.file})`;
}

/** How to have init's entries in place of the plugin's, for this project alone. */
function turnOff(plugin: EnabledPlugin): string {
  return `turn the plugin off for this project with claude plugin disable ${plugin.id} --scope local`;
}

const PARTS = {
  hooks: { brings: 'the guard hooks', twice: 'every write is guarded twice', skipped: 'init writes none', entry: "spec-harness's hooks", them: 'them' },
  server: { brings: 'the server', twice: 'the server is registered twice', skipped: 'init registers none', entry: 'the spec-harness server', them: 'it' },
} as const;

/**
 * What init says of a Claude Code file it leaves alone because the plugin is
 * on and brings the same `part`. A file that holds init's entry already is a
 * double install for the person to settle: init removes nothing, since the
 * file is the repository's and a clone without the plugin relies on it.
 */
export function describeSkipped(plugin: EnabledPlugin, part: 'hooks' | 'server', present: boolean): string {
  const words = PARTS[part];
  if (present) return `${isOn(plugin)} and brings ${words.brings} this file holds as well, so ${words.twice}: take ${words.entry} out of this file, or ${turnOff(plugin)}`;
  return `${isOn(plugin)} and brings ${words.brings}, so ${words.skipped}: with both, ${words.twice}. To have ${words.them} here instead, for every clone of the repository, ${turnOff(plugin)} and run init again`;
}

/** How Claude Code is wired to the harness: the plugin, init's entries, both or neither. */
export interface ClaudeCodeWiring {
  readonly plugin: EnabledPlugin | null;
  /** The settings files that hold the guard hooks. */
  readonly hooks: readonly string[];
  /** Whether `.mcp.json` registers the server. */
  readonly server: boolean;
}

export type WiringState = 'plugin' | 'init' | 'both' | 'none';

/** Which of the four the wiring is. `both` is a double install, and doctor fails it; either of init's entries counts. */
export function wiringState(wiring: ClaudeCodeWiring): WiringState {
  const init = wiring.hooks.length > 0 || wiring.server;
  if (wiring.plugin === null) return init ? 'init' : 'none';
  return init ? 'both' : 'plugin';
}

/** What `doctor` says of the wiring, and what to do when it is doubled or missing. */
export function describeClaudeCode(wiring: ClaudeCodeWiring): string {
  const { plugin } = wiring;
  const entries = [...wiring.hooks.map((file) => `the guard hooks in ${file}`), ...(wiring.server ? ['the server in .mcp.json'] : [])].join(', ');
  if (plugin === null) {
    if (entries === '') return 'neither the spec-harness plugin nor the hooks init writes, so Claude Code guards no write: run spec-harness init --write, or install the plugin';
    return `init's entries: ${entries}`;
  }
  if (entries === '') return `${isOn(plugin)} and brings the guard hooks and the server`;
  const twice = [...(wiring.hooks.length > 0 ? [PARTS.hooks.twice] : []), ...(wiring.server ? [PARTS.server.twice] : [])].join(' and ');
  return `${isOn(plugin)}, beside ${entries}: ${twice}. Keep one: take spec-harness's entries out of those files, or ${turnOff(plugin)}`;
}

/** The spec-brief plugin this package ships, as spec-brief's `plugins` names it. */
export const PLUGIN = '@descent-vtt/spec-harness/spec-brief-plugin';

/** spec-brief's configuration files, in the order spec-brief looks for them in a directory. */
export const SPEC_BRIEF_CONFIGS: readonly string[] = ['.spec-brief.json', 'spec-brief.json'];

/** The conditions an import meets in Node, its `defaultConditions`, and `default`, which every one meets. */
const IMPORT_CONDITIONS: readonly string[] = ['node', 'import', 'default'];

/** A target Node refuses as invalid, which an array passes over and anything else stops at. */
const INVALID = Symbol('invalid target');

function resolveTarget(target: unknown): string | null | undefined | typeof INVALID {
  if (typeof target === 'string') return target.startsWith('./') ? target : INVALID;
  if (Array.isArray(target)) {
    for (const item of target) {
      const resolved = resolveTarget(item);
      if (resolved !== undefined && resolved !== INVALID) return resolved;
    }
    return null;
  }
  if (typeof target !== 'object' || target === null) return target === null ? null : INVALID;
  for (const [condition, value] of Object.entries(target)) {
    if (!IMPORT_CONDITIONS.includes(condition)) continue;
    const resolved = resolveTarget(value);
    if (resolved !== undefined) return resolved;
  }
  return undefined;
}

/**
 * The file a package's `exports` target names for an import, as Node's
 * PACKAGE_TARGET_RESOLVE finds it, or `null` when it names none: a string
 * that starts with `./`; in an object, the target of the first key, in the
 * object's own order, that an import meets - `node`, `import` or
 * `default` - and that resolves to anything, a `null` included; in an
 * array, the first item that resolves, one Node refuses passed over. A
 * `null` target is not exported, and ends the search there, where a
 * condition an import does not meet lets it go on.
 */
export function exportedFile(target: unknown): string | null {
  const resolved = resolveTarget(target);
  return typeof resolved === 'string' ? resolved : null;
}

/**
 * Whether spec-brief's configuration loads the plugin, by name or as
 * `{ module, options }`. spec-brief also loads a plugin by a path, one that
 * starts with `.` or is absolute, read from the root; such a path is the
 * plugin when `isPluginFile` says it names the plugin's file, which only the
 * disk can tell. Without one, no path is: the default's `false` and an
 * `undefined` read the same in `some`, so that mutant is equivalent.
 */
export function loadsPlugin(config: Json, isPluginFile: (path: string) => boolean = () => false): boolean {
  const plugins = config['plugins'];
  const names = (specifier: unknown): boolean =>
    specifier === PLUGIN || (typeof specifier === 'string' && (specifier.startsWith('.') || isAbsolute(specifier)) && isPluginFile(specifier));
  return Array.isArray(plugins) && plugins.some((entry) => names(entry) || (isObject(entry) && names(entry['module'])));
}

/** Whether spec-brief's configuration names the base its archive measures a round from. */
export function measuresArchive(config: Json): boolean {
  const archiving = config['archiving'];
  return isObject(archiving) && typeof archiving['base'] === 'string';
}

/**
 * spec-brief's configuration with the plugin loaded and the archive measured
 * from `base`, or `null` when both already hold. spec-brief's archive
 * refuses a round that changed a protected file, and learns that a signed
 * ruling allows it only by asking the plugin (ADR-0006). It checks the file at
 * all only when it knows the base: without one it warns that the scope went
 * unmeasured and passes, so the gate is open until a base is named. A base a
 * person wrote is kept.
 */
export function mergeSpecBrief(current: Json, base: string | null = null, isPluginFile?: (path: string) => boolean): Json | null {
  const plugin = loadsPlugin(current, isPluginFile);
  const measure = base !== null && !measuresArchive(current);
  if (plugin && !measure) return null;
  const plugins: unknown[] = Array.isArray(current['plugins']) ? current['plugins'] : [];
  const archiving: Json = isObject(current['archiving']) ? current['archiving'] : {};
  return {
    ...current,
    ...(plugin ? {} : { plugins: [...plugins, PLUGIN] }),
    ...(measure ? { archiving: { ...archiving, base } } : {}),
  };
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
  return `${file} is not on ${base}, so no ruling can count: commit it there, one line per person: <email> namespaces="git" <public key>`;
}

/**
 * The note doctor gives on the signers whose key is not FIDO2, or `null`
 * when every one's is. A note, never a failure: ADR-0006 accepts a key the
 * agent's account cannot read too, and a PIV or PKCS#11 hardware key is
 * written as a plain key.
 */
export function describeSignerKeys(signers: readonly Pick<AllowedSigner, 'line' | 'principals' | 'keyType'>[]): string | null {
  if (signers.length === 0) return null;
  const named = signers.map((signer) => `${signer.principals.join(',')} (${signer.keyType}, line ${signer.line})`).join(', ');
  return (
    `note: signers whose key is not a FIDO2 key: ${named}. ` +
    "Where an agent runs as the person, ADR-0006 recommends a FIDO2 key, ssh-keygen -t ed25519-sk, whose signature needs a touch no process can supply, or a key the agent's account cannot read; " +
    'a PIV or PKCS#11 hardware key reads as a plain ssh-rsa or ecdsa line, so this is a note, not a failure'
  );
}

/** The note doctor gives on a line of the allowed-signers file that is not a signer. */
export function describeSignerProblem(problem: { readonly line: number; readonly message: string }): string {
  return `note: line ${problem.line} is not a signer: ${problem.message}`;
}

/** What doctor says of the Claude Code on `PATH`, which runs the guard's hooks only from the minimum on. */
export function describeClaudeRelease(check: ClaudeCodeCheck): string {
  // A version read from a package.json says so: nothing ran to tell it.
  const release = (found: { readonly version: string; readonly file?: string }): string =>
    `Claude Code ${found.version}${found.file === undefined ? '' : ` (as ${found.file} declares)`}`;
  switch (check.state) {
    case 'ok':
      return `${release(check)} runs the hooks, which need ${CLAUDE_CODE_MINIMUM} or later`;
    case 'outdated':
      return `${release(check)} is older than ${CLAUDE_CODE_MINIMUM}, which the hooks need: it ignores a hook's args and runs a bare node, which fails, and a PreToolUse hook that fails blocks nothing, so every write passes unguarded: update Claude Code, with claude update`;
    case 'unknown':
      return `whether Claude Code is ${CLAUDE_CODE_MINIMUM} or later, which the hooks need, cannot be told: ${check.reason}; an older release lets every write pass unguarded, so check claude --version where Claude Code runs`;
  }
}

/** Where git's pre-commit hook stands: git's path for it, shown from the root, and what is there. */
export type GitHookState =
  | { readonly state: 'runs' | 'absent' | 'other' | 'inert'; readonly file: string }
  | { readonly state: 'unknown'; readonly reason: string };

/**
 * The advice for a missing hook, which init gives beside the file and doctor
 * with it. The hook is the guard for a write the agent's hooks never see,
 * one made through a shell (ADR-0005).
 */
export function missingGitHook(file: string | null): string {
  const where = file === null ? '' : ` (${file})`;
  return `no pre-commit hook runs spec-harness${where}: one refuses a commit that changes what the active brief protects, for any agent or none, a shell's writes included; run spec-harness init --git-hook --write to add it`;
}

/**
 * How to keep the files the rules live in from changing unread, on each
 * forge, as spec-core's ADR-0005 asks: the forge protects them, and CI checks
 * a change against the base branch's rules. GitLab Free has no Code Owners
 * approval, so there the person who merges is the reviewer.
 */
export const PROTECT_RULE_FILES =
  "Have the forge protect this file, the ADRs, the tool configurations and the CI configuration, so no change to them reaches the base branch without a person, and check each change in CI against the base branch's rules: " +
  'on GitHub, CODEOWNERS and a protected branch; on GitLab Premium, Code Owners; on GitLab Free, a protected branch no one pushes to, merged by Maintainers, agents as Developers, and pipelines that must succeed. ' +
  "spec-core's docs/adopting.md has the settings";

/** The line to add to a hook the repository has of its own. */
export const GIT_HOOK_LINE = 'npx --no-install spec-harness hook git';

/** What doctor says of git's pre-commit hook. */
export function describeGitHook(hook: GitHookState): string {
  switch (hook.state) {
    case 'runs':
      return `${hook.file} runs spec-harness`;
    case 'inert':
      return `${hook.file} runs spec-harness, but is not executable, so git skips it: chmod +x ${hook.file}`;
    case 'other':
      return `${hook.file} does not run spec-harness: add the line "${GIT_HOOK_LINE}" to it`;
    case 'absent':
      return missingGitHook(hook.file);
    case 'unknown':
      return `where git runs its hooks cannot be told: ${hook.reason}`;
  }
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
