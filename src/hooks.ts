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

/**
 * The tools whose input names a file they write, by every name a release of
 * Claude Code has had for one. The hook reads a path from each: a name more
 * costs nothing, and a Claude Code that still has the tool may send it.
 */
export const WRITING_TOOLS: readonly string[] = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'];

/**
 * Those of them a Claude Code the harness runs under can call
 * (`CLAUDE_CODE_MINIMUM`, versions.ts). Its tools reference
 * (https://code.claude.com/docs/en/tools-reference, read 2026-10-12) has
 * `Edit`, `Write` and `NotebookEdit` in its table of tools, and no
 * `MultiEdit`, which its permissions page calls a legacy tool; and the tool
 * inputs each release declares hold a `MultiEdit` up to 1.0.128 and none
 * from 2.0.0 on (ADR-0005). So what doctor and init say of the writes a
 * line is started for names these alone: a tool nobody can call leaves no
 * write unchecked.
 */
export const CALLABLE_TOOLS: readonly string[] = ['Edit', 'Write', 'NotebookEdit'];

const PATH_FIELDS: readonly string[] = ['file_path', 'path', 'notebook_path'];

export interface HookRequest {
  readonly event: string;
  readonly tool: string;
  /** The session's working directory, when the hook says. */
  readonly cwd: string | null;
  /** Files the tool writes, as the tool named them - absolute, usually. */
  readonly paths: readonly string[];
  /** The session and the tool call the question is about, when it says: `session_id` and `tool_use_id`. */
  readonly session: string | null;
  readonly call: string | null;
}

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The event Claude Code runs as a session starts, resumes, is cleared or
 * compacted, or is forked: no tool is named, and the hook checks what every
 * write of the session will need (ADR-0005).
 */
export const SESSION_START = 'SessionStart';

/**
 * The event Claude Code runs as its main agent finishes a turn, under which
 * the hook reports what the work tree holds, where the configuration asks
 * for it (ADR-0005). No tool is named.
 */
export const TURN_END = 'Stop';

/** The events that name no tool, which the hook answers of the session and not of a write. */
const NO_TOOL: readonly string[] = [SESSION_START, TURN_END];

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
  if (typeof event !== 'string' || (typeof tool !== 'string' && !NO_TOOL.includes(event))) return { error: 'the hook input names no event or tool' };
  // A session's start and a turn's end name no tool, and are read as naming none.
  const named = typeof tool === 'string' ? tool : '';
  const input = isObject(value['tool_input']) ? value['tool_input'] : {};
  const paths: string[] = [];
  if (WRITING_TOOLS.includes(named)) {
    for (const field of PATH_FIELDS) {
      const path = input[field];
      if (typeof path === 'string' && path !== '' && !paths.includes(path)) paths.push(path);
    }
  }
  const text = (field: string): string | null => {
    const found = value[field];
    return typeof found === 'string' ? found : null;
  };
  return { event, tool: named, cwd: text('cwd'), paths, session: text('session_id'), call: text('tool_use_id') };
}

/**
 * The answer as a session starts: what would hold every write of it, in
 * one line, for the person as `systemMessage` and for Claude as
 * `additionalContext`; or nothing, where all is well. Always exit 0: the
 * event cannot block, and a check that fails must not keep a session from
 * starting.
 */
export function sessionResponse(problem: string | null): HookResponse {
  if (problem === null) return NONE;
  const said = `spec-harness: ${problem}`;
  return { stdout: `${JSON.stringify({ systemMessage: said, hookSpecificOutput: { hookEventName: SESSION_START, additionalContext: said } })}\n`, exitCode: 0 };
}

/**
 * The answer as a turn ends: the report, in one `systemMessage`, or
 * nothing, where there is nothing to report. Always exit 0, and never a
 * field that has Claude go on: `decision`, `additionalContext` and exit 2
 * each continue the turn under Stop, and `continue: false` would stop one
 * another hook continues. Claude Code shows a `systemMessage` to the person
 * from an entry it waits on, and hands it to Claude on the next turn from
 * one it runs in the background, as `init` writes it (ADR-0005, ADR-0012).
 */
export function turnResponse(report: string | null): HookResponse {
  if (report === null) return NONE;
  return { stdout: `${JSON.stringify({ systemMessage: report })}\n`, exitCode: 0 };
}

export interface HookResponse {
  /** What to print on stdout: JSON, or nothing. */
  readonly stdout: string;
  readonly exitCode: number;
}

/**
 * The answer before the one write a configuration that does not load lets
 * through, a write to the configuration file itself: no decision, so that
 * the person's own permission prompt stands as for any write the guard
 * passes, and the line that says why every other write is held, for the
 * person as `systemMessage` and for Claude as `additionalContext`, which
 * Claude Code's hooks reference has a PreToolUse hook's answer carry
 * (ADR-0005). Exit 0.
 */
