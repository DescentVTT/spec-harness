import { describe, expect, it } from 'vitest';

import { SIBLINGS } from '../../src/config.js';
import { checkVersion, meets, MINIMUM_VERSIONS, parseVersion, type Version } from '../../src/versions.js';

const version = (text: string): Version => {
  const parsed = parseVersion(text);
  if (parsed === null) throw new Error(`${text} did not parse`);
  return parsed;
};

describe('a version', () => {
  it('reads major, minor and patch, and whether it is a prerelease', () => {
    expect(parseVersion('0.12.3')).toEqual({ major: 0, minor: 12, patch: 3, prerelease: false });
    expect(parseVersion('10.0.20')).toEqual({ major: 10, minor: 0, patch: 20, prerelease: false });
    expect(parseVersion('1.2.3-rc.1')).toEqual({ major: 1, minor: 2, patch: 3, prerelease: true });
    expect(parseVersion('1.2.3-0.beta-2.x')).toEqual({ major: 1, minor: 2, patch: 3, prerelease: true });
  });

  it('accepts build metadata and ignores it, as precedence does', () => {
    expect(parseVersion('1.2.3+build.7')).toEqual({ major: 1, minor: 2, patch: 3, prerelease: false });
    expect(parseVersion('1.2.3-rc.1+sha-5114f85')).toEqual({ major: 1, minor: 2, patch: 3, prerelease: true });
  });

  it('refuses what semver refuses', () => {
    for (const text of [
      '',
      '1.2',
      '1.2.3.4',
      'v1.2.3',
      ' 1.2.3',
      '1.2.3 ',
      '01.2.3',
      '1.02.3',
      '1.2.03',
      '1.2.x',
      '1x2.3',
      '1.2x3',
      '1.2.3-',
      '1.2.3-rc..1',
      '1.2.3-rc.',
      '1.2.3-rc_1',
      '1.2.3+',
      '1.2.3+a..b',
      '1.2.3+a.',
      '1.2.3+a_b',
      '1.2.3-rc+',
      '>=1.2.3',
      '^1.2.3',
    ]) {
      expect(parseVersion(text), text).toBeNull();
    }
  });
});

describe('meeting a minimum', () => {
  const minimum = version('0.12.0');

  it('is met by the minimum itself and by anything later, at any part', () => {
    for (const text of ['0.12.0', '0.12.1', '0.13.0', '1.0.0', '1.0.0-rc.1', '0.12.1-rc.1', '0.13.0-alpha', '2.3.4+build']) {
      expect(meets(version(text), minimum), text).toBe(true);
    }
  });

  it('is not met by anything earlier, even with a later part below the one that differs', () => {
    for (const text of ['0.11.0', '0.11.9', '0.9.99', '0.0.12', '0.1.20']) {
      expect(meets(version(text), minimum), text).toBe(false);
    }
    expect(meets(version('0.99.99'), version('1.0.0'))).toBe(false);
    expect(meets(version('1.0.0'), version('0.99.99'))).toBe(true);
    expect(meets(version('1.2.3'), version('1.2.4'))).toBe(false);
    expect(meets(version('1.2.5'), version('1.2.4'))).toBe(true);
  });

  it('is not met by a prerelease of the minimum, which comes before it', () => {
    expect(meets(version('0.12.0-rc.1'), minimum)).toBe(false);
    expect(meets(version('0.12.0+build'), minimum)).toBe(true);
  });
});

describe('an installed sibling', () => {
  it('runs at its minimum or later', () => {
    expect(checkVersion('spec-brief', '0.2.0')).toEqual({ ok: true, version: '0.2.0' });
    expect(checkVersion('spec-guard', '0.12.4')).toEqual({ ok: true, version: '0.12.4' });
    expect(checkVersion('spec-graph', '1.0.0')).toEqual({ ok: true, version: '1.0.0' });
  });

  it('below its minimum is refused, naming the minimum and how to reach it', () => {
    expect(checkVersion('spec-brief', '0.1.0')).toEqual({
      ok: false,
      version: '0.1.0',
      reason: 'spec-brief 0.1.0 is installed here; spec-harness needs 0.2.0 or later: npm install --save-dev @descent-vtt/spec-brief@latest',
    });
    expect(checkVersion('spec-guard', '0.12.0-rc.1')).toEqual({
      ok: false,
      version: '0.12.0-rc.1',
      reason: 'spec-guard 0.12.0-rc.1 is installed here; spec-harness needs 0.12.0 or later: npm install --save-dev @descent-vtt/spec-guard@latest',
    });
  });

  it('with a version that cannot be read is refused as an old one is', () => {
    expect(checkVersion('spec-graph', undefined)).toEqual({
      ok: false,
      version: null,
      reason: 'the spec-graph installed here declares no version; spec-harness needs 0.9.0 or later: npm install --save-dev @descent-vtt/spec-graph@latest',
    });
    expect(checkVersion('spec-graph', 9)).toMatchObject({ ok: false, version: null });
    expect(checkVersion('spec-graph', 'latest')).toEqual({
      ok: false,
      version: 'latest',
      reason: 'the spec-graph installed here declares "latest", which is not a version; spec-harness needs 0.9.0 or later: npm install --save-dev @descent-vtt/spec-graph@latest',
    });
  });

  it('has a minimum for every sibling, each a release rather than a prerelease', () => {
    expect(Object.keys(MINIMUM_VERSIONS).sort()).toEqual([...SIBLINGS].sort());
    for (const name of SIBLINGS) {
      expect(parseVersion(MINIMUM_VERSIONS[name])?.prerelease, name).toBe(false);
    }
  });
});
