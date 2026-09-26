import { describe, expect, it } from 'vitest';

import type { OutOfScope } from '../../src/config.js';
import { decide, type GuardInput, type VerifiedRuling } from '../../src/guard.js';
import type { BriefRow } from '../../src/types.js';
import { row } from './helpers.js';

const brief = row({
  affectedFiles: ['src/auth/**', 'tests/auth/**'],
  protectedFiles: ['src/db/schema.ts', 'migrations/**'],
});

function check(path: string | null, options: { brief?: BriefRow | null; rulings?: VerifiedRuling[]; outOfScope?: OutOfScope; noBrief?: string } = {}) {
  const input: GuardInput = {
    path,
    given: path ?? '/elsewhere/x.ts',
    brief: options.brief === undefined ? brief : options.brief,
    rulings: options.rulings ?? [],
    outOfScope: options.outOfScope ?? 'warn',
    ...(options.noBrief === undefined ? {} : { noBrief: options.noBrief }),
  };
  return decide(input);
}

const ESCALATE =
  'if the round cannot be done without it, stop and ask for a ruling: spec-harness escalate --path <file> --reason <why>, or the request_escalation tool';

describe('the guard', () => {
  it('allows a path in scope, naming the patterns that put it there', () => {
    const decision = check('src/auth/login.ts');
    expect(decision).toEqual({
      path: 'src/auth/login.ts',
      verdict: 'allow',
      reason: 'in-scope',
      because: ['src/auth/**'],
      message: "src/auth/login.ts is in brief 012's scope (src/auth/**)",
      hint: 'nothing to do',
    });
  });

  it('refuses a protected path with the next step, even inside the scope', () => {
    const decision = check('src/db/schema.ts', { brief: row({ affectedFiles: ['src/**'], protectedFiles: ['src/db/schema.ts'] }) });
    expect(decision.verdict).toBe('deny');
    expect(decision.reason).toBe('protected');
    expect(decision.because).toEqual(['src/db/schema.ts']);
    expect(decision.message).toBe('brief 012 does not empower this round to change src/db/schema.ts (protectedFiles: src/db/schema.ts)');
    expect(decision.hint).toBe(ESCALATE);
  });

  it('names every protection a path meets, and every scope pattern', () => {
    const decision = check('migrations/001.sql', { brief: row({ protectedFiles: ['migrations/**', '**/*.sql', 'docs/**'] }) });
    expect(decision.because).toEqual(['migrations/**', '**/*.sql']);
    expect(decision.message).toBe('brief 012 does not empower this round to change migrations/001.sql (protectedFiles: migrations/**, **/*.sql)');
    const scoped = check('src/auth/a.ts', { brief: row({ affectedFiles: ['src/**', 'src/auth/*.ts'], protectedFiles: [] }) });
    expect(scoped.message).toBe("src/auth/a.ts is in brief 012's scope (src/**, src/auth/*.ts)");
    const unreadable = check('a.ts', { brief: row({ protectedFiles: ['[a', '{b'] }) });
    expect(unreadable.message).toMatch(/^brief 012 protects files with a pattern that cannot be read: \[a \(.+\); \{b \(.+\)$/);
  });

  it('lets a verified ruling pass the protected paths it names, and no other', () => {
    const rulings: VerifiedRuling[] = [
      { id: 'R-012-1', paths: ['docs/**'], signer: 'a@example.com' },
      { id: 'R-012-2', paths: ['src/db/schema.ts'], signer: 'p@example.com' },
    ];
    const ruled = check('src/db/schema.ts', { rulings });
    expect(ruled).toMatchObject({ verdict: 'allow', reason: 'ruled', because: ['R-012-2'], hint: 'keep the change to what the ruling allows' });
    expect(ruled.message).toBe('src/db/schema.ts is protected by brief 012, and ruling R-012-2, signed by p@example.com, allows it');
    expect(check('migrations/002.sql', { rulings })).toMatchObject({ verdict: 'deny', reason: 'protected' });
  });

  it('reads a ruling that names a glob, and ignores one whose pattern cannot be read', () => {
    expect(check('migrations/9.sql', { rulings: [{ id: 'R-1', paths: ['migrations/*.sql'], signer: 's' }] }).reason).toBe('ruled');
    expect(check('migrations/9.sql', { rulings: [{ id: 'R-1', paths: ['migrations/[9'], signer: 's' }] }).reason).toBe('protected');
  });

  it('fails closed on a protection it cannot read, whatever the path and the rulings', () => {
    const unreadable = row({ protectedFiles: ['src/[db', 'migrations/**'] });
    for (const path of ['src/auth/login.ts', 'README.md', 'migrations/1.sql']) {
      const decision = check(path, { brief: unreadable, rulings: [{ id: 'R-1', paths: ['**'], signer: 's' }] });
      expect(decision.verdict).toBe('deny');
      expect(decision.reason).toBe('unreadable-protection');
      expect(decision.because).toEqual(['src/[db (a "[" is never closed)']);
      expect(decision.message).toBe('brief 012 protects files with a pattern that cannot be read: src/[db (a "[" is never closed)');
      expect(decision.hint).toBe('fix protectedFiles in briefs/012_rotate-tokens.md (spec-brief lint names the problem)');
    }
  });

  it('answers a path outside the scope as the repository configured: warn, ask or deny', () => {
    const warned = check('README.md');
    expect(warned).toMatchObject({ verdict: 'warn', reason: 'out-of-scope', because: [] });
    expect(warned.message).toBe("README.md is outside brief 012's scope, which covers src/auth/**, tests/auth/**");
    expect(warned.hint).toBe(
      'if the round needs it, say so in briefs/012_rotate-tokens.md and add it to affectedFiles; the archive reports every file outside the scope',
    );
    expect(check('README.md', { outOfScope: 'ask' })).toMatchObject({ verdict: 'ask', reason: 'out-of-scope', hint: warned.hint });
    const denied = check('README.md', { outOfScope: 'deny' });
    expect(denied).toMatchObject({ verdict: 'deny', reason: 'out-of-scope' });
    expect(denied.hint).toBe(
      `add it to affectedFiles in briefs/012_rotate-tokens.md if the round needs it, which is a change the person who approved the brief must see; or ${ESCALATE}`,
    );
  });

  it('says a brief with no scope declares none, and names a scope pattern it could not read', () => {
    const unscoped = check('src/a.ts', { brief: row({ affectedFiles: [], protectedFiles: [] }) });
    expect(unscoped.message).toBe("src/a.ts is outside brief 012's scope, which declares no affectedFiles");
    const unreadable = check('src/a.ts', { brief: row({ affectedFiles: ['src/{a'], protectedFiles: [] }) });
    expect(unreadable).toMatchObject({ verdict: 'warn', reason: 'out-of-scope' });
    expect(unreadable.because).toHaveLength(1);
    expect(unreadable.because[0]).toMatch(/^src\/\{a \(/);
  });

  it('reads a pattern with no glob syntax as a file or the directory it names', () => {
    // protectedFiles: [src/db] protects everything in src/db, as spec-brief reads it.
    const directory = row({ affectedFiles: ['docs'], protectedFiles: ['src/db'] });
    expect(check('src/db/schema.ts', { brief: directory })).toMatchObject({ verdict: 'deny', reason: 'protected' });
    expect(check('src/db', { brief: directory })).toMatchObject({ verdict: 'deny', reason: 'protected' });
    expect(check('docs/a/b.md', { brief: directory })).toMatchObject({ verdict: 'allow', reason: 'in-scope' });
    expect(check('src/dbx.ts', { brief: directory }).reason).toBe('out-of-scope');
  });

  it('matches case as written: the caller corrects the spelling, not the guard', () => {
    expect(check('SRC/db/schema.ts').reason).toBe('out-of-scope');
  });

  it('lets the round write its own brief, even one it protects', () => {
    const selfProtecting = row({ protectedFiles: ['briefs/**'] });
    expect(check('briefs/012_rotate-tokens.md', { brief: selfProtecting })).toEqual({
      path: 'briefs/012_rotate-tokens.md',
      verdict: 'allow',
      reason: 'brief-file',
      because: [],
      message: 'briefs/012_rotate-tokens.md is brief 012 itself',
      hint: 'tick or disposition its boxes as the work lands',
    });
    expect(check('briefs/013_other.md', { brief: selfProtecting }).reason).toBe('protected');
  });

  it('allows everything, saying why, when no brief governs the round', () => {
    expect(check('src/db/schema.ts', { brief: null, noBrief: 'no brief is named' })).toEqual({
      path: 'src/db/schema.ts',
      verdict: 'allow',
      reason: 'no-brief',
      because: [],
      message: 'no brief governs src/db/schema.ts: no brief is named',
      hint: 'name the brief this work belongs to, so its scope can be checked',
    });
    expect(check('a.ts', { brief: null }).message).toBe('no brief governs a.ts: no active brief');
  });

  it('allows a path outside the repository, which no brief governs', () => {
    expect(check(null)).toEqual({
      path: '/elsewhere/x.ts',
      verdict: 'allow',
      reason: 'outside-repository',
      because: [],
      message: '/elsewhere/x.ts is outside the repository; no brief governs it',
      hint: 'nothing to do',
    });
  });
});
