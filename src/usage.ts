/**
 * What a command line that parsed has still to be before it runs.
 *
 * The parser says what was typed. Whether it names anything was left to each
 * command, and most never asked: an option another command reads was taken
 * and did nothing, an argument no command asked for was dropped, and an
 * option given an empty value, as `--root "$DIR"` is where the variable is
 * not set, was read as the option left out. Each run then answered a
 * question nobody had put, exit 0, where a tool never falls back to its
 * defaults and reports clean (spec-core ADR-0005).
 *
 * Pure: the command line as it was read, and the line that refuses it, or
 * `null`. The one thing only the disk knows, whether `--root` is a
 * directory, is asked of the caller.
 */

import { literal } from './literal.js';

/** A command line as the parser read it; what `parseOptions` returns is one. */
export interface CommandLine {
  readonly command: string | undefined;
  readonly positionals: readonly string[];
  /** The long name of every option on it, in the order given. */
  readonly given: readonly string[];
  readonly brief: string | undefined;
  readonly base: string | undefined;
  readonly root: string | undefined;
  readonly paths: readonly string[];
  readonly reason: string | undefined;
  readonly options: readonly string[];
  readonly recommend: string | undefined;
  readonly show: string | undefined;
  readonly id: string | undefined;
}

/** Whether a value names nothing: empty, or only space. */
export function isBlank(value: string): boolean {
  return value.trim() === '';
}

interface Valued {
  readonly of: (line: CommandLine) => readonly string[];
  /** What is said of a value that names nothing, and what to do instead. */
  readonly says: string;
}

// An option left out has no value to refuse, and a value that names something
// is passed over as none is: the empty list is equivalent to its mutant.
const one = (value: string | undefined): readonly string[] => (value === undefined ? [] : [value]);

/**
 * The options that take a value, and what an empty one fails to name.
 * `--format` and `--at` are not here: each takes one of a few words, and the
 * parser refuses any other, the empty one with them. Nor is `--note`, which
 * `rule` refuses by name itself.
 */
const VALUED = literal({
  brief: { of: (line) => one(line.brief), says: "names no brief; give it a brief's id, or leave it out for the one SPEC_BRIEF or the branch names" },
  base: { of: (line) => one(line.base), says: 'names no commit; give it a branch or a commit, or leave it out for the configured base' },
  root: { of: (line) => one(line.root), says: 'names no directory; give it one, or leave it out to run in the current directory' },
  path: { of: (line) => line.paths, says: 'names no file; give it the path of a file' },
  reason: { of: (line) => one(line.reason), says: 'gives no reason; say why the round cannot be done without the file' },
  option: { of: (line) => line.options, says: 'names no choice; give it "<label>: <cost>", or leave it out' },
  recommend: { of: (line) => one(line.recommend), says: 'recommends nothing; say which option and why, or leave it out' },
  show: { of: (line) => one(line.show), says: 'names no escalation; give it an id, as spec-harness escalate --list prints them' },
  id: { of: (line) => one(line.id), says: "names no probe; give it a probe's id, or leave it out to run every probe" },
}) satisfies Record<string, Valued>;

export type ValuedOption = keyof typeof VALUED;

/**
 * The line for a value that names nothing. `subject` is the input as its
 * caller knows it: `--brief` on a command line, `"brief"` in a tool call. The
 * value is shown as JSON, where a tab or a line break in it can be seen.
 */
export function emptyValue(subject: string, option: ValuedOption, value: string): string {
  return `${subject} is ${JSON.stringify(value)}, which ${VALUED[option].says}`;
}

interface Shape {
  /** The options the command reads, by their long names. */
  readonly options: readonly string[];
  /** The most arguments it takes, with that said for the refusal of one more; `null` where it takes any number. */
  readonly limit: { readonly most: number; readonly takes: string } | null;
  /**
   * What an argument of it is, and what to do about an empty one; absent
   * where it takes none, or says so itself. `option` is the option that
   * names the same thing, where there is one: the two together are refused.
   * Only a brief is named both ways.
   */
  readonly argument?: { readonly role: string; readonly instead: string; readonly option?: 'brief' };
  /** The options whose empty value the command says in its own report. */
  readonly reports?: readonly string[];
  /**
   * The options that make the command another one, each with the only
   * options it reads beside it. The first on the list that is given decides,
   * as the command itself decides.
   */
  readonly modes?: readonly { readonly option: string; readonly beside: readonly string[] }[];
}

