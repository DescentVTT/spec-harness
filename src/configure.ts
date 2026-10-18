/**
 * What `init` writes into each tool's configuration, and what `doctor` says
 * of the result.
 *
 * Pure: `setup.ts` and the command line read the files and ask git, and
 * write what these return, so the core sweep holds these to the unit suite.
 * Each merge keeps what a person wrote and returns `null` when there is
 * nothing to add.
 */

import { isAbsolute, join } from 'node:path';
import { runInNewContext } from 'node:vm';

import { CALLABLE_TOOLS } from './hooks.js';
import { literal } from './literal.js';
import type { AllowedSigner } from './signers.js';
import type { LocalBranch } from './types.js';
import { namedTree, type HookLine } from './usage.js';
import { parseGlobList } from './vendor/spec-core/pattern/index.js';
import { CLAUDE_CODE_MINIMUM, meets, parseVersion, type ClaudeCodeCheck } from './versions.js';

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
 * everywhere. git's hook runs the same script, from the top of the work
 * tree, where git starts it.
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

/**
 * The matcher every release wrote: each name the hook reads a file from
 * (hooks.ts). `MultiEdit` is one no supported Claude Code has a tool for,
 * and Claude Code compares a listed name with a tool's exactly, so it starts
 * the hook for nothing there. It stays, since the hook is asked about a name
 * only under a matcher that lets the name through, and it reads this one for
 * whatever still sends it.
 */
const HOOK_MATCHER = 'Edit|Write|MultiEdit|NotebookEdit';
/** The event Claude Code runs before a tool call, the only one of the two where a hook can refuse the call. */
const BEFORE = 'PreToolUse';
/** The event after a call that succeeded, where a hook can only tell the model what it wrote. */
const AFTER = 'PostToolUse';
const GUARDED_EVENTS = [BEFORE, AFTER];
const GUARD_ARGS: readonly string[] = Object.freeze([`${PROJECT_DIR}/${BIN}`, 'hook', 'claude']);

/**
 * The guard as a Claude Code hook: exec form, `args` given, so the project's
 * path is one argument whatever it holds, and no shell is involved.
 */
export const GUARD_HOOK: Readonly<Json> = Object.freeze({ type: 'command', command: 'node', args: GUARD_ARGS, timeout: 60 });

// bare-name: what 0.1 installed, an npx command found from wherever the
// session stood. Read here so that init replaces it, and never run.
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

/**
 * The tools, of those that write a file and a supported Claude Code can call
 * (hooks.ts), that a group's matcher has Claude Code start the group's hooks
 * for, by its hooks reference
 * (https://code.claude.com/docs/en/hooks, Matcher patterns, read
 * 2026-10-12): left out, empty or `*`, every tool; made of letters, digits,
 * `_`, `-`, spaces, `,` and `|` alone, the tools it names, one between each
 * `|` or `,`; with any other character in it, a JavaScript regular
 * expression that may match anywhere in a tool's name. `null` where the
 * reference does not say, or it cannot be told: a matcher that is neither
 * text nor an array, is no pattern, or is a pattern whose reading runs out
 * its budget.
 *
 * Two things its page on debugging a configuration adds
 * (https://code.claude.com/docs/en/debug-your-config, Check hooks and Check
 * common causes, read 2026-10-14). A matcher that is an array is an entry
 * Claude Code lists as an invalid setting, among the reasons a hook is not
 * loaded and never fires: no tool. And a comma separates names only from
 * {@link COMMA_SINCE} on, so a matcher that lists names with one is read as
 * `commas` has the Claude Code here read it.
 */
function matchedTools(matcher: unknown, pattern: PatternReader, commas: Commas): readonly string[] | null {
  if (matcher === undefined || matcher === '' || matcher === '*') return CALLABLE_TOOLS;
  if (Array.isArray(matcher)) return [];
  if (typeof matcher !== 'string') return null;
  if (!NAMES.test(matcher)) return pattern(matcher);
  const comma = commas.as === 'separator' ? null : commaReading(matcher, pattern);
  if (comma === null) return listedTools(matcher);
  if (commas.as === 'pattern') return comma.earlier;
  // Which of the two readings holds cannot be told, and where both are no
  // tool that writes it need not be.
  return comma.earlier !== null && comma.listed.length === 0 ? comma.listed : null;
}

/** A matcher that is a name, or names between `|` and `,`: what the reference compares with a tool's name exactly. */
const NAMES = /^[A-Za-z0-9_\- ,|]*$/;

/** The writing tools a matcher of names lists, one between each `|` or `,`. */
function listedTools(matcher: string): readonly string[] {
  const names = matcher.split(/[|,]/).map((name) => name.trim());
  return CALLABLE_TOOLS.filter((tool) => names.includes(tool));
}

/**
 * The release of Claude Code from which a comma in a matcher separates
 * names as a `|` does. Its page on debugging a configuration (Check hooks,
 * read 2026-10-14) has a comma before it fall through to the reading of a
 * pattern, under which the matcher never matched, and its changelog has the
 * fix under this release: hooks with comma-separated matchers no longer
 * silently never firing.
 */
export const COMMA_SINCE = '2.1.191';

/**
 * How the Claude Code that runs the hooks reads a comma in a matcher of
 * names: as a separator, from {@link COMMA_SINCE} on; as part of a pattern,
 * in the release named, which is older; or it cannot be told, where the
 * release cannot.
 */
export type Commas = { readonly as: 'separator' } | { readonly as: 'pattern'; readonly release: string } | { readonly as: 'untold' };

/** The reading every release from {@link COMMA_SINCE} on has, and what a caller that asks no release is given. */
const SEPARATOR: Commas = { as: 'separator' };

/**
 * How the Claude Code doctor asked its release reads a comma. A release that
 * was not asked, or could not be told, leaves the reading untold: asked or
 * not, nothing says which it is.
 */
export function commasUnder(release: ClaudeCodeCheck | null): Commas {
  if (release === null || release.state === 'unknown') return { as: 'untold' };
  // A release that was told is one whose version was read as one, and the
  // constant is a version, so both parse.
  return meets(parseVersion(release.version)!, parseVersion(COMMA_SINCE)!) ? SEPARATOR : { as: 'pattern', release: release.version };
}

/** A matcher of names that holds a comma, by the two readings a release may have of it. */
interface CommaReading {
  /** From {@link COMMA_SINCE} on: the writing tools it lists. */
  readonly listed: readonly string[];
  /**
   * Before it: no tool, where the matcher read as a pattern matches none of
   * the writing tools, which is what the page has such a matcher do. `null`
   * where read as a pattern it matches one, as `Edit|Write,Bash` matches
   * `Edit`: the page says a comma is read as part of a pattern and says the
   * matcher never matched, and for such a matcher the two disagree.
   */
  readonly earlier: readonly string[] | null;
}

