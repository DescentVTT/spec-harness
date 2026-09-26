import { describe, expect, it } from 'vitest';

import { findActive, parseBriefList, SiblingOutputError, SUPPORTED_SCHEMA_VERSIONS } from '../../src/briefs.js';
import { row } from './helpers.js';

function document(briefs: unknown[], overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { tool: 'spec-brief', version: '0.1.0', schemaVersion: 2, command: 'list', ok: true, briefs, ...overrides };
}

const FULL = {
  id: '012',
  file: 'briefs/012_rotate.md',
  title: '012 - Rotate',
  phase: 'live',
  status: 'active',
  type: 'defect',
  wave: 2,
  dependsOn: ['7'],
  affectedFiles: ['src/auth/**'],
  protectedFiles: ['src/db/schema.ts'],
  tasks: { total: 3, checked: 1 },
  ready: false,
  waitingOn: ['7'],
};

function refusal(value: unknown): string {
  try {
    parseBriefList(value);
  } catch (error) {
    expect(error).toBeInstanceOf(SiblingOutputError);
    expect((error as Error).name).toBe('SiblingOutputError');
    return (error as Error).message;
  }
  throw new Error('parseBriefList accepted the document');
}

describe('spec-brief list documents', () => {
  it('reads every field of a row', () => {
    expect(parseBriefList(document([FULL]))).toEqual([FULL]);
  });

  it('reads every schema version it knows: 1 from spec-brief 0.1.0, and 2 and 3', () => {
    expect(SUPPORTED_SCHEMA_VERSIONS).toEqual([1, 2, 3]);
    for (const schemaVersion of [1, 2, 3]) expect(parseBriefList(document([FULL], { schemaVersion }))).toHaveLength(1);
  });

  it('refuses a schema version it does not know, rather than half-reading it', () => {
    expect(refusal(document([FULL], { schemaVersion: 4 }))).toBe('spec-brief printed schemaVersion 4; this harness reads 1, 2, 3');
    expect(refusal(document([FULL], { schemaVersion: 0 }))).toContain('schemaVersion 0');
    expect(refusal(document([FULL], { schemaVersion: '2' }))).toContain('schemaVersion 2;');
    expect(refusal(document([FULL], { schemaVersion: undefined }))).toContain('schemaVersion undefined');
  });

  it('refuses what is not a list document from spec-brief', () => {
    const message = 'spec-brief did not print a list document';
    expect(refusal(null)).toBe(message);
    expect(refusal([FULL])).toBe(message);
    expect(refusal('text')).toBe(message);
    expect(refusal(document([FULL], { tool: 'spec-guard' }))).toBe(message);
    expect(refusal(document([FULL], { command: 'lint' }))).toBe(message);
    expect(refusal(document([FULL], { briefs: {} }))).toBe('spec-brief list has no "briefs"');
  });

  it('refuses a row of the wrong shape, naming it', () => {
    expect(refusal(document([FULL, 'x']))).toBe('briefs[1] is not an object');
    expect(refusal(document([[FULL]]))).toBe('briefs[0] is not an object');
    expect(refusal(document([{ ...FULL, id: 12 }]))).toBe('briefs[0] has no id or file');
    expect(refusal(document([{ ...FULL, file: undefined }]))).toBe('briefs[0] has no id or file');
    expect(refusal(document([{ ...FULL, phase: 'done' }]))).toBe('briefs[0].phase is "done"');
    expect(refusal(document([{ ...FULL, title: 3 }]))).toBe('briefs[0].title is not a string');
    expect(refusal(document([{ ...FULL, status: false }]))).toBe('briefs[0].status is not a string');
    expect(refusal(document([{ ...FULL, type: {} }]))).toBe('briefs[0].type is not a string');
    expect(refusal(document([{ ...FULL, dependsOn: '7' }]))).toBe('briefs[0].dependsOn is not a list of strings');
    expect(refusal(document([{ ...FULL, affectedFiles: [1] }]))).toBe('briefs[0].affectedFiles is not a list of strings');
    expect(refusal(document([{ ...FULL, protectedFiles: 'src/**' }]))).toBe('briefs[0].protectedFiles is not a list of strings');
    expect(refusal(document([{ ...FULL, waitingOn: [null] }]))).toBe('briefs[0].waitingOn is not a list of strings');
  });

  it('fills what a row leaves out with the empty reading, never a guess', () => {
    const [read] = parseBriefList(document([{ id: '1', file: 'briefs/001.md', phase: 'archived' }]));
    expect(read).toEqual({
      id: '1',
      file: 'briefs/001.md',
      title: null,
      phase: 'archived',
      status: null,
      type: null,
      wave: null,
      dependsOn: [],
      affectedFiles: [],
      protectedFiles: [],
      tasks: { total: 0, checked: 0 },
      ready: false,
      waitingOn: [],
    });
  });

  it('reads a wave, tasks and readiness only when they have their types', () => {
    const [read] = parseBriefList(
      document([{ ...FULL, wave: '2', tasks: { total: '3', checked: 1 }, ready: 'yes', title: null }]),
    );
    expect(read?.wave).toBeNull();
    expect(read?.tasks).toEqual({ total: 0, checked: 1 });
    expect(read?.ready).toBe(false);
    expect(read?.title).toBeNull();
    const [counted] = parseBriefList(document([{ ...FULL, tasks: { total: 3, checked: '1' } }]));
    expect(counted?.tasks).toEqual({ total: 3, checked: 0 });
    const [other] = parseBriefList(document([{ ...FULL, tasks: [3, 1], ready: true }]));
    expect(other?.tasks).toEqual({ total: 0, checked: 0 });
    expect(other?.ready).toBe(true);
  });
});

