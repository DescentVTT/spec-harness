/**
 * What an agent needs to start a round, and nothing it does not.
 *
 * The brief in full - it is the contract, and a summary of a contract is a
 * different contract. Then what the brief implies but does not say: the scope
 * as the guard will read it, the rulings already signed, the briefs it waits
 * on, the rules spec-guard holds the scope's code to, and the documents the
 * brief cites. The cited documents are the one part that can be large, so
 * they fill what the budget leaves, in the order the brief cites them, and
 * the rest are named rather than dropped silently. So is a document whose
 * front matter is never closed, whose status cannot be read, rather than
 * shown as one without a status, and a pattern in the scope, a protection or
 * a ruling's path the guard cannot read, with spec-core's reason and what the
 * guard does without it, rather than listed as one it can.
 */

import { sameId } from './branch.js';
import { rooted, whyUnreadable } from './guard.js';
import type { BriefRow } from './types.js';

export interface CitedDocument {
  readonly path: string;
  readonly title: string | null;
  readonly status: string | null;
  /** `null` when the link does not resolve to a readable file. */
  readonly text: string | null;
  /** YAML front matter opened on line 1 and never closed, so no status was read from it. */
  readonly unclosedFrontMatter?: boolean | undefined;
}

export interface RuleInForce {
  readonly document: string;
  readonly line: number;
  readonly kind: string;
  readonly description: string;
  readonly reason: string | null;
}

/**
 * The rules in force for the scope; `none` when spec-guard reads no
 * specification here, so none can be in force; `unavailable` when the rules
 * could not be read.
 */
export type Rules = readonly RuleInForce[] | { readonly none: string } | { readonly unavailable: string };

interface QueryDocument {
  readonly specFiles?: unknown;
  readonly results?: readonly { readonly rules?: readonly (RuleInForce & { readonly reason?: string | null; readonly inForce?: boolean })[] }[];
}

/**
 * spec-guard's answer to `query --json`, read. It exits 2 both when no spec
 * file matched its patterns - a repository that keeps none, or keeps them
 * where it does not look - and when it could not read the specs it has; only
 * the first prints a document, one with no spec file in it, so that is how
 * the two are told apart. What it said on stderr is the reason for the second.
 */
export function readRules(answer: { readonly code: number; readonly document: unknown; readonly stderr: string }): Rules {
  const document = (answer.document ?? {}) as QueryDocument;
  if (answer.code !== 0) {
    if (Array.isArray(document.specFiles) && document.specFiles.length === 0) {
      return { none: 'no spec file matched its patterns ("specs" in its configuration, docs/**/*.md by default)' };
    }
    const said = (answer.stderr.trim().split('\n')[0] ?? '').replace(/^spec-guard:\s*/, '');
    return { unavailable: said === '' ? `spec-guard exited ${answer.code}` : `spec-guard exited ${answer.code}: ${said}` };
  }
  const seen = new Set<string>();
  const out: RuleInForce[] = [];
  for (const result of document.results ?? []) {
    for (const rule of result.rules ?? []) {
      const key = `${rule.document}:${rule.line}`;
      if (rule.inForce === false || seen.has(key)) continue;
      seen.add(key);
      out.push({ document: rule.document, line: rule.line, kind: rule.kind, description: rule.description, reason: rule.reason ?? null });
    }
  }
  return out;
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
  /** The rules in force for the scope, none because spec-guard reads no specification, or why they could not be read. */
  readonly rules: Rules;
  readonly rulings: readonly RulingInForce[];
  readonly branch: string | null;
  readonly base: string | null;
  readonly budget: number;
}

/** A pattern in the brief's scope or protections that the guard cannot read, with spec-core's reason. */
export interface UnreadablePattern {
  readonly pattern: string;
  readonly reason: string;
}

/** A path of a ruling in force that the guard cannot read, with the ruling's id and spec-core's reason. */
export interface UnreadableRulingPath extends UnreadablePattern {
  readonly ruling: string;
}