/** The two readings of a matcher of names that holds a comma, or `null` for any other matcher, which every release reads one way. */
function commaReading(matcher: unknown, pattern: PatternReader): CommaReading | null {
  if (typeof matcher !== 'string' || !NAMES.test(matcher) || !matcher.includes(',')) return null;
  const read = pattern(matcher);
  return { listed: listedTools(matcher), earlier: read !== null && read.length === 0 ? read : null };
}

/**
 * How long the reading of one pattern may take, in milliseconds of the
 * clock. A sane matcher is read in about half of one (ADR-0005), so only a
 * pattern that backtracks without end meets it; on a machine under load an
 * ordinary one may, and is then said as one that cannot be told, where an
 * idle machine reads it.
 */
const PATTERN_BUDGET = 100;

/**
 * The writing tools a matcher that is a pattern matches, or `null` where it
 * is no pattern, or its reading runs out its budget.
 *
 * The pattern is a line of a settings file, which arrives with a clone, and
 * one can be written that a test of a few short names never finishes:
 * `^((((([A-Za-z]*)*)*)*)*)*$X` ran for more than ten seconds. Tested as
 * written, one such entry and neither doctor nor init would come back, with
 * no word. So it is made and tested in a context of its own, whose run
 * takes a timeout where a test in this one takes none, and what throws
 * there, a pattern that is none or the stop itself, is a matcher that
 * cannot be told. The shape of a pattern does not say which will: groups in
 * a row backtrack as nested ones do.
 */
function patternTools(source: string): readonly string[] | null {
  try {
    const matched: string[] = runInNewContext('tools.filter((tool) => new RegExp(source).test(tool))', { tools: CALLABLE_TOOLS, source }, { timeout: PATTERN_BUDGET });
    return matched;
  } catch {
    return null;
  }
}

/** What reads a matcher that is a pattern: the writing tools it matches, or `null` where that cannot be told. */
export type PatternReader = (source: string) => readonly string[] | null;

/**
 * A reader for one run: a pattern is read the first time it is asked of,
 * and answered from that reading after.
 *
 * A reading that runs out its budget costs the whole of it, a settings file
 * can hold one matcher over any number of entries, and init asks of an
 * entry twice, for what doctor says of the file and for what to write into
 * it. Fifty entries under one such pattern were fifty readings, five and a
 * half seconds, and fifty-one for init; they are one. Nothing is spared a
 * file that holds a pattern of its own for each entry.
 *
 * Made where a run begins and handed down, never kept by this module: a
 * reading is of the clock, so one kept past its run would answer for a
 * machine that is busy no longer.
 */
export function patternReader(read: PatternReader = patternTools): PatternReader {
  const known = new Map<string, readonly string[] | null>();
  return (source) => {
    const before = known.get(source);
    if (before !== undefined) return before;
    const tools = read(source);
    known.set(source, tools);
    return tools;
  };
}

/** Whether Claude Code runs a hook's entry in the background, where it waits on no answer of it. */
function inBackground(hook: Json): boolean {
  return hook['async'] === true || hook['asyncRewake'] === true;
}

/**
 * The writing tools whose call Claude Code hands an entry under `event` and
 * waits for it on, or `null` where that cannot be told here. Before a write
 * an entry in the background answers too late to refuse it, so it is waited
 * on for none (the reference, Run hooks in the background). An `if` has the
 * entry started only for the calls its rule matches, in the syntax of a
 * permission rule, which is not read here.
 */
function answered(event: string, matcher: unknown, hook: Json, pattern: PatternReader, commas: Commas): readonly string[] | null {
  if (event === BEFORE && inBackground(hook)) return [];
  if (hook['if'] !== undefined) return null;
  return matchedTools(matcher, pattern, commas);
}

/**
 * `.claude/settings.json`, or the plugin's hooks, with the guard hooks merged
 * in; `null` when they are already there.
 *
 * An event has the guard where Claude Code starts init's own line under it
 * for a write. Where the settings hold another line of the hook that it
 * starts for a write, one `isHook` knows as the hook's by the words after
 * the harness's command, nothing is merged in at all: the line is a
 * person's, a second one beside it would run for every write as well, and
 * init rewrites none but the one 0.1 wrote. Without `isHook`, only init's
 * own line is known: the default's `false` and an `undefined` read the same
 * in `some`, so that mutant is equivalent.
 *
 * `pattern` reads a matcher that is a pattern: the run's own reader, where
 * the run has read the file's matchers already ({@link patternReader}).
 * `commas` is how the Claude Code here reads a comma in a matcher of names,
 * where the run asked its release ({@link commasUnder}): a line that
 * release starts for no write is no guard, and init's own is written beside
 * it.
 */
