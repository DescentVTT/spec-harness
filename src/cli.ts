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
 *
 * A command loads what it runs. This module imports what every run needs,
 * the hook's before a write among them, and a module that only some
 * commands run is imported where one of them is the command: the hook
 * runs before and after every write an agent makes, and what it loaded of
 * the other commands was a wait before each (ADR-0002). A module that
 * cannot be loaded is thrown where it was asked for, and ends the run in a
 * line and exit 2, as every error does.
 */

import { SiblingOutputError } from './briefs.js';
import { CONFIG_FILE, ConfigError, SIBLINGS, SPEC_BRIEF_CONFIGS } from './config.js';
import type { ClaudeCodeWiring } from './configure.js';
import { dirname, join } from 'node:path';

import { gitDirectories, holdsGit, isDirectory, keepCall, loadConfig, realSpelling, repositoryPath, StateError, takeCall } from './fs.js';
import { changedPaths, GitError, show, stagedChanges } from './git.js';
import type { DocumentReader } from './document.js';
import type { Decision } from './guard.js';
import { afterResponse, callFile, callRecord, claudeResponse, gitResponse, keptCall, parseClaudeHook, SESSION_START, sessionOf, sessionResponse, TURN_END, turnResponse, warningResponse, warningsKept, warningsOf, type CallRecord, type HookRequest, type HookResponse } from './hooks.js';
import type { Base } from './round.js';
import type { BriefRow } from './types.js';
import { SiblingError } from './siblings.js';
import { emptyValue, heldHookLine, isBlank, isClaudeHook, readHookLine, refusal, twoValues, unreadHookLine, type Command, type LineFault } from './usage.js';
import { CLAUDE_CODE_MINIMUM, MINIMUM_VERSIONS, type ClaudeCodeCheck } from './versions.js';
import {
  activeBrief,
  answerOf,
  describeActive,
  EXIT_ERROR,
  EXIT_FAILED,
  EXIT_OK,
  findTree,
  foundCommonDir,
  json,
  MAIN_INSTALL,
  openFound,
  openWorkspace,
  parseOptions,
  UsageError,
  version,
  type CliIO,
  type FoundTree,
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
  hook claude         Answer a Claude Code PreToolUse, PostToolUse, SessionStart or Stop
                      hook (stdin). At session start it says what would hold every
                      write; at a turn's end, with "turnReport" on, what the work tree
                      holds that the brief protects or that is outside its scope.
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
                      applies it; --git-hook adds a pre-commit hook; --block-on-failure
                      has Claude Code 2.1.295 or later hold a write when the hook cannot
                      start or runs past its timeout.
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
  --block-on-failure  onFailure "block" on init's entries but the one as a turn ends. For init.
  --help, --version   One of the two: both on one line are refused.

An option a command does not read, an argument it does not take, an option or an
argument given an empty value, a brief given both as the argument and as --brief,
and an option that takes one value given two that name two things are refused, exit 2,
not read as if they were not there, and so with --help or --version on the line. The
same value twice, as --root . --root ./, is read once. doctor says an empty --brief or
--base in its report. hook claude reads its line as every release has, and says a line
it cannot read, two values for one option among them, a --root that is not a
directory, and a question it cannot read, as a warning to the person with exit 0: it
refuses nothing for any of them.

Exit codes: 0 clean, 1 refused or found something, 2 the answer cannot be trusted.
`;


/* ------------------------------------------------------------------- guard */

/**
 * The reader of a brief's rulings, loaded where a ruling is read: a write
 * to a file no brief protects reads none.
 */
const reader = async (): Promise<DocumentReader> => (await import('./reader.js')).createReader();

/**
 * The work tree with spec-brief's answers kept for a session of Claude
 * Code's, and given again to it where all they were read from reads the
 * same (ADR-0002); as it is where no session is named.
 */
function keptFor(workspace: Workspace, session: string | null): Workspace {
  return session === null ? workspace : { ...workspace, siblings: workspace.siblings.keeping(workspace.commonDir, session) };
}

async function decisionsFor(
  workspace: Workspace,
  options: Options,
  io: CliIO,
  given: readonly string[],
  cwd: string,
  session: string | null = null,
): Promise<{ readonly decisions: Decision[]; readonly brief: BriefRow | null } | { readonly problem: string }> {
  const active = await activeBrief(keptFor(workspace, session), options, io.env);
  const { brief, note, problem } = describeActive(active);
  if (problem !== null) return { problem };
  const { checkPaths } = await import('./round.js');
  return { decisions: await checkPaths(workspace, brief, note, given, cwd, reader, options.base), brief };
}

/**
 * Whether a decision is of a file the answer after the write is made from:
 * the configuration, spec-brief's, the brief, or a file beside it in the
 * briefs' directory, which spec-brief reads too. A call that writes one is
 * decided again after the write, so that what the write changed is read
 * (ADR-0002).
 */
function decidesAnswers(decision: Decision, brief: BriefRow | null): boolean {
  if (decision.path === CONFIG_FILE || SPEC_BRIEF_CONFIGS.includes(decision.path)) return true;
  if (brief === null) return false;
  return decision.path === brief.file || decision.path.startsWith(`${dirname(brief.file)}/`);
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
 * The write Claude Code asks the hook about, or the session that starts, or
 * the exit code that answers already, 0: for a question that cannot be read,
 * said to the person, and for a tool that writes no file. Asked before
 * anything on the hook's own line is, so that a line that is wrong is said
 * where there is a write it leaves unchecked, or a session whose every write
 * it leaves so.
 */
async function writeAsked(io: CliIO): Promise<HookRequest | number> {
  let question: string;
  try {
    question = await readStdin(io);
  } catch (error) {
    // A question that could not be read is one the hook cannot see, as one
    // it cannot parse is, below: it has no event to hold a write by.
    return answer(io, warningResponse(`the hook input could not be read: ${(error as Error).message}, so nothing it asks about is checked`));
  }
  const request = parseClaudeHook(question);
  // A hook that cannot read its question refuses nothing it cannot see, and
  // says so where the person reads it.
  if ('error' in request) return answer(io, warningResponse(`${request.error}, so nothing it asks about is checked`));
  return request.paths.length === 0 && request.event !== SESSION_START && request.event !== TURN_END ? EXIT_OK : request;
}

/**
 * What is wrong with the hook's own line, said and nothing refused for it:
 * one line, shown to the person, and exit 0, where exit 2 would hold every
 * write of the session, the one that mends the line among them. Exit 1 said
 * it as well, and is what Claude Code counts as a hook that failed, which
 * `onFailure: "block"` holds the write for (ADR-0005).
 */
function guardOff(io: CliIO, { wrong, mend }: LineFault, event: string): number {
  if (event === SESSION_START) return answer(io, sessionResponse(`${wrong}, so the guard is off and no write of this session is checked; ${mend}`));
  if (event === TURN_END) return answer(io, turnResponse(`spec-harness: ${wrong}, so the guard is off and no write of this session is checked; ${mend}`));
  return answer(io, warningResponse(`${wrong}, so the guard is off and this write is not checked; ${mend}`));
}

function answer(io: CliIO, response: { readonly stdout: string; readonly exitCode: number }): number {
  io.stdout.write(response.stdout);
  return response.exitCode;
}

/**
 * What would hold every write of the session that starts, said once as it
 * starts and no write waits on it (ADR-0005): a configuration that does not
 * load, a brief named that spec-brief does not list or has archived, and
 * spec-brief itself, where a brief is named, missing, too old or unable to
 * list the briefs. Each in the words a write would be held with, and
 * `doctor` says, and with what mends it. `null` where nothing does. The
 * check never ends the session's start: whatever it meets is said.
 */
async function sessionProblem(options: Options, io: CliIO, root: string, cwd: string | null, session: string | null): Promise<string | null> {
  const held = 'so every write of this session is held until it is mended';
  try {
    const named = await openWorkspace({ ...options, root }, io);
    // A session in another work tree of the project has its writes decided
    // there, and so is the check (ADR-0005).
    const found = cwd === null ? null : await otherTree(named, cwd);
    const workspace = found === null ? named : await openFound(found, io, () => [named.root]);
    const { problem } = describeActive(await activeBrief(keptFor(workspace, session), options, io.env));
    return problem === null ? null : `${heldHookLine(problem).wrong}, ${held}: fix the brief or the branch before writing; spec-harness doctor says more`;
  } catch (error) {
    // A session in no work tree has nothing to guard, as a write there has
    // not. Anything else that stops the check stops a write's as well, which
    // is then held as one the hook cannot check: a configuration that does
    // not load, a spec-brief that is missing, too old or cannot list the
    // briefs, and whatever a defect throws.
    if (error instanceof UsageError) return null;
    return `${(error as Error).message}, ${held}; spec-harness doctor says more`;
  }
}

/** The most paths a report names one by one: past it, how many more there are. */
const REPORTED = 20;

/**
 * What the work tree holds at the end of a turn that the brief protects or
 * that is outside its scope, one line a path in the words a write of it is
 * given; or `null` where there is nothing to say: `turnReport` is off, no
 * brief is named, nothing changed is either, or the session is in no work
 * tree (ADR-0005). The work tree is the one a write of the session is
 * decided in. One start of git reads what changed, and nothing is asked of
 * the base, so no ruling is read: a protected file a signed ruling allows
 * is said as protected, and the audit reads the ruling. A configuration
 * that does not load is said by every write and as the session starts, and
 * here holds the report back without a word.
 */
async function turnReport(options: Options, io: CliIO, root: string, cwd: string | null): Promise<string | null> {
  try {
    const named = await openWorkspace({ ...options, root }, io);
    const found = cwd === null ? null : await otherTree(named, cwd);
    const workspace = found === null ? named : await openFound(found, io, () => [named.root]);
    if (!workspace.config.turnReport) return null;
    const { brief, problem } = describeActive(await activeBrief(workspace, options, io.env));
    if (problem !== null) return `spec-harness: ${heldHookLine(problem).wrong}, so what the work tree holds is not reported, and every write is held; spec-harness doctor says more`;
    if (brief === null) return null;
    const [changed, { decide }] = await Promise.all([changedPaths(workspace.root), import('./guard.js')]);
    const outOfScope = workspace.config.outOfScope;
    const said = changed.map((path) => decide({ path, given: path, brief, rulings: [], outOfScope })).filter((decision) => decision.verdict !== 'allow');
    if (said.length === 0) return null;
    const lines = said.slice(0, REPORTED).map((decision) => `- ${decision.message}. Next: ${decision.hint}.`);
    const more = said.length > REPORTED ? [`- and ${said.length - REPORTED} more: spec-harness guard <path> says each`] : [];
    const paths = said.length === 1 ? `a path that brief ${brief.id} protects or that is outside its scope` : `${said.length} paths that brief ${brief.id} protects or that are outside its scope`;
    return [`spec-harness: as this turn ended, the work tree held changes to ${paths}:`, ...lines, ...more].join('\n');
  } catch (error) {
    if (error instanceof UsageError || error instanceof ConfigError) return null;
    return `spec-harness: ${(error as Error).message}, so what the work tree holds is not reported`;
  }
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
  return guardOff(io, unreadHookLine(said).fault, request.event);
}

/**
 * Whether a work tree other than the one whose top is `top` may hold `cwd`:
 * `cwd` is outside it, or a `.git` stands in a directory between the two,
 * where a linked worktree, a submodule or a repository of its own starts.
 * Where neither is so, `cwd` is in that work tree, and git is asked nothing
 * more: a session works at its project's top, or below it, for nearly every
 * write. Answering that one may is what git is then asked, so the mutant
 * that always answers so is equivalent, at the cost of a process, and so
 * is each that only answers so more often: a slice one short reaches the
 * top itself, which holds a `.git`, and a part named in place of none is
 * a directory no top holds.
 */
function mayBeElsewhere(cwd: string, top: string): boolean {
  const path = repositoryPath(cwd, top, cwd);
  if (path === null) return true;
  const parts = path === '' ? [] : path.split('/');
  return parts.some((_, index) => holdsGit(join(top, ...parts.slice(0, index + 1))));
}

/**
 * The work tree that holds `cwd`, where it is another work tree of the
 * repository the hook's root names, by the git directory the two share;
 * `null` where `cwd` is in the root's own, in another repository, or in
 * none (ADR-0005).
 */
async function otherTree(named: Workspace, cwd: string): Promise<FoundTree | null> {
  if (!mayBeElsewhere(cwd, named.root)) return null;
  const found = await findTree(cwd);
  // The project's own work tree, found again, would decide every path the
  // same way once more: the check saves reading its configuration twice, and
  // its mutant is equivalent.
  if (found === null || found.root === named.root) return null;
  const common = await foundCommonDir(found);
  // git names a common directory wherever it names a top, so `null` is
  // there for the type.
  if (common === null || realSpelling(common) !== realSpelling(named.commonDir)) return null;
  return found;
}

/**
 * The work trees a write is decided in, each with the paths it decides
 * (ADR-0005). The repository is the one the hook's root names, as before,
 * and so is the work tree, but where the question's `cwd` is in another
 * work tree of that repository, linked or main, by the git directory the
 * two share: there a session works in a worktree while Claude Code names
 * the project it started in, and the hook decided by the project's branch,
 * which named no brief, so a protected write passed with no word. That work
 * tree decides the paths it holds, by its branch, its briefs and its
 * configuration, with its siblings looked for in its install and then the
 * project's. A path it does not hold is decided as before, by the work tree
 * the root names: a write to the project's own file from a worktree is
 * refused where it was. Where both hold a path, one is inside the other,
 * and the inner one holds it as git reads it. A `cwd` in another
 * repository, or in none, leaves every path where it was.
 */
async function writesBy(named: Workspace, cwd: string | null, paths: readonly string[], io: CliIO): Promise<{ readonly workspace: Workspace; readonly paths: readonly string[] }[]> {
  const asBefore = [{ workspace: named, paths }];
  if (cwd === null) return asBefore;
  const found = await otherTree(named, cwd);
  if (found === null) return asBefore;
  const inner = repositoryPath(found.root, named.root, cwd) !== null;
  const holds = (path: string): boolean => repositoryPath(path, found.root, cwd) !== null && (inner || repositoryPath(path, named.root, cwd) === null);
  const own = paths.filter(holds);
  if (own.length === 0) return asBefore;
  const workspace = await openFound(found, io, () => [named.root]);
  const rest = paths.filter((path) => !holds(path));
  return [{ workspace, paths: own }, ...(rest.length === 0 ? [] : [{ workspace: named, paths: rest }])];
}

/**
 * The answer after a write, where it can be given with no process started,
 * or `null` where it is to be decided as before (ADR-0002, ADR-0003).
 *
 * The git directory is the one the files at the hook's root name. What the
 * run before the write kept for this call, if anything, is taken away as it
 * is read, and answered from where it is this call's: the same release,
 * session, call, tool, paths, directories, line and variables. And where
 * nothing is kept, a run after a write says nothing but a warning outside
 * the scope, which only `outOfScope: "warn"` decides: under `ask` or
 * `deny` there is nothing to say, where the configuration read is the one
 * git would have the hook read, of the work tree the session is in.
 */
async function answeredAfter(root: string, record: CallRecord | null, cwd: string | null, io: CliIO): Promise<HookResponse | null> {
  const found = gitDirectories(root, io.env);
  if (found === null) return null;
  if (record !== null) {
    const kept = await takeCall(found.common, callFile(record));
    // warningsKept reads no text as no record as well: the test is there for
    // the type, and its mutant is equivalent.
    const warnings = kept === null ? null : warningsKept(kept, record);
    if (warnings !== null) return afterResponse(warnings);
  }
  if (!found.exact || (cwd !== null && mayBeElsewhere(cwd, found.top))) return null;
  try {
    return (await loadConfig(found.top)).config.outOfScope === 'warn' ? null : afterResponse([]);
  } catch {
    // A configuration that does not load is said as it was, by the run.
    return null;
  }
}

/**
 * The answer before a write the hook could not check: one line, and exit 2,
 * which holds the write. Claude Code shows the line to Claude as the
 * reason.
 */
function cannotCheck(io: CliIO, error: unknown): number {
  io.stderr.write(`spec-harness: cannot check this write: ${(error as Error).message}\n`);
  return EXIT_ERROR;
}

async function hookCommand(options: Options, io: CliIO): Promise<number> {
  const kind = options.positionals[0];
  if (kind === 'claude') {
    const request = await writeAsked(io);
    if (typeof request === 'number') return request;
    // The root the line gives, or what is wrong with it: read as `doctor`
    // reads the line where it finds it in a settings file (usage.ts).
    const line = readHookLine(options.root, io.cwd, isDirectory);
    if (line.state === 'off') return guardOff(io, line.fault, request.event);
    const cwd = request.cwd ?? io.cwd;
    const root = line.root ?? io.env['CLAUDE_PROJECT_DIR'] ?? cwd;
    const session = sessionOf(request);
    if (request.event === SESSION_START) return answer(io, sessionResponse(await sessionProblem(options, io, root, request.cwd, session)));
    if (request.event === TURN_END) return answer(io, turnResponse(await turnReport(options, io, root, request.cwd)));
    const record = callRecord(request, { root: line.root, brief: options.brief, base: options.base }, io.cwd, io.env, version());
    if (request.event === 'PostToolUse') {
      const answered = await answeredAfter(root, record, request.cwd, io);
      if (answered !== null) {
        io.stdout.write(answered.stdout);
        return answered.exitCode;
      }
    }
    let workspace: Workspace;
    try {
      workspace = await openWorkspace({ ...options, root }, io);
    } catch (error) {
      if (error instanceof UsageError) return EXIT_OK;
      // git asked where the work tree is and did not answer within its time
      // limit: before a write that is a write the hook could not check, said
      // as one (ADR-0002).
      if (error instanceof GitError && request.event === 'PreToolUse') return cannotCheck(io, error);
      throw error;
    }
    try {
      // The answer reads a decision by its verdict, which a mutant's text
      // put first on this list has none of: that mutant is equivalent.
      const decisions: Decision[] = [];
      // Whether the run after the write may answer from what this one keeps:
      // not where a decision refuses, nor where the write is to what the
      // answer is made from, in any work tree that decides it.
      let keeps = true;
      for (const part of await writesBy(workspace, request.cwd, request.paths, io)) {
        const decided = await decisionsFor(part.workspace, options, io, part.paths, cwd, session);
        if ('problem' in decided) {
          // Exit 2 blocks the tool call, and its stderr reaches the model. Where
          // the name stands on the hook's own line, what is wrong with it is
          // `doctor`'s to say as well, in the same words (usage.ts).
          io.stderr.write(`spec-harness: ${heldHookLine(decided.problem).wrong}. Fix the brief or the branch before writing.\n`);
          return EXIT_ERROR;
        }
        // A line of the answer for each path, by the work tree that decided it.
        decisions.push(...decided.decisions);
        if (decided.decisions.some((decision) => decision.verdict === 'deny' || decidesAnswers(decision, decided.brief))) keeps = false;
      }
      const response = claudeResponse(request.event, decisions);
      io.stdout.write(response.stdout);
      // What the run after the write will say, kept for it where the call
      // goes ahead: a refused call has none. It changes nothing of the
      // answer, which is made before it is kept.
      if (request.event === 'PreToolUse' && record !== null && keeps) {
        await keepCall(workspace.commonDir, callFile(record), keptCall(record, warningsOf(decisions)));
      }
      return response.exitCode;
    } catch (error) {
      if (request.event !== 'PreToolUse') throw error;
      // A round is named and its briefs cannot be read: the guard cannot
      // tell a protected file from any other, so the write waits.
      return cannotCheck(io, error);
    }
  }
  if (kind === 'git') {
    // git starts its hook at the top of the work tree it commits in, a
    // linked worktree's own, whose install may be none: it is then checked
    // with the main work tree's (ADR-0005).
    const workspace = await openWorkspace(options, io, MAIN_INSTALL);
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
async function baseAndSigners(
  { resolveBase }: Pick<typeof import('./round.js'), 'resolveBase'>,
  workspace: Workspace,
  flag: string | undefined,
  signersFile: string,
): Promise<{ readonly base: Base; readonly signersText: string | null }> {
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
async function wiringAndRelease(
  { claudeCodeWiring }: Pick<typeof import('./round.js'), 'claudeCodeWiring'>,
  root: string,
  io: CliIO,
): Promise<{ readonly wiring: Omit<ClaudeCodeWiring, 'release'>; readonly release: ClaudeCodeCheck | null }> {
  const { release, ...wiring } = await claudeCodeWiring(root, io);
  return { wiring, release };
}

async function doctorCommand(options: Options, io: CliIO): Promise<number> {
  // What doctor alone runs of them, loaded before anything is asked: the
  // five things below are asked at once, and none waits on a module.
  const [configure, round, setup, signing] = await Promise.all([import('./configure.js'), import('./round.js'), import('./setup.js'), import('./signers.js')]);
  const { describeBase, describeClaudeCode, describeClaudeRelease, describeGitHook, describeHooksOff, describePlugin, describePresence, describeSignerKeys, describeSignerProblem, describeSigners, guardSwitchedOff, NO_SESSION_START, wiringState } = configure;
  const { diagnoseBrief, specBriefPlugin } = round;
  const { gitHook } = setup;
  const { notFido2, readAllowedSigners } = signing;
  // The siblings as git's hook finds them in this work tree: its own
  // install, and in a linked worktree with none the main work tree's.
  const workspace = await openWorkspace(options, io, MAIN_INSTALL);
  const rows = SIBLINGS.map((name) => {
    const sibling = workspace.siblings.locate(name);
    const row = { tool: name, state: sibling.kind, minimum: MINIMUM_VERSIONS[name] };
    if (sibling.kind === 'absent') return { ...row, version: null, elsewhere: null, detail: sibling.reason };
    const elsewhere = sibling.elsewhere ?? null;
    const whose = elsewhere === null ? '' : `, the install of ${elsewhere}: this work tree has none of its own`;
    if (sibling.kind === 'outdated') return { ...row, version: sibling.version, elsewhere, detail: `${sibling.reason}${whose}` };
    const command = sibling.command.join(' ');
    const detail = sibling.version === null ? `${command} (named in .spec-harness.json; its version is not checked)` : `${command} (${sibling.version}${whose})`;
    return { ...row, version: sibling.version, elsewhere, detail };
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
    baseAndSigners(round, workspace, options.base, signersFile),
    specBriefPlugin(workspace.root),
    wiringAndRelease(round, workspace.root, io),
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
  // And whether the hook is started as a session starts, where settings hold
  // the guard: a note, failing nothing, and `sessionStart` in the document.
  const atStart = wiring.hooks.length > 0 && !wiring.sessionStart ? NO_SESSION_START : null;
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
        ...more(atStart === null ? [] : [atStart]),
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
  // this machine, nor a hook git runs that cannot be read, which stops every
  // commit as a script and runs as a program: --strict fails the four.
  const outdated = rows.some((row) => row.state === 'outdated');
  const usable = rows.some((row) => row.state === 'found');
  const off = wiring.lines.some((line) => line.state === 'off' || line.state === 'held');
  const missing = wiring.presence?.state === 'absent' && wiring.hooks.length === 0;
  const tooOld = release?.state === 'outdated';
  const stopped = hook.state === 'stops';
  // Only an unreadable hook has `runs`, so the test of its state is the
  // compiler's, and its mutant is equivalent.
  const untold =
    options.strict && (release?.state === 'unknown' || wiring.lines.some((line) => line.state === 'unknown') || wiring.presence?.state === 'unknown' || (hook.state === 'unreadable' && hook.runs));
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
  // One for every command that has a shape (usage.ts), which the compiler
  // holds. A command of another module loads its module when it is the one
  // typed, and no other command's.
  Object.entries({
    guard: guardCommand,
    hook: hookCommand,
    context: async (options, io) => (await import('./commands.js')).contextCommand(options, io),
    audit: async (options, io) => (await import('./commands.js')).auditCommand(options, io),
    escalate: async (options, io) => (await import('./commands.js')).escalateCommand(options, io),
    rule: async (options, io) => (await import('./commands.js')).ruleCommand(options, io),
    rulings: async (options, io) => (await import('./commands.js')).rulingsCommand(options, io),
    probe: async (options, io) => (await import('./commands.js')).probeCommand(options, io),
    premises: async (options, io) => (await import('./premises.js')).premisesCommand(options, io),
    init: async (options, io) => (await import('./setup.js')).initCommand(options, io),
    mcp: async (options, io) => (await import('./server.js')).mcpCommand(options, io),
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
  // Two values for an option that takes one: the parser kept the last, and
  // which was meant cannot be told from the line, so it is refused as a line
  // the parser cannot read is, and Claude Code's hook says it of its own.
  const twice = twoValues(options, io.cwd);
  if (twice !== null) {
    if (isClaudeHook(options.command, options.positionals[0])) return unreadLine(twice, io);
    io.stderr.write(`spec-harness: ${twice}; give it one\n`);
    return EXIT_ERROR;
  }
  // A line that is wrong is refused before --help or --version answers: an
  // answer beside it said nothing of what was wrong, exit 0, as an option no
  // command has never was (spec-core ADR-0005).
  if (options.command !== undefined && !COMMANDS.has(options.command)) {
    io.stderr.write(`spec-harness: unknown command "${options.command}"; see spec-harness --help\n`);
    return EXIT_ERROR;
  }
  // What parsed and names nothing, before anything is read or written for it.
  const refused = refusal(options, isDirectory);
  if (refused !== null) {
    io.stderr.write(`spec-harness: ${refused}\n`);
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
  return COMMANDS.get(options.command)!(options, io);
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
 *
 * Nor is a module of the build that is not there. The launcher says a build
 * without its command line in a line, and a module a command asks for where
 * it runs is said in the same line: a build with a file missing is not a
 * defect a stack leads to. It is read by its code too: the harness imports
 * nothing but its own modules and Node's.
 */
export async function run(argv: readonly string[], io: CliIO): Promise<number> {
  try {
    return await dispatch(argv, io);
  } catch (error) {
    // A sibling's document of a shape the harness does not read is a sibling
    // that printed something it cannot read (answers.ts): exit 2. A git
    // command that failed is what git said, and no line of the harness's;
    // and a path under git's directory where the harness keeps its state,
    // which holds something else, is said in a line of its own (fs.ts).
    if (
      error instanceof UsageError ||
      error instanceof ConfigError ||
      error instanceof SiblingError ||
      error instanceof SiblingOutputError ||
      error instanceof GitError ||
      error instanceof StateError
    ) {
      io.stderr.write(`spec-harness: ${error.message}\n`);
      return EXIT_ERROR;
    }
    if (!(error instanceof Error)) io.stderr.write(`spec-harness: unexpected error: ${String(error)}\n`);
    else if ((error as NodeJS.ErrnoException).code === 'EPIPE') io.stderr.write('spec-harness: stdout was closed before all of the output was written\n');
    else if ((error as NodeJS.ErrnoException).code === 'ERR_MODULE_NOT_FOUND') io.stderr.write('spec-harness: build output is missing; run "npm run build" first, or install the published package.\n');
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

