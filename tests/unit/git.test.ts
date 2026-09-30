import { describe, expect, it } from 'vitest';

import { isUncommitted, parseNameStatus } from '../../src/git.js';

// `git diff --name-status -z` separates fields with NUL; written as escapes so the file holds none.
const NUL = '\u0000';

describe('git diff --name-status -z', () => {
  it('reads additions, modifications, deletions and type changes', () => {
    const output = ['A', 'src/new.ts', 'M', 'src/a b.ts', 'D', 'old.ts', 'T', 'link', ''].join(NUL);
    expect(parseNameStatus(output)).toEqual([
      { status: 'A', path: 'src/new.ts' },
      { status: 'M', path: 'src/a b.ts' },
      { status: 'D', path: 'old.ts' },
      { status: 'T', path: 'link' },
    ]);
  });

  it('reads renames and copies with where they came from, whatever their score', () => {
    const output = ['R100', 'old/a.ts', 'new/a.ts', 'C075', 'b.ts', 'c.ts', 'M', 'd.ts', ''].join(NUL);
    expect(parseNameStatus(output)).toEqual([
      { status: 'R', from: 'old/a.ts', path: 'new/a.ts' },
      { status: 'C', from: 'b.ts', path: 'c.ts' },
      { status: 'M', path: 'd.ts' },
    ]);
  });

  it('reads no change from no output, and tolerates output cut short', () => {
    expect(parseNameStatus('')).toEqual([]);
    expect(parseNameStatus(`${NUL}${NUL}`)).toEqual([]);
    expect(parseNameStatus('M')).toEqual([{ status: 'M', path: '' }]);
    expect(parseNameStatus(`R090${NUL}a`)).toEqual([{ status: 'R', from: 'a', path: '' }]);
    expect(parseNameStatus('R090')).toEqual([{ status: 'R', from: '', path: '' }]);
  });
});

describe('a line nobody committed', () => {
  it('belongs to the all-zero commit, in either hash, and to no commit that merely starts or ends with a zero', () => {
    expect(isUncommitted('0'.repeat(40))).toBe(true);
    expect(isUncommitted('0'.repeat(64))).toBe(true);
    expect(isUncommitted(`0${'a'.repeat(39)}`)).toBe(false);
    expect(isUncommitted(`${'a'.repeat(39)}0`)).toBe(false);
    expect(isUncommitted(`${'0'.repeat(20)}1${'0'.repeat(19)}`)).toBe(false);
  });
});