export function mergeClaudeSettings(
  current: Json,
  isHook: (words: readonly string[]) => boolean = () => false,
  pattern: PatternReader = patternReader(),
  commas: Commas = SEPARATOR,
): Json | null {
  const hooks = isObject(current['hooks']) ? current['hooks'] : {};
  const theirs = harnessEntries(current).some((entry) => !isGuard(entry.hook) && !isLegacyGuard(entry.hook) && isHook(entry.words) && isStarted(toolsOf(entry, pattern, commas)));
  if (theirs) return null;
  let changed = false;
  const next: Json = { ...hooks };
  for (const event of GUARDED_EVENTS) {
    const listed = hooks[event];
    const before: unknown[] = Array.isArray(listed) ? listed : [];
    const groups = before.map(upgraded);
    const replaced = groups.some((group, index) => group !== before[index]);
    const present = harnessEntries({ hooks: { [event]: groups } }).some((entry) => isGuard(entry.hook) && isStarted(toolsOf(entry, pattern, commas)));
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

/** The harness's command on a line: its script, or its name, alone or at the end of a path. */
function isLauncher(word: string): boolean {
  const name = word.split(/[\\/]/).at(-1);
  return name === 'spec-harness' || name === 'spec-harness.js';
}

/** Anything in a word that a shell reads before the program is handed it: a quote, a variable, an operator, a pattern. */
const SHELL_READS = /[^A-Za-z0-9_./:=@%+,-]/;

/** A line of the harness's in Claude Code's settings: what follows its command there. */
export interface WrittenHook {
  /** The events whose hooks hold the line, of the two the guard answers. */
  readonly events: readonly string[];
  /** What follows the harness's command, word for word as written. */
  readonly words: readonly string[];
  /**
   * Whether a shell reads those words first, and can change them: a line
   * with no `args`, which Claude Code hands to a shell, holding a quote, a
   * variable or anything else a shell rewrites. What the hook is handed is
   * then the shell's to say. With `args`, Claude Code hands each word over
   * as it stands.
   */
  readonly shell: boolean;
  /** Whether the entry sets `onFailure` to `"block"`. */
  readonly blocks: boolean;
  /**
   * What the entry has for `type` where that is not `"command"`, as it is
   * said of the line: none at all, or a word the reference does not list.
   * Whether Claude Code runs such an entry cannot be told. `null` for an
   * entry it runs as a command.
   */
  readonly untyped: string | null;
}

/**
 * The handler types that are no command, by Claude Code's hooks reference
 * (https://code.claude.com/docs/en/hooks, Hook handler fields, read
 * 2026-10-12): an entry of one sends a request, calls a tool of an MCP
 * server, or asks a model or an agent. It runs no command, the harness's or
 * any other, whatever else the entry holds.
 */
const OTHER_HANDLERS: readonly unknown[] = ['http', 'mcp_tool', 'prompt', 'agent'];

/**
 * The line of an entry that runs the harness, or `null` for one that does
 * not. Only an entry Claude Code runs as a command is one: the reference
 * has `type` as a field every entry must have, with `"command"` for a
 * command and four other words, and says nothing of an entry with none or
 * with another word, which is kept, and said as one that cannot be told.
 */
function writtenHook(hook: Json): Line | null {
  const { command, args, type } = hook;
  if (typeof command !== 'string' || OTHER_HANDLERS.includes(type)) return null;
  let line: string[];
  // Without arguments the line is a shell's, which splits it at its spaces:
  // at each one here, and what stands between two of them is no word.
  if (args === undefined) line = command.split(/\s/).filter((word) => word !== '');
  else if (Array.isArray(args) && args.every((arg): arg is string => typeof arg === 'string')) line = [command, ...args];
  // Arguments that are not all text are no line Claude Code can start.
  else return null;
  const shell = args === undefined;
  // A quote around the path of the command is the shell's, dropped to know the command by.
  const at = line.findIndex((word) => isLauncher(shell ? word.replace(/["']/g, '') : word));
  if (at === -1) return null;
  const words = line.slice(at + 1);
  const untyped = type === 'command' ? null : type === undefined ? 'no "type"' : `the "type" ${JSON.stringify(type)}`;
  return { words, shell: shell && words.some((word) => SHELL_READS.test(word)), blocks: hook['onFailure'] === 'block', untyped };
}

/**
 * Every line in Claude Code's settings that runs the harness, under the two
 * events the guard answers: a line that stands under both, as init writes
 * it, is one line. Whose line each is, the guard's or another command's, is
 * the reader's to say (usage.ts): this knows the harness by its command
 * alone.
 */
export function writtenHooks(settings: unknown): WrittenHook[] {
  const found: { events: string[]; words: readonly string[]; shell: boolean; blocks: boolean; untyped: string | null }[] = [];
  for (const { event, words, shell, blocks, untyped } of harnessEntries(settings)) {
    const same = found.find((other) => sameLine(other, { words, shell, blocks, untyped }));
    if (same === undefined) found.push({ events: [event], words, shell, blocks, untyped });
    else if (!same.events.includes(event)) same.events.push(event);
  }
  return found;
}

type Line = Omit<WrittenHook, 'events'>;

function sameLine(one: Line, other: Line): boolean {
  return one.shell === other.shell && one.blocks === other.blocks && one.untyped === other.untyped && sameStrings(one.words, other.words);
}

/** An entry that runs the harness: its line, where it stands, and what decides whether Claude Code starts it there. */
interface HarnessEntry extends Line {
  readonly event: string;
  /** The matcher of the entry's group, as written; `undefined` where the group has none. */
  readonly matcher: unknown;
  readonly hook: Json;
}

/**
 * The writing tools whose call an entry is handed and waited on for, or
 * `null` where that cannot be told. Read where it is asked for and no
 * sooner: a matcher that is a pattern can cost its whole budget.
 */
function toolsOf(entry: HarnessEntry, pattern: PatternReader, commas: Commas): readonly string[] | null {
  return answered(entry.event, entry.matcher, entry.hook, pattern, commas);
}

/** Every entry that runs the harness under the two events the guard answers, in the order the settings hold them. */
function harnessEntries(settings: unknown): HarnessEntry[] {
  const hooks = field(settings, 'hooks');
  if (!isObject(hooks)) return [];
  return GUARDED_EVENTS.flatMap((event) => {
    const groups = hooks[event];
    if (!Array.isArray(groups)) return [];
    return groups.flatMap((group) =>
      hooksOf(group).flatMap((hook): HarnessEntry[] => {
        if (!isObject(hook)) return [];
        const written = writtenHook(hook);
        if (written === null) return [];
        return [{ ...written, event, matcher: field(group, 'matcher'), hook }];
      }),
    );
  });
}

/** Whether Claude Code starts a line for a write, by the tools it is waited on for: one whose tools cannot be told is taken as started. */
export function isStarted(tools: readonly string[] | null): boolean {
  return tools === null || tools.length > 0;
}

/** What doctor reports of one line of Claude Code's hook. */
export interface HookReport {
  /** The settings file that holds it, as a person finds it. */
  readonly file: string;
  readonly events: readonly string[];
  /** What follows the harness's command, as written. */
  readonly line: readonly string[];
  /**
   * `guards`: Claude Code waits on the hook before a write, and the hook
   * checks it. `off`: the hook checks no write, for a line it cannot read, a
   * root that is no directory, or a root that is a directory outside any
   * work tree; or it is never started, in a file an array for a matcher
   * keeps Claude Code from loading the hooks of. `held`: the hook holds every write, for a
   * brief the line names that is not one. `unstarted`: Claude Code waits on
   * the line before no write, so it is not the guard. `unknown`: what the
   * hook is handed, which writes it is started for, or whether Claude Code
   * runs the entry at all, cannot be told here.
   */
  readonly state: 'guards' | 'off' | 'held' | 'unstarted' | 'unknown';
  readonly onFailure: 'block' | null;
  /** What there is to say of what the hook does with the line, or `null`. */
  readonly detail: string | null;
  /** The writing tools Claude Code waits on the line before a write by, where the hook can refuse it, of those a supported Claude Code can call (hooks.ts); `null` where that cannot be told. */
  readonly before: readonly string[] | null;
  /** The writing tools Claude Code starts the line after a write by, where the hook can warn of it; `null` where that cannot be told. */
  readonly after: readonly string[] | null;
  /** What there is to say of the two, or `null` where they are every tool that writes, as init has it. */
  readonly cover: string | null;
  /** What `onFailure` changes, where the entry sets it to `"block"`. */
  readonly note: string | null;
}

/**
 * The release of Claude Code that reads `onFailure` on a hook's entry, by its
 * hooks reference (https://code.claude.com/docs/en/hooks, read 2026-10-12).
 */
const ON_FAILURE_SINCE = '2.1.295';

/** What `onFailure: "block"` changes for a line, named by `where` it stands, or `null` where the entry does not set it. */
function describeOnFailure(where: string, blocks: boolean, off: boolean): string | null {
  if (!blocks) return null;
  const holds = `${where} sets onFailure to "block", so Claude Code ${ON_FAILURE_SINCE} or later holds a write when the hook fails`;
  if (off) return `${holds}, which with this line is every write, the one that mends the line among them: mend it by hand`;
  return `${holds}, where it lets the write go ahead without it: by its exit 1 for a question it cannot read, by not starting, or by running past its timeout`;
}

/** Names as a sentence lists them: one, two with "and", more with commas before it. Never asked of none. */
function named(names: readonly string[]): string {
  const last = names.at(-1)!;
  return names.length === 1 ? last : `${names.slice(0, -1).join(', ')} and ${last}`;
}

/** The writing tools a line's entries under `event` are waited on for between them, or `null` where an entry that cannot be told might add one. */
function toolsUnder(event: string, entries: readonly HarnessEntry[], reading: Reading): readonly string[] | null {
  const read = entries.filter((entry) => entry.event === event).map((entry) => toolsOf(entry, reading.pattern, reading.commas));
  const sure = CALLABLE_TOOLS.filter((tool) => read.some((tools) => tools !== null && tools.includes(tool)));
  return sure.length < CALLABLE_TOOLS.length && read.some((tools) => tools === null) ? null : sure;
}

/** What a run reads every matcher with: its reader of patterns, and how the Claude Code here reads a comma. */
interface Reading {
  readonly pattern: PatternReader;
  readonly commas: Commas;
}

/**
 * What is said after a matcher that Claude Code does not read as its text
 * suggests: an array, which it loads no hook under, and names with a comma
 * where the release here reads the comma another way than the newest does,
 * or cannot be told. Nothing for any other matcher, and nothing for a comma
 * where both readings come to no tool that writes.
 */
function saidOfMatcher(matcher: unknown, { pattern, commas }: Reading): string {
  if (Array.isArray(matcher)) return ', an array, which Claude Code lists as an invalid setting and loads no hook under';
  if (commas.as === 'separator') return '';
  const comma = commaReading(matcher, pattern);
  if (comma === null || (comma.earlier !== null && comma.listed.length === 0)) return '';
  const listed = comma.listed.length === 0 ? 'no tool that writes' : named(comma.listed);
  const earlier = comma.earlier === null ? 'a pattern whose matches its documentation does not give' : 'a pattern that matches no tool';
  if (commas.as === 'untold') return `, which is ${listed} from Claude Code ${COMMA_SINCE} on, where a comma separates names, and ${earlier} before it: the release here cannot be told`;
  return `, which Claude Code ${commas.release} reads as ${earlier}: a comma separates names from ${COMMA_SINCE} on, where the matcher is ${listed}`;
}

/** What a line's entries under `event` hold that decides when Claude Code starts them, as written. */
function entriesUnder(event: string, entries: readonly HarnessEntry[], reading: Reading): string {
  const under = entries.filter((entry) => entry.event === event);
  if (under.length === 0) return `it stands under no ${event}`;
  const said = under.map(({ matcher, hook }) => {
    const pattern = matcher === undefined ? 'no matcher' : `the matcher ${JSON.stringify(matcher)}${saidOfMatcher(matcher, reading)}`;
    const background = inBackground(hook) ? ' in the background' : '';
    const rule = hook['if'] === undefined ? '' : ` with "if" ${JSON.stringify(hook['if'])}`;
    return `${pattern}${background}${rule}`;
  });
  return `under ${event} it has ${named([...new Set(said)])}`;
}

/**
 * What is said of the writes Claude Code starts a line for, by the event and
 * the matcher of each entry that holds it; `null` where it is waited on
 * before every tool that writes and started after each, as init writes it.
 * A tool is one a supported Claude Code can call: `MultiEdit`, which the
 * hook still reads a path from, is named as unchecked for no line, since no
 * such Claude Code has it to call (hooks.ts).
 */
function describeCover(where: string, before: readonly string[] | null, after: readonly string[] | null, entries: readonly HarnessEntry[], reading: Reading): string | null {
  const parts: string[] = [];
  const left = (tools: readonly string[]): string[] => CALLABLE_TOOLS.filter((tool) => !tools.includes(tool));
  if (before === null) parts.push(`which writes Claude Code waits on it before cannot be told here (${entriesUnder(BEFORE, entries, reading)})`);
  else if (before.length === 0) parts.push(`Claude Code waits on it before no write, so it is not the guard and refuses none (${entriesUnder(BEFORE, entries, reading)})`);
  else if (left(before).length > 0) {
    parts.push(`Claude Code waits on it before a write by ${named(before)}, and before none by ${named(left(before))}, which goes unchecked (${entriesUnder(BEFORE, entries, reading)})`);
  }
  if (after === null) parts.push(`which writes it is started after cannot be told here (${entriesUnder(AFTER, entries, reading)})`);
  else if (after.length === 0) parts.push(`it is started after no write, so it warns of none (${entriesUnder(AFTER, entries, reading)})`);
  else if (left(after).length > 0) parts.push(`it is started after a write by ${named(after)} alone (${entriesUnder(AFTER, entries, reading)})`);
  return parts.length === 0 ? null : `${where}: ${parts.join('; ')}`;
}

/** The events under which an array for a matcher keeps Claude Code from loading the rest of a file's hooks. */
const UNLOADING: readonly string[] = [BEFORE, 'PermissionRequest'];

/** An array that stands for a matcher where it unloads a settings file's hooks: the event it stands under, and the array as written. */
export interface ArrayMatcher {
  readonly event: string;
  readonly matcher: string;
}

/**
 * The first array that stands for a matcher under `PreToolUse` or
 * `PermissionRequest` in a settings file, or `null`.
 *
 * Claude Code's page on debugging a configuration
 * (https://code.claude.com/docs/en/debug-your-config, Check hooks, read
 * 2026-10-14) has a matcher that is an array, where it must be one string,
 * as an entry Claude Code lists as an invalid setting, at the start of an
 * interactive session and in `claude doctor`; and where the array is under
 * one of these two events, none of that file's other hooks load either. It
 * names no release. So a file that holds one runs no hook at all, whoever
 * wrote the entry and whatever it runs: the array's own is not loaded, and
 * neither is any other.
 */
export function arrayMatcher(settings: unknown): ArrayMatcher | null {
  const hooks = field(settings, 'hooks');
  for (const event of UNLOADING) {
    const groups = field(hooks, event);
    if (!Array.isArray(groups)) continue;
    const group = groups.find((candidate) => Array.isArray(field(candidate, 'matcher')));
    if (group !== undefined) return { event, matcher: JSON.stringify(field(group, 'matcher')) };
  }
  return null;
}

/** What is said of a settings file that an array for a matcher keeps Claude Code from loading the hooks of. */
export function describeArrayMatcher(file: string, { event, matcher }: ArrayMatcher): string {
  return `${file} has an array for a matcher under ${event}, ${matcher}, which Claude Code lists as an invalid setting, and beside one under PreToolUse or PermissionRequest it loads none of the file's other hooks`;
}

/** How a matcher that is an array is mended. */
export const ONE_STRING = 'write the matcher as one string, its names between "|"';

/** The words Claude Code hands the hook for a line: what follows the harness's command, each `${CLAUDE_PROJECT_DIR}` filled with `project`. */
function handedWords(words: readonly string[], project: string): string[] {
  return words.map((word) => word.split(PROJECT_DIR).join(project));
}

/** The words handed over for every line of the harness's in the settings files, for a caller that has to ask something of each before it reports them. */
export function handedLines(sources: readonly ClaudeSettings[], project: string): string[][] {
  return sources.flatMap(({ settings }) => writtenHooks(settings).map((hook) => handedWords(hook.words, project)));
}

/**
 * The lines of Claude Code's hook in the settings files, each with what the
 * hook does with it and which writes Claude Code starts it for. `read` is
 * the hook's own reading of the words it is handed (usage.ts), `null` for a
 * line that is not its; the words are handed to it as Claude Code hands them
 * to the hook, each `${CLAUDE_PROJECT_DIR}` filled with `project`.
 *
 * A line that guards and holds no more than a release wrote is reported
 * with nothing to say, as it always was. One with more on it is said as it
 * is, and fails nothing. One the hook cannot read, or whose root is no
 * directory, or is in no work tree that holds the project, is a guard that
 * is off, and one that names a brief which is not
 * one holds every write: each a problem, and doctor exits 1 for it. A line
 * Claude Code waits on before no write is not the guard, whatever the hook
 * would do with it.
 *
 * `pattern` reads a matcher that is a pattern, once for every entry under
 * it in every file: the run's own reader, where something else in the run
 * reads the same files ({@link patternReader}). `commas` is how the Claude
 * Code here reads a comma in a matcher of names, where its release was
 * asked ({@link commasUnder}); a caller that asks none reads a comma as
 * every release from {@link COMMA_SINCE} on does.
 *
 * A file that holds an array for a matcher under `PreToolUse` or
 * `PermissionRequest` has none of its hooks loaded ({@link arrayMatcher}):
 * each line of the hook there is started for no write, and one that stood
 * to be started for a write is a guard that is off.
 */
export function reportHooks(
  sources: readonly ClaudeSettings[],
  project: string,
  read: (words: readonly string[]) => HookLine | null,
  pattern: PatternReader = patternReader(),
  commas: Commas = SEPARATOR,
): HookReport[] {
  const reading: Reading = { pattern, commas };
  return sources.flatMap(({ file, settings }) => {
    const entries = harnessEntries(settings);
    const array = arrayMatcher(settings);
    return writtenHooks(settings).flatMap((hook): HookReport[] => {
      const handed = read(handedWords(hook.words, project));
      if (handed === null) return [];
      const both = GUARDED_EVENTS.every((event) => hook.events.includes(event));
      // An empty word is shown as a shell spells one, where joined it would not show at all.
      // A line that is not under both events is under one.
      const where = `"${hook.words.map((word) => (word === '' ? "''" : word)).join(' ')}" in ${file}${both ? '' : ` (under ${hook.events[0]} alone)`}`;
      const mine = entries.filter((entry) => sameLine(entry, hook));
      const before = toolsUnder(BEFORE, mine, reading);
      const after = toolsUnder(AFTER, mine, reading);
      if (array !== null) {
        // Nothing of the file is loaded, whatever the line holds and
        // whatever the hook would do with it. A line that stood to be
        // started for a write, or stands under an array itself, where
        // someone meant a matcher, is a guard set up that checks nothing;
        // one that stood to be started for none leaves no write unchecked
        // that it was ever asked about.
        const unloaded = { file, events: hook.events, line: hook.words, onFailure: hook.blocks ? 'block' : null, before: [], after: [], cover: null, note: null } satisfies Partial<HookReport>;
        const said = `${where}: ${describeArrayMatcher(file, array)}`;
        if (isStarted(before) || isStarted(after) || mine.some((entry) => Array.isArray(entry.matcher))) {
          return [{ ...unloaded, state: 'off', detail: `${said}, so the guard is off and no write is checked; ${ONE_STRING}` }];
        }
        return [{ ...unloaded, state: 'unstarted', detail: `${said}: the line is not started, and stood to be started for no write as it is, so no guard is switched off` }];
      }
      const written = { file, events: hook.events, line: hook.words, onFailure: hook.blocks ? 'block' : null, before, after, cover: describeCover(where, before, after, mine, reading) } satisfies Partial<HookReport>;
      const note = describeOnFailure(where, hook.blocks, false);
      if (hook.untyped !== null) {
        const detail = `${where} stands on an entry with ${hook.untyped}, where Claude Code's hooks reference has "type": "command" on an entry it runs as a command, so whether Claude Code runs it cannot be told here: give the entry "type": "command"`;
        return [{ ...written, state: 'unknown', detail, note }];
      }
      if (hook.shell) {
        const detail = `${where} is a shell's to read before the hook is handed it, so what the hook does with it cannot be told here: written with "args", each word reaches the hook as it stands`;
        return [{ ...written, state: 'unknown', detail, note }];
      }
      // What the hook would do with a line it is never asked on before a write is not what guards.
      const unstarted: HookReport = { ...written, state: 'unstarted', detail: null, note };
      const waited = before === null || before.length > 0;
      if (handed.state === 'off') {
        const detail = `${where}: ${handed.fault.wrong}, so the guard is off and ${handed.unchecked ?? 'no write is checked'}; ${handed.fault.mend}`;
        // A fault the hook says, it says with exit 1 after every write it is
        // started for as well, so it is said wherever the line stands.
        if (handed.silent !== true) return [{ ...written, state: 'off', detail, note: describeOnFailure(where, hook.blocks, true) }];
        // A root outside any work tree, or in one that does not hold the
        // project, of which the hook says nothing: no run of it fails
        // there, so onFailure holds no write for it, and where the line is
        // waited on before no write there is none it leaves unchecked.
        return [waited ? { ...written, state: 'off', detail, note } : unstarted];
      }
      if (!waited) return [unstarted];
      if (handed.state === 'held') {
        const detail = `${where}: ${handed.wrong}, so the hook holds every write until the line is mended: name a brief spec-brief lists, or take --brief off the line`;
        return [{ ...written, state: 'held', detail, note }];
      }
      if (before === null) return [{ ...written, state: 'unknown', detail: null, note }];
      // What a release wrote: its hook, and nothing after it.
      if (sameStrings(hook.words, ['hook', 'claude'])) return [{ ...written, state: 'guards', detail: null, note }];
      const root = handed.root === undefined ? '' : `, and its root, ${handed.root}, is a directory`;
      // Whose briefs a write is checked by, where they are not the project's own.
      const holder = handed.holder === undefined ? '' : ` in ${namedTree(handed.holder)}, which holds this project: the hook checks a write here by that work tree's briefs and its branch, as a file under ${handed.holder.path}/ there`;
      return [{ ...written, state: 'guards', detail: `${where} is more than init writes, and guards: the hook reads the line${root}${holder}`, note }];
    });
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

/**
 * The settings file whose `disableAllHooks` turns Claude Code's hooks off,
 * or `null` where none does.
 *
 * By its settings reference
 * (https://code.claude.com/docs/en/settings-reference, disableAllHooks, read
 * 2026-10-12) the key is a Boolean any settings file may hold, and `true`
 * turns hooks off. Set outside managed settings, it turns off the hooks of
 * the user's, the project's and the local settings and of plugins, and the
 * hooks of managed settings, of the Agent SDK and of a plugin that managed
 * settings force on keep running. By its hooks reference (Disable or remove
 * hooks) the value that counts is the one left after settings precedence:
 * of the files given, lowest precedence first, the last that sets a Boolean
 * decides. A value that is no Boolean is passed over, as the key left out.
 */
export function hooksDisabled(sources: readonly ClaudeSettings[]): string | null {
  let file: string | null = null;
  for (const source of sources) {
    const value = field(source.settings, 'disableAllHooks');
    if (typeof value === 'boolean') file = value ? source.file : null;
  }
  return file;
}

/** The project's settings file for Claude Code, as it is named among the sources. */
export const PROJECT_SETTINGS = '.claude/settings.json';

/** Where Claude Code records the marketplaces it has fetched, in a directory it keeps plugins in. */
export const MARKETPLACE_REGISTRY = 'known_marketplaces.json';

/** Where it records the marketplaces hosted on claude.ai, in a shape its reference does not give. */
export const HOSTED_REGISTRY = 'known_marketplaces_claudeai.json';

/**
 * The origins in a plugin's id that are no marketplace, by Claude Code's
 * plugin loading reference (https://code.claude.com/docs/en/plugins/loading,
 * Find where a plugin came from, read 2026-10-12): a plugin started from a
 * directory or an archive, one saved under a skills directory, and one
 * synced from a claude.ai account. None has a marketplace, and the first
 * and the last no record on disk that the reference describes.
 */
const OTHER_ORIGINS: readonly string[] = ['inline', 'skills-dir', 'synced'];

/** A name a directory can be looked up by: no separator, and no way out of the directory it is looked up in. */
const DIRECTORY_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * The marketplace a plugin's id names, where it names one whose directory
 * can be looked up: `null` for an origin that is no marketplace, and for
 * text that names no directory.
 */
export function pluginMarketplace(id: string): string | null {
  const origin = id.slice(id.indexOf('@') + 1);
  return OTHER_ORIGINS.includes(origin) || !DIRECTORY_NAME.test(origin) ? null : origin;
}

/** What one of the directories Claude Code keeps plugins in holds of a plugin and its marketplace. */
export interface PluginsRoot {
  readonly directory: string;
  /** Whether its cache holds a version of the plugin that no `.orphaned_at` marks as left behind. */
  readonly cached: boolean;
  /** Its `known_marketplaces.json` as read: `null` where there is none. */
  readonly registry: Json | null | 'unreadable';
  /** Whether a record of marketplaces hosted on claude.ai stands beside it. */
  readonly hosted: boolean;
}

/**
 * Whether this machine has what Claude Code loads a plugin from. `detail`
 * is why, where the plugin is not simply there.
 */
export type PluginPresence = { readonly state: 'present'; readonly detail: null } | { readonly state: 'absent' | 'unknown'; readonly detail: string };

function turnsOn(settings: unknown, id: string): boolean {
  const plugins = field(settings, 'enabledPlugins');
  return isObject(plugins) && plugins[id] === true;
}

function holds(record: unknown, name: string): boolean {
  return isObject(record) && Object.hasOwn(record, name);
}

/**
 * Whether the plugin that settings turn on is on this machine, by Claude
 * Code's plugin loading reference
 * (https://code.claude.com/docs/en/plugins/loading, read 2026-10-12), from
 * the settings files and from what the directories it keeps plugins in
 * hold: its plugins root, and each seed directory.
 *
 * `present`: a version of it is in a cache, where the reference has one
 * directory for each installed version of a marketplace plugin (Find
 * plugins on disk).
 *
 * `absent` is said only where the reference leaves the plugin no way to
 * load (Enabled in project settings but not installed): its only `true` is
 * in the project's `.claude/settings.json`, for which Claude Code fetches
 * no plugin a machine lacks, and neither of the page's two exceptions is
 * met, a marketplace that lists it by a relative path, since no marketplace
 * of that name is recorded as fetched or declared in settings, and a seed
 * directory that holds it.
 *
 * Everything else is `unknown`: an origin that is no marketplace, a record
 * that is not there or cannot be read, a marketplace that is there or is
 * declared, whose own list is not read here, and a `true` in a settings
 * file of the person's own, for which Claude Code fetches.
 */
export function pluginPresence(plugin: EnabledPlugin, sources: readonly ClaudeSettings[], roots: readonly PluginsRoot[]): PluginPresence {
  const untold = (detail: string): PluginPresence => ({ state: 'unknown', detail });
  const marketplace = pluginMarketplace(plugin.id);
  if (marketplace === null) return untold(`${plugin.id} names no marketplace whose plugins are kept in a cache: a plugin from --plugin-dir, a skills directory or a claude.ai account comes another way`);
  if (roots.length === 0) return untold('where Claude Code keeps its plugins is not known here: none of CLAUDE_CODE_PLUGIN_CACHE_DIR, CLAUDE_CONFIG_DIR and a home directory is set');
  if (roots.some((root) => root.cached)) return { state: 'present', detail: null };
  const unread = roots.find((root) => !isObject(root.registry));
  if (unread !== undefined) {
    const wrong = unread.registry === null ? 'is not there' : 'cannot be read as JSON';
    return untold(`${join(unread.directory, MARKETPLACE_REGISTRY)}, where Claude Code records the marketplaces it has fetched, ${wrong}`);
  }
  const fetched = roots.find((root) => holds(root.registry, marketplace));
  if (fetched !== undefined) {
    return untold(
      `its marketplace, ${marketplace}, is on this machine (${join(fetched.directory, MARKETPLACE_REGISTRY)}) and no version of the plugin is in the cache: Claude Code loads a plugin that its marketplace lists by a relative path from the marketplace itself, and the marketplace's list is not read here`,
    );
  }
  const declaring = sources.find(({ settings }) => holds(field(settings, 'extraKnownMarketplaces'), marketplace));
  if (declaring !== undefined) return untold(`${declaring.file} declares its marketplace, ${marketplace}, under extraKnownMarketplaces, which Claude Code fetches after a session has started: nothing of it is on this machine now`);
  const hosted = roots.find((root) => root.hosted);
  if (hosted !== undefined) return untold(`${join(hosted.directory, HOSTED_REGISTRY)} records the marketplaces hosted on claude.ai, in a shape Claude Code's reference does not give, so whether ${marketplace} is one cannot be read`);
  const own = sources.filter(({ file, settings }) => file !== PROJECT_SETTINGS && turnsOn(settings, plugin.id)).map(({ file }) => file);
  if (own.length > 0) return untold(`${named(own)} ${own.length === 1 ? 'turns' : 'turn'} it on, and Claude Code fetches a plugin that settings of the person's own turn on: neither a version of it nor its marketplace, ${marketplace}, is on this machine now`);
  return {
    state: 'absent',
    detail: `${PROJECT_SETTINGS} alone turns it on, and Claude Code fetches no plugin that a project's settings alone turn on, unless its marketplace lists it by a relative path or a seed directory holds it: no marketplace ${marketplace} is recorded as fetched or declared in settings, and no version of the plugin is in a cache (${roots.map((root) => join(root.directory, 'cache')).join(', ')})`,
  };
}

/** Where the plugin is on, as a person would look it up. */
function isOn(plugin: EnabledPlugin): string {
  return `the spec-harness plugin is on (${plugin.id} in ${plugin.file})`;
}

/** How to have init's entries in place of the plugin's, for this project alone. */
function turnOff(plugin: EnabledPlugin): string {
  return `turn the plugin off for this project with claude plugin disable ${plugin.id} --scope local`;
}

const PARTS = literal({
  hooks: { brings: 'the guard hooks', twice: 'every write is guarded twice', skipped: 'init writes none', entry: "spec-harness's hooks", them: 'them', none: 'no hook' },
  server: { brings: 'the server', twice: 'the server is registered twice', skipped: 'init registers none', entry: 'the spec-harness server', them: 'it', none: 'no server' },
});

/** How to have a plugin that is not on this machine brought to it, in the commands Claude Code's plugin pages give. */
function bring(plugin: EnabledPlugin): string {
  return `install it here, with claude plugin install ${plugin.id} once its marketplace is added`;
}

/** That the plugin settings turn on is not on this machine, and why. */
function isAbsent(plugin: EnabledPlugin, detail: string, brought: string): string {
  return `${isOn(plugin)} and is not on this machine, so it brings ${brought} here: ${detail}`;
}

/**
 * What init says of a Claude Code file where the plugin that settings turn
 * on is not on this machine. It writes nothing on that reading alone: a
 * plugin that is there after all would bring the same `part` a second time.
 * A file that holds init's entry already is `present`.
 */
export function describeAbsent(plugin: EnabledPlugin, detail: string, part: 'hooks' | 'server', present: boolean): string {
  const words = PARTS[part];
  const absent = isAbsent(plugin, detail, words.none);
  if (present) return `${absent}. This file holds ${words.entry}; with the plugin installed as well, ${words.twice}: ${turnOff(plugin)}`;
  return `${absent}. On that reading alone ${words.skipped}, since with a plugin that is there after all ${words.twice}: ${bring(plugin)}, or to have ${words.them} here instead, ${turnOff(plugin)} and run init again`;
}

/**
 * What init says of a Claude Code file it leaves alone because the plugin is
 * on and brings the same `part`. A file that holds init's entry already is a
 * double install for the person to settle: init removes nothing, since the
 * file is the repository's and a clone without the plugin relies on it. So
 * is an entry `elsewhere`, in a settings file of the person's own, which
 * init does not write and doctor fails all the same.
 */
export function describeSkipped(plugin: EnabledPlugin, part: 'hooks' | 'server', present: boolean, elsewhere: readonly string[] = []): string {
  const words = PARTS[part];
  if (present) return `${isOn(plugin)} and brings ${words.brings} this file holds as well, so ${words.twice}: take ${words.entry} out of this file, or ${turnOff(plugin)}`;
  if (elsewhere.length > 0) {
    return `${isOn(plugin)} and brings ${words.brings} ${named(elsewhere)} ${elsewhere.length === 1 ? 'holds' : 'hold'} as well, so ${words.twice}: take ${words.entry} out there, or ${turnOff(plugin)}. init writes none here`;
  }
  return `${isOn(plugin)} and brings ${words.brings}, so ${words.skipped}: with both, ${words.twice}. To have ${words.them} here instead, for every clone of the repository, ${turnOff(plugin)} and run init again`;
}

/** How Claude Code is wired to the harness: the plugin, init's entries, both or neither. */
export interface ClaudeCodeWiring {
  readonly plugin: EnabledPlugin | null;
  /** Whether this machine has what Claude Code loads that plugin from; `null` where no settings file turns one on. */
  readonly presence: PluginPresence | null;
  /** The settings file whose `disableAllHooks` turns the hooks off, or `null`. */
  readonly hooksOff: string | null;
  /** The settings files that hold the guard hooks: a line of the hook that Claude Code starts for a write, before it or after. */
  readonly hooks: readonly string[];
  /** Each line of the hook in the settings files, with what the hook does with it and the writes it is started for. */
  readonly lines: readonly HookReport[];
  /** Whether `.mcp.json` registers the server. */
  readonly server: boolean;
  /**
   * The release of the Claude Code on `PATH`, where it was asked: a matcher
   * that lists names with a comma is read as that release reads it
   * ({@link commasUnder}). `null` where it was not asked.
   */
  readonly release: ClaudeCodeCheck | null;
}

export type WiringState = 'plugin' | 'init' | 'both' | 'none';

/** The wiring as its descriptions read it: what a caller knows of the plugin's presence, which one that does not ask leaves out. */
type Wired = Pick<ClaudeCodeWiring, 'plugin' | 'hooks' | 'server'> & { readonly presence?: PluginPresence | null };

/** Why the plugin settings turn on is not on this machine, or `null` where it is, may be, or none is on. */
function absence(wiring: Wired): string | null {
  return wiring.presence?.state === 'absent' ? wiring.presence.detail : null;
}

/**
 * Which of the four the wiring is. `both` is a double install, and doctor
 * fails it; either of init's entries counts. A plugin that is not on this
 * machine brings nothing to it, and is not counted.
 */
export function wiringState(wiring: Wired): WiringState {
  const init = wiring.hooks.length > 0 || wiring.server;
  if (wiring.plugin === null || absence(wiring) !== null) return init ? 'init' : 'none';
  return init ? 'both' : 'plugin';
}

/**
 * Whether hooks that would guard are switched off: `disableAllHooks` in a
 * settings file, where a settings file holds the guard hooks or a plugin
 * that may be on this machine brings them. A guard someone set up, which
 * checks no write.
 */
export function guardSwitchedOff(wiring: Wired & Pick<ClaudeCodeWiring, 'hooksOff'>): boolean {
  return wiring.hooksOff !== null && (wiring.hooks.length > 0 || (wiring.plugin !== null && absence(wiring) === null));
}

/**
 * What doctor and init say of `disableAllHooks` in `file`. `guarded` is
 * whether there are guard hooks for it to switch off; without any it is a
 * note on what the key would do to them.
 */
export function describeHooksOff(file: string, guarded: boolean): string {
  const off = `"disableAllHooks" is true in ${file}, so Claude Code runs no hook of the user's, the project's or the local settings, and none of a plugin`;
  if (!guarded) return `note: ${off}: the hooks init writes, and those the plugin brings, would not run while it stands`;
  return `${off}: no write is guarded. Take the key out of ${file}, or set it to false, to have the guard back. Hooks of managed settings, and of a plugin managed settings force on, keep running, and no managed settings are read here`;
}

/**
 * What doctor adds of the plugin settings turn on, where it is not simply on
 * this machine: that it cannot be told, which is never fine, or that it is
 * not, beside entries of init's. `null` where there is no more to say: no
 * plugin, one that is there, and one that is not where nothing else is
 * wired, which the wiring's own sentence says.
 */
export function describePresence(wiring: Wired): string | null {
  const { plugin, presence } = wiring;
  if (plugin === null || presence === undefined || presence === null || presence.state === 'present') return null;
  if (presence.state === 'unknown') return `whether ${plugin.id} is on this machine cannot be told: ${presence.detail}. A plugin that is not there brings no hook: Claude Code's /plugin lists it, and its errors`;
  if (wiring.hooks.length > 0) return `${isAbsent(plugin, presence.detail, 'no hook')}. With the plugin installed as well, ${PARTS.hooks.twice}: ${turnOff(plugin)}`;
  return wiring.server ? unguarded(plugin, presence.detail) : null;
}

/** That the plugin settings turn on is not on this machine and no hook of init's stands in for it, with the two ways to a guard. */
function unguarded(plugin: EnabledPlugin, detail: string): string {
  return `${isAbsent(plugin, detail, 'no hook')}, and Claude Code guards no write. To have the guard, ${bring(plugin)}, or ${turnOff(plugin)} and run spec-harness init --write`;
}

/** What `doctor` says of the wiring, and what to do when it is doubled or missing. */
export function describeClaudeCode(wiring: Wired): string {
  const { plugin } = wiring;
  const entries = [...wiring.hooks.map((file) => `the guard hooks in ${file}`), ...(wiring.server ? ['the server in .mcp.json'] : [])].join(', ');
  const own = `init's entries: ${entries}`;
  if (plugin === null) {
    if (entries === '') return 'neither the spec-harness plugin nor the hooks init writes, so Claude Code guards no write: run spec-harness init --write, or install the plugin';
    return own;
  }
  const absent = absence(wiring);
  if (absent !== null) return entries === '' ? unguarded(plugin, absent) : own;
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
  /** The name of the branch checked out, or `null` on a detached head. */
  readonly branch: string | null;
  /** Every local branch, by its name and the ref a base names it by. */
  readonly branches: readonly LocalBranch[];
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
    if (conventional || facts.branches.every((local) => local.name === branch)) {
      const which = conventional ? 'the branch init runs on' : 'the only branch';
      // The base is a ref git and spec-brief read, so it is the name git
      // reads as the branch and nothing else: `heads/main` beside a tag
      // `main`. A branch with no commit yet is listed by no ref.
      const base = facts.branches.find((local) => local.name === branch)?.ref ?? branch;
      return { base, detail: `rounds are measured from ${base}, ${which}: ${unrecorded}; change "base" if rounds merge into another` };
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
  /**
   * What stands at the path is no file, `what` it is instead. `stops`: git
   * can execute it, tries to run it as the hook, fails, and stops every
   * commit. `ignored`: git cannot execute it, and skips it as it skips a
   * hook that is not executable.
   */
  | { readonly state: 'stops' | 'ignored'; readonly file: string; readonly what: string }
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

/**
 * The line to add to a hook the repository has of its own: node and the
 * script in the project's install, as Claude Code's hooks are run. git starts
 * a pre-commit hook at the top of the work tree it commits in, a linked
 * worktree's own, wherever the hook is kept, so the path is read from there.
 */
export const GIT_HOOK_LINE = `node ${BIN} hook git`;

/**
 * The hook init writes. It is a POSIX sh script on every platform, since Git
 * for Windows runs a hook with the sh it ships. git starts it at the top of
 * the work tree it commits in, so the project's install is read from there,
 * and where a linked worktree has none, from the repository's main work
 * tree: the work tree whose `.git` the common directory is, where `git
 * worktree add` was run and the project installed (ADR-0005). Where neither
 * has the install - a worktree of a repository nobody installed into, a
 * repository that shares its hooks with one that uses the harness - node
 * would end on a stack trace, so the hook says what is missing and where,
 * and the commit waits, as it did when npx found nothing to run.
 */
export const PRE_COMMIT = `#!/bin/sh
# spec-harness: refuse a commit that changes what the active brief protects.
# git runs this at the top of the work tree it commits in, a linked worktree's
# own, wherever the hook is kept: the project's install is read from there,
# or, where a linked worktree has none, from the repository's main work tree.
bin=${BIN}
if [ ! -f "$bin" ]; then
  common=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
  if [ "\${common##*/}" = .git ] && [ -f "\${common%/.git}/$bin" ]; then
    bin=\${common%/.git}/$bin
  else
    printf '%s\\n' "spec-harness: $bin is not in $PWD, the work tree git commits in, nor in its repository's main work tree: install the project's dependencies there, as with npm ci, and commit again" >&2
    exit 2
  fi
fi
exec node "$bin" hook git
`;

/**
 * What doctor and init add of a hook whose text runs the harness through
 * npx: the hook init wrote through 0.9.1, or the line it advised for a hook
 * of the repository's own. A note, never a failure: the hook guards as it
 * did. npx starts npm to start node, and npm 12 says on stderr what it runs,
 * twice a commit. A comment that names the command runs nothing, and neither
 * does another runner's line, which is the repository's to choose.
 */
export function gitHookNote(text: string): string | null {
  const npx = text.split('\n').some((line) => /^[^#]*\bnpx\b.*\bspec-harness\s+hook\s+git\b/.test(line));
  if (!npx) return null;
  return `it runs spec-harness through npx, which starts npm to start node on every commit, and under npm 12 prints two "npm notice run" lines each time: to run it with node from the project's install, as Claude Code's hooks are, replace the npx command there with "${GIT_HOOK_LINE}"`;
}

/** What doctor says of git's pre-commit hook. */
export function describeGitHook(hook: GitHookState): string {
  switch (hook.state) {
    case 'runs':
      return `${hook.file} runs spec-harness`;
    case 'inert':
      return `${hook.file} runs spec-harness, but is not executable, so git skips it: chmod +x ${hook.file}`;
    case 'other':
      return `${hook.file} does not run spec-harness: add the line "${GIT_HOOK_LINE}" to it`;
    case 'stops':
      return `${hook.file} is ${hook.what}, not a hook, and git stops every commit at it, since it cannot run it ("cannot spawn" on Windows, "cannot exec" elsewhere): nothing is checked there, and nothing is committed. Take it away, then run spec-harness init --git-hook --write`;
    case 'ignored':
      return `${hook.file} is ${hook.what}, not a hook, and is not executable, so git skips it and runs no hook: take it away, then run spec-harness init --git-hook --write`;
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
  const patterns = current['historyPatterns'];
  const history = Array.isArray(patterns) ? patterns.filter((p): p is string => typeof p === 'string') : [];
  if (history.includes(archiveGlob)) return null;
  return { ...current, historyPatterns: [...history, archiveGlob] };
}
