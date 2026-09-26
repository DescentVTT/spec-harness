/**
 * The command line: arguments, dispatch, output and exit codes.
 *
 * Exit 0: done, nothing refused. Exit 1: something refused or found. Exit 2:
 * the answer cannot be trusted - a bad flag, a configuration that does not
 * load, a sibling that is missing or printed something unreadable. A run that
 * could not look must never exit as though it looked and found nothing
 * (spec-core ADR-0005).
 */

import { auditCommand, contextCommand, escalateCommand, probeCommand, ruleCommand, rulingsCommand } from './commands.js';
import { ConfigError, SIBLINGS } from './config.js';
import { describeBase, describePlugin, describeSigners } from './configure.js';
import { show, stagedChanges } from './git.js';
import type { Decision } from './guard.js';
import { claudeResponse, gitResponse, parseClaudeHook } from './hooks.js';
import { premisesCommand } from './premises.js';
import { createReader } from './reader.js';
import { checkPaths, resolveBase, specBriefPlugin } from './round.js';
import { mcpCommand } from './server.js';
import { initCommand } from './setup.js';
import { SiblingError } from './siblings.js';
import { MINIMUM_VERSIONS } from './versions.js';
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
  premises            Do the live briefs' premises still hold? For CI: exit 1 when one is stale.
  init                Configure the spec-* tools to agree. Prints the plan; --write
                      applies it; --git-hook adds a pre-commit hook.
  mcp                 Serve start_round, check_path, request_escalation, audit_round,
                      list_rounds and the workflow prompts over MCP on stdio.
  doctor              Which siblings are installed, at which versions, and which
                      brief is named. Exit 1 when one is older than this release needs.

Options:
  --brief <id>        The brief the round works on. Otherwise SPEC_BRIEF, then the branch.
  --base <ref>        What the round is measured from. Otherwise "base" in
                      .spec-harness.json, then the remote's default branch.
  --root <dir>        Run from another directory.
  --format <fmt>      pretty or json.
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
): Promise<{ decisions: Decision[]; problem: string | null }> {
  const active = await activeBrief(workspace, options, io.env);
  const { brief, note, problem } = describeActive(active);
  if (problem !== null) return { decisions: [], problem };
  const decisions = await checkPaths(workspace, brief, note, given, cwd, reader, options.base);
  return { decisions, problem: null };
}

const SYMBOL: Record<Decision['verdict'], string> = { allow: 'ok     ', warn: 'warning', ask: 'ask    ', deny: 'refused' };

async function guardCommand(options: Options, io: CliIO): Promise<number> {
  if (options.positionals.length === 0) throw new UsageError('guard needs at least one path');
  const workspace = await openWorkspace(options, io);
  const { decisions, problem } = await decisionsFor(workspace, options, io, options.positionals, io.cwd);
  if (problem !== null) {
    io.stderr.write(`spec-harness: ${problem}\n`);
    return EXIT_ERROR;
  }
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
      const { decisions, problem } = await decisionsFor(workspace, options, io, request.paths, cwd);
      if (problem !== null) {
        // Exit 2 blocks the tool call, and its stderr reaches the model.
        io.stderr.write(`spec-harness: ${problem}. Fix the brief or the branch before writing.\n`);
        return EXIT_ERROR;
      }
      const response = claudeResponse(request.event, decisions);
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
    const { decisions, problem } = await decisionsFor(workspace, options, io, paths, workspace.root);
    if (problem !== null) {
      io.stderr.write(`spec-harness: ${problem}\n`);
      return EXIT_ERROR;
    }
    const response = gitResponse(decisions);
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
  const onBase = base.kind === 'resolved' ? (await show(base.sha, signersFile, workspace.root)) !== null : null;
  const signers = describeSigners(signersFile, base.kind === 'resolved' ? base.ref : null, onBase === true);
  const plugin = await specBriefPlugin(workspace.root);
  if (options.format === 'json') {
    io.stdout.write(
      json('doctor', {
        root: workspace.root,
        branch: workspace.branch,
        brief: named,
        base: base.kind === 'resolved' ? { ref: base.ref, source: base.source, mergeBase: base.mergeBase } : { unresolved: base.reason },
        allowedSigners: { file: signersFile, onBase, detail: signers },
        plugin: { state: plugin.kind, file: 'file' in plugin ? plugin.file : null, detail: describePlugin(plugin) },
        siblings: rows,
      }),
    );
  } else {
    io.stdout.write(
      [
        `root    ${workspace.root}`,
        `branch  ${workspace.branch ?? '(detached)'}`,
        `brief   ${named ?? '(none named)'}`,
        `base    ${describeBase(base.kind === 'resolved' ? base : { reason: base.reason })}`,
        `signers ${signers}`,
        `plugin  ${describePlugin(plugin)}`,
        '',
        '',
      ].join('\n'),
    );
    for (const row of rows) io.stdout.write(`${row.state.padEnd(8)}  ${row.tool.padEnd(10)}  ${row.detail}\n`);
  }
  // An outdated sibling is a problem to fix, where a missing optional one is
  // a choice; with none installed, the harness can check nothing.
  const outdated = rows.some((row) => row.state === 'outdated');
  const usable = rows.some((row) => row.state === 'found');
  return outdated || !usable ? EXIT_FAILED : EXIT_OK;
}

/* ---------------------------------------------------------------- dispatch */

const COMMANDS: Readonly<Record<string, (options: Options, io: CliIO) => Promise<number>>> = {
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
};

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
    return options.command === undefined && !options.help ? EXIT_ERROR : EXIT_OK;
  }
  const command = COMMANDS[options.command];
  if (command === undefined) {
    io.stderr.write(`spec-harness: unknown command "${options.command}"; see spec-harness --help\n`);
    return EXIT_ERROR;
  }
  try {
    return await command(options, io);
  } catch (error) {
    if (error instanceof UsageError || error instanceof ConfigError || error instanceof SiblingError) {
      io.stderr.write(`spec-harness: ${error.message}\n`);
      return EXIT_ERROR;
    }
    throw error;
  }
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  return run(argv, { stdout: process.stdout, stderr: process.stderr, cwd: process.cwd(), env: process.env });
}