describe('the active brief', () => {
  const live = row({ id: '012' });
  const other = row({ id: '013', file: 'briefs/013_x.md' });
  const archived = row({ id: '007', file: 'briefs/archive/007_x.md', phase: 'archived' });
  const briefs = [live, other, archived];

  it('is named by the flag first, then the environment, then the branch', () => {
    expect(findActive(briefs, { flag: '012', environment: '013', branch: '007' })).toEqual({ kind: 'found', brief: live, source: 'flag' });
    expect(findActive(briefs, { environment: '013', branch: '012' })).toEqual({ kind: 'found', brief: other, source: 'environment' });
    expect(findActive(briefs, { branch: '013' })).toEqual({ kind: 'found', brief: other, source: 'branch' });
  });

  it('skips a flag or an environment that names nothing, and trims what they name', () => {
    expect(findActive(briefs, { flag: '  ', environment: ' 013 ' })).toEqual({ kind: 'found', brief: other, source: 'environment' });
    expect(findActive(briefs, { flag: '', environment: '', branch: '012' })).toEqual({ kind: 'found', brief: live, source: 'branch' });
    expect(findActive(briefs, { environment: '   ', branch: '013' })).toEqual({ kind: 'found', brief: other, source: 'branch' });
    expect(findActive(briefs, { flag: ' 12 ' })).toEqual({ kind: 'found', brief: live, source: 'flag' });
  });

  it('never falls back when the name it has finds nothing', () => {
    // A flag naming a brief that does not exist is a mistake to fix, not a
    // reason to guard against another brief's contract.
    expect(findActive(briefs, { flag: '99', environment: '012', branch: '012' })).toEqual({ kind: 'unknown', id: '99', source: 'flag' });
    expect(findActive(briefs, { environment: 'x', branch: '012' })).toEqual({ kind: 'unknown', id: 'x', source: 'environment' });
    expect(findActive(briefs, { branch: '98' })).toEqual({ kind: 'unknown', id: '98', source: 'branch' });
  });

  it('compares ids as numbers when both are digits', () => {
    expect(findActive(briefs, { branch: '12' })).toMatchObject({ kind: 'found', brief: live });
    expect(findActive(briefs, { branch: '7' })).toMatchObject({ kind: 'archived', brief: archived });
  });

  it('reports an archived brief as archived, and prefers the live one of two', () => {
    expect(findActive(briefs, { flag: '007' })).toEqual({ kind: 'archived', brief: archived, source: 'flag' });
    const reopened = row({ id: '7', file: 'briefs/007_x.md' });
    expect(findActive([archived, reopened], { flag: '7' })).toEqual({ kind: 'found', brief: reopened, source: 'flag' });
  });

  it('is none, with the ways to name one, when nothing names a brief', () => {
    const none = findActive(briefs, {});
    expect(none.kind).toBe('none');
    expect(none).toEqual({
      kind: 'none',
      reason: 'no brief is named: pass --brief <id>, set SPEC_BRIEF, or work on a branch named like brief/<id>-<topic>',
    });
    expect(findActive(briefs, { branch: null })).toEqual(none);
    expect(findActive([live], { flag: undefined, environment: undefined, branch: undefined }).kind).toBe('none');
  });

  it('never guesses from a single live brief', () => {
    expect(findActive([live], {}).kind).toBe('none');
  });
});
