/**
 * Did the round stay inside the lines?
 *
 * One report, from three sources and one question of its own:
 *
 * - spec-brief's archive, asked with `--dry-run`: open boxes, protected files
 *   changed, files outside the scope, a tree that was not committed. The
 *   archive is spec-brief's decision, so its reasons are carried as they are
 *   - one defect, one finding - and the harness does not measure the scope a
 *   second time.
 * - spec-guard, over the brief's own assertions: the goals must hold now. A
 *   premise - an assertion in a section that states what was true before the
 *   round, such as "The Defect, Measured" - is expected to stop holding, and
 *   one that still holds says the defect may still be there.
 * - The rulings: each one whose signature does not verify is reported, since
 *   an unverified ruling allows nothing.
 * - And the one question nobody else asks: which dependencies the round
 *   added. A dependency is code no reviewer read.
 *
 * A part that could not be measured is a finding, never a silence.
 */

import type { DependencyChange } from './manifests.js';
import { sameSection } from './reader.js';
import type { BriefRow, Finding, Severity } from './types.js';

export interface AssertionOutcome {
  readonly ok: boolean;
  readonly description: string;
  readonly message: string;
  readonly line: number;
  /** The brief section the directive sits in, or `null`. */
  readonly section: string | null;
  /** Every section it sits in, outermost first; `[section]` when not given. */
  readonly enclosing?: readonly string[] | undefined;
}

export interface AuditInput {
  readonly brief: BriefRow;
  /** Why the round's changes could not be measured, when they could not. */
  readonly unmeasured: string | null;
  readonly dependencies: { readonly changes: readonly DependencyChange[]; readonly unread: readonly string[] };
  readonly archive: { readonly blocking: readonly Finding[]; readonly warnings: readonly Finding[] } | { readonly unavailable: string };
  readonly assertions: readonly AssertionOutcome[] | { readonly unavailable: string };
  /** Section names whose assertions are premises. Compared without case, emphasis, a leading number or a trailing colon. */
  readonly premiseSections: readonly string[];
  readonly unverifiedRulings: readonly { readonly id: string; readonly reason: string }[];
}

export interface AuditReport {
  readonly findings: readonly Finding[];
  readonly counts: Readonly<Record<Severity, number>>;
}

function finding(rule: string, severity: Severity, message: string, hint: string, file?: string, line?: number): Finding {
  return { rule, severity, message, hint, ...(file === undefined ? {} : { file }), ...(line === undefined ? {} : { line }) };
}

/**
 * Whether an assertion's section is a premise section. Compared as the
 * rulings section is, and as spec-brief compares section names: a heading
 * written `## 3. **The Defect, Measured:**` is still the premise section, and
 * an assertion under it read as a goal would fail the round for retiring it.
 */
export function isPremise(sections: string | null | readonly string[], premises: readonly string[]): boolean {
  const list = sections === null ? [] : typeof sections === 'string' ? [sections] : sections;
  // A premise section's subsections are still premises: `### Before` under
  // `## The Defect, Measured` states what was true before the round.
  return list.some((section) => premises.some((premise) => sameSection(section, premise)));
}

export function audit(input: AuditInput): AuditReport {
  const { brief } = input;
  const out: Finding[] = [];

  if (input.unmeasured !== null) {
    out.push(
      finding(
        'unmeasured',
        'warning',
        `the round's changes were not measured: ${input.unmeasured}`,
        'pass --base <ref>, set "base" in .spec-harness.json, or audit on the round\'s branch before it merges',
        brief.file,
      ),
    );
  }

  if ('unavailable' in input.archive) {
    out.push(finding('archive-unchecked', 'warning', `what the archive would say is unknown: ${input.archive.unavailable}`, 'install spec-brief, or fix what stopped it', brief.file));
  } else {
    for (const reason of [...input.archive.blocking, ...input.archive.warnings]) {
      out.push(finding(`archive/${reason.rule}`, reason.severity, reason.message, reason.hint, reason.file, reason.line));
    }
  }

  if (!Array.isArray(input.assertions)) {
    const unavailable = (input.assertions as { unavailable: string }).unavailable;
    out.push(finding('assertions-unchecked', 'warning', `the brief's assertions were not run: ${unavailable}`, 'install spec-guard, or fix what stopped it', brief.file));
  } else {
    for (const outcome of input.assertions) {
      const premise = isPremise(outcome.enclosing ?? outcome.section, input.premiseSections);
      if (premise && outcome.ok) {
        out.push(
          finding(
            'premise-holds',
            'warning',
            `a premise still holds after the round: ${outcome.description}`,
            'the round set out to change what this premise states; check that it did, or move the assertion out of the premises',
            brief.file,
            outcome.line,
          ),
        );
      } else if (premise) {
        out.push(finding('premise-retired', 'note', `a premise no longer holds, as the round intended: ${outcome.description}`, 'nothing to do', brief.file, outcome.line));
      } else if (!outcome.ok) {
        out.push(finding('goal-failed', 'error', `${outcome.description}: ${outcome.message}`, 'the round is not done until this holds', brief.file, outcome.line));
      }
    }
  }

  for (const ruling of input.unverifiedRulings) {
    out.push(
      finding(
        'ruling-unverified',
        'warning',
        `ruling ${ruling.id} allows nothing: ${ruling.reason}`,
        'a ruling counts when the commit that last changed its row is signed by a key in the base branch\'s allowed signers',
        brief.file,
      ),
    );
  }

  for (const file of input.dependencies.unread) {
    out.push(finding('manifest-unread', 'warning', `${file} changed and could not be read for dependencies`, 'check its dependencies by hand; the audit cannot', file));
  }
  for (const change of input.dependencies.changes) {
    const where = `${change.file} (${change.section})`;
    if (change.before === null) {
      out.push(
        finding(
          'new-dependency',
          'warning',
          `the round added ${change.ecosystem} dependency "${change.name}"${change.after === '' ? '' : ` ${change.after}`} in ${where}`,
          'say in the brief why it is needed, or remove it; a new dependency is code no reviewer read',
          change.file,
        ),
      );
    } else if (change.after === null) {
      out.push(finding('dependency-removed', 'note', `the round removed "${change.name}" from ${where}`, 'nothing to do', change.file));
    } else {
      out.push(finding('dependency-changed', 'note', `the round moved "${change.name}" from ${change.before} to ${change.after} in ${where}`, 'nothing to do, if the brief meant it', change.file));
    }
  }

  const counts: Record<Severity, number> = { error: 0, warning: 0, note: 0 };
  for (const item of out) counts[item.severity] += 1;
  return { findings: out, counts };
}