const NO_ARGUMENT = literal({ limit: { most: 0, takes: 'no argument' } });
const ONE_BRIEF = literal({
  limit: { most: 1, takes: "one argument at most, a brief's id" },
  argument: { role: 'the brief', instead: "give it a brief's id, or leave it out for the one --brief, SPEC_BRIEF or the branch names", option: 'brief' },
});

/**
 * Every command, with what it reads of a command line. An option is listed
 * for a command only where the command's answer depends on it: `init`
 * chooses the base itself and the server is told the brief by each call, so
 * neither takes `--base` or `--brief`, and taking them would tell someone
 * the base or the brief had been set.
 */
const SHAPE = literal({
  context: { options: ['brief', 'base', 'root', 'format'], ...ONE_BRIEF },
  guard: {
    options: ['brief', 'base', 'root', 'format', 'strict'],
    limit: null,
    argument: { role: 'a path', instead: 'give it the paths the round would write' },
  },
  hook: { options: ['brief', 'base', 'root'], limit: { most: 1, takes: 'one argument, "claude" or "git"' } },
  // `--list` and `--show` print what waits and raise nothing: neither reads
  // the parts of a request, nor a brief, since what waits is every round's.
  escalate: {
    options: ['brief', 'root', 'format', 'path', 'reason', 'option', 'recommend', 'list', 'show'],
    ...NO_ARGUMENT,
    modes: [
      { option: 'list', beside: ['root', 'format'] },
      { option: 'show', beside: ['root', 'format'] },
    ],
  },
  rule: {
    options: ['root', 'format', 'allow', 'deny', 'note'],
    limit: { most: 1, takes: "one argument, the escalation's id" },
    argument: { role: 'the escalation', instead: 'give it an id, as spec-harness escalate --list prints them' },
  },
  rulings: { options: ['brief', 'base', 'root', 'format'], ...ONE_BRIEF },
  audit: { options: ['brief', 'base', 'root', 'format', 'strict'], ...ONE_BRIEF },
  probe: { options: ['brief', 'base', 'root', 'format', 'id', 'at'], ...ONE_BRIEF },
  premises: { options: ['brief', 'root', 'format', 'strict'], ...NO_ARGUMENT },
  init: { options: ['root', 'format', 'write', 'git-hook'], ...NO_ARGUMENT },
  mcp: { options: ['root'], ...NO_ARGUMENT },
  // A diagnosis says what is wrong with what it was given, where a command
  // that acts on it stops: a brief or a base that names nothing is a line of
  // doctor's report.
  doctor: { options: ['brief', 'base', 'root', 'format', 'strict'], ...NO_ARGUMENT, reports: ['brief', 'base'] },
}) satisfies Record<string, Shape>;

/** Every command there is: the command line dispatches on these names and no other. */
export type Command = keyof typeof SHAPE;

// A map, since a command is a word a person types and an object answers to
// more names than it was given: `constructor` has no shape.
const SHAPES: ReadonlyMap<string, Shape> = new Map(Object.entries(SHAPE));

function listed(options: readonly string[]): string {
  const names = options.map((option) => `--${option}`);
  // Every command reads at least `--root`, so a list is never empty.
  if (names.length === 1) return `its only option is ${names[0] as string}`;
  return `its options are ${names.slice(0, -1).join(', ')} and ${names.at(-1)!}`;
}

/**
 * Whether a line is Claude Code's hook, by its command and the argument
 * after it. It is exempt from every refusal here, and read as each release
 * since 0.1.0 read it: the line lives in settings files and in the plugin of
 * every release, which this one cannot rewrite, and exit 2 from it holds
 * every write of a session, the write that would fix the line among them.
 * A line the parser cannot read is asked the same, and the hook says it
 * with exit 1 (cli.ts).
 */
export function isClaudeHook(command: string | undefined, argument: string | undefined): boolean {
  return command === 'hook' && argument === 'claude';
}

