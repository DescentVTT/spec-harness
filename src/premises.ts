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
 */

import { isPremise, premiseFinding } from './audit.js';
import { briefIdFromBranch } from './branch.js';
import { findActive } from './briefs.js';
import { createReader } from './reader.js';
import { briefText } from './round.js';
import type { Finding } from './types.js';
import { EXIT_ERROR, EXIT_FAILED, EXIT_OK, json, openWorkspace, type CliIO, type Options } from './workspace.js';

interface GuardResult {
  readonly ok: boolean;
  readonly description: string;
  readonly message: string;
  readonly spec?: { readonly file: string; readonly line: number };
}

export async function premisesCommand(options: Options, io: CliIO): Promise<number> {
  const workspace = await openWorkspace(options, io);
  const reader = createReader();
  const briefs = await workspace.siblings.briefs();
  const live = briefs.filter((brief) => brief.phase === 'live');
  const fromBranch = workspace.branch === null ? null : briefIdFromBranch(workspace.config.branches, workspace.branch);
  const active = findActive(briefs, { flag: options.brief, environment: io.env['SPEC_BRIEF'], branch: fromBranch });
  const round = active.kind === 'found' ? active.brief.file : null;
  if (live.length === 0) {
    io.stdout.write(options.format === 'json' ? json('premises', { ok: true, checked: 0, findings: [] }) : 'no live brief\n');
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
  const results = ((answer.document as { results?: GuardResult[] }).results ?? []).filter((result) => result.spec !== undefined);
  const findings: Finding[] = [];
  let premises = 0;
  for (const brief of live) {
    const own = results.filter((result) => result.spec?.file.replace(/\\/g, '/') === brief.file);
    if (own.length === 0) continue;
    const text = await briefText(workspace, brief);
    for (const result of own) {
      const line = result.spec?.line ?? 0;
      if (!isPremise(reader.sectionsAt(text, line), workspace.config.assertions.premises)) continue;
      premises += 1;
      if (result.ok) continue;
      findings.push(premiseFinding(brief, { description: result.description, message: result.message, line }, brief.file === round));
    }
  }
  const stale = findings.filter((finding) => finding.severity === 'error').length;
  const retired = findings.length - stale;
  if (options.format === 'json') {
    io.stdout.write(json('premises', { ok: stale === 0, briefs: live.length, premises, findings }));
  } else {
    for (const finding of findings) io.stdout.write(`${finding.severity.padEnd(8)} ${finding.file}:${finding.line}  ${finding.message}\n         ${finding.hint}\n`);
    const intended = retired === 0 || active.kind !== 'found' ? '' : `, and ${retired} retired by the round on brief ${active.brief.id}, as it intends`;
    io.stdout.write(`${premises} premise(s) in ${live.length} live brief(s), ${stale} no longer hold${intended}\n`);
  }
  return stale > 0 ? EXIT_FAILED : EXIT_OK;
}