export interface ContextPacket {
  readonly markdown: string;
  /** Cited documents included whole. */
  readonly included: readonly string[];
  /** Cited documents named but left out for the budget. */
  readonly omitted: readonly string[];
  /** Links in the brief that resolve to nothing. */
  readonly unresolved: readonly string[];
  /** Cited documents whose front matter opens on line 1 and is never closed, so no status was read from them. */
  readonly unclosedFrontMatter: readonly string[];
  /** Patterns in `affectedFiles` the guard cannot read, in the brief's order: each puts no path in the scope. */
  readonly unreadableScope: readonly UnreadablePattern[];
  /** Patterns in `protectedFiles` the guard cannot read, in the brief's order: while one stands, the guard refuses every write but to the brief. */
  readonly unreadableProtections: readonly UnreadablePattern[];
  /** Paths of the rulings in force the guard cannot read, in the order the rulings are listed: each allows nothing. */
  readonly unreadableRulingPaths: readonly UnreadableRulingPath[];
}

function list(items: readonly string[]): string {
  return items.map((item) => `- \`${item}\``).join('\n');
}

/**
 * Each pattern a line, as the guard reads it: as written, or with spec-core's
 * reason the guard cannot read it and what the guard does without it. The
 * guard's own compile decides, so the packet and the guard cannot disagree.
 * With `rootedNote`, a pattern a leading `/` roots, or one of whose
 * alternatives it roots, is marked too, and counted when every alternative
 * is rooted.
 */
function patternLines(
  patterns: readonly string[],
  consequence: string,
  rootedNote?: { readonly whole: string; readonly part: string },
): { lines: string[]; unreadable: UnreadablePattern[]; rootedWhole: number } {
  const unreadable: UnreadablePattern[] = [];
  let rootedWhole = 0;
  const lines = patterns.map((pattern) => {
    const reason = whyUnreadable(pattern);
    if (reason === null) {
      const root = rootedNote === undefined ? null : rooted(pattern);
      if (root === null) return `- \`${pattern}\``;
      if (root === 'whole') rootedWhole += 1;
      return `- \`${pattern}\`, ${(rootedNote as { whole: string; part: string })[root]}`;
    }
    unreadable.push({ pattern, reason });
    return `- \`${pattern}\`, which the guard cannot read: ${reason}; ${consequence}`;
  });
  return { lines, unreadable, rootedWhole };
}

