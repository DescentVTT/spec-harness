/**
 * The command line: arguments, dispatch, output and exit codes.
 *
 * Exit 0: done, nothing refused. Exit 1: something refused or found. Exit 2:
 * the answer cannot be trusted - a bad flag, an option, an argument or a
 * value that names nothing, a configuration that does not load, a sibling
 * that is missing or printed something unreadable, a git command that
 * failed, an output its reader closed, an error nothing here expected. A run
 * that could not look must never exit as though it looked and found nothing
 * (spec-core ADR-0005).
 */

import { SiblingOutputError } from './briefs.js';
import { auditCommand, contextCommand, escalateCommand, probeCommand, ruleCommand, rulingsCommand } from './commands.js';
import { ConfigError, SIBLINGS } from './config.js';
import {
  describeBase,
  describeClaudeCode,
  describeClaudeRelease,
  describeGitHook,
  describeHooksOff,
  describePlugin,
  describePresence,
  describeSignerKeys,
  describeSignerProblem,
  describeSigners,
  guardSwitchedOff,
  wiringState,
  type ClaudeCodeWiring,
} from './configure.js';
import { isDirectory } from './fs.js';
import { GitError, show, stagedChanges } from './git.js';
import type { Decision } from './guard.js';
import { claudeResponse, gitResponse, parseClaudeHook, type HookRequest } from './hooks.js';
import { premisesCommand } from './premises.js';
import { createReader } from './reader.js';
import { checkPaths, claudeCodeWiring, diagnoseBrief, resolveBase, specBriefPlugin, type Base } from './round.js';
import { mcpCommand } from './server.js';
import { gitHook, initCommand } from './setup.js';
import { notFido2, readAllowedSigners } from './signers.js';
import { SiblingError } from './siblings.js';
import { emptyValue, heldHookLine, isBlank, isClaudeHook, readHookLine, refusal, unreadHookLine, type Command, type LineFault } from './usage.js';
import { CLAUDE_CODE_MINIMUM, MINIMUM_VERSIONS, type ClaudeCodeCheck } from './versions.js';
import {
  activeBrief,
  answerOf,
  describeActive,
  EXIT_ERROR,
  EXIT_FAILED,
  EXIT_OK,
  json,
  openWorkspace,
  parseOptions,
  UsageError,
  version,
  type CliIO,
  type Options,
  type UnreadableLine,
  type Workspace,
} from './workspace.js';

export { EXIT_ERROR, EXIT_FAILED, EXIT_OK, UsageError, version, type CliIO } from './workspace.js';

export const HELP = `spec-harness - context, guards, audits and rulings for rounds of agent work

Usage:
  spec-harness <command> [options]

Commands:
  context [brief]     What an agent needs to start a round: the brief, its scope,
                      rulings, dependencies, the rules in force, the cited documents.
  guard <path...>     May the round write these paths? Exit 1 if one is refused.
  hook claude         Answer a Claude Code PreToolUse or PostToolUse hook (stdin).
  hook git            Answer git's pre-commit hook for the staged files.
  escalate            Ask a person to rule: --path <file> (repeatable) --reason <why>
                      [--option "<label>: <cost>"]... [--recommend <text>].
                      --list shows what waits; --show <id> prints one memo. Neither
                      raises a request: beside one, only --root and --format are read.
  rule <id>           Record a person's ruling in the brief: --allow or --deny, with
                      --note <text>. It counts once committed signed.
  rulings [brief]     The brief's rulings, and whether each one's signature verifies.
  audit [brief]       Did the round stay inside the lines: what the archive would say,
                      the brief's assertions, unverified rulings, new dependencies
                      and the install scripts it allowed.
  probe [brief]       Run the brief's probes: red at the base, green at the head.
                      --at <base|head|both>, --id <probe>.
  premises            Do the live briefs' premises still hold? For CI: exit 1 when one
                      is stale, or, with --strict, when spec-guard cannot read one.
  init                Configure the spec-* tools to agree. Prints the plan; --write
                      applies it; --git-hook adds a pre-commit hook.
  mcp                 Serve start_round, check_path, request_escalation, audit_round,
                      list_rounds and the workflow prompts over MCP on stdio.
  doctor              Which siblings are installed, at which versions, which brief is
                      named, how Claude Code runs the guard, and git's hook. Exit 1
                      when a sibling is older than this release needs, the guard is
                      installed twice, its hook's line turns it off or holds every
                      write, disableAllHooks or an array for a matcher switches it
                      off, the plugin that is turned on is not on this machine and
                      nothing else guards, Claude Code is too old to run its hooks,
                      or git stops every commit at what stands for its hook.

Options:
  --brief <id>        The brief the round works on. Otherwise SPEC_BRIEF, then the branch.
                      For context, guard, hook, escalate, rulings, audit, probe, premises
                      and doctor.
  --base <ref>        What the round is measured from. Otherwise "base" in
                      .spec-harness.json, then the remote's default branch. For context,
                      guard, hook, rulings, audit, probe and doctor.
  --root <dir>        Run from another directory, which must exist. For every command.
  --format <fmt>      pretty or json; audit and premises also gitlab, sarif or github.
                      For every command but hook and mcp.
  --strict            Warnings fail the run. For guard, audit, premises and doctor.
  --help, --version

An option a command does not read, an argument it does not take, an option or an
argument given an empty value, and a brief given both as the argument and as --brief
are refused, exit 2, not read as if they were not there. doctor says an empty --brief
or --base in its report. hook claude reads its line as every release has, and says a
line it cannot read, and a --root that is not a directory, with exit 1: it refuses
nothing for either.

Exit codes: 0 clean, 1 refused or found something, 2 the answer cannot be trusted.
`;


