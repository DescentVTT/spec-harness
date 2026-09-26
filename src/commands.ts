/**
 * The commands that read a round: context, audit, escalate, rule, rulings
 * and probe. Each resolves the brief, asks `round.ts` for the facts and
 * prints them; exit codes follow the family contract.
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { briefIdFromBranch } from './branch.js';
import { findActive } from './briefs.js';
import { readJUnit } from './junit.js';
import { classify, readProbes, renderEvidence, verdictOf, type ProbeResult, type ProbeSpec } from './probe.js';
import { createReader } from './reader.js';
import {
  buildContext,
  checkRulings,
  briefText,
  listEscalations,
  raiseEscalation,
  recordRuling,
  resolveBase,
  runAudit,
} from './round.js';
import { renderMemo, type EscalationOption } from './rulings.js';
import { runCommand, withWorktree } from './sandbox.js';
import type { BriefRow, Finding } from './types.js';
import {
  describeActive,
  EXIT_ERROR,
  EXIT_FAILED,
  EXIT_OK,
  json,
  UsageError,
  type CliIO,
  type Options,
  type Workspace,
  openWorkspace,
} from './workspace.js';

const reader = createReader();

/** The brief a command acts on: a positional id, else the active one. A command that needs one and has none is a usage error. */
export async function targetBrief(workspace: Workspace, options: Options, io: CliIO, positional: string | undefined): Promise<{ brief: BriefRow; briefs: BriefRow[] }> {
  const briefs = await workspace.siblings.briefs();
  const fromBranch = workspace.branch === null ? null : briefIdFromBranch(workspace.config.branches, workspace.branch);
  const active = findActive(briefs, { flag: positional ?? options.brief, environment: io.env['SPEC_BRIEF'], branch: fromBranch });
  const { brief, note, problem } = describeActive(active);
  if (problem !== null) throw new UsageError(problem);
  if (brief === null) throw new UsageError(note ?? 'no brief is named');
  return { brief, briefs };
}

const MARK: Record<Finding['severity'], string> = { error: 'error  ', warning: 'warning', note: 'note   ' };

function printFindings(io: CliIO, findings: readonly Finding[]): void {
  for (const finding of findings) {
    const where = finding.file === undefined ? '' : `${finding.file}${finding.line === undefined ? '' : `:${finding.line}`}  `;
    io.stdout.write(`${MARK[finding.severity]}  ${where}${finding.message}  ${finding.rule}\n         ${finding.hint}\n`);
  }
}

/* ----------------------------------------------------------------- context */

export async function contextCommand(options: Options, io: CliIO): Promise<number> {
  const workspace = await openWorkspace(options, io);
  const { brief, briefs } = await targetBrief(workspace, options, io, options.positionals[0]);
  const packet = await buildContext(workspace, brief, briefs, reader);
  if (options.format === 'json') {
    io.stdout.write(json('context', { brief: brief.id, markdown: packet.markdown, included: packet.included, omitted: packet.omitted, unresolved: packet.unresolved }));
  } else {
    io.stdout.write(packet.markdown);
  }
  return EXIT_OK;
}

/* ------------------------------------------------------------------- audit */

export async function auditCommand(options: Options, io: CliIO): Promise<number> {
  const workspace = await openWorkspace(options, io);
  const { brief } = await targetBrief(workspace, options, io, options.positionals[0]);
  const result = await runAudit(workspace, brief, reader, options.base);
  const { counts, findings } = result.report;
  if (options.format === 'json') {
    io.stdout.write(
      json('audit', {
        ok: counts.error === 0 && (!options.strict || counts.warning === 0),
        brief: brief.id,
        base: result.base.kind === 'resolved' ? { ref: result.base.ref, mergeBase: result.base.mergeBase, head: result.base.head } : null,
        counts,
        findings,
        dependencies: result.dependencies,
      }),
    );
  } else {
    io.stdout.write(`audit of brief ${brief.id}${result.base.kind === 'resolved' ? ` from ${result.base.ref} (${result.base.mergeBase.slice(0, 12)})` : ''}\n\n`);
    printFindings(io, findings);
    io.stdout.write(`\n${counts.error} error(s), ${counts.warning} warning(s), ${counts.note} note(s)\n`);
  }
  return counts.error > 0 || (options.strict && counts.warning > 0) ? EXIT_FAILED : EXIT_OK;
}

