/**
 * The command line: arguments, dispatch, output and exit codes.
 *
 * Exit 0: done, nothing refused. Exit 1: something refused or found. Exit 2:
 * the answer cannot be trusted - a bad flag, a configuration that does not
 * load, a sibling that is missing or printed something unreadable. A run that
 * could not look must never exit as though it looked and found nothing
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
  describePlugin,
  describeSignerKeys,
  describeSignerProblem,
  describeSigners,
  wiringState,
} from './configure.js';
import { show, stagedChanges } from './git.js';
import type { Decision } from './guard.js';
import { claudeResponse, gitResponse, parseClaudeHook } from './hooks.js';
import { claudeVersion } from './host.js';
import { premisesCommand } from './premises.js';
import { createReader } from './reader.js';
import { checkPaths, claudeCodeWiring, resolveBase, specBriefPlugin } from './round.js';
import { mcpCommand } from './server.js';
import { gitHook, initCommand } from './setup.js';
import { notFido2, readAllowedSigners } from './signers.js';
import { SiblingError } from './siblings.js';
import { checkClaudeCode, CLAUDE_CODE_MINIMUM, MINIMUM_VERSIONS } from './versions.js';
import {
  activeBrief,
  describeActive,
  EXIT_ERROR,
  EXIT_FAILED,
  EXIT_OK,
  json,
  namedId,
  openWorkspace,
  parseOptions,
  UsageError,
  version,
  type CliIO,
  type Options,
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
                      --list shows what waits; --show <id> prints one memo.
  rule <id>           Record a person's ruling in the brief: --allow or --deny, with
                      --note. It counts once committed signed.
  rulings [brief]     The brief's rulings, and whether each one's signature verifies.
  audit [brief]       Did the round stay inside the lines: what the archive would say,
                      the brief's assertions, unverified rulings, new dependencies.
  probe [brief]       Run the brief's probes: red at the base, green at the head.
                      --at base|head|both, --id <probe>.
  premises            Do the live briefs' premises still hold? For CI: exit 1 when one
                      is stale, or, with --strict, when spec-guard cannot read one.
  init                Configure the spec-* tools to agree. Prints the plan; --write
                      applies it; --git-hook adds a pre-commit hook.
  mcp                 Serve start_round, check_path, request_escalation, audit_round,
                      list_rounds and the workflow prompts over MCP on stdio.
  doctor              Which siblings are installed, at which versions, which brief is
                      named, how Claude Code runs the guard, and git's hook. Exit 1
                      when a sibling is older than this release needs, the guard is
                      installed twice, or Claude Code is too old to run its hooks.

Options:
  --brief <id>        The brief the round works on. Otherwise SPEC_BRIEF, then the branch.
  --base <ref>        What the round is measured from. Otherwise "base" in
                      .spec-harness.json, then the remote's default branch.
  --root <dir>        Run from another directory.
  --format <fmt>      pretty or json; audit and premises also gitlab, sarif or github.
  --strict            Warnings fail the run.
  --help, --version

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

async function hookCommand(options: Options, io: CliIO): Promise<number> {
  const kind = options.positionals[0];
  if (kind === 'claude') {
    const request = parseClaudeHook(await readStdin(io));
    if ('error' in request) {
      // A hook that cannot read its question refuses nothing it cannot see,
      // but says so where the person reads it: a non-blocking error.
      io.stderr.write(`spec-harness: ${request.error}\n`);
      return EXIT_FAILED;
    }
    if (request.paths.length === 0) return EXIT_OK;
    const cwd = request.cwd ?? io.cwd;
    let workspace: Workspace;
    try {
      workspace = await openWorkspace({ ...options, root: options.root ?? io.env['CLAUDE_PROJECT_DIR'] ?? cwd }, io);
    } catch (error) {
      if (error instanceof UsageError) return EXIT_OK;
      throw error;
    }
    try {
      const decided = await decisionsFor(workspace, options, io, request.paths, cwd);
      if ('problem' in decided) {
        // Exit 2 blocks the tool call, and its stderr reaches the model.
        io.stderr.write(`spec-harness: ${decided.problem}. Fix the brief or the branch before writing.\n`);
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
  const named = namedId(workspace, options, io.env);
  // A ruling counts only by a signature checked against the allowed signers
  // on the base, and only once spec-brief's archive asks the plugin about it.
  const base = await resolveBase(workspace, options.base);
  const signersFile = workspace.config.rulings.allowedSigners;
  // An unresolved base has no commit: git shows nothing for one, so asking
  // anyway reads as no file, and that mutant is equivalent.
  const signersText = base.kind === 'resolved' ? await show(base.sha, signersFile, workspace.root) : null;
  const onBase = base.kind === 'resolved' ? signersText !== null : null;
  const signers = describeSigners(signersFile, base.kind === 'resolved' ? base.ref : null, onBase === true);
  // Which keys sign, as notes: a key that is not FIDO2 can still be one the
  // agent cannot use, and a PIV key reads as a plain one (ADR-0006).
  const read = readAllowedSigners(signersText ?? '');
  const plain = notFido2(read.signers);
  const signerNotes = [describeSignerKeys(plain), ...read.problems.map(describeSignerProblem)].filter((note): note is string => note !== null);
  const plugin = await specBriefPlugin(workspace.root);
  // The plugin and init's entries both on: Claude Code runs every guard twice
  // and registers the server twice (ADR-0012).
  const wiring = await claudeCodeWiring(workspace.root, io.env);
  const claude = wiringState(wiring);
  // Only a Claude Code that runs the guard is asked its release: one older
  // than the hooks need lets every write through unguarded.
  const release = claude === 'none' ? null : checkClaudeCode(await claudeVersion(io.env));
  // How the hook runs the harness is a note: one that goes through npx guards
  // as well as one that does not, and fails nothing, --strict or not.
  const { hook, note: hookNote } = await gitHook(workspace.root);
  const branch = workspace.branch === null ? '(detached)' : `${workspace.branch}${workspace.branchSource === undefined ? '' : ` (detached; ${workspace.branchSource} names it)`}`;
  if (options.format === 'json') {
    io.stdout.write(
      json('doctor', {
        root: workspace.root,
        branch: workspace.branch,
        branchSource: workspace.branchSource ?? null,
        brief: named,
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
        `brief   ${named ?? '(none named)'}`,
        `base    ${describeBase(base)}`,
        `signers ${signers}`,
        ...more(signerNotes),
        `plugin  ${describePlugin(plugin)}`,
        `claude  ${describeClaudeCode(wiring)}`,
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
  // and so is a Claude Code too old to run the hooks. One whose release
  // cannot be told is not fine either: --strict fails it.
  const outdated = rows.some((row) => row.state === 'outdated');
  const usable = rows.some((row) => row.state === 'found');
  const tooOld = release?.state === 'outdated';
  const untold = options.strict && release?.state === 'unknown';
  return outdated || !usable || claude === 'both' || tooOld || untold ? EXIT_FAILED : EXIT_OK;
}

/* ---------------------------------------------------------------- dispatch */