/* ------------------------------------------------------------------- guard */

const reader = createReader();

async function decisionsFor(
  workspace: Workspace,
  options: Options,
  io: CliIO,
  given: readonly string[],
  cwd: string,
): Promise<{ readonly decisions: Decision[] } | { readonly problem: string }> {
  const active = await activeBrief(workspace, options, io.env);
  const { brief, note, problem } = describeActive(active);
  if (problem !== null) return { problem };
  return { decisions: await checkPaths(workspace, brief, note, given, cwd, reader, options.base) };
}

const SYMBOL: Record<Decision['verdict'], string> = { allow: 'ok     ', warn: 'warning', ask: 'ask    ', deny: 'refused' };

async function guardCommand(options: Options, io: CliIO): Promise<number> {
  if (options.positionals.length === 0) throw new UsageError('guard needs at least one path');
  const workspace = await openWorkspace(options, io);
  const decided = await decisionsFor(workspace, options, io, options.positionals, io.cwd);
  if ('problem' in decided) {
    io.stderr.write(`spec-harness: ${decided.problem}\n`);
    return EXIT_ERROR;
  }
  const { decisions } = decided;
  if (options.format === 'json') {
    io.stdout.write(json('guard', { decisions }));
  } else {
    for (const decision of decisions) {
      io.stdout.write(`${SYMBOL[decision.verdict]}  ${decision.message}\n`);
      if (decision.verdict !== 'allow') io.stdout.write(`         ${decision.hint}\n`);
    }
  }
  const refused = decisions.some((d) => d.verdict === 'deny' || d.verdict === 'ask');
  const warned = decisions.some((d) => d.verdict === 'warn');
  return refused || (options.strict && warned) ? EXIT_FAILED : EXIT_OK;
}

/* -------------------------------------------------------------------- hook */

