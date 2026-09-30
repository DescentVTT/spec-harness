/**
 * `spec-harness premises`: is every live brief still about something true?
 *
 * A brief written against a defect states the defect as a premise - an
 * assertion under a section such as "The Defect, Measured" that holds while
 * the defect does. When the premise stops holding before the round has run,
 * the brief is stale: someone fixed the defect another way, or the code it
 * describes is gone. A repository that keeps its premises executable can say
 * so on every build, and ask for the brief to be archived or rewritten before
 * an agent is sent to fix what is already fixed.
 *
 * Goals are the audit's (`audit`), not this: a goal fails until its round is
 * done, and a build that failed for that would fail for every brief in flight.
 * For the same reason the premise of the brief a round is working on - the
 * one the flag, SPEC_BRIEF or the branch names - is reported as the audit
 * reports it, retired as the round intends, and fails nothing: on the round's
 * branch, a premise that no longer holds is the work being done.
 *
 * A premise spec-guard cannot read is checked by nothing, and is a warning,
 * as it is in the audit: `--strict` fails the run on it.
 */

import { isPremise, premiseFinding, unreadablePremiseFinding } from './audit.js';
import { briefIdFromBranch } from './branch.js';
import { findActive } from './briefs.js';
import { CONFIG_FILE } from './config.js';
import { formatFindings } from './formats.js';
import { createReader } from './reader.js';
import { briefText } from './round.js';
import type { Finding } from './types.js';
import { EXIT_ERROR, EXIT_FAILED, EXIT_OK, json, openWorkspace, version, type CliIO, type Options } from './workspace.js';

/** Where spec-guard places a directive. */
interface Spec {
  readonly file: string;
  readonly line: number;
}

interface GuardResult {
  readonly ok: boolean;
  readonly description: string;
  readonly message: string;
  readonly spec?: Spec;
}

interface GuardError {
  readonly message: string;
  readonly raw?: string;
  readonly spec?: Spec;
}

export async function premisesCommand(options: Options, io: CliIO): Promise<number> {
  const workspace = await openWorkspace(options, io);
  const reader = createReader();
  const briefs = await workspace.siblings.briefs();
  const live = briefs.filter((brief) => brief.phase === 'live');
  const fromBranch = briefIdFromBranch(workspace.config.branches, workspace.branch);
  const active = findActive(briefs, { flag: options.brief, environment: io.env['SPEC_BRIEF'], branch: fromBranch });
  const round = active.kind === 'found' ? active.brief.file : null;
  if (live.length === 0) {
    if (options.format === 'json') io.stdout.write(json('premises', { ok: true, checked: 0, findings: [] }));
    else if (options.format === 'pretty') io.stdout.write('no live brief\n');
    else io.stdout.write(formatFindings(options.format, [], { file: CONFIG_FILE, version: version(), summary: 'no live brief' }));
    return EXIT_OK;
  }
  const answer = await workspace.siblings.json('spec-guard', [...live.map((brief) => brief.file), '--ignore-status', '--json']);
  if ('absent' in answer) {
    io.stderr.write(`spec-harness: premises cannot be checked: ${answer.absent}\n`);
    return EXIT_ERROR;
  }
  if (answer.code === 2) {
    io.stderr.write('spec-harness: spec-guard could not run the briefs\' assertions\n');
    return EXIT_ERROR;
  }
  const document = answer.document as { results?: GuardResult[]; errors?: GuardError[] };
  // A missing list is an empty one. A list that holds a string instead, the
  // mutant, sorts nothing to a brief either, since a string has no spec, so
  // it is equivalent; so is the one for errors.
  const results = document.results ?? [];
  // A directive spec-guard cannot read is listed apart from the results; one
  // in a premise section is a premise nothing checks.
  const errors = document.errors ?? [];
  // A directive is a brief's when spec-guard places it in the brief's file;
  // one it places nowhere is no brief's.
  const inBrief = <T extends { readonly spec?: Spec }>(item: T, file: string): item is T & { readonly spec: Spec } =>
    item.spec?.file.replace(/\\/g, '/') === file;
  const findings: Finding[] = [];
  let premises = 0;
  for (const brief of live) {
    const own = results.filter((result) => inBrief(result, brief.file));
    const unread = errors.filter((error) => inBrief(error, brief.file));
    // Only saves reading a brief with nothing to judge: going on finds nothing, so that mutant is equivalent.
    if (own.length === 0 && unread.length === 0) continue;
    const text = await briefText(workspace, brief);
    const premise = (line: number): boolean => isPremise(reader.sectionsAt(text, line), workspace.config.assertions.premises);
    for (const result of own) {
      const { line } = result.spec;
      if (!premise(line)) continue;
      premises += 1;
      if (result.ok) continue;
      findings.push(premiseFinding(brief, { description: result.description, message: result.message, line }, brief.file === round));
    }
    for (const error of unread) {
      const { line } = error.spec;
      if (premise(line)) findings.push(unreadablePremiseFinding(brief, { message: error.message, line, raw: error.raw ?? '' }));
    }
  }
  const stale = findings.filter((finding) => finding.severity === 'error').length;
  const retired = findings.filter((finding) => finding.severity === 'note').length;
  const unreadable = findings.filter((finding) => finding.severity === 'warning').length;
  // Only the round on the active brief retires a premise, so with one retired
  // there is an active brief, and dropping the second test is equivalent.
  const intended = retired === 0 || active.kind !== 'found' ? '' : `, and ${retired} retired by the round on brief ${active.brief.id}, as it intends`;
  const unchecked = unreadable === 0 ? '' : `; ${unreadable} premise(s) spec-guard cannot read, so not checked`;
  const summary = `${premises} premise(s) in ${live.length} live brief(s), ${stale} no longer hold${intended}${unchecked}`;
  // As the audit does: a warning fails the run under --strict.
  const failed = stale > 0 || (options.strict && unreadable > 0);
  if (options.format === 'json') {
    io.stdout.write(json('premises', { ok: !failed, briefs: live.length, premises, unreadable, findings }));
  } else if (options.format === 'pretty') {
    for (const finding of findings) io.stdout.write(`${finding.severity.padEnd(8)} ${finding.file}:${finding.line}  ${finding.message}\n         ${finding.hint}\n`);
    io.stdout.write(`${summary}\n`);
  } else {
    io.stdout.write(formatFindings(options.format, findings, { file: CONFIG_FILE, version: version(), summary }));
  }
  return failed ? EXIT_FAILED : EXIT_OK;
}