/** The words for a `--root` that is a file, or is not there, wherever it is said. */
export function noDirectory(root: string): string {
  return `--root is "${root}", which is not a directory`;
}

/** What is wrong with the line of Claude Code's hook, and what mends it. */
export interface LineFault {
  readonly wrong: string;
  readonly mend: string;
}

/**
 * What Claude Code's hook does with its own line, as far as the line decides
 * it: it guards, in the root the line gives it where it gives one and under
 * the brief it names where it names one; or the guard is off, for a fault
 * the hook says with exit 1 and holds no write for; or every write is held,
 * exit 2, for a brief the line names that is not one (ADR-0005). The hook
 * reads its line through the functions below, and `doctor` reads a line it
 * finds in Claude Code's settings through the same ones, so what it says of
 * a line is what the hook does with it.
 */
export type HookLine = Guards | GuardOff | WritesHeld;

export interface Guards {
  readonly state: 'guards';
  readonly root: string | undefined;
  /**
   * The brief the line names with `--brief`, as written. Whether it is a
   * brief is spec-brief's to say, which the caller asks. Absent where the
   * line names none.
   */
  readonly brief?: string;
}

export interface GuardOff {
  readonly state: 'off';
  readonly fault: LineFault;
  /**
   * Set where the hook says nothing of the fault and exits 0, so that no
   * run of it fails: a root outside any work tree. Every other fault it
   * says, with exit 1.
   */
  readonly silent?: true;
}

export interface WritesHeld {
  readonly state: 'held';
  /** What is said of the name, by what named the brief (workspace.ts). */
  readonly wrong: string;
}

/**
 * A line under which the round has no brief to be checked against, since
 * what names one names a brief spec-brief does not know, or one it has
 * archived: the hook holds the write, exit 2, and every write after it until
 * the name is mended (ADR-0004). `wrong` is what is said of the name.
 */
export function heldHookLine(wrong: string): WritesHeld {
  return { state: 'held', wrong };
}

/**
 * A line the parser refused: an option no command has, an option left
 * without its value, a `--format` or an `--at` that is none. The parser's
 * words are kept, on one line: what node says of an option that may have
 * lost its value is three.
 */
export function unreadHookLine(said: string): GuardOff {
  return { state: 'off', fault: { wrong: `the hook's line cannot be read (${said.split('\n').join(' ')})`, mend: 'mend it in Claude Code\'s settings, where init writes "hook claude" and nothing after it' } };
}

/**
 * A line that parsed, by the root it gives. An empty root is the directory
 * the hook was started in: git starts there when it is handed no directory,
 * so the hook has guarded there for an empty root in every release. A root
 * that is a file, or is not there, is one git starts in neither of, which
 * read as a session outside a work tree, exit 0 and no word, and the guard
 * someone had configured was off.
 */
export function readHookLine(root: string | undefined, cwd: string, isDirectory: (path: string) => boolean): Guards | GuardOff {
  const given = root === '' ? cwd : root;
  if (given !== undefined && !isDirectory(given)) {
    return { state: 'off', fault: { wrong: noDirectory(given), mend: "give the hook's line a directory that exists, or leave --root out for the project Claude Code names" } };
  }
  return { state: 'guards', root: given };
}

/**
 * A line whose root is a directory outside any git work tree. The hook
 * reads that as a session outside one, where it has nothing to guard: it
 * checks no write and says nothing, exit 0 (ADR-0005), and that stays. Only
 * git can tell such a root, so the caller asks it. A line that carries one
 * is a guard someone set up that checks nothing, and `doctor` says it as
 * off.
 */
export function outsideHookLine(root: string): GuardOff {
  return {
    state: 'off',
    silent: true,
    fault: {
      wrong: `--root is "${root}", a directory outside any git work tree, which the hook reads as a session outside one, exit 0 and no word`,
      mend: "give the hook's line a directory in the work tree, or leave --root out for the project Claude Code names",
    },
  };
}