async function readStdin(io: CliIO): Promise<string> {
  // Only the built command line reads process.stdin, and the suite spawns it
  // from dist/, outside the sweep (tests/integration/claude-code.test.ts): the
  // lines below survive it untested in-process.
  if (io.stdin !== undefined) return io.stdin();
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * The write Claude Code asks the hook about, or the exit code that answers
 * already: 1 for a question that cannot be read, 0 for a tool that writes
 * no file. Asked before anything on the hook's own line is, so that a line
 * that is wrong is said where there is a write it leaves unchecked.
 */
async function writeAsked(io: CliIO): Promise<HookRequest | number> {
  let question: string;
  try {
    question = await readStdin(io);
  } catch (error) {
    // A question that could not be read is one the hook cannot see, as one
    // it cannot parse is, below: it has no event to hold a write by.
    io.stderr.write(`spec-harness: the hook input could not be read: ${(error as Error).message}\n`);
    return EXIT_FAILED;
  }
  const request = parseClaudeHook(question);
  if ('error' in request) {
    // A hook that cannot read its question refuses nothing it cannot see,
    // but says so where the person reads it: a non-blocking error.
    io.stderr.write(`spec-harness: ${request.error}\n`);
    return EXIT_FAILED;
  }
  return request.paths.length === 0 ? EXIT_OK : request;
}

/**
 * What is wrong with the hook's own line, said and nothing refused for it:
 * one line, since Claude Code shows the first line of the stderr of a hook
 * that exits 1 and goes on with the write, where exit 2 would hold every
 * write of the session, the one that mends the line among them (ADR-0005).
 */
function guardOff(io: CliIO, { wrong, mend }: LineFault): number {
  io.stderr.write(`spec-harness: ${wrong}, so the guard is off and this write is not checked; ${mend}\n`);
  return EXIT_FAILED;
}

/**
 * Claude Code's hook on a line the parser refused: an option no command has,
 * an option left without its value, a --format or an --at that is none. It
 * was exit 2 before the question was read, for the line a settings file
 * holds as for one typed at a terminal. What is said of it is `doctor`'s
 * to say as well, of a line it finds in a settings file (usage.ts).
 */
async function unreadLine(said: string, io: CliIO): Promise<number> {
  const request = await writeAsked(io);
  if (typeof request === 'number') return request;
  return guardOff(io, unreadHookLine(said).fault);
}

async function hookCommand(options: Options, io: CliIO): Promise<number> {
  const kind = options.positionals[0];
  if (kind === 'claude') {
    const request = await writeAsked(io);
    if (typeof request === 'number') return request;
    // The root the line gives, or what is wrong with it: read as `doctor`
    // reads the line where it finds it in a settings file (usage.ts).
    const line = readHookLine(options.root, io.cwd, isDirectory);
    if (line.state === 'off') return guardOff(io, line.fault);
    const cwd = request.cwd ?? io.cwd;
    let workspace: Workspace;
    try {
      workspace = await openWorkspace({ ...options, root: line.root ?? io.env['CLAUDE_PROJECT_DIR'] ?? cwd }, io);
    } catch (error) {
      if (error instanceof UsageError) return EXIT_OK;
      throw error;
    }
    try {
      const decided = await decisionsFor(workspace, options, io, request.paths, cwd);
      if ('problem' in decided) {
        // Exit 2 blocks the tool call, and its stderr reaches the model. Where
        // the name stands on the hook's own line, what is wrong with it is
        // `doctor`'s to say as well, in the same words (usage.ts).
        io.stderr.write(`spec-harness: ${heldHookLine(decided.problem).wrong}. Fix the brief or the branch before writing.\n`);
        return EXIT_ERROR;
      }
      const response = claudeResponse(request.event, decided.decisions);
      io.stdout.write(response.stdout);
      return response.exitCode;
    } catch (error) {
      if (request.event !== 'PreToolUse') throw error;
      // A round is named and its briefs cannot be read: the guard cannot
      // tell a protected file from any other, so the write waits.
      io.stderr.write(`spec-harness: cannot check this write: ${(error as Error).message}\n`);
      return EXIT_ERROR;
    }
  }
  if (kind === 'git') {
    const workspace = await openWorkspace(options, io);
    const staged = await stagedChanges(workspace.root);
    const paths = staged.flatMap((change) => (change.from === undefined ? [change.path] : [change.from, change.path]));
    if (paths.length === 0) return EXIT_OK;
    const decided = await decisionsFor(workspace, options, io, paths, workspace.root);
    if ('problem' in decided) {
      io.stderr.write(`spec-harness: ${decided.problem}\n`);
      return EXIT_ERROR;
    }
    const response = gitResponse(decided.decisions);
    io.stderr.write(response.text);
    return response.exitCode;
  }
  throw new UsageError('hook takes "claude" or "git"');
}

/* ------------------------------------------------------------------ doctor */

/**
 * The base, and the allowed-signers file as it is on it: the file waits on
 * the base, and the two on nothing else doctor asks. A --base given nothing
 * is no base, said as the brief's is, in the report.
 */
async function baseAndSigners(workspace: Workspace, flag: string | undefined, signersFile: string): Promise<{ readonly base: Base; readonly signersText: string | null }> {
  // Nothing in doctor asks what kind a base is but whether it is resolved, so
  // the mutant that names this one otherwise is equivalent.
  const base: Base = flag !== undefined && isBlank(flag) ? { kind: 'unresolved', reason: emptyValue('--base', 'base', flag) } : await resolveBase(workspace, flag);
  // An unresolved base has no commit: git shows nothing for one, so asking
  // anyway reads as no file, and that mutant is equivalent.
  const signersText = base.kind === 'resolved' ? await show(base.sha, signersFile, workspace.root) : null;
  return { base, signersText };
}

/**
 * How Claude Code is wired to the guard, and the release of the one on
 * `PATH`, which waits on the wiring: only a Claude Code that runs the guard
 * is asked its release, since one older than the hooks need lets every
 * write through unguarded. `null` where it was not asked. The wiring asks
 * it itself, since which writes a line is started for can turn on the
 * release as well (round.ts); the two are told apart here for the report,
 * which has a place of its own for the release.
 */
async function wiringAndRelease(root: string, io: CliIO): Promise<{ readonly wiring: Omit<ClaudeCodeWiring, 'release'>; readonly release: ClaudeCodeCheck | null }> {
  const { release, ...wiring } = await claudeCodeWiring(root, io);
  return { wiring, release };
}

async function doctorCommand(options: Options, io: CliIO): Promise<number> {
  const workspace = await openWorkspace(options, io);
  const rows = SIBLINGS.map((name) => {
    const sibling = workspace.siblings.locate(name);
    const row = { tool: name, state: sibling.kind, minimum: MINIMUM_VERSIONS[name] };
    if (sibling.kind === 'absent') return { ...row, version: null, detail: sibling.reason };
    if (sibling.kind === 'outdated') return { ...row, version: sibling.version, detail: sibling.reason };
    const command = sibling.command.join(' ');
    const detail = sibling.version === null ? `${command} (named in .spec-harness.json; its version is not checked)` : `${command} (${sibling.version})`;
    return { ...row, version: sibling.version, detail };
  });
  const signersFile = workspace.config.rulings.allowedSigners;
  // Five things that wait on the work tree and on nothing of one another,
  // each a process or a chain of them. Asked one after another, Claude
  // Code's release, the longest wait of a doctor on Windows, was asked for
  // only when every answer of git's before it was in. So they are asked at
  // once, and read below in the order they were asked in before: where more
  // than one fails, the first of that order is the one thrown, whichever
  // failed first by the clock (ADR-0002).
  const [briefAsked, baseAsked, pluginAsked, claudeAsked, hookAsked] = await Promise.allSettled([
    diagnoseBrief(workspace, options, io.env),
    baseAndSigners(workspace, options.base, signersFile),
    specBriefPlugin(workspace.root),
    wiringAndRelease(workspace.root, io),
    gitHook(workspace.root),
  ]);
  const named = answerOf(briefAsked);
  // A ruling counts only by a signature checked against the allowed signers
  // on the base, and only once spec-brief's archive asks the plugin about it.
  const { base, signersText } = answerOf(baseAsked);
  const onBase = base.kind === 'resolved' ? signersText !== null : null;
  const signers = describeSigners(signersFile, base.kind === 'resolved' ? base.ref : null, onBase === true);
  // Which keys sign, as notes: a key that is not FIDO2 can still be one the
  // agent cannot use, and a PIV key reads as a plain one (ADR-0006).
  const read = readAllowedSigners(signersText ?? '');
  const plain = notFido2(read.signers);
  const signerNotes = [describeSignerKeys(plain), ...read.problems.map(describeSignerProblem)].filter((note): note is string => note !== null);
  const plugin = answerOf(pluginAsked);
  // The plugin and init's entries both on: Claude Code runs every guard twice
  // and registers the server twice (ADR-0012).
  const { wiring, release } = answerOf(claudeAsked);
  const claude = wiringState(wiring);
  // What the hook does with each line the settings hold for it, where there
  // is something to say: more on it than init writes, a line that turns the
  // guard off or holds every write, one only a shell can read, the writes
  // Claude Code starts it for where they are not all of them, and what
  // onFailure changes.
  const lineNotes = wiring.lines.flatMap((line) => [line.detail, line.cover, line.note]).filter((note): note is string => note !== null);
  // What stands over every line: a plugin that is turned on and is not on
  // this machine, or cannot be told to be, and disableAllHooks, which
  // switches off whatever hooks there are.
  const switchedOff = guardSwitchedOff(wiring);
  const wiringNotes = [describePresence(wiring), wiring.hooksOff === null ? null : describeHooksOff(wiring.hooksOff, switchedOff)].filter((note): note is string => note !== null);
  // How the hook runs the harness is a note: one that goes through npx guards
  // as well as one that does not, and fails nothing, --strict or not.
  const { hook, note: hookNote } = answerOf(hookAsked);
  const branch = workspace.branch === null ? '(detached)' : `${workspace.branch}${workspace.branchSource === undefined ? '' : ` (detached; ${workspace.branchSource} names it)`}`;
  if (options.format === 'json') {
    io.stdout.write(
      json('doctor', {
        root: workspace.root,
        branch: workspace.branch,
        branchSource: workspace.branchSource ?? null,
        brief: named.id,
        briefProblem: named.problem,
        base: base.kind === 'resolved' ? { ref: base.ref, source: base.source, mergeBase: base.mergeBase } : { unresolved: base.reason },
        allowedSigners: {
          file: signersFile,
          onBase,
          detail: signers,
          notFido2: plain.map(({ line, principals, keyType }) => ({ line, principals, keyType })),
          problems: read.problems,
        },
        plugin: { state: plugin.kind, file: 'file' in plugin ? plugin.file : null, detail: describePlugin(plugin) },
        claudeCode: {
          state: claude,
          ...wiring,
          detail: describeClaudeCode(wiring),
          notes: wiringNotes,
          release:
            release === null
              ? { state: 'unchecked', version: null, minimum: CLAUDE_CODE_MINIMUM, detail: 'not asked: nothing wires Claude Code to the guard here' }
              : { state: release.state, version: 'version' in release ? release.version : null, minimum: CLAUDE_CODE_MINIMUM, detail: describeClaudeRelease(release) },
        },
        gitHook: { state: hook.state, file: 'file' in hook ? hook.file : null, detail: describeGitHook(hook), note: hookNote },
        siblings: rows,
      }),
    );
  } else {
    const more = (notes: readonly string[]): string[] => notes.map((note) => `        ${note}`);
    io.stdout.write(
      [
        `root    ${workspace.root}`,
        `branch  ${branch}`,
        `brief   ${named.problem === null ? (named.id ?? '(none named)') : `none: ${named.problem}`}`,
        `base    ${describeBase(base)}`,
        `signers ${signers}`,
        ...more(signerNotes),
        `plugin  ${describePlugin(plugin)}`,
        `claude  ${describeClaudeCode(wiring)}`,
        ...more(wiringNotes),
        ...more(lineNotes),
        ...more(release === null ? [] : [describeClaudeRelease(release)]),
        `git     ${describeGitHook(hook)}`,
        ...more(hookNote === null ? [] : [hookNote]),
        '',
        '',
      ].join('\n'),
    );
    for (const row of rows) io.stdout.write(`${row.state.padEnd(8)}  ${row.tool.padEnd(10)}  ${row.detail}\n`);
  }
  // An outdated sibling is a problem to fix, where a missing optional one is
  // a choice; with none installed, the harness can check nothing. A double
  // install is a problem too, where no Claude Code wiring at all is a choice,
  // and so are a hook whose own line turns the guard off or holds every
  // write, guard hooks that disableAllHooks switches off, a plugin that is
  // turned on and is not on this machine where no hook of init's stands in
  // for it, a Claude Code too old to run the hooks, and something at the
  // path of git's pre-commit hook that git cannot run and stops every
  // commit at. A release that cannot be told is not fine either, nor a
  // line whose reading cannot be, nor a plugin that cannot be told to be on
  // this machine: --strict fails the three.
  const outdated = rows.some((row) => row.state === 'outdated');
  const usable = rows.some((row) => row.state === 'found');
  const off = wiring.lines.some((line) => line.state === 'off' || line.state === 'held');
  const missing = wiring.presence?.state === 'absent' && wiring.hooks.length === 0;
  const tooOld = release?.state === 'outdated';
  const stopped = hook.state === 'stops';
  const untold = options.strict && (release?.state === 'unknown' || wiring.lines.some((line) => line.state === 'unknown') || wiring.presence?.state === 'unknown');
  return outdated || !usable || claude === 'both' || off || switchedOff || missing || tooOld || stopped || untold ? EXIT_FAILED : EXIT_OK;
}

/* ---------------------------------------------------------------- dispatch */

/**
 * A map, because the command is the first word a person types and an object
 * answers to more names than it was given: `spec-harness constructor` ran
 * `Object` as a command and ended on a stack trace, where `spec-harness
 * construct` is an unknown command with exit 2.
 */
const COMMANDS: ReadonlyMap<string, (options: Options, io: CliIO) => Promise<number>> = new Map(
  // One for every command that has a shape (usage.ts), which the compiler holds.
  Object.entries({
    guard: guardCommand,
    hook: hookCommand,
    context: contextCommand,
    audit: auditCommand,
    escalate: escalateCommand,
    rule: ruleCommand,
    rulings: rulingsCommand,
    probe: probeCommand,
    premises: premisesCommand,
    init: initCommand,
    mcp: mcpCommand,
    doctor: doctorCommand,
  } satisfies Record<Command, (options: Options, io: CliIO) => Promise<number>>),
);

async function dispatch(argv: readonly string[], io: CliIO): Promise<number> {
  let options: Options;
  try {
    options = parseOptions(argv);
  } catch (error) {
    // The parser throws nothing but its refusal of the line, which holds
    // whose line it was. Claude Code's hook says its own, and holds no
    // write for it.
    const refused = error as UnreadableLine;
    if (isClaudeHook(refused.words[0], refused.words[1])) return unreadLine(refused.message, io);
    io.stderr.write(`spec-harness: ${refused.message}\n`);
    return EXIT_ERROR;
  }
  if (options.version) {
    io.stdout.write(`${version()}\n`);
    return EXIT_OK;
  }
  if (options.help || options.command === undefined) {
    io.stdout.write(HELP);
    return options.help ? EXIT_OK : EXIT_ERROR;
  }
  const command = COMMANDS.get(options.command);
  if (command === undefined) {
    io.stderr.write(`spec-harness: unknown command "${options.command}"; see spec-harness --help\n`);
    return EXIT_ERROR;
  }
  // What parsed and names nothing, before anything is read or written for it.
  const refused = refusal(options, isDirectory);
  if (refused !== null) {
    io.stderr.write(`spec-harness: ${refused}\n`);
    return EXIT_ERROR;
  }
  return command(options, io);
}

/**
 * Runs the command line and resolves to the exit code, for an error nothing
 * below expected too.
 *
 * Such an error is neither a refusal nor a finding: the answer cannot be
 * trusted, which is exit 2 (spec-core ADR-0005). Rejected instead, it reached
 * the launcher as Node's uncaught error, exit 1, "refused or found something"
 * to a script, and to Claude Code a hook that failed without blocking: the
 * write the guard could not check went ahead. The stack is what makes a
 * report of it something to act on, and it goes to stderr alone: a script
 * that reads a document from stdout is handed no part of one.
 *
 * A write its reader had closed the pipe for is not such an error: the answer
 * was not delivered, which is still 2, and nothing in the harness is at
 * fault, so it is said in a line and no stack sends a person looking for a
 * defect. The process's own streams report it as an event, which the
 * launcher answers in the same words; here it is a caller's stream that
 * throws it. It is read by its code: stdout and stderr are the only pipes
 * the harness writes to.
 */
export async function run(argv: readonly string[], io: CliIO): Promise<number> {
  try {
    return await dispatch(argv, io);
  } catch (error) {
    // A sibling's document of a shape the harness does not read is a sibling
    // that printed something it cannot read (answers.ts): exit 2. A git
    // command that failed is what git said, and no line of the harness's.
    if (
      error instanceof UsageError ||
      error instanceof ConfigError ||
      error instanceof SiblingError ||
      error instanceof SiblingOutputError ||
      error instanceof GitError
    ) {
      io.stderr.write(`spec-harness: ${error.message}\n`);
      return EXIT_ERROR;
    }
    if (!(error instanceof Error)) io.stderr.write(`spec-harness: unexpected error: ${String(error)}\n`);
    else if ((error as NodeJS.ErrnoException).code === 'EPIPE') io.stderr.write('spec-harness: stdout was closed before all of the output was written\n');
    else io.stderr.write(`spec-harness: unexpected error: ${error.stack ?? error.message}\n`);
    return EXIT_ERROR;
  }
}

// What bin/spec-harness.js runs; the suite spawns the built one, from dist/,
// outside the sweep (tests/integration/cli.test.ts), so it survives untested
// in-process.
export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  return run(argv, { stdout: process.stdout, stderr: process.stderr, cwd: process.cwd(), env: process.env });
}

