import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DependencyChange } from '../../src/manifests.js';
import type { Finding } from '../../src/types.js';
import { brief, BRIEF_FILE, cleanup, cli, parsed, repository, SPEC_BRIEF, type Repository } from './helpers.js';

afterAll(cleanup);

interface Report {
  ok: boolean;
  brief: string;
  base: { ref: string; mergeBase: string; head: string } | null;
  counts: { error: number; warning: number; note: number };
  findings: Finding[];
  dependencies: DependencyChange[];
}

const BODY = [
  '## The Defect, Measured',
  '',
  '<!-- @assert-count target="src/auth" symbol="OldToken" min="1" -->',
  '',
  '## Goals',
  '',
  '<!-- @assert-absence target="src/auth" symbol="OldToken" -->',
  '<!-- @assert-absence target="src/auth" symbol="LegacyGateway" -->',
  '',
].join('\n');

const PACKAGE = { name: 'x', version: '1.0.0', dependencies: { kept: '^1.0.0', bumped: '1.0.0', dropped: '2.0.0' } };

let repo: Repository;
let base: string;

beforeAll(() => {
  repo = repository({
    [BRIEF_FILE]: brief({ affected: ['src/auth/**', 'package.json'], protected: ['src/db/schema.ts'], tasks: ['- [ ] the tests pass'], body: BODY }),
    'package.json': `${JSON.stringify(PACKAGE, null, 2)}\n`,
    'requirements-dev.txt': 'pytest==8.0\n',
    'src/auth/a.ts': 'export const OldToken = 1;\n',
    'src/db/schema.ts': 'table;\n',
  });
  base = repo.git('rev-parse', 'HEAD');
  repo.git('checkout', '-q', '-b', 'brief/001-rotate');
  repo.write('package.json', `${JSON.stringify({ ...PACKAGE, dependencies: { kept: '^1.0.0', bumped: '1.1.0', 'left-pad': '^1.3.0' } }, null, 2)}\n`);
  repo.write('requirements-dev.txt', 'pytest==8.0\nhypothesis\n');
  repo.write('src/auth/a.ts', 'export const NewToken = 1;\n');
  repo.write('NOTES.md', 'outside the scope\n');
  repo.commit('the round');
});