/* -------------------------------------------------------------- escalation */

function parseOption(raw: string): EscalationOption {
  const colon = raw.indexOf(':');
  return colon < 0 ? { label: raw.trim(), consequence: '' } : { label: raw.slice(0, colon).trim(), consequence: raw.slice(colon + 1).trim() };
}

export async function escalateCommand(options: Options, io: CliIO): Promise<number> {
  const workspace = await openWorkspace(options, io);
  if (options.list) {
    const waiting = await listEscalations(workspace);
    if (options.format === 'json') io.stdout.write(json('escalate', { waiting }));
    else if (waiting.length === 0) io.stdout.write('no escalation is waiting\n');
    else for (const request of waiting) io.stdout.write(`${request.id}  brief ${request.brief}  ${request.paths.join(', ')}  ${request.reason.split('\n')[0]}\n`);
    return EXIT_OK;
  }
  if (options.show !== undefined) {
    const request = (await listEscalations(workspace)).find((candidate) => candidate.id === options.show);
    if (request === undefined) throw new UsageError(`no escalation "${options.show}" is waiting`);
    io.stdout.write(options.format === 'json' ? json('escalate', { request }) : renderMemo(request));
    return EXIT_OK;
  }
  if (options.paths.length === 0 || options.reason === undefined) {
    throw new UsageError('escalate needs --path <file> (repeatable) and --reason <why>; or --list, or --show <id>');
  }
  const { brief } = await targetBrief(workspace, options, io, undefined);
  const { request, memo } = await raiseEscalation(workspace, brief, {
    paths: options.paths,
    reason: options.reason,
    options: options.options.map(parseOption),
    recommendation: options.recommend ?? null,
  });
  io.stdout.write(options.format === 'json' ? json('escalate', { request, memo }) : memo);
  // Exit 1: the round is waiting on a person, which a caller must not read as done.
  return EXIT_FAILED;
}

export async function ruleCommand(options: Options, io: CliIO): Promise<number> {
  const id = options.positionals[0];
  if (id === undefined) throw new UsageError('rule needs the escalation id, such as E-012-1');
  if (options.allow === options.deny) throw new UsageError('rule needs exactly one of --allow or --deny');
  if (options.note === undefined || options.note.trim() === '') throw new UsageError('rule needs --note: what exactly is allowed, or why not');
  const workspace = await openWorkspace(options, io);
  const recorded = await recordRuling(workspace, id, options.allow ? 'allow' : 'deny', options.note, reader);
  const command = `git commit -S -m "ruling ${recorded.id}: ${options.allow ? 'allow' : 'deny'}" -- ${recorded.file}`;
  if (options.format === 'json') {
    io.stdout.write(json('rule', { ruling: recorded.id, file: recorded.file, row: recorded.row, commit: command }));
  } else {
    io.stdout.write(`${recorded.file} now holds ruling ${recorded.id}:\n\n  ${recorded.row}\n\nIt counts once you commit it signed, with a key the base branch's allowed signers list:\n\n  ${command}\n`);
  }
  return EXIT_OK;
}

export async function rulingsCommand(options: Options, io: CliIO): Promise<number> {
  const workspace = await openWorkspace(options, io);
  const { brief } = await targetBrief(workspace, options, io, options.positionals[0]);
  const base = await resolveBase(workspace, options.base);
  const check = await checkRulings(workspace, brief, await briefText(workspace, brief), reader, base);
  if (options.format === 'json') {
    io.stdout.write(json('rulings', { brief: brief.id, rows: check.rows, verified: check.verified, unverified: check.unverified, problems: check.problems }));
  } else {
    if (check.rows.length === 0) io.stdout.write(`brief ${brief.id} holds no ruling\n`);
    for (const row of check.rows) {
      const verified = check.verified.find((ruling) => ruling.id === row.id);
      const unverified = check.unverified.find((ruling) => ruling.id === row.id);
      const state = row.decision === 'deny' ? 'refused' : verified !== undefined ? `signed by ${verified.signer}` : `not verified: ${unverified?.reason ?? ''}`;
      io.stdout.write(`${row.id}  ${row.decision}  ${row.paths.join(', ')}  ${state}\n`);
    }
    printFindings(io, check.problems);
  }
  return check.unverified.length > 0 || check.problems.length > 0 ? EXIT_FAILED : EXIT_OK;
}

