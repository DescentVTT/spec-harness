/**
 * `premises` and the spec-brief plugin, against real repositories, the real
 * spec-brief and spec-guard, and a real SSH signature.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { waive } from '../../src/plugin.js';
import { premisesCommand } from '../../src/premises.js';
import { parseOptions, type CliIO } from '../../src/workspace.js';

const HERE = dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const ROOT = join(HERE, '..', '..');
const BIN = (tool: string): string => join(ROOT, 'node_modules', '@descent-vtt', tool, 'bin', `${tool}.js`).replace(/\\/g, '/');

const made: string[] = [];
afterEach(() => {
  for (const directory of made.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function write(root: string, path: string, content: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

function repository(): string {
  const root = mkdtempSync(join(tmpdir(), 'spec-harness-test-'));
  made.push(root);
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 't@example.com');
  git(root, 'config', 'user.name', 'T');
  git(root, 'config', 'core.autocrlf', 'false');
  write(
    root,
    '.spec-harness.json',
    `${JSON.stringify({ base: 'main', tools: { 'spec-brief': ['node', BIN('spec-brief')], 'spec-guard': ['node', BIN('spec-guard')] } }, null, 2)}\n`,
  );
  return root;
}

function io(cwd: string): CliIO & { out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, stdout: { write: (t: string) => out.push(t) }, stderr: { write: (t: string) => err.push(t) }, cwd, env: {} };
}

const BRIEF = `---
status: active
wave: 1
affectedFiles: [src/**]
protectedFiles: [src/db/schema.ts]
---

# 001 - Remove the legacy call

## Intent

No caller uses legacyCall.

## Negative Scope

- Nothing else.

## The Defect, Measured

<!-- @assert-count target="src" symbol="legacyCall" min="1" reason="the defect: legacyCall is still called" -->

## Invariants

<!-- @assert-absence target="src" symbol="legacyCall" reason="the goal: nothing calls legacyCall" -->

- [ ] legacyCall is gone
`;

describe('premises', () => {
  it('passes while every premise holds, whatever the goals say', async () => {
    const root = repository();
    write(root, 'briefs/001_remove.md', BRIEF);
    write(root, 'src/a.ts', 'legacyCall();\n');
    git(root, 'add', '-A');
    git(root, 'commit', '-qm', 'start');
    const cli = io(root);
    const code = await premisesCommand(parseOptions(['premises']), cli);
    expect(cli.err.join('')).toBe('');
    expect(code).toBe(0);
    expect(cli.out.join('')).toContain('1 premise(s) in 1 live brief(s), 0 no longer hold');
  });

  it('fails when a live brief\'s premise no longer holds', async () => {
    const root = repository();
    write(root, 'briefs/001_remove.md', BRIEF);
    write(root, 'src/a.ts', 'modernCall();\n');
    git(root, 'add', '-A');
    git(root, 'commit', '-qm', 'start');
    const cli = io(root);
    const code = await premisesCommand(parseOptions(['premises', '--format', 'json']), cli);
    expect(code).toBe(1);
    const report = JSON.parse(cli.out.join('')) as { findings: { rule: string; file: string; line: number }[] };
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]).toMatchObject({ rule: 'stale-premise', file: 'briefs/001_remove.md', line: 20 });
  });

  it('cannot be trusted without spec-guard, and says so', async () => {
    const root = repository();
    write(root, '.spec-harness.json', `${JSON.stringify({ tools: { 'spec-brief': ['node', BIN('spec-brief')] } })}\n`);
    write(root, 'briefs/001_remove.md', BRIEF);
    git(root, 'add', '-A');
    git(root, 'commit', '-qm', 'start');
    const cli = io(root);
    expect(await premisesCommand(parseOptions(['premises']), cli)).toBe(2);
    expect(cli.err.join('')).toContain('premises cannot be checked');
  });
});

function hasSshKeygen(): boolean {
  try {
    execFileSync('ssh-keygen', ['-?'], { stdio: 'ignore' });
    return true;
  } catch (error) {
    // ssh-keygen prints usage and exits non-zero when it exists.
    return (error as { status?: number | null }).status !== undefined && (error as { status?: number | null }).status !== null;
  }
}

describe.skipIf(!hasSshKeygen())('the spec-brief plugin', () => {
  function signedRepository(): { root: string; key: string } {
    const root = repository();
    const key = join(root, '..', `${root.split(/[\\/]/).pop() as string}-key`);
    made.push(key, `${key}.pub`);
    execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 't@example.com', '-f', key]);
    write(root, '.github/allowed_signers', `t@example.com namespaces="git" ${readFileSync(`${key}.pub`, 'utf8').trim()}\n`);
    write(root, 'briefs/001_remove.md', BRIEF);
    write(root, 'src/db/schema.ts', 'table;\n');
    git(root, 'add', '-A');
    git(root, 'commit', '-qm', 'start');
    git(root, 'checkout', '-qb', 'brief/001-remove');
    return { root, key };
  }

  const ruling = (text: string): string =>
    `${text}\n## Rulings\n\n| Ruling | Paths | Decision | Note |\n| --- | --- | --- | --- |\n| R-001-1 | \`src/db/schema.ts\` | allow | One column. |\n`;

  it('waives a protected file a signed ruling allows, and only that', async () => {
    const { root, key } = signedRepository();
    const text = ruling(BRIEF);
    write(root, 'briefs/001_remove.md', text);
    git(root, '-c', 'gpg.format=ssh', '-c', `user.signingkey=${key}`, 'commit', '-q', '-S', '-am', 'ruling R-001-1');
    const waivers = await waive({
      root,
      brief: { id: '001', file: 'briefs/001_remove.md', text },
      findings: [
        { rule: 'protected-file', path: 'src/db/schema.ts' },
        { rule: 'protected-file', path: 'src/db/other.ts' },
        { rule: 'open-task', path: 'src/db/schema.ts' },
      ],
      base: 'main',
      commit: null,
    });
    expect(waivers).toEqual([{ rule: 'protected-file', path: 'src/db/schema.ts', reason: 'ruling R-001-1, signed by t@example.com, allows it' }]);
  });

  it('waives nothing for a ruling nobody signed', async () => {
    const { root } = signedRepository();
    const text = ruling(BRIEF);
    write(root, 'briefs/001_remove.md', text);
    git(root, 'commit', '-q', '-am', 'an unsigned ruling');
    const waivers = await waive({
      root,
      brief: { id: '001', file: 'briefs/001_remove.md', text },
      findings: [{ rule: 'protected-file', path: 'src/db/schema.ts' }],
      base: 'main',
      commit: null,
    });
    expect(waivers).toEqual([]);
  });
});
