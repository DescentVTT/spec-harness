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

  it('prints the same as text, with what it measured above its counts, which stay the last line', async () => {
    const result = await cli(['audit'], repo.root);
    expect(result.code).toBe(1);
    expect(result.stdout.startsWith(`audit of brief 001 from main (${base.slice(0, 12)})\n\n`)).toBe(true);
    expect(result.stdout).toContain(`error    ${BRIEF_FILE}:`);
    expect(result.stdout).toContain('warning  package.json  the round added npm dependency "left-pad" ^1.3.0 in package.json (dependencies)  new-dependency');
    expect(result.stdout).toMatch(
      /\n\nmeasured: goals: 2 held, 0 failed · premises: 1 retired, 0 holding · archive: asked · rulings: none · dependencies: 4 changed, 0 unread\n\d+ error\(s\), \d+ warning\(s\), \d+ note\(s\)\n$/,
    );
  });

  it('says in JSON what it measured, beside the counts', async () => {
    const report = parsed<Report & { measured: unknown }>(await cli(['audit', '--format', 'json'], repo.root));
    expect(report.measured).toEqual({
      changes: 'measured',
      archive: 'asked',
      assertions: 'run',
      goals: { held: 2, failed: 0 },
      premises: { retired: 1, holding: 0 },
      unreadableAssertions: 0,
      rulings: { verified: 0, unverified: 0 },
      dependencies: { changed: 4, unread: 0 },
    });
  });

  it('reports each assertion spec-guard cannot read as a warning, where the audit dropped it and passed', async () => {
    const unreadable = ['## Goals', '', '<!-- @assert-absence target="src" -->', '<!-- @assert-count symbol="Foo" target="src" min="abc" -->', ''].join('\n');
    const r = repository({ [BRIEF_FILE]: brief({ affected: ['src/**'], body: unreadable }), 'src/a.ts': 'a\n' });
    r.git('checkout', '-q', '-b', 'brief/001-x');
    r.write('src/b.ts', 'b\n');
    r.commit('work');
    const result = await cli(['audit', '--format', 'json'], r.root);
    const report = parsed<Report & { measured: { assertions: string; goals: unknown; unreadableAssertions: number } }>(result);
    expect(report.findings.filter((f) => f.rule === 'assertion-unreadable').map((f) => [f.severity, f.line, f.message])).toEqual([
      ['warning', 22, 'spec-guard cannot read an assertion in the brief, so nothing it states was run: @assert-absence requires a non-empty symbol="..." attribute.'],
      ['warning', 23, 'spec-guard cannot read an assertion in the brief, so nothing it states was run: Attribute "min" must be a non-negative integer, got "abc".'],
    ]);
    // Each is about the directive as written, which its fingerprint is made of.
    expect(report.findings.filter((f) => f.rule === 'assertion-unreadable').map((f) => f.subject)).toEqual([
      '<!-- @assert-absence target="src" -->',
      '<!-- @assert-count symbol="Foo" target="src" min="abc" -->',
    ]);
    expect(report.measured).toMatchObject({ assertions: 'run', goals: { held: 0, failed: 0 }, unreadableAssertions: 2 });
    // Warnings: the audit fails on them only under --strict.
    expect(result.code).toBe(0);
    expect((await cli(['audit', '--strict'], r.root)).code).toBe(1);
    expect((await cli(['audit'], r.root)).stdout).toContain('\nmeasured: goals: none declared · premises: none declared · unreadable assertions: 2 · archive: asked');
  });

  it('counts a ruling row it cannot read among its warnings, first in the report', async () => {
    const rows = '## Rulings\n\n| Ruling | Paths | Decision |\n| --- | --- | --- |\n| R-001-1 | `a` | perhaps |\n';
    const r = repository({ [BRIEF_FILE]: brief({ affected: ['src/**'], body: rows }), 'src/a.ts': 'a\n' });
    r.git('checkout', '-q', '-b', 'brief/001-x');
    r.write('src/b.ts', 'b\n');
    r.commit('work');
    const report = parsed<Report>(await cli(['audit', '--format', 'json'], r.root));
    expect(report.findings.map((f) => f.rule)).toEqual(['ruling-unreadable']);
    expect(report.counts).toEqual({ error: 0, warning: 1, note: 0 });
  });

  it('says a brief with no assertion declares no goal, and warns about nothing for it', async () => {
    const r = repository({ [BRIEF_FILE]: brief({ affected: ['src/**'] }), 'src/a.ts': 'a\n' });
    r.git('checkout', '-q', '-b', 'brief/001-x');
    r.write('src/b.ts', 'b\n');
    r.commit('work');
    const result = await cli(['audit'], r.root);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe(
      `audit of brief 001 from main (${r.git('rev-parse', 'main').slice(0, 12)})\n\n\nmeasured: goals: none declared · premises: none declared · archive: asked · rulings: none · dependencies: 0 changed, 0 unread\n0 error(s), 0 warning(s), 0 note(s)\n`,
    );
    expect((await cli(['audit', '--strict'], r.root)).code).toBe(0);
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

  it('names a manifest name a leading "/" roots, which names no manifest the round changed, as it names one it cannot read', async () => {
    const r = repository(
      { [BRIEF_FILE]: brief({ affected: ['**'] }), 'package.json': '{ "dependencies": {} }\n', 'Gemfile': "gem 'rails'\n", 'Cargo.toml': '[dependencies]\n' },
      { dependencies: { manifests: ['/package.json', '{/Gemfile,Cargo.toml}'] } },
    );
    r.git('checkout', '-q', '-b', 'brief/1-x');
    r.write('package.json', '{ "dependencies": { "left-pad": "1" } }\n');
    r.write('Gemfile', "gem 'rails'\ngem 'rack'\n");
    r.write('Cargo.toml', '[dependencies]\nserde = "1"\n');
    r.commit('work');
    const result = await cli(['audit', '--format', 'json'], r.root);
    const report = parsed<Report>(result);
    expect(report.findings.filter((f) => f.rule === 'manifest-name-rooted').map((f) => [f.severity, f.file, f.message])).toEqual([
      ['warning', '.spec-harness.json', `"dependencies.manifests" names "/package.json": a leading "/" roots it at the filesystem's root, where no file of the repository is, so no manifest it names was read`],
      [
        'warning',
        '.spec-harness.json',
        `"dependencies.manifests" names "{/Gemfile,Cargo.toml}": a leading "/" roots an alternative of it at the filesystem's root, where no file of the repository is, so that alternative names no manifest`,
      ],
    ]);
    // The alternative that is not rooted is read as before; the rooted ones name nothing the round changed.
    expect(report.dependencies).toEqual([{ file: 'Cargo.toml', ecosystem: 'cargo', section: 'dependencies', name: 'serde', before: null, after: '1' }]);
    expect(result.code).toBe(0);
    expect((await cli(['audit', '--strict'], r.root)).code).toBe(1);
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

describe('audit for a forge', () => {
  interface Issue {
    check_name: string;
    severity: string;
    fingerprint: string;
    description: string;
    location: { path: string; lines: { begin: number } };
  }

  it('prints GitLab Code Quality, every finding placed, with the exit code of the other formats', async () => {
    const result = await cli(['audit', '--format', 'gitlab'], repo.root);
    expect(result.code).toBe(1);
    const issues = JSON.parse(result.stdout) as Issue[];
    const json = parsed<Report>(await cli(['audit', '--format', 'json'], repo.root));
    expect(issues.map((issue) => issue.check_name)).toEqual(json.findings.map((f) => f.rule));
    const dependency = issues.find((issue) => issue.check_name === 'new-dependency');
    expect(dependency).toMatchObject({
      severity: 'minor',
      description: 'the round added npm dependency "left-pad" ^1.3.0 in package.json (dependencies). say in the brief why it is needed, or remove it; a new dependency is code no reviewer read',
      location: { path: 'package.json', lines: { begin: 1 } },
    });
    expect(issues.find((issue) => issue.check_name === 'premise-retired')).toMatchObject({ severity: 'info', location: { path: BRIEF_FILE, lines: { begin: 23 } } });
    expect(new Set(issues.map((issue) => issue.fingerprint)).size).toBe(issues.length);
  });

  it('prints SARIF with what it measured as a note, and GitHub annotations', async () => {
    const sarif = JSON.parse((await cli(['audit', '--format', 'sarif'], repo.root)).stdout) as {
      runs: { invocations: { toolExecutionNotifications: { message: { text: string } }[] }[]; results: { ruleId: string }[] }[];
    };
    expect(sarif.runs[0]?.invocations[0]?.toolExecutionNotifications[0]?.message.text).toBe(
      'measured: goals: 2 held, 0 failed · premises: 1 retired, 0 holding · archive: asked · rulings: none · dependencies: 4 changed, 0 unread',
    );
    expect(sarif.runs[0]?.results.map((r) => r.ruleId)).toContain('archive/open-task');
    const github = await cli(['audit', '--format', 'github'], repo.root);
    expect(github.code).toBe(1);
    expect(github.stdout).toContain(
      '::warning file=package.json,line=1,title=spec-harness new-dependency::the round added npm dependency "left-pad" ^1.3.0 in package.json (dependencies). say in the brief why it is needed, or remove it; a new dependency is code no reviewer read\n',
    );
    expect(github.stdout).toContain(`::notice file=${BRIEF_FILE},line=23,title=spec-harness premise-retired::`);
  });

  it('keeps a finding\'s fingerprint when its line moves', async () => {
    const r = repository({ [BRIEF_FILE]: brief({ affected: ['src/**'], body: BODY }), 'src/auth/a.ts': 'export const OldToken = 1; LegacyGateway();\n' });
    r.git('checkout', '-q', '-b', 'brief/001-x');
    r.write('src/auth/b.ts', 'b;\n');
    r.commit('work');
    const before = JSON.parse((await cli(['audit', '--format', 'gitlab'], r.root)).stdout) as Issue[];
    r.write(BRIEF_FILE, brief({ affected: ['src/**'], body: `A line the round added above the goals.\n\n${BODY}` }));
    r.commit('a line above');
    const after = JSON.parse((await cli(['audit', '--format', 'gitlab'], r.root)).stdout) as Issue[];
    const goals = (issues: Issue[]) => issues.filter((issue) => issue.check_name === 'goal-failed');
    expect(goals(after).map((issue) => issue.location.lines.begin)).toEqual(goals(before).map((issue) => issue.location.lines.begin + 2));
    expect(goals(after).map((issue) => issue.fingerprint)).toEqual(goals(before).map((issue) => issue.fingerprint));
  });

  it('is refused for a command whose output has no places', async () => {
    expect(await cli(['context', '--format', 'sarif'], repo.root)).toEqual({ code: 2, stdout: '', stderr: 'spec-harness: --format sarif is for audit and premises; context prints pretty or json\n' });
  });
});