/**
 * A map, because the command is the first word a person types and an object
 * answers to more names than it was given: `spec-harness constructor` ran
 * `Object` as a command and ended on a stack trace, where `spec-harness
 * construct` is an unknown command with exit 2.
 */
const COMMANDS: ReadonlyMap<string, (options: Options, io: CliIO) => Promise<number>> = new Map([
  ['guard', guardCommand],
  ['hook', hookCommand],
  ['context', contextCommand],
  ['audit', auditCommand],
  ['escalate', escalateCommand],
  ['rule', ruleCommand],
  ['rulings', rulingsCommand],
  ['probe', probeCommand],
  ['premises', premisesCommand],
  ['init', initCommand],
  ['mcp', mcpCommand],
  ['doctor', doctorCommand],
]);

export async function run(argv: readonly string[], io: CliIO): Promise<number> {
  let options: Options;
  try {
    options = parseOptions(argv);
  } catch (error) {
    io.stderr.write(`spec-harness: ${(error as Error).message}\n`);
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
  try {
    return await command(options, io);
  } catch (error) {
    // A sibling's document of a shape the harness does not read is a sibling
    // that printed something it cannot read (answers.ts): exit 2.
    if (error instanceof UsageError || error instanceof ConfigError || error instanceof SiblingError || error instanceof SiblingOutputError) {
      io.stderr.write(`spec-harness: ${error.message}\n`);
      return EXIT_ERROR;
    }
    throw error;
  }
}

// What bin/spec-harness.js runs; the suite spawns the built one, from dist/,
// outside the sweep (tests/integration/cli.test.ts), so it survives untested
// in-process.
export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  return run(argv, { stdout: process.stdout, stderr: process.stderr, cwd: process.cwd(), env: process.env });
}

