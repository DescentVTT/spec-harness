import { describe, expect, it } from 'vitest';

import { changelogSection, pluginDrift, releaseOf } from '../../scripts/release.js';

const CHANGELOG = [
  '# Changelog',
  '',
  '## Unreleased',
  '',
  '- Something not yet released.',
  '',
  '## [0.2.0] - 2026-10-01',
  '',
  '- A feature.',
  '',
  '### Fixed',
  '',
  '- A defect.',
  '',
  '## 0.2.0-rc.1',
  '',
  '- The candidate.',
  '',
  '## 0.1.1',
  '',
  '## 0.1.0',
  '',
  'The first release.',
  '',
].join('\n');

describe('the release check', () => {
  it('accepts the tag that names the version, with the notes and the default dist-tag', () => {
    expect(releaseOf('v0.1.0', '0.1.0', CHANGELOG)).toEqual({ version: '0.1.0', distTag: 'latest', notes: 'The first release.' });
  });

  it('stages a prerelease under next, never as the default install', () => {
    expect(releaseOf('v0.2.0-rc.1', '0.2.0-rc.1', CHANGELOG)).toEqual({
      version: '0.2.0-rc.1',
      distTag: 'next',
      notes: '- The candidate.',
    });
  });

  it('refuses a tag that does not name the version, and says how to fix it', () => {
    expect(releaseOf('v0.1.1', '0.1.0', CHANGELOG)).toBe(
      "the tag v0.1.1 does not name the package's version 0.1.0: tag v0.1.0, or change the version",
    );
    expect(releaseOf('0.1.0', '0.1.0', CHANGELOG)).toContain('does not name');
  });

  it('refuses a version the changelog does not describe, or describes with nothing', () => {
    const missing = 'CHANGELOG.md has no "## 0.3.0" section with text in it; describe the release before tagging it';
    expect(releaseOf('v0.3.0', '0.3.0', CHANGELOG)).toBe(missing);
    expect(releaseOf('v0.1.1', '0.1.1', CHANGELOG)).toContain('no "## 0.1.1" section');
  });
});

describe('a changelog section', () => {
  it('runs to the next heading of its level, keeping the headings below it', () => {
    expect(changelogSection(CHANGELOG, '0.2.0')).toBe('- A feature.\n\n### Fixed\n\n- A defect.');
  });

  it('matches the version exactly, not a prerelease of it or a longer version', () => {
    expect(changelogSection('## 0.1.0-rc.1\n\nx\n', '0.1.0')).toBeNull();
    expect(changelogSection('## 0.1.00\n\nx\n', '0.1.0')).toBeNull();
    expect(changelogSection('### 0.1.0\n\nx\n', '0.1.0')).toBeNull();
    expect(changelogSection('## Unreleased\n\nx\n', 'Unreleased')).toBe('x');
  });

  it('reads CRLF, and stops at a top-level heading too', () => {
    expect(changelogSection('## 1.0.0\r\n\r\n- a\r\n# Appendix\r\ny\r\n', '1.0.0')).toBe('- a');
  });
});

describe('the plugin beside the package', () => {
  const plugin = (version: unknown): unknown => ({ name: 'spec-harness', version });
  const marketplace = (...plugins: unknown[]): unknown => ({ name: 'spec-tools', plugins });

  it('passes when both manifests name the package version', () => {
    expect(pluginDrift('0.1.0', plugin('0.1.0'), marketplace({ name: 'other', version: '9.9.9' }, { name: 'spec-harness', version: '0.1.0' }))).toBeNull();
  });

  it('names each manifest that says another version, and the one the package says', () => {
    expect(pluginDrift('0.2.0', plugin('0.1.0'), marketplace({ name: 'spec-harness', version: '0.2.0' }))).toBe(
      '.claude-plugin/plugin.json names 0.1.0, where package.json names 0.2.0: the plugin is released with the package, at its version',
    );
    expect(pluginDrift('0.2.0', plugin('0.2.0'), marketplace({ name: 'spec-harness', version: '0.1.0' }))).toBe(
      'the spec-harness plugin in .claude-plugin/marketplace.json names 0.1.0, where package.json names 0.2.0: the plugin is released with the package, at its version',
    );
    expect(pluginDrift('0.2.0', plugin('0.1.0'), marketplace({ name: 'spec-harness', version: '0.1.0' }))).toBe(
      '.claude-plugin/plugin.json names 0.1.0, and the spec-harness plugin in .claude-plugin/marketplace.json names 0.1.0, where package.json names 0.2.0: the plugin is released with the package, at its version',
    );
  });

  it('counts a manifest without a version, or without the plugin, as drift', () => {
    const none = 'names no version';
    expect(pluginDrift('0.1.0', { name: 'spec-harness' }, marketplace({ name: 'spec-harness', version: '0.1.0' }))).toContain(`plugin.json ${none}`);
    expect(pluginDrift('0.1.0', plugin(1), marketplace({ name: 'spec-harness', version: '0.1.0' }))).toContain(`plugin.json ${none}`);
    expect(pluginDrift('0.1.0', plugin('0.1.0'), marketplace({ name: 'spec-brief', version: '0.1.0' }))).toContain(`marketplace.json ${none}`);
    expect(pluginDrift('0.1.0', plugin('0.1.0'), { plugins: 'spec-harness' })).toContain(`marketplace.json ${none}`);
    expect(pluginDrift('0.1.0', plugin('0.1.0'), marketplace('spec-harness'))).toContain(`marketplace.json ${none}`);
    expect(pluginDrift('0.1.0', [], null)).toContain(`plugin.json ${none}, and`);
  });
});