/* ------------------------------------------------------------------- probe */

async function runProbe(directory: string, probe: ProbeSpec, runs: number, timeout: number): Promise<ProbeResult['runs']> {
  const classified = [];
  for (let i = 0; i < runs; i += 1) {
    const report = probe.junit === null ? null : join(directory, probe.junit);
    if (report !== null) await rm(report, { force: true });
    const run = await runCommand(probe.run, directory, timeout);
    const junit = report === null || !existsSync(report) ? null : readJUnit(await readFile(report, 'utf8'));
    classified.push(classify(probe, { exitCode: run.exitCode, output: run.output, junit }));
  }
  return classified;
}

export async function probeCommand(options: Options, io: CliIO): Promise<number> {
  const workspace = await openWorkspace(options, io);
  const { brief } = await targetBrief(workspace, options, io, options.positionals[0]);
  const text = await briefText(workspace, brief);
  const set = readProbes(reader.codeBlocks(text));
  if (set.problems.length > 0) {
    for (const problem of set.problems) io.stderr.write(`spec-harness: ${brief.file}:${problem.line}: ${problem.message}\n`);
    return EXIT_ERROR;
  }
  const probes = set.probes.filter((probe) => options.id === undefined || probe.id === options.id);
  if (probes.length === 0) {
    io.stdout.write(`brief ${brief.id} declares no probe${options.id === undefined ? '' : ` named ${options.id}`}\n`);
    return options.id === undefined ? EXIT_OK : EXIT_ERROR;
  }
  const base = await resolveBase(workspace, options.base);
  if (base.kind === 'unresolved') throw new UsageError(base.reason);
  const at = options.at ?? (base.mergeBase === base.head ? 'base' : 'both');
  const results: ProbeResult[] = [];
  const measure = async (label: 'base' | 'head', commit: string, expected: 'red' | 'green'): Promise<void> => {
    await withWorktree(workspace.root, commit, async (directory) => {
      for (const file of set.files) {
        await mkdir(dirname(join(directory, file.path)), { recursive: true });
        await writeFile(join(directory, file.path), file.content.endsWith('\n') ? file.content : `${file.content}\n`);
      }
      const setups = [...new Set(probes.map((probe) => probe.setup).filter((setup): setup is string => setup !== null))];
      for (const setup of setups) {
        const run = await runCommand(setup, directory, workspace.config.probes.timeout);
        if (run.exitCode !== 0) throw new UsageError(`the probe setup "${setup}" failed at ${label}:\n${run.output.slice(-2000)}`);
      }
      for (const probe of probes) {
        const runs = await runProbe(directory, probe, probe.runs ?? workspace.config.probes.runs, probe.timeout ?? workspace.config.probes.timeout);
        results.push({ probe, at: label, commit, expected, runs, verdict: verdictOf(expected, runs) });
      }
    });
  };
  if (at === 'base' || at === 'both') await measure('base', base.mergeBase, 'red');
  if (at === 'head' || at === 'both') await measure('head', base.head, 'green');
  const evidence = renderEvidence(results, set.hash, new Date().toISOString().slice(0, 10));
  const failed = results.filter((result) => result.verdict !== (result.expected === 'red' ? 'measured' : 'fixed'));
  if (options.format === 'json') {
    io.stdout.write(
      json('probe', {
        ok: failed.length === 0,
        brief: brief.id,
        hash: set.hash,
        results: results.map((result) => ({ id: result.probe.id, at: result.at, commit: result.commit, expected: result.expected, verdict: result.verdict, runs: result.runs })),
        evidence,
      }),
    );
  } else {
    io.stdout.write(`${evidence}\n`);
  }
  return failed.length === 0 ? EXIT_OK : EXIT_FAILED;
}
