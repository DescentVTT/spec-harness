import { describe, expect, it } from 'vitest';

import { minimumsOf, notAtMinimum } from '../../scripts/minimum-siblings.js';

const MINIMUMS = { 'spec-brief': '0.12.0', 'spec-graph': '0.21.0', 'spec-guard': '0.30.0' };

describe('the siblings CI installs at their minimums', () => {
  it('are the siblings among the devDependencies, each at its minimum, whatever range the manifest gives', () => {
    const devDependencies = { vitest: '^4.1.11', '@spec-family/spec-guard': '^0.30.1', '@spec-family/spec-brief': '^0.12.1', '@types/node': '^22.20.4' };
    expect(minimumsOf(devDependencies, MINIMUMS)).toEqual([
      { name: '@spec-family/spec-brief', version: '0.12.0' },
      { name: '@spec-family/spec-guard', version: '0.30.0' },
    ]);
  });

  it('leave out a sibling the suite does not install, which no install could replace', () => {
    expect(minimumsOf({ '@spec-family/spec-brief': '^0.12.1' }, MINIMUMS)).toEqual([{ name: '@spec-family/spec-brief', version: '0.12.0' }]);
  });

  it('are refused when a sibling the suite installs has no minimum, rather than tested at whatever npm chose', () => {
    expect(minimumsOf({ '@spec-family/spec-brief': '^0.12.1', '@spec-family/spec-lint': '^1.0.0', '@spec-family/spec-audit': '^1.0.0' }, MINIMUMS)).toBe(
      'MINIMUM_VERSIONS in src/versions.ts has no minimum for @spec-family/spec-audit, @spec-family/spec-lint',
    );
  });

  it('are refused when no sibling is a devDependency, rather than leaving the suite on the newest', () => {
    const none = 'package.json has no @spec-family/* devDependency, so there is no sibling to test at its minimum';
    expect(minimumsOf({}, MINIMUMS)).toBe(none);
    // A package of another scope, or one that only ends like a sibling, is no sibling.
    expect(minimumsOf({ '@other/spec-brief': '1.0.0', 'spec-brief': '1.0.0', 'x@spec-family/spec-brief': '1.0.0' }, MINIMUMS)).toBe(none);
    // Nor is the scope the family left on 2026-10-26, which nothing here looks for.
    expect(minimumsOf({ '@descent-vtt/spec-brief': '^0.11.0', '@descent-vtt/spec-guard': '^0.29.0' }, MINIMUMS)).toBe(none);
  });
});

describe('the check that the minimums are what is installed', () => {
  const wanted = [
    { name: '@spec-family/spec-brief', version: '0.12.0' },
    { name: '@spec-family/spec-guard', version: '0.30.0' },
  ];

  it('passes when each sibling declares exactly its minimum', () => {
    expect(notAtMinimum(wanted, (name) => (name === '@spec-family/spec-brief' ? '0.12.0' : '0.30.0'))).toEqual([]);
  });

  it('names a sibling left at a newer release, which is what npm leaves when the install did nothing', () => {
    expect(notAtMinimum(wanted, (name) => (name === '@spec-family/spec-brief' ? '0.12.1' : '0.30.0'))).toEqual([
      '@spec-family/spec-brief is installed at 0.12.1, where its minimum is 0.12.0',
    ]);
  });

  it('names a later patch of the minimum too: the minimum is one version, not a range', () => {
    expect(notAtMinimum(wanted, (name) => (name === '@spec-family/spec-guard' ? '0.30.1' : '0.12.0'))).toEqual([
      '@spec-family/spec-guard is installed at 0.30.1, where its minimum is 0.30.0',
    ]);
  });

  it('names a sibling that is not installed, or whose version cannot be read', () => {
    expect(notAtMinimum(wanted, () => null)).toEqual([
      '@spec-family/spec-brief is not installed, where its minimum is 0.12.0',
      '@spec-family/spec-guard is not installed, where its minimum is 0.30.0',
    ]);
  });
});