describe('audit of a round', () => {
  it('reports the archive\'s reasons, the assertions, and every dependency added', async () => {
    const result = await cli(['audit', '--format', 'json'], repo.root);
    expect(result.code).toBe(1);
    const report = parsed<Report>(result);
    expect(report.ok).toBe(false);
    expect(report.brief).toBe('001');
    expect(report.base).toEqual({ ref: 'main', mergeBase: base, head: repo.git('rev-parse', 'HEAD') });
    const rules = report.findings.map((f) => f.rule);
    expect(rules).toContain('archive/open-task');
    expect(rules).toContain('archive/out-of-scope');
    // The default manifest names all read.
    expect(rules).not.toContain('manifest-name-unread');
    expect(report.findings.find((f) => f.rule === 'archive/out-of-scope')?.message).toContain('NOTES.md');
    // The premise stopped holding, as the round meant it to; the goals hold.
    expect(report.findings.filter((f) => f.rule.startsWith('premise') || f.rule === 'goal-failed').map((f) => [f.rule, f.line])).toEqual([['premise-retired', 23]]);
    expect(report.findings.filter((f) => f.rule === 'new-dependency').map((f) => f.message)).toEqual([
      'the round added npm dependency "left-pad" ^1.3.0 in package.json (dependencies)',
      'the round added pip dependency "hypothesis" hypothesis in requirements-dev.txt (requirements)',
    ]);
    expect(report.dependencies.map((d) => [d.name, d.before, d.after])).toEqual([
      ['bumped', '1.0.0', '1.1.0'],
      ['left-pad', null, '^1.3.0'],
      ['dropped', '2.0.0', null],
      ['hypothesis', null, 'hypothesis'],
    ]);
    expect(report.counts.error).toBeGreaterThanOrEqual(1);
  });

  it('prints the same as text, with its counts', async () => {
    const result = await cli(['audit'], repo.root);
    expect(result.code).toBe(1);
    expect(result.stdout.startsWith(`audit of brief 001 from main (${base.slice(0, 12)})\n\n`)).toBe(true);
    expect(result.stdout).toContain(`error    ${BRIEF_FILE}:`);
    expect(result.stdout).toContain('warning  package.json  the round added npm dependency "left-pad" ^1.3.0 in package.json (dependencies)  new-dependency');
    expect(result.stdout).toMatch(/\n\d+ error\(s\), \d+ warning\(s\), \d+ note\(s\)\n$/);
  });

  it('fails a goal that does not hold, and warns about a premise that still does', async () => {
    const r = repository({
      [BRIEF_FILE]: brief({ affected: ['src/**'], body: BODY }),
      'src/auth/a.ts': 'export const OldToken = 1; LegacyGateway();\n',
    });
    r.git('checkout', '-q', '-b', 'brief/001-x');
    r.write('src/auth/b.ts', 'b;\n');
    r.commit('a round that fixed nothing');
    const report = parsed<Report>(await cli(['audit', '--format', 'json'], r.root));
    expect(report.findings.filter((f) => ['premise-holds', 'premise-retired', 'goal-failed'].includes(f.rule)).map((f) => [f.rule, f.line])).toEqual([
      ['premise-holds', 22],
      ['goal-failed', 26],
      ['goal-failed', 27],
    ]);
  });

  it('warns that the round was not measured when the base is HEAD, or names no commit', async () => {
    const r = repository({ [BRIEF_FILE]: brief({ affected: ['src/**'] }) });
    const same = parsed<Report>(await cli(['audit', '1', '--format', 'json'], r.root));
    expect(same.findings[0]).toMatchObject({ rule: 'unmeasured', message: "the round's changes were not measured: main and HEAD are the same commit: there is nothing to measure" });
    const none = parsed<Report>(await cli(['audit', '1', '--base', 'no-such-branch', '--format', 'json'], r.root));
    expect(none.base).toBeNull();
    expect(none.findings[0]).toMatchObject({ rule: 'unmeasured', message: 'the round\'s changes were not measured: "no-such-branch" names no commit' });
  });

  it('fails on warnings alone under --strict', async () => {
    const r = repository({ [BRIEF_FILE]: brief({ affected: ['src/**'] }) });
    expect((await cli(['audit', '1'], r.root)).code).toBe(0);
    const strict = await cli(['audit', '1', '--strict', '--format', 'json'], r.root);
    expect(strict.code).toBe(1);
    expect(parsed<Report>(strict).ok).toBe(false);
  });

  it('says what it could not ask when spec-guard is not there', async () => {
    const r = repository({ [BRIEF_FILE]: brief({ affected: ['src/**'] }) }, { tools: { 'spec-brief': ['node', SPEC_BRIEF] } });
    r.git('checkout', '-q', '-b', 'brief/1-x');
    r.write('src/a.ts', 'a\n');
    r.commit('work');
    const report = parsed<Report>(await cli(['audit', '--format', 'json'], r.root));
    expect(report.findings.map((f) => f.rule)).toContain('assertions-unchecked');
    expect(report.findings.find((f) => f.rule === 'assertions-unchecked')?.message).toContain('spec-guard is not installed here');
  });

  it('reports a manifest the round broke as unread, never as clean', async () => {
    // Not package.json: spec-guard reads its own options there and stops on a broken one.
    const r = repository({ [BRIEF_FILE]: brief({ affected: ['**'] }), 'Cargo.toml': '[dependencies]\nserde = "1"\n', 'go.mod': 'module x\n' });
    r.git('checkout', '-q', '-b', 'brief/1-x');
    r.write('Cargo.toml', '[dependencies]\nserde = "1"\n[features]\nall = [\n  "a",\n');
    r.write('go.mod', 'module x\n\nrequire (\n\tgithub.com/a/b v1.0.0\n');
    r.commit('broken manifests');
    const report = parsed<Report>(await cli(['audit', '--format', 'json'], r.root));
    expect(report.findings.filter((f) => f.rule === 'manifest-unread').map((f) => f.file).sort()).toEqual(['Cargo.toml', 'go.mod']);
    expect(report.dependencies).toEqual([]);
  });

  it('reads a manifest the round renamed from where it came, and one only the configuration names', async () => {
    // Large enough that one more line leaves git calling it a rename.
    const dependencies = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`dependency-${i}`, `^${i}.0.0`]));
    const r = repository(
      { [BRIEF_FILE]: brief({ affected: ['**'] }), 'app/package.json': `${JSON.stringify({ dependencies }, null, 2)}\n`, 'deps.lock': 'x\n' },
      { dependencies: { manifests: ['package.json', 'deps.lock'] } },
    );
    r.git('checkout', '-q', '-b', 'brief/1-x');
    r.git('rm', '-q', 'app/package.json');
    r.write('web/package.json', `${JSON.stringify({ dependencies: { ...dependencies, b: '2' } }, null, 2)}\n`);
    r.write('deps.lock', 'y\n');
    r.commit('moved');
    const report = parsed<Report>(await cli(['audit', '--format', 'json'], r.root));
    expect(report.dependencies).toEqual([{ file: 'web/package.json', ecosystem: 'npm', section: 'dependencies', name: 'b', before: null, after: '2' }]);
    // A configured manifest no reader understands is reported, not skipped.
    expect(report.findings.filter((f) => f.rule === 'manifest-unread').map((f) => f.file)).toEqual(['deps.lock']);
    // Its name read, so the name is not reported.
    expect(report.findings.map((f) => f.rule)).not.toContain('manifest-name-unread');
  });

  it('names a manifest name it cannot read, with spec-core\'s reason, and reads the manifests the other names name', async () => {
    const huge = `${'{a,b}'.repeat(8)}/${'x'.repeat(300)}`;
    const r = repository(
      { [BRIEF_FILE]: brief({ affected: ['**'] }), 'Cargo.toml': '[dependencies]\nserde = "1"\n' },
      { dependencies: { manifests: ['[x', huge, 'Cargo.toml'] } },
    );
    r.git('checkout', '-q', '-b', 'brief/1-x');
    r.write('Cargo.toml', '[dependencies]\nserde = "1.1"\n');
    r.commit('work');
    const result = await cli(['audit', '--format', 'json'], r.root);
    const report = parsed<Report>(result);
    const names = (findings: readonly Finding[]): string[][] => findings.filter((f) => f.rule === 'manifest-name-unread').map((f) => [f.severity, f.file ?? '', f.message]);
    expect(names(report.findings)).toEqual([
      ['warning', '.spec-harness.json', '"dependencies.manifests" names "[x", which cannot be read: a "[" is never closed; no manifest it names was read'],
      [
        'warning',
        '.spec-harness.json',
        `"dependencies.manifests" names "${huge}", which cannot be read: the pattern compiles to more than 65536 states; no manifest it names was read`,
      ],
    ]);
    expect(report.dependencies).toEqual([{ file: 'Cargo.toml', ecosystem: 'cargo', section: 'dependencies', name: 'serde', before: '1', after: '1.1' }]);
    // A warning, which fails the audit only under --strict.
    expect(result.code).toBe(0);
    expect((await cli(['audit', '--strict'], r.root)).code).toBe(1);
    // With no base to measure from, the names are named all the same.
    const unmeasured = parsed<Report>(await cli(['audit', '--base', 'no-such-branch', '--format', 'json'], r.root));
    expect(unmeasured.base).toBeNull();
    expect(names(unmeasured.findings)).toEqual(names(report.findings));
  });

  it('names a manifest name whose braces expand to no path, which made every file the round changed a manifest', async () => {
    const r = repository(
      { [BRIEF_FILE]: brief({ affected: ['**'] }), 'Cargo.toml': '[dependencies]\nserde = "1"\n' },
      { dependencies: { manifests: ['{./,Gemfile}', 'Cargo.toml'] } },
    );
    r.git('checkout', '-q', '-b', 'brief/1-x');
    r.write('Cargo.toml', '[dependencies]\nserde = "1.1"\n');
    r.write('src/a.ts', 'a;\n');
    r.commit('work');
    const report = parsed<Report>(await cli(['audit', '--format', 'json'], r.root));
    expect(report.findings.filter((f) => f.rule === 'manifest-name-unread').map((f) => [f.severity, f.message])).toEqual([
      ['warning', '"dependencies.manifests" names "{./,Gemfile}", which cannot be read: the braces expand to "./", which names no path; no manifest it names was read'],
    ]);
    // Read as every path, the name made src/a.ts a manifest no reader understands.
    expect(report.findings.map((f) => f.rule)).not.toContain('manifest-unread');
    expect(report.dependencies).toEqual([{ file: 'Cargo.toml', ecosystem: 'cargo', section: 'dependencies', name: 'serde', before: '1', after: '1.1' }]);
  });
});
