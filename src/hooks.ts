/**
 * The guard, spoken in the languages that ask it: an agent's pre- and
 * post-tool hooks, and git's pre-commit.
 *
 * Claude Code sends a hook one JSON object on stdin naming the tool and its
 * input. A file-editing tool names its file under `file_path`, `path` or
 * `notebook_path` depending on the tool and the release; all three are read,
 * because a guard that missed a renamed field would allow everything.
 *
 * What the answer may not do matters as much as what it does. Returning
 * `allow` from a pre-tool hook skips the person's own permission prompt, so
 * the guard never says `allow`: it says `deny`, or `ask`, or nothing. A
 * warning - a write outside the scope when the repository asked only to be
 * warned - is told to the model after the write, through the post-tool hook's
 * additional context, where it cannot unlock anything.
 */

import type { Decision } from './guard.js';

/** The tools whose input names a file they write. */
export const WRITING_TOOLS: readonly string[] = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'];

const PATH_FIELDS = ['file_path', 'path', 'notebook_path'] as const;

export interface HookRequest {
  readonly event: string;
  readonly tool: string;
  /** The session's working directory, when the hook says. */
  readonly cwd: string | null;
  /** Files the tool writes, as the tool named them - absolute, usually. */
  readonly paths: readonly string[];
}

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reads a Claude Code hook's stdin, or says why it cannot. */
export function parseClaudeHook(raw: string): HookRequest | { readonly error: string } {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { error: 'the hook input is not JSON' };
  }
  if (!isObject(value)) return { error: 'the hook input is not a JSON object' };
  const event = value['hook_event_name'];
  const tool = value['tool_name'];
  if (typeof event !== 'string' || typeof tool !== 'string') return { error: 'the hook input names no event or tool' };
  const input = isObject(value['tool_input']) ? value['tool_input'] : {};
  const paths: string[] = [];
  if (WRITING_TOOLS.includes(tool)) {
    for (const field of PATH_FIELDS) {
      const path = input[field];
      if (typeof path === 'string' && path !== '' && !paths.includes(path)) paths.push(path);
    }
  }
  const cwd = value['cwd'];
  return { event, tool, cwd: typeof cwd === 'string' ? cwd : null, paths };
}

export interface HookResponse {
  /** What to print on stdout: JSON, or nothing. */
  readonly stdout: string;
  readonly exitCode: number;
}

const NONE: HookResponse = { stdout: '', exitCode: 0 };

function reasonOf(decisions: readonly Decision[]): string {
  return decisions.map((decision) => `spec-harness: ${decision.message}. Next: ${decision.hint}.`).join('\n');
}

/**
 * The answer to a Claude Code hook: a refusal or a question before a write,
 * a warning after one, or nothing.
 */
export function claudeResponse(event: string, decisions: readonly Decision[]): HookResponse {
  if (event === 'PreToolUse') {
    const denied = decisions.filter((decision) => decision.verdict === 'deny');
    const asked = decisions.filter((decision) => decision.verdict === 'ask');
    const decided = denied.length > 0 ? { verdict: 'deny', list: denied } : asked.length > 0 ? { verdict: 'ask', list: asked } : null;
    if (decided === null) return NONE;
    return {
      stdout: `${JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: decided.verdict,
          permissionDecisionReason: reasonOf(decided.list),
        },
      })}\n`,
      exitCode: 0,
    };
  }
  if (event === 'PostToolUse') {
    const warned = decisions.filter((decision) => decision.verdict === 'warn');
    if (warned.length === 0) return NONE;
    return {
      stdout: `${JSON.stringify({
        hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: reasonOf(warned) },
      })}\n`,
      exitCode: 0,
    };
  }
  return NONE;
}

/**
 * The answer to git's pre-commit hook: every file the commit would change
 * that the round may not, and exit 1 if any is refused. A warning prints and
 * lets the commit through; a question has no one to ask in git, so it refuses.
 */
export function gitResponse(decisions: readonly Decision[]): { readonly text: string; readonly exitCode: number } {
  const lines: string[] = [];
  let refused = 0;
  for (const decision of decisions) {
    if (decision.verdict === 'allow') continue;
    const blocking = decision.verdict === 'deny' || decision.verdict === 'ask';
    if (blocking) refused += 1;
    lines.push(`${blocking ? 'refused' : 'warning'}  ${decision.message}`, `         ${decision.hint}`);
  }
  if (refused > 0) lines.push(`spec-harness: ${refused} file(s) this round may not change; the commit was stopped`);
  return { text: lines.length === 0 ? '' : `${lines.join('\n')}\n`, exitCode: refused > 0 ? 1 : 0 };
}