/**
 * What Claude Code's hook does with the words it is handed, or `null` for
 * words that are not its line: read by the parser the command line reads
 * every line with, and known by its command and the argument after it on a
 * line that parsed and on one that did not, as the command line knows it
 * (cli.ts). `parse` is that parser, which throws its refusal with the words
 * it could still read.
 *
 * A line that guards says which brief it names, where it names one: the hook
 * passes over a `--brief` that is empty, as every release has, and holds
 * every write under one that names no brief, which only spec-brief can tell.
 */
export function claudeHookLine(
  words: readonly string[],
  parse: (argv: readonly string[]) => CommandLine,
  cwd: string,
  isDirectory: (path: string) => boolean,
): HookLine | null {
  let line: CommandLine;
  try {
    line = parse(words);
  } catch (error) {
    const refused = error as { readonly message: string; readonly words: readonly string[] };
    return isClaudeHook(refused.words[0], refused.words[1]) ? unreadHookLine(refused.message) : null;
  }
  if (!isClaudeHook(line.command, line.positionals[0])) return null;
  const read = readHookLine(line.root, cwd, isDirectory);
  return read.state === 'guards' && line.brief !== undefined && !isBlank(line.brief) ? { ...read, brief: line.brief } : read;
}

/**
 * Why the command line is refused, or `null` when the command can run:
 * an option it does not read, alone or beside another, an argument it does
 * not take, a brief named twice, a value or an argument that names nothing,
 * a `--root` that is no directory. Asked once a command is known and neither
 * `--help` nor `--version` answers instead; a command with no shape is none,
 * which its caller says.
 */
export function refusal(line: CommandLine, isDirectory: (path: string) => boolean): string | null {
  const { command, positionals } = line;
  // No shape is kept under `undefined`, so the first check is the compiler's,
  // and its mutant is equivalent.
  if (command === undefined) return null;
  const shape = SHAPES.get(command);
  if (shape === undefined || isClaudeHook(command, positionals[0])) return null;
  const stray = line.given.find((option) => !shape.options.includes(option));
  if (stray !== undefined) return `${command} does not take --${stray}; ${listed(shape.options)}`;
  // An option the command reads, beside one that leaves it unread:
  // `escalate --list --path src/a.ts` printed the list, exit 0, and the
  // request it also spelled out was never raised.
  const mode = shape.modes?.find((candidate) => line.given.includes(candidate.option));
  if (mode !== undefined) {
    const unread = line.given.find((option) => option !== mode.option && !mode.beside.includes(option));
    if (unread !== undefined) return `${command} --${mode.option} does not take --${unread}; beside --${mode.option} ${listed(mode.beside)}`;
  }
  if (shape.limit !== null && positionals.length > shape.limit.most) {
    return `${command} takes ${shape.limit.takes}, not ${positionals.map((argument) => JSON.stringify(argument)).join(', ')}`;
  }
  // One thing named two ways, whatever the two hold: the argument won with
  // no word, so `audit 012 --brief 013` audited 012 for someone who had
  // also typed 013.
  const { argument } = shape;
  if (argument?.option !== undefined && positionals.length > 0 && line.given.includes(argument.option)) {
    return `${command} was given ${argument.role} twice, as its argument ${JSON.stringify(positionals[0])} and as --${argument.option} ${JSON.stringify(line[argument.option])}; give one of them`;
  }
  for (const [option, valued] of Object.entries(VALUED) as [ValuedOption, Valued][]) {
    if (shape.reports?.includes(option)) continue;
    const empty = valued.of(line).find(isBlank);
    if (empty !== undefined) return emptyValue(`--${option}`, option, empty);
  }
  const empty = positionals.find(isBlank);
  if (shape.argument !== undefined && empty !== undefined) {
    return `${command} was given ${JSON.stringify(empty)} as ${shape.argument.role}, which names none; ${shape.argument.instead}`;
  }
  // An empty one was refused above, so this is a path that was meant: a file,
  // or a directory that is not there. git starts in neither, and the run
  // ended saying the path was outside a work tree, which named neither the
  // option nor what was wrong with what it was given.
  if (line.root !== undefined && !isDirectory(line.root)) {
    return `${noDirectory(line.root)}; give it one that exists, or leave it out to run in the current directory`;
  }
  return null;
}
