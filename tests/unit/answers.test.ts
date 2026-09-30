import { describe, expect, it } from 'vitest';

import { readArchivePlan, readGuardRun, readQueryRules } from '../../src/answers.js';
import { SiblingOutputError } from '../../src/briefs.js';

/** The message a reader refuses a document with, which the command prints before exiting 2. */
function refusal(read: () => unknown): string {
  try {
    read();
  } catch (error) {
    expect(error).toBeInstanceOf(SiblingOutputError);
    return (error as Error).message;
  }
  throw new Error('the document was read');
}

describe('spec-guard query', () => {
  const rule = (extra: Record<string, unknown> = {}) => ({ document: 'docs/adr/0001.md', line: 5, kind: 'assert-absence', description: 'd', ...extra });

  it('reads each result\'s rules, a missing list as an empty one, a missing reason as none and a missing inForce as in force', () => {
    const document = {
      results: [{ path: 'src', rules: [rule({ reason: 'gone', inForce: false, bounds: { max: 0 } }), rule({ reason: null }), rule()] }, { path: 'lib' }],
    };
    expect(readQueryRules(document)).toEqual([
      [
        { document: 'docs/adr/0001.md', line: 5, kind: 'assert-absence', description: 'd', reason: 'gone', inForce: false },
        { document: 'docs/adr/0001.md', line: 5, kind: 'assert-absence', description: 'd', reason: null, inForce: true },
        { document: 'docs/adr/0001.md', line: 5, kind: 'assert-absence', description: 'd', reason: null, inForce: true },
      ],
      [],
    ]);
    expect(readQueryRules({ formatVersion: 1 })).toEqual([]);
  });

  it('refuses a document of another shape, naming the field', () => {
    const query = (document: unknown) => refusal(() => readQueryRules(document));
    for (const document of [null, 5, [], 'x']) expect(query(document)).toBe('spec-guard query printed a document that is not an object');
    expect(query({ results: 5 })).toBe('spec-guard query printed results that is not a list');
    expect(query({ results: ['src'] })).toBe('spec-guard query printed results[0] that is not an object');
    expect(query({ results: [{ rules: {} }] })).toBe('spec-guard query printed results[0].rules that is not a list');
    expect(query({ results: [{}, { rules: [rule(), 7] }] })).toBe('spec-guard query printed results[1].rules[1] that is not an object');
    const field = (extra: Record<string, unknown>) => query({ results: [{ rules: [rule(extra)] }] });
    expect(field({ document: undefined })).toBe('spec-guard query printed results[0].rules[0].document that is not text');
    expect(field({ line: '5' })).toBe('spec-guard query printed results[0].rules[0].line that is not a number');
    expect(field({ kind: 3 })).toBe('spec-guard query printed results[0].rules[0].kind that is not text');
    expect(field({ description: null })).toBe('spec-guard query printed results[0].rules[0].description that is not text');
    expect(field({ reason: 5 })).toBe('spec-guard query printed results[0].rules[0].reason that is not text or null');
    expect(field({ inForce: 'yes' })).toBe('spec-guard query printed results[0].rules[0].inForce that is not true or false');
  });
});

