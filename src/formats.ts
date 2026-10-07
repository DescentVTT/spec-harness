/**
 * Findings in the formats a forge reads beside a change: GitLab Code Quality,
 * SARIF 2.1.0 and GitHub workflow commands (spec-core ADR-0005).
 *
 * The shapes are the siblings': spec-brief's severities and its hint in the
 * text, spec-guard's fingerprint of a finding's identity. Pure: the command
 * prints what these return.
 */

import { createHash } from 'node:crypto';

import { RULES } from './audit.js';
import type { Finding, Severity } from './types.js';

/** The formats that place findings, which `audit` and `premises` print. */
export type FindingFormat = 'gitlab' | 'sarif' | 'github';

export const FINDING_FORMATS: readonly FindingFormat[] = ['gitlab', 'sarif', 'github'];

export interface FormatOptions {
  /** Where a finding with no file of its own is placed: the brief the command is about. */
  readonly file: string;
  /** This tool's version, which SARIF names. */
  readonly version: string;
  /** What the run measured, which SARIF carries as a note beside its results. */
  readonly summary?: string | undefined;
}

/**
 * GitLab's severities. An error fails the run, but it is not the crash or the
 * security hole `critical` and `blocker` say in GitLab's own reports, so the
 * scale tops out at `major`, as spec-brief's does.
 */
const GITLAB_SEVERITY: Readonly<Record<Severity, string>> = { error: 'major', warning: 'minor', note: 'info' };
const SARIF_LEVEL: Readonly<Record<Severity, string>> = { error: 'error', warning: 'warning', note: 'note' };
const GITHUB_COMMAND: Readonly<Record<Severity, string>> = { error: 'error', warning: 'warning', note: 'notice' };

interface Placed {
  readonly finding: Finding;
  readonly file: string;
  readonly line: number;
  readonly fingerprint: string;
}

/**
 * Each finding with its place and its fingerprint. A finding about a whole
 * brief is placed on the brief's first line. The fingerprint is the SHA-256
 * of the finding's identity - its rule, its file and its subject - and never
 * of its message, hint or line: GitLab tells a new finding from one it has
 * seen by it, so a reworded message or a line added above must not read as
 * one problem fixed and another found. Two findings with one identity are
 * told apart by the order they come in.
 */
function place(findings: readonly Finding[], fallback: string): Placed[] {
  const seen = new Map<string, number>();
  return findings.map((finding) => {
    const file = finding.file ?? fallback;
    const identity = [finding.rule, file, finding.subject ?? ''].join('\u0000');
    const repeat = seen.get(identity) ?? 0;
    seen.set(identity, repeat + 1);
    const fingerprint = createHash('sha256').update(repeat === 0 ? identity : `${identity}\u0000${repeat}`).digest('hex');
    return { finding, file, line: Math.max(finding.line ?? 1, 1), fingerprint };
  });
}

/**
 * The message and the next action, which every format carries (spec-core
 * ADR-0005). A message a sibling ended with a full stop keeps one.
 */
function text(finding: Finding): string {
  return `${finding.message.replace(/\.$/, '')}. ${finding.hint}`;
}

/** GitLab Code Quality: a JSON array of issues, which a merge request shows beside the lines they are on. */
export function formatGitlab(findings: readonly Finding[], options: FormatOptions): string {
  const issues = place(findings, options.file).map(({ finding, file, line, fingerprint }) => ({
    description: text(finding),
    check_name: finding.rule,
    fingerprint,
    severity: GITLAB_SEVERITY[finding.severity],
    location: { path: file, lines: { begin: line } },
  }));
  return `${JSON.stringify(issues, null, 2)}\n`;
}

/** How SARIF describes a rule: the audit's own words, or the archive rule spec-brief gave. */
function describeRule(id: string): string {
  if (id.startsWith('archive/')) return `A reason spec-brief's archive gives: ${id.slice('archive/'.length)}.`;
  // Its own rules only: a finding a caller made may name any rule, and every
  // object answers to `constructor`, which is no sentence.
  return Object.hasOwn(RULES, id) ? (RULES[id] as string) : id;
}

/**
 * SARIF 2.1.0, for code scanning. What the run measured is a note in the
 * invocation, SARIF's place for what happened in a run that is not a finding,
 * so a page with no result still says what was checked.
 */
export function formatSarif(findings: readonly Finding[], options: FormatOptions): string {
  const placed = place(findings, options.file);
  const ids = [...new Set(findings.map((finding) => finding.rule))].sort();
  const document = {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        ...(options.summary === undefined
          ? {}
          : { invocations: [{ executionSuccessful: true, toolExecutionNotifications: [{ level: 'note', message: { text: options.summary } }] }] }),
        tool: {
          driver: {
            name: 'spec-harness',
            version: options.version,
            informationUri: 'https://github.com/DescentVTT/spec-harness',
            rules: ids.map((id) => ({ id, shortDescription: { text: describeRule(id) } })),
          },
        },
        results: placed.map(({ finding, file, line, fingerprint }) => ({
          ruleId: finding.rule,
          level: SARIF_LEVEL[finding.severity],
          message: { text: text(finding) },
          locations: [{ physicalLocation: { artifactLocation: { uri: file, uriBaseId: '%SRCROOT%' }, region: { startLine: line } } }],
          partialFingerprints: { specHarnessFinding: fingerprint },
        })),
      },
    ],
  };
  return `${JSON.stringify(document, null, 2)}\n`;
}

/** A workflow command's message: `%`, and the line breaks that would end the command. */
function escapeData(value: string): string {
  return value.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

/** A workflow command's property: as a message, and the `:` and `,` that would end the property. */
function escapeProperty(value: string): string {
  return escapeData(value).replace(/:/g, '%3A').replace(/,/g, '%2C');
}

/** GitHub Actions workflow commands, one line each, which a job's log turns into annotations on the diff. */
export function formatGithub(findings: readonly Finding[], options: FormatOptions): string {
  return place(findings, options.file)
    .map(({ finding, file, line }) => {
      const properties = `file=${escapeProperty(file)},line=${line},title=${escapeProperty(`spec-harness ${finding.rule}`)}`;
      return `::${GITHUB_COMMAND[finding.severity]} ${properties}::${escapeData(text(finding))}\n`;
    })
    .join('');
}

export function formatFindings(format: FindingFormat, findings: readonly Finding[], options: FormatOptions): string {
  switch (format) {
    case 'gitlab':
      return formatGitlab(findings, options);
    case 'sarif':
      return formatSarif(findings, options);
    case 'github':
      return formatGithub(findings, options);
  }
}
