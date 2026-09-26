/**
 * What an agent needs to start a round, and nothing it does not.
 *
 * The brief in full - it is the contract, and a summary of a contract is a
 * different contract. Then what the brief implies but does not say: the scope
 * as the guard will read it, the rulings already signed, the briefs it waits
 * on, the rules spec-guard holds the scope's code to, and the documents the
 * brief cites. The cited documents are the one part that can be large, so
 * they fill what the budget leaves, in the order the brief cites them, and
 * the rest are named rather than dropped silently.
 */

import { sameId } from './branch.js';
import type { BriefRow } from './types.js';

export interface CitedDocument {
  readonly path: string;
  readonly title: string | null;
  readonly status: string | null;
  /** `null` when the link does not resolve to a readable file. */
  readonly text: string | null;
}

export interface RuleInForce {
  readonly document: string;
  readonly line: number;
  readonly kind: string;
  readonly description: string;
  readonly reason: string | null;
}

export interface RulingInForce {
  readonly id: string;
  readonly paths: readonly string[];
  readonly signer: string;
}

export interface ContextInput {
  readonly brief: BriefRow;
  readonly briefText: string;
  readonly dependencies: readonly BriefRow[];
  readonly cited: readonly CitedDocument[];
  /** The rules in force for the scope, or why they could not be read. */
  readonly rules: readonly RuleInForce[] | { readonly unavailable: string };
  readonly rulings: readonly RulingInForce[];
  readonly branch: string | null;
  readonly base: string | null;
  readonly budget: number;
}

export interface ContextPacket {
  readonly markdown: string;
  /** Cited documents included whole. */
  readonly included: readonly string[];
  /** Cited documents named but left out for the budget. */
  readonly omitted: readonly string[];
  /** Links in the brief that resolve to nothing. */
  readonly unresolved: readonly string[];
}

function list(items: readonly string[], empty: string): string {
  return items.length === 0 ? `- ${empty}` : items.map((item) => `- \`${item}\``).join('\n');
}

function rulesSection(rules: ContextInput['rules']): string {
  if (!Array.isArray(rules)) {
    return `The rules spec-guard holds this code to could not be read: ${(rules as { unavailable: string }).unavailable}. Treat every ADR as binding until they can.`;
  }
  if (rules.length === 0) return 'spec-guard holds no rule over this scope.';
  const byDocument = new Map<string, RuleInForce[]>();
  for (const rule of rules) byDocument.set(rule.document, [...(byDocument.get(rule.document) ?? []), rule]);
  const parts: string[] = [];
  for (const [document, found] of byDocument) {
    parts.push(`### ${document}`, '');
    for (const rule of found) parts.push(`- line ${rule.line}: ${rule.description}${rule.reason === null ? '' : ` - ${rule.reason}`}`);
    parts.push('');
  }
  return parts.join('\n').trimEnd();
}

/**
 * A brief's title without the id it repeats, `012 - Rotate tokens` read as
 * `Rotate tokens`. Only the brief's own id is taken off: `Fix - the login
 * bug` is a title, not an id and a title.
 */
function titleOf(brief: BriefRow): string | null {
  if (brief.title === null) return null;
  return brief.title.replace(/^\s*(\S+)\s+-\s+/, (whole, first: string) => (sameId(first, brief.id) ? '' : whole));
}

/** Renders the packet, filling the budget with cited documents in the order the brief cites them. */
export function renderContext(input: ContextInput): ContextPacket {
  const { brief } = input;
  const title = titleOf(brief);
  const header = [
    `# Round ${brief.id}${title === null ? '' : `: ${title}`}`,
    '',
    [
      `Status ${brief.status ?? 'unknown'}`,
      brief.wave === null ? null : `wave ${brief.wave}`,
      input.branch === null ? null : `branch \`${input.branch}\``,
      input.base === null ? null : `measured from \`${input.base}\``,
    ]
      .filter((part) => part !== null)
      .join(' · '),
    '',
  ].join('\n');

  const contract = ['## The contract', '', `\`${brief.file}\`, in full:`, '', '````markdown', input.briefText.trimEnd(), '````', ''].join('\n');

  const rulings =
    input.rulings.length === 0
      ? '- none'
      : input.rulings.map((ruling) => `- ${ruling.id}, signed by ${ruling.signer}: ${ruling.paths.map((p) => `\`${p}\``).join(', ')}`).join('\n');
  const scope = [
    '## Scope, as the guard reads it',
    '',
    'May write:',
    list(brief.affectedFiles, 'nothing declared: every write is outside the scope'),
    '',
    'Must not change without a ruling:',
    list(brief.protectedFiles, 'nothing declared'),
    '',
    'Rulings in force:',
    rulings,
    '',
  ].join('\n');

  const waiting = input.dependencies.map((dependency) => {
    const state = dependency.phase === 'archived' ? 'archived, done' : `still ${dependency.status ?? 'live'}`;
    return `- ${dependency.id}${dependency.title === null ? '' : ` ${dependency.title}`}: ${state}`;
  });
  const dependencies = ['## Depends on', '', waiting.length === 0 ? '- nothing' : waiting.join('\n'), ''].join('\n');

  const rules = ['## Rules in force for this scope', '', rulesSection(input.rules), ''].join('\n');

  const howTo = [
    '## How this round works',
    '',
    '- Before writing a file, ask whether the round may: `spec-harness guard <path>`, or the `check_path` tool.',
    '- A protected file is changed only under a ruling a person signs. If the round cannot be done without one, stop and ask: `spec-harness escalate --path <file> --reason <why>`, or the `request_escalation` tool. Do not work around it.',
    '- Every box in the brief ends ticked, or with a note under it that starts with a disposition (`**Delegated`, `**Accepted debt`, `**Rejected`, or what the repository configures).',
    '- When the work is done, run `spec-harness audit` and fix what it reports. The archive is a person\'s decision, not the round\'s.',
    '',
  ].join('\n');

  const fixed = [header, contract, scope, dependencies, rules, howTo].join('\n');
  const included: string[] = [];
  const omitted: string[] = [];
  const unresolved: string[] = [];
  const documents: string[] = [];
  let used = fixed.length;
  for (const cited of input.cited) {
    if (cited.text === null) {
      unresolved.push(cited.path);
      continue;
    }
    const heading = `### \`${cited.path}\`${cited.title === null ? '' : ` - ${cited.title}`}${cited.status === null ? '' : ` (${cited.status})`}`;
    const block = [heading, '', '````markdown', cited.text.trimEnd(), '````', ''].join('\n');
    if (used + block.length > input.budget) {
      omitted.push(cited.path);
      continue;
    }
    used += block.length;
    included.push(cited.path);
    documents.push(block);
  }
  const citedSection = ['## Documents the brief cites', ''];
  if (documents.length === 0 && omitted.length === 0 && unresolved.length === 0) citedSection.push('None.', '');
  citedSection.push(...documents);
  if (omitted.length > 0) {
    citedSection.push(`Left out to stay within ${input.budget} characters; read them when the work reaches them:`, list(omitted, ''), '');
  }
  if (unresolved.length > 0) citedSection.push('Cited but not found in the repository:', list(unresolved, ''), '');

  return { markdown: `${fixed}\n${citedSection.join('\n').trimEnd()}\n`, included, omitted, unresolved };
}
