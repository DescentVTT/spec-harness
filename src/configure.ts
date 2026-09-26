/**
 * What `init` writes into each tool's configuration.
 *
 * Pure: `setup.ts` reads the files and asks git, and writes what these
 * return, so the core sweep holds these to the unit suite. Each merge keeps
 * what a person wrote and returns `null` when there is nothing to add.
 */

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

/** spec-graph's configuration with the archive read as history, or `null` when it already is. */
export function mergeSpecGraph(current: Json, archiveGlob: string): Json | null {
  const history = Array.isArray(current['historyPatterns']) ? (current['historyPatterns'] as unknown[]).filter((p): p is string => typeof p === 'string') : [];
  if (history.includes(archiveGlob)) return null;
  return { ...current, historyPatterns: [...history, archiveGlob] };
}
