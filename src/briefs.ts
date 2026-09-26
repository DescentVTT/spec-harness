/**
 * The briefs, as spec-brief reports them, and which one a round is working on.
 *
 * spec-brief owns the brief format and its configuration (its ADR-0003), so
 * the harness reads briefs the way spec-brief does by asking it:
 * `spec-brief list --archived --format json`. This module reads that
 * document and nothing else; a shape it does not recognise is an error, never
 * a best-effort reading of half the fields (ADR-0002).
 */

import { sameId } from './branch.js';
import type { BriefRow } from './types.js';

/**
 * The spec-brief JSON document versions this harness reads. Version 1 is the
 * one spec-brief 0.1.0 prints; version 2 changed only `matrix`, which the
 * harness never reads, so the `list` and `archive` documents are the same.
 */
export const SUPPORTED_SCHEMA_VERSIONS: readonly number[] = [1, 2, 3];

export class SiblingOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SiblingOutputError';
  }
}

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function strings(value: unknown, where: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new SiblingOutputError(`${where} is not a list of strings`);
  }
  return value;
}

function nullableString(value: unknown, where: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new SiblingOutputError(`${where} is not a string`);
  return value;
}

/** Reads the document `spec-brief list --format json` prints. */
export function parseBriefList(document: unknown): BriefRow[] {
  if (!isObject(document) || document['tool'] !== 'spec-brief' || document['command'] !== 'list') {
    throw new SiblingOutputError('spec-brief did not print a list document');
  }
  const version = document['schemaVersion'];
  if (typeof version !== 'number' || !SUPPORTED_SCHEMA_VERSIONS.includes(version)) {
    throw new SiblingOutputError(
      `spec-brief printed schemaVersion ${String(version)}; this harness reads ${SUPPORTED_SCHEMA_VERSIONS.join(', ')}`,
    );
  }
  const briefs = document['briefs'];
  if (!Array.isArray(briefs)) throw new SiblingOutputError('spec-brief list has no "briefs"');
  return briefs.map((row, index) => {
    const where = `briefs[${index}]`;
    if (!isObject(row)) throw new SiblingOutputError(`${where} is not an object`);
    const id = row['id'];
    const file = row['file'];
    if (typeof id !== 'string' || typeof file !== 'string') throw new SiblingOutputError(`${where} has no id or file`);
    const phase = row['phase'];
    if (phase !== 'live' && phase !== 'archived') throw new SiblingOutputError(`${where}.phase is "${String(phase)}"`);
    const tasks = row['tasks'];
    const wave = row['wave'];
    return {
      id,
      file,
      title: nullableString(row['title'], `${where}.title`),
      phase,
      status: nullableString(row['status'], `${where}.status`),
      type: nullableString(row['type'], `${where}.type`),
      wave: typeof wave === 'number' ? wave : null,
      dependsOn: strings(row['dependsOn'] ?? [], `${where}.dependsOn`),
      affectedFiles: strings(row['affectedFiles'] ?? [], `${where}.affectedFiles`),
      protectedFiles: strings(row['protectedFiles'] ?? [], `${where}.protectedFiles`),
      tasks: {
        total: isObject(tasks) && typeof tasks['total'] === 'number' ? tasks['total'] : 0,
        checked: isObject(tasks) && typeof tasks['checked'] === 'number' ? tasks['checked'] : 0,
      },
      ready: row['ready'] === true,
      waitingOn: strings(row['waitingOn'] ?? [], `${where}.waitingOn`),
    };
  });
}

/** How the active brief was named, for messages. */
export type ActiveSource = 'flag' | 'environment' | 'branch';

export type ActiveBrief =
  | { readonly kind: 'found'; readonly brief: BriefRow; readonly source: ActiveSource }
  | { readonly kind: 'none'; readonly reason: string }
  | { readonly kind: 'unknown'; readonly id: string; readonly source: ActiveSource }
  | { readonly kind: 'archived'; readonly brief: BriefRow; readonly source: ActiveSource };

/**
 * The brief a round is working on: named by a flag, by `SPEC_BRIEF`, or by
 * the branch - never guessed from which brief happens to be the only active
 * one (ADR-0004).
 */
export function findActive(
  briefs: readonly BriefRow[],
  named: { readonly flag?: string | undefined; readonly environment?: string | undefined; readonly branch?: string | null | undefined },
): ActiveBrief {
  const pick = (id: string, source: ActiveSource): ActiveBrief => {
    const matches = briefs.filter((brief) => sameId(brief.id, id));
    const live = matches.find((brief) => brief.phase === 'live');
    if (live !== undefined) return { kind: 'found', brief: live, source };
    const archived = matches[0];
    if (archived !== undefined) return { kind: 'archived', brief: archived, source };
    return { kind: 'unknown', id, source };
  };
  if (named.flag !== undefined && named.flag.trim() !== '') return pick(named.flag.trim(), 'flag');
  if (named.environment !== undefined && named.environment.trim() !== '') return pick(named.environment.trim(), 'environment');
  if (named.branch !== undefined && named.branch !== null) return pick(named.branch, 'branch');
  return {
    kind: 'none',
    reason: 'no brief is named: pass --brief <id>, set SPEC_BRIEF, or work on a branch named like brief/<id>-<topic>',
  };
}