describe('a spec-guard run', () => {
  const result = (extra: Record<string, unknown> = {}) => ({ ok: false, description: 'd', message: 'm', kind: 'assert-absence', ...extra });

  it('reads the results and the errors, where each is placed if anywhere, and a missing raw as empty', () => {
    const document = {
      results: [result({ spec: { file: 'briefs/001.md', line: 22, column: 1 } }), result({ ok: true })],
      errors: [{ message: 'e', raw: '<!-- x -->', spec: { file: 'briefs/001.md', line: 3 } }, { message: 'nowhere' }],
    };
    expect(readGuardRun(document)).toEqual({
      results: [
        { ok: false, description: 'd', message: 'm', spec: { file: 'briefs/001.md', line: 22 } },
        { ok: true, description: 'd', message: 'm', spec: undefined },
      ],
      errors: [
        { message: 'e', raw: '<!-- x -->', spec: { file: 'briefs/001.md', line: 3 } },
        { message: 'nowhere', raw: '', spec: undefined },
      ],
    });
    expect(readGuardRun({})).toEqual({ results: [], errors: [] });
  });

  it('refuses a document of another shape, naming the field', () => {
    const run = (document: unknown) => refusal(() => readGuardRun(document));
    expect(run(null)).toBe('spec-guard printed a document that is not an object');
    expect(run({ results: 5 })).toBe('spec-guard printed results that is not a list');
    expect(run({ results: [5] })).toBe('spec-guard printed results[0] that is not an object');
    expect(run({ results: [result({ ok: 'false' })] })).toBe('spec-guard printed results[0].ok that is not true or false');
    expect(run({ results: [result({ description: undefined })] })).toBe('spec-guard printed results[0].description that is not text');
    expect(run({ results: [result({ message: 5 })] })).toBe('spec-guard printed results[0].message that is not text');
    expect(run({ results: [result({ spec: 'briefs/001.md' })] })).toBe('spec-guard printed results[0].spec that is not an object');
    expect(run({ results: [result({ spec: { file: 5, line: 1 } })] })).toBe('spec-guard printed results[0].spec.file that is not text');
    expect(run({ results: [result({ spec: { file: 'a.md', line: '1' } })] })).toBe('spec-guard printed results[0].spec.line that is not a number');
    expect(run({ errors: { message: 'e' } })).toBe('spec-guard printed errors that is not a list');
    expect(run({ errors: ['e'] })).toBe('spec-guard printed errors[0] that is not an object');
    expect(run({ errors: [{ raw: 'x' }] })).toBe('spec-guard printed errors[0].message that is not text');
    expect(run({ errors: [{ message: 'e', raw: 5 }] })).toBe('spec-guard printed errors[0].raw that is not text');
    expect(run({ errors: [{ message: 'e', spec: { line: 1 } }] })).toBe('spec-guard printed errors[0].spec.file that is not text');
  });
});

describe('spec-brief archive', () => {
  const reason = (extra: Record<string, unknown> = {}) => ({ rule: 'open-task', severity: 'error', message: 'm', ...extra });

  it('reads what it refuses and warns about, carrying a reason\'s hint, file, line and path only where it gives them', () => {
    const full = reason({ hint: 'h', file: 'briefs/001.md', line: 19, path: 'src/db/schema.ts', brief: '001' });
    expect(readArchivePlan({ plan: { blocking: [full], warnings: [reason({ severity: 'warning' })] } })).toEqual({
      blocking: [{ rule: 'open-task', severity: 'error', message: 'm', hint: 'h', file: 'briefs/001.md', line: 19, path: 'src/db/schema.ts' }],
      warnings: [{ rule: 'open-task', severity: 'warning', message: 'm' }],
    });
    expect(readArchivePlan({ plan: { blocking: [reason({ severity: 'note' })] } }).blocking[0]).toMatchObject({ severity: 'note' });
    expect(readArchivePlan({})).toEqual({ blocking: [], warnings: [] });
    expect(readArchivePlan({ plan: {} })).toEqual({ blocking: [], warnings: [] });
  });

  it('refuses a document of another shape, naming the field', () => {
    const archive = (document: unknown) => refusal(() => readArchivePlan(document));
    expect(archive(5)).toBe('spec-brief archive printed a document that is not an object');
    expect(archive({ plan: 5 })).toBe('spec-brief archive printed plan that is not an object');
    expect(archive({ plan: { blocking: {} } })).toBe('spec-brief archive printed plan.blocking that is not a list');
    expect(archive({ plan: { warnings: [null] } })).toBe('spec-brief archive printed plan.warnings[0] that is not an object');
    const field = (extra: Record<string, unknown>) => archive({ plan: { blocking: [reason(extra)] } });
    expect(field({ rule: undefined })).toBe('spec-brief archive printed plan.blocking[0].rule that is not text');
    expect(field({ severity: 'fatal' })).toBe('spec-brief archive printed plan.blocking[0].severity that is not error, warning or note');
    expect(field({ severity: 2 })).toBe('spec-brief archive printed plan.blocking[0].severity that is not text');
    expect(field({ message: [] })).toBe('spec-brief archive printed plan.blocking[0].message that is not text');
    expect(field({ hint: 5 })).toBe('spec-brief archive printed plan.blocking[0].hint that is not text');
    expect(field({ file: 5 })).toBe('spec-brief archive printed plan.blocking[0].file that is not text');
    expect(field({ line: '19' })).toBe('spec-brief archive printed plan.blocking[0].line that is not a number');
    expect(field({ path: false })).toBe('spec-brief archive printed plan.blocking[0].path that is not text');
  });
});
