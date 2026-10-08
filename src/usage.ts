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
const VALUED = {
  brief: { of: (line) => one(line.brief), says: "names no brief; give it a brief's id, or leave it out for the one SPEC_BRIEF or the branch names" },
  base: { of: (line) => one(line.base), says: 'names no commit; give it a branch or a commit, or leave it out for the configured base' },
  root: { of: (line) => one(line.root), says: 'names no directory; give it one, or leave it out to run in the current directory' },
  path: { of: (line) => line.paths, says: 'names no file; give it the path of a file' },
  reason: { of: (line) => one(line.reason), says: 'gives no reason; say why the round cannot be done without the file' },
  option: { of: (line) => line.options, says: 'names no choice; give it "<label>: <cost>", or leave it out' },
  recommend: { of: (line) => one(line.recommend), says: 'recommends nothing; say which option and why, or leave it out' },
  show: { of: (line) => one(line.show), says: 'names no escalation; give it an id, as spec-harness escalate --list prints them' },
  id: { of: (line) => one(line.id), says: "names no probe; give it a probe's id, or leave it out to run every probe" },
} as const satisfies Record<string, Valued>;

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
  /** What an argument of it is, and what to do about an empty one; absent where it takes none, or says so itself. */
  readonly argument?: { readonly role: string; readonly instead: string };
  /** The options whose empty value the command says in its own report. */
  readonly reports?: readonly string[];
}

const NO_ARGUMENT = { limit: { most: 0, takes: 'no argument' } } as const;
const ONE_BRIEF = {
  limit: { most: 1, takes: "one argument at most, a brief's id" },
  argument: { role: 'the brief', instead: "give it a brief's id, or leave it out for the one --brief, SPEC_BRIEF or the branch names" },
} as const;

/**
 * Every command, with what it reads of a command line. An option is listed
 * for a command only where the command's answer depends on it: `init`
 * chooses the base itself and the server is told the brief by each call, so
 * neither takes `--base` or `--brief`, and taking them would tell someone
 * the base or the brief had been set.
 */
const SHAPE = {
  context: { options: ['brief', 'base', 'root', 'format'], ...ONE_BRIEF },
  guard: {
    options: ['brief', 'base', 'root', 'format', 'strict'],
    limit: null,
    argument: { role: 'a path', instead: 'give it the paths the round would write' },
  },
  hook: { options: ['brief', 'base', 'root'], limit: { most: 1, takes: 'one argument, "claude" or "git"' } },
  escalate: { options: ['brief', 'root', 'format', 'path', 'reason', 'option', 'recommend', 'list', 'show'], ...NO_ARGUMENT },
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
} as const satisfies Record<string, Shape>;

/** Every command there is: the command line dispatches on these names and no other. */
export type Command = keyof typeof SHAPE;

// A map, since a command is a word a person types and an object answers to
// more names than it was given: `constructor` has no shape.
const SHAPES: ReadonlyMap<string, Shape> = new Map(Object.entries(SHAPE));

function listed(options: readonly string[]): string {
  const names = options.map((option) => `--${option}`);
  // Every command reads at least `--root`, so a list is never empty.
  if (names.length === 1) return `its only option is ${names[0] as string}`;
  return `its options are ${names.slice(0, -1).join(', ')} and ${names.at(-1) as string}`;
}

/**
 * Whether the line is Claude Code's hook. It is exempt from every refusal
 * here, and read as each release since 0.1.0 read it: the line lives in
 * settings files and in the plugin of every release, which this one cannot
 * rewrite, and exit 2 from it holds every write of a session, the write that
 * would fix the line among them. An option the parser itself does not know
 * is exit 2 there, as it always was.
 */
function isClaudeHook(line: CommandLine): boolean {
  return line.command === 'hook' && line.positionals[0] === 'claude';
}

/**
 * Why the command line is refused, or `null` when the command can run:
 * an option it does not read, an argument it does not take, a value or an
 * argument that names nothing, a `--root` that is no directory. Asked once a
 * command is known and neither `--help` nor `--version` answers instead; a
 * command with no shape is none, which its caller says.
 */
export function refusal(line: CommandLine, isDirectory: (path: string) => boolean): string | null {
  const { command, positionals } = line;
  // No shape is kept under `undefined`, so the first check is the compiler's,
  // and its mutant is equivalent.
  if (command === undefined) return null;
  const shape = SHAPES.get(command);
  if (shape === undefined || isClaudeHook(line)) return null;
  const stray = line.given.find((option) => !shape.options.includes(option));
  if (stray !== undefined) return `${command} does not take --${stray}; ${listed(shape.options)}`;
  if (shape.limit !== null && positionals.length > shape.limit.most) {
    return `${command} takes ${shape.limit.takes}, not ${positionals.map((argument) => JSON.stringify(argument)).join(', ')}`;
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
    return `--root is "${line.root}", which is not a directory; give it one that exists, or leave it out to run in the current directory`;
  }
  return null;
}
