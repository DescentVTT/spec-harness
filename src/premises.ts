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
 */

import { isPremise } from './audit.js';
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
  const live = (await workspace.siblings.briefs()).filter((brief) => brief.phase === 'live');
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
      findings.push({
        rule: 'stale-premise',
        severity: 'error',
        message: `brief ${brief.id}'s premise no longer holds: ${result.description}: ${result.message}`,
        hint: 'what the brief was written against has changed; archive the brief if its work is done, or rewrite its premise before a round is run on it',
        file: brief.file,
        line,
      });
    }
  }
  if (options.format === 'json') {
    io.stdout.write(json('premises', { ok: findings.length === 0, briefs: live.length, premises, findings }));
  } else {
    for (const finding of findings) io.stdout.write(`error    ${finding.file}:${finding.line}  ${finding.message}\n         ${finding.hint}\n`);
    io.stdout.write(`${premises} premise(s) in ${live.length} live brief(s), ${findings.length} no longer hold\n`);
  }
  return findings.length > 0 ? EXIT_FAILED : EXIT_OK;
}