export function mendResponse(said: string): HookResponse {
  const line = `spec-harness: ${said}`;
  return { stdout: `${JSON.stringify({ systemMessage: line, hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: line } })}\n`, exitCode: 0 };
}

/** The answer that says nothing and decides nothing: the write goes on as the person's own permissions have it. */
export const NONE: HookResponse = { stdout: '', exitCode: 0 };

function reasonOf(decisions: readonly Warning[]): string {
  return decisions.map((decision) => `spec-harness: ${decision.message}. Next: ${decision.hint}.`).join('\n');
}

/** What a warning after a write says: a decision's message and its next step. */
export type Warning = Pick<Decision, 'message' | 'hint'>;

/** The answer after a write: the warnings, as additional context for the model, or nothing. */
export function afterResponse(warnings: readonly Warning[]): HookResponse {
  if (warnings.length === 0) return NONE;
  return {
    stdout: `${JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: reasonOf(warnings) },
    })}\n`,
    exitCode: 0,
  };
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
  if (event === 'PostToolUse') return afterResponse(warningsOf(decisions));
  return NONE;
}

/** The decisions a run after the write would say: those that warn, each by its message and next step. */
export function warningsOf(decisions: readonly Decision[]): Warning[] {
  return decisions.filter((decision) => decision.verdict === 'warn').map(({ message, hint }) => ({ message, hint }));
}

/**
 * What the hook reads besides its question and its line, as it decides: the
 * project Claude Code names, the brief the environment names, and the
 * branch a forge's CI names on a detached head (ADR-0004).
 */
export const CALL_VARIABLES: readonly string[] = [
  'CLAUDE_PROJECT_DIR',
  'SPEC_BRIEF',
  'GITHUB_HEAD_REF',
  'GITHUB_REF_TYPE',
  'GITHUB_REF_NAME',
  'CI_MERGE_REQUEST_SOURCE_BRANCH_NAME',
  'CI_COMMIT_BRANCH',
];

/**
 * A tool call, as both of its hooks see it: the release, the session and
 * the call, the tool and its paths, the session's directory, what the
 * hook's line gives, the directory the hook was started in, and the
 * variables it reads (ADR-0002). What a run before the write keeps is
 * answered after it only to a run for which all of it is the same.
 */
export interface CallRecord {
  readonly release: string;
  readonly session: string;
  readonly call: string;
  readonly tool: string;
  readonly paths: readonly string[];
  readonly cwd: string | null;
  readonly line: readonly (string | null)[];
  readonly started: string;
  readonly env: readonly (string | null)[];
}

/** An id the hook names a file by: what Claude Code's ids are made of, and nothing a path could climb out by. */
const ID = /^[\w-]{1,256}$/;

/**
 * The call a question is about, or `null` where it does not say which
 * session and call it is, or says it in a form no file is named by.
 */
export function callRecord(
  request: HookRequest,
  line: Readonly<{ root: string | undefined; brief: string | undefined; base: string | undefined }>,
  started: string,
  env: Readonly<Record<string, string | undefined>>,
  release: string,
): CallRecord | null {
  const { session, call } = request;
  if (session === null || call === null || !ID.test(session) || !ID.test(call)) return null;
  return {
    release,
    session,
    call,
    tool: request.tool,
    paths: request.paths,
    cwd: request.cwd,
    line: [line.root ?? null, line.brief ?? null, line.base ?? null],
    started,
    env: CALL_VARIABLES.map((name) => env[name] ?? null),
  };
}

/** The name of the file a call's decisions are kept under. */
export function callFile(record: CallRecord): string {
  return `${record.session}.${record.call}.json`;
}

/** What a run before the write keeps for the run after it: the call, and the warnings it decided. */
export function keptCall(record: CallRecord, warnings: readonly Warning[]): string {
  return `${JSON.stringify({ record, warnings })}\n`;
}

function isWarning(value: unknown): value is Warning {
  return isObject(value) && typeof value['message'] === 'string' && typeof value['hint'] === 'string';
}

/**
 * The warnings kept for this call, or `null` where what was kept is not
 * JSON, is another call's, or holds anything but warnings: such a call is
 * decided as it was before anything was kept (ADR-0002).
 */
export function warningsKept(text: string, record: CallRecord): Warning[] | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    // Read as an empty object, a text that is not JSON holds no record
    // either: that mutant is equivalent.
    return null;
  }
  if (!isObject(value) || JSON.stringify(value['record']) !== JSON.stringify(record)) return null;
  const warnings = value['warnings'];
  return Array.isArray(warnings) && warnings.every(isWarning) ? warnings.map(({ message, hint }) => ({ message, hint })) : null;
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
