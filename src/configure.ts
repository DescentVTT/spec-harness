/**
 * What `init` writes into each tool's configuration.
 *
 * Pure: `setup.ts` reads the files and asks git, and writes what these
 * return, so the core sweep holds these to the unit suite. Each merge keeps
 * what a person wrote and returns `null` when there is nothing to add.
 */

type Json = Record<string, unknown>;

export const HOOK_COMMAND = 'npx --no-install spec-harness hook claude';
const HOOK_MATCHER = 'Edit|Write|MultiEdit|NotebookEdit';

/** `.claude/settings.json` with the guard hooks merged in, or `null` when they are already there. */
export function mergeClaudeSettings(current: Json): Json | null {
  const hooks = (typeof current['hooks'] === 'object' && current['hooks'] !== null ? current['hooks'] : {}) as Json;
  let changed = false;
  const next: Json = { ...hooks };
  for (const event of ['PreToolUse', 'PostToolUse']) {
    const groups = Array.isArray(hooks[event]) ? [...(hooks[event] as Json[])] : [];
    const present = groups.some((group) => Array.isArray(group['hooks']) && (group['hooks'] as Json[]).some((hook) => hook['command'] === HOOK_COMMAND));
    if (present) continue;
    groups.push({ matcher: HOOK_MATCHER, hooks: [{ type: 'command', command: HOOK_COMMAND, timeout: 60 }] });
    next[event] = groups;
    changed = true;
  }
  return changed ? { ...current, hooks: next } : null;
}

/** `.mcp.json` with the harness's server merged in, or `null` when it is already there. */
export function mergeMcp(current: Json): Json | null {
  const servers = (typeof current['mcpServers'] === 'object' && current['mcpServers'] !== null ? current['mcpServers'] : {}) as Json;
  if ('spec-harness' in servers) return null;
  return { ...current, mcpServers: { ...servers, 'spec-harness': { command: 'npx', args: ['--no-install', 'spec-harness', 'mcp'] } } };
}

/** spec-graph's configuration with the archive read as history, or `null` when it already is. */
export function mergeSpecGraph(current: Json, archiveGlob: string): Json | null {
  const history = Array.isArray(current['historyPatterns']) ? (current['historyPatterns'] as unknown[]).filter((p): p is string => typeof p === 'string') : [];
  if (history.includes(archiveGlob)) return null;
  return { ...current, historyPatterns: [...history, archiveGlob] };
}
