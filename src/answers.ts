/**
 * What spec-guard and spec-brief answer in JSON, besides the brief list
 * briefs.ts reads: a query's rules, a run's results and errors, and an
 * archive's plan. Each is checked for the fields the harness reads, with the
 * types it reads them as, and a document of another shape is an error that
 * names the tool and the field (ADR-0002): the command that asked stops with
 * exit 2, as for any sibling that printed something it cannot read, rather
 * than crash halfway through the document or count what it could not read as
 * clean. Fields the harness does not read are not checked, so a sibling may
 * add to its documents freely.
 */

import type { ArchiveReason } from './audit.js';
import { SiblingOutputError } from './briefs.js';

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reads fields of one document, naming the tool, its command and the field in every refusal. */
function reader(printer: string) {
  const refuse = (where: string, expected: string): never => {
    throw new SiblingOutputError(`${printer} printed ${where} that is not ${expected}`);
  };
  return {
    object(value: unknown, where: string): Json {
      return isObject(value) ? value : refuse(where, 'an object');
    },
    /** A list that is absent is an empty one. */
    list(value: unknown, where: string): unknown[] {
      if (value === undefined) return [];
      return Array.isArray(value) ? (value as unknown[]) : refuse(where, 'a list');
    },
    text(value: unknown, where: string): string {
      return typeof value === 'string' ? value : refuse(where, 'text');
    },
    optionalText(value: unknown, where: string): string | undefined {
      return value === undefined ? undefined : typeof value === 'string' ? value : refuse(where, 'text');
    },
    number(value: unknown, where: string): number {
      return typeof value === 'number' ? value : refuse(where, 'a number');
    },
    optionalNumber(value: unknown, where: string): number | undefined {
      return value === undefined ? undefined : typeof value === 'number' ? value : refuse(where, 'a number');
    },
    flag(value: unknown, where: string): boolean {
      return typeof value === 'boolean' ? value : refuse(where, 'true or false');
    },
    refuse,
  };
}

/** Where spec-guard places a directive. */
export interface Spec {
  readonly file: string;
  readonly line: number;
}

export interface QueryRule {
  readonly document: string;
  readonly line: number;
  readonly kind: string;
  readonly description: string;
  readonly reason: string | null;
  /** Absent from a document that says nothing of it, which is in force. */
  readonly inForce: boolean;
}

/** The rules in each of the results of `spec-guard query --json`, in order. */
export function readQueryRules(document: unknown): QueryRule[][] {
  const read = reader('spec-guard query');
  const top = read.object(document, 'a document');
  return read.list(top['results'], 'results').map((value, index) => {
    const result = read.object(value, `results[${index}]`);
    return read.list(result['rules'], `results[${index}].rules`).map((ruleValue, at) => {
      const where = `results[${index}].rules[${at}]`;
      const rule = read.object(ruleValue, where);
      const reason = rule['reason'];
      if (reason !== undefined && reason !== null && typeof reason !== 'string') read.refuse(`${where}.reason`, 'text or null');
      const inForce = rule['inForce'];
      return {
        document: read.text(rule['document'], `${where}.document`),
        line: read.number(rule['line'], `${where}.line`),
        kind: read.text(rule['kind'], `${where}.kind`),
        description: read.text(rule['description'], `${where}.description`),
        reason: typeof reason === 'string' ? reason : null,
        inForce: inForce === undefined ? true : read.flag(inForce, `${where}.inForce`),
      };
    });
  });
}

export interface GuardResult {
  readonly ok: boolean;
  readonly description: string;
  readonly message: string;
  readonly spec?: Spec | undefined;
}

export interface GuardError {
  readonly message: string;
  readonly raw: string;
  readonly spec?: Spec | undefined;
}

/** The results and the unreadable directives of a spec-guard run over briefs, `--json`. */
export function readGuardRun(document: unknown): { results: GuardResult[]; errors: GuardError[] } {
  const read = reader('spec-guard');
  const top = read.object(document, 'a document');
  const spec = (value: unknown, where: string): Spec | undefined => {
    if (value === undefined) return undefined;
    const placed = read.object(value, where);
    return { file: read.text(placed['file'], `${where}.file`), line: read.number(placed['line'], `${where}.line`) };
  };
  const results = read.list(top['results'], 'results').map((value, index) => {
    const where = `results[${index}]`;
    const result = read.object(value, where);
    return {
      ok: read.flag(result['ok'], `${where}.ok`),
      description: read.text(result['description'], `${where}.description`),
      message: read.text(result['message'], `${where}.message`),
      spec: spec(result['spec'], `${where}.spec`),
    };
  });
  const errors = read.list(top['errors'], 'errors').map((value, index) => {
    const where = `errors[${index}]`;
    const error = read.object(value, where);
    return {
      message: read.text(error['message'], `${where}.message`),
      raw: read.optionalText(error['raw'], `${where}.raw`) ?? '',
      spec: spec(error['spec'], `${where}.spec`),
    };
  });
  return { results, errors };
}

const SEVERITIES: readonly string[] = ['error', 'warning', 'note'];

/**
 * What `spec-brief archive --dry-run --format json` would refuse and warn
 * about. A document with no plan plans nothing to refuse. spec-brief gives a
 * reason without a hint where it has no next step, and the reason is carried
 * as it gave it: a field it left out is undefined, which JSON leaves out too.
 */
export function readArchivePlan(document: unknown): { blocking: ArchiveReason[]; warnings: ArchiveReason[] } {
  const read = reader('spec-brief archive');
  const top = read.object(document, 'a document');
  if (top['plan'] === undefined) return { blocking: [], warnings: [] };
  const plan = read.object(top['plan'], 'plan');
  const reasons = (key: 'blocking' | 'warnings'): ArchiveReason[] =>
    read.list(plan[key], `plan.${key}`).map((value, index) => {
      const where = `plan.${key}[${index}]`;
      const reason = read.object(value, where);
      const severity = read.text(reason['severity'], `${where}.severity`);
      if (!SEVERITIES.includes(severity)) read.refuse(`${where}.severity`, 'error, warning or note');
      const hint = read.optionalText(reason['hint'], `${where}.hint`);
      const file = read.optionalText(reason['file'], `${where}.file`);
      const line = read.optionalNumber(reason['line'], `${where}.line`);
      const path = read.optionalText(reason['path'], `${where}.path`);
      return {
        rule: read.text(reason['rule'], `${where}.rule`),
        severity: severity as ArchiveReason['severity'],
        message: read.text(reason['message'], `${where}.message`),
        hint,
        file,
        line,
        path,
      } as ArchiveReason;
    });
  return { blocking: reasons('blocking'), warnings: reasons('warnings') };
}
