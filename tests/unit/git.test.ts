import { describe, expect, it } from 'vitest';

import { isUncommitted, parseNameStatus, parseStatus } from '../../src/git.js';

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

describe('git status --porcelain=v2 -z', () => {
  const H = '0123456789abcdef0123456789abcdef01234567';
  it('reads the path of each kind of record, and both of a rename or a copy', () => {
    const output = [
      `1 .M N... 100644 100644 100644 ${H} ${H} src/a.ts`,
      `1 A. N... 000000 100644 100644 ${H} ${H} src/with  two spaces.ts`,
      `2 R. N... 100644 100644 100644 ${H} ${H} R100 src/new.ts`,
      'src/old.ts',
      `2 C. N... 100644 100644 100644 ${H} ${H} C75 src/copy.ts`,
      'src/source.ts',
      `u UU N... 100644 100644 100644 100644 ${H} ${H} ${H} src/both.ts`,
      '? notes/new.md',
      '! dist/out.js',
      '# branch.oid (initial)',
      '',
    ].join(NUL);
    expect(parseStatus(output)).toEqual(['src/a.ts', 'src/with  two spaces.ts', 'src/new.ts', 'src/old.ts', 'src/copy.ts', 'src/source.ts', 'src/both.ts', 'notes/new.md', 'dist/out.js']);
  });

  it('names a path once, and nothing for what is no record of a path', () => {
    expect(parseStatus('')).toEqual([]);
    expect(parseStatus(`${NUL}${NUL}`)).toEqual([]);
    expect(parseStatus(['? a.md', `1 .M N... 100644 100644 100644 ${H} ${H} a.md`, ''].join(NUL))).toEqual(['a.md']);
    expect(parseStatus(['# stash 3', 'x y', '1 .M', '?', ''].join(NUL))).toEqual([]);
    // A rename at the end with no path it came from names its own.
    expect(parseStatus(`2 R. N... 100644 100644 100644 ${H} ${H} R100 b.md`)).toEqual(['b.md']);
  });
});