function rulesSection(rules: Rules, scopeUnread: boolean, scopeRooted: boolean): string {
  if ('none' in rules) return `spec-guard holds no rule over this scope: ${rules.none}.`;
  if ('unavailable' in rules) {
    return `The rules spec-guard holds this code to could not be read: ${rules.unavailable}. Treat every ADR as binding until they can.`;
  }
  if (rules.length === 0) {
    // With no pattern of the scope readable, spec-guard was asked about no
    // path, so an empty answer is no answer: "no rule" would tell the agent
    // the code it writes is unconstrained.
    if (scopeUnread) {
      return 'The scope could not be read: no pattern in `affectedFiles` can be read, so spec-guard was not asked for the rules over it. Treat every ADR as binding until the scope is fixed.';
    }
    return scopeRooted
      ? "No pattern in `affectedFiles` puts a path in the scope: each is rooted at the filesystem's root or cannot be read, so spec-guard was not asked for the rules over it. Treat every ADR as binding until the scope is fixed."
      : 'spec-guard holds no rule over this scope.';
  }
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
 * A brief's title without the id it repeats, by the rules spec-brief reads
 * it with: the brief's own id, then an em dash, which `spec-brief new`
 * writes, an en dash, a full-width colon or a colon, spaced or not, or a
 * hyphen with a space on each side; `012 - Rotate tokens`, `012\u2014Rotate
 * tokens` and `012\uFF1ARotate tokens` read as `Rotate tokens`. A bare hyphen
 * is part of a word or a number, as in `001-2 migration`, and only the
 * brief's own id is taken off: `Fix - the login bug` is a title, and so is
 * `0010 \u2014 x` on brief 001.
 */
export function titleOf(brief: Pick<BriefRow, 'id' | 'title'>): string | null {
  if (brief.title === null) return null;
  return brief.title.replace(/^\s*([^\s:\uFF1A\u2013\u2014]+)(?:\s*[:\uFF1A\u2013\u2014]\s*|\s+-\s+)(?=\S)/, (whole, first: string) =>
    sameId(first, brief.id) ? '' : whole,
  );
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

  // The guard passes over a ruling's path it cannot read, so the path allows
  // nothing. The paths share a line, so the note is in parentheses, closed
  // before the next path.
  const unreadableRulingPaths: UnreadableRulingPath[] = [];
  const rulings =
    input.rulings.length === 0
      ? '- none'
      : input.rulings
          .map((ruling) => {
            const paths = ruling.paths.map((pattern) => {
              const reason = whyUnreadable(pattern);
              if (reason === null) return `\`${pattern}\``;
              unreadableRulingPaths.push({ ruling: ruling.id, pattern, reason });
              return `\`${pattern}\` (which the guard cannot read: ${reason}; it allows nothing)`;
            });
            return `- ${ruling.id}, signed by ${ruling.signer}: ${paths.join(', ')}`;
          })
          .join('\n');
  // A rooted pattern can be read and puts no path in the scope: every path
  // the guard decides is repository-relative. spec-guard is not asked about it.
  const mayWrite = patternLines(brief.affectedFiles, 'it puts no path in the scope', {
    whole: "which a leading `/` roots at the filesystem's root: it puts no path in the scope, and spec-guard is not asked about it",
    part: "an alternative of which a leading `/` roots at the filesystem's root: that alternative puts no path in the scope, and spec-guard is not asked about it",
  });
  const unreadableScope = mayWrite.unreadable;
  // While a protection the guard cannot read stands, the guard refuses every
  // write, and no ruling waives it; a write to the brief is let through,
  // since that is where it is fixed.
  const mustNot = patternLines(brief.protectedFiles, 'until it is fixed, the guard refuses every write but to the brief');
  const unreadableProtections = mustNot.unreadable;
  const scope = [
    '## Scope, as the guard reads it',
    '',
    'May write:',
    mayWrite.lines.length === 0 ? '- nothing declared: every write is outside the scope' : mayWrite.lines.join('\n'),
    '',
    'Must not change without a ruling:',
    mustNot.lines.length === 0 ? '- nothing declared' : mustNot.lines.join('\n'),
    '',
    'Rulings in force:',
    rulings,
    '',
  ].join('\n');

  const waiting = input.dependencies.map((dependency) => {
    const state = dependency.phase === 'archived' ? 'archived, done' : `still ${dependency.status ?? 'live'}`;
    const named = titleOf(dependency);
    return `- ${dependency.id}${named === null ? '' : ` ${named}`}: ${state}`;
  });
  const dependencies = ['## Depends on', '', waiting.length === 0 ? '- nothing' : waiting.join('\n'), ''].join('\n');

  const scopeUnread = mayWrite.lines.length > 0 && unreadableScope.length === mayWrite.lines.length;
  const scopeRooted = mayWrite.rootedWhole > 0 && unreadableScope.length + mayWrite.rootedWhole === mayWrite.lines.length;
  const rules = ['## Rules in force for this scope', '', rulesSection(input.rules, scopeUnread, scopeRooted), ''].join('\n');

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
  const unclosed: string[] = [];
  const documents: string[] = [];
  let used = fixed.length;
  for (const cited of input.cited) {
    if (cited.text === null) {
      unresolved.push(cited.path);
      continue;
    }
    // Named whether or not the budget leaves room for it: the status is
    // unread either way, and the fix is the same.
    if (cited.unclosedFrontMatter === true) unclosed.push(cited.path);
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
    citedSection.push(`Left out to stay within ${input.budget} characters; read them when the work reaches them:`, list(omitted), '');
  }
  if (unresolved.length > 0) citedSection.push('Cited but not found in the repository:', list(unresolved), '');
  if (unclosed.length > 0) {
    citedSection.push('Front matter opened on line 1 and never closed, so the status was not read; close the block with `---` on a line of its own:', list(unclosed), '');
  }

  return {
    markdown: `${fixed}\n${citedSection.join('\n').trimEnd()}\n`,
    included,
    omitted,
    unresolved,
    unclosedFrontMatter: unclosed,
    unreadableScope,
    unreadableProtections,
    unreadableRulingPaths,
  };
}
