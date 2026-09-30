import { afterAll, describe, expect, it } from 'vitest';

import type { Classified } from '../../src/probe.js';
import { brief, BRIEF_FILE, cleanup, cli, parsed, repository, type Repository } from './helpers.js';

afterAll(cleanup);

interface ProbeReport {
  ok: boolean;
  brief: string;
  hash: string;
  results: { id: string; at: string; commit: string; expected: string; verdict: string; runs: Classified[] }[];
  evidence: string;
}

/** A script that fails with the defect's signature until src/value.txt says "fixed". */
const PROBE_JS = [
  "const { readFileSync } = require('node:fs');",
  "const value = readFileSync('src/value.txt', 'utf8').trim();",
  "if (value !== 'fixed') {",
  "  console.log('expected fixed, got ' + value);",
  '  process.exit(1);',
  '}',
  "console.log('ok');",
].join('\n');

function probeBlock(fields: string, files: Record<string, string> = { 'probe.js': PROBE_JS }): string {
  const blocks = ['## Probes', '', '```probe', fields, '```', ''];
  for (const [path, content] of Object.entries(files)) blocks.push(`\`\`\`probe-file ${path}`, content, '```', '');
  return blocks.join('\n');
}

/** A brief whose probe measures src/value.txt, on a branch that fixes it. */
function defect(fields: string, options: { fix?: string; files?: Record<string, string>; config?: Record<string, unknown> } = {}): Repository {
  const repo = repository(
    { [BRIEF_FILE]: brief({ affected: ['src/**'], body: probeBlock(fields, options.files) }), 'src/value.txt': 'broken\n' },
    { probes: { runs: 1 }, ...options.config },
  );
  repo.git('checkout', '-q', '-b', 'brief/001-fix');
  if (options.fix !== undefined) {
    repo.write('src/value.txt', `${options.fix}\n`);
    repo.commit('the fix');
  }
  return repo;
}

function worktrees(repo: Repository): string[] {
  return repo
    .git('worktree', 'list', '--porcelain')
    .split('\n')
    .filter((line) => line.startsWith('worktree '));
}

describe('probe', () => {
  it('measures the defect at the base and finds it fixed at the head, then removes its worktrees', async () => {
    const repo = defect('id: value-fixed\nrun: node probe.js\nsignature: expected fixed, got broken\nruns: 2', { fix: 'fixed' });
    const result = await cli(['probe', '--format', 'json'], repo.root);
    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);
    const report = parsed<ProbeReport>(result);
    expect(report.ok).toBe(true);
    expect(report.hash).toMatch(/^sha256-[0-9a-f]{64}$/);
    expect(report.results.map((r) => [r.id, r.at, r.expected, r.verdict, r.runs.length])).toEqual([
      ['value-fixed', 'base', 'red', 'measured', 2],
      ['value-fixed', 'head', 'green', 'fixed', 2],
    ]);
    expect(report.results[0]?.runs[0]).toEqual({ outcome: 'red', detail: 'expected fixed, got broken' });
    expect(report.results[0]?.commit).toBe(repo.git('rev-parse', 'main'));
    expect(report.results[1]?.commit).toBe(repo.git('rev-parse', 'HEAD'));
    expect(report.evidence).toContain('| value-fixed | base `');
    expect(report.evidence).toContain(`by spec-harness with probes \`${report.hash}\`.`);
    expect(report.evidence).toMatch(/\nMeasured \d{4}-\d{2}-\d{2} by spec-harness/);
    expect(parsed<{ command: string }>(result).command).toBe('probe');
    // The worktrees were temporary; the person's checkout was never touched.
    expect(worktrees(repo)).toHaveLength(1);
    expect(repo.git('status', '--porcelain')).toBe('');
    expect(repo.read('src/value.txt')).toBe('fixed\n');
  });

  it('prints the evidence table as text', async () => {
    const repo = defect('id: v\nrun: node probe.js\nsignature: expected fixed', { fix: 'fixed' });
    const result = await cli(['probe'], repo.root);
    expect(result.code).toBe(0);
    expect(result.stdout.startsWith('| Probe | At | Runs | Verdict | Evidence |\n| --- | --- | ---: | --- | --- |\n| v | base `')).toBe(true);
    expect(result.stdout).toMatch(/\| v \| head `[0-9a-f]{12}` \| 1\/1 \| fixed \| the command passed \|/);
  });

  it('calls a probe vacuous when the base is already green: there is no defect to fix', async () => {
    const repo = defect('id: v\nrun: node -e "process.exit(0)"\nsignature: expected fixed');
    const report = parsed<ProbeReport>(await cli(['probe', '--at', 'base', '--format', 'json'], repo.root));
    expect(report.ok).toBe(false);
    expect(report.results.map((r) => r.verdict)).toEqual(['vacuous']);
    expect((await cli(['probe', '--at', 'base'], repo.root)).code).toBe(1);
  });

  it('calls a probe invalid when it fails for a reason it did not declare', async () => {
    const repo = defect('id: v\nrun: node probe.js\nsignature: expected 401');
    const report = parsed<ProbeReport>(await cli(['probe', '--format', 'json'], repo.root));
    // Base and head are one commit here, so only the base is measured.
    expect(report.results.map((r) => [r.at, r.verdict])).toEqual([['base', 'invalid']]);
    expect(report.results[0]?.runs[0]).toEqual({ outcome: 'wrong-failure', detail: 'the command exited 1 and its output does not contain "expected 401"' });
  });

  it('calls a probe still failing when the head did not fix it', async () => {
    const repo = defect('id: v\nrun: node probe.js\nsignature: expected fixed', { fix: 'still broken' });
    const report = parsed<ProbeReport>(await cli(['probe', '--at', 'head', '--format', 'json'], repo.root));
    expect(report.results.map((r) => [r.at, r.verdict])).toEqual([['head', 'still-failing']]);
  });

  it('calls runs that disagree flaky', async () => {
    // Red the first time, green after: it leaves a file behind in the worktree.
    const script = "const fs = require('node:fs'); if (!fs.existsSync('seen')) { fs.writeFileSync('seen', ''); console.log('expected fixed'); process.exit(1); }";
    const repo = defect('id: v\nrun: node flaky.js\nsignature: expected fixed\nruns: 2', { files: { 'flaky.js': script } });
    const report = parsed<ProbeReport>(await cli(['probe', '--format', 'json'], repo.root));
    expect(report.results.map((r) => r.verdict)).toEqual(['flaky']);
    expect(report.results[0]?.runs.map((r) => r.outcome)).toEqual(['red', 'green']);
  });

  it('stops a run at its timeout and calls it invalid', async () => {
    const repo = defect('id: v\nrun: node -e "setTimeout(() => {}, 60000)"\nsignature: expected fixed\ntimeout: 1');
    const report = parsed<ProbeReport>(await cli(['probe', '--format', 'json'], repo.root));
    expect(report.results[0]?.runs).toEqual([{ outcome: 'timeout', detail: 'stopped after 1 seconds' }]);
    expect(report.results[0]?.verdict).toBe('invalid');
    expect(worktrees(repo)).toHaveLength(1);
  });

  it('reads the declared test out of a JUnit report', async () => {
    const junit = [
      "const { readFileSync, mkdirSync, writeFileSync } = require('node:fs');",
      "const fixed = readFileSync('src/value.txt', 'utf8').trim() === 'fixed';",
      "const failure = fixed ? '' : '<failure message=\"expected fixed\">got broken</failure>';",
      "mkdirSync('reports', { recursive: true });",
      "writeFileSync('reports/junit.xml', '<testsuites><testsuite name=\"s\"><testcase classname=\"value\" name=\"is fixed\">' + failure + '</testcase></testsuite></testsuites>');",
      'process.exit(fixed ? 0 : 1);',
    ].join('\n');
    const repo = defect('id: v\nrun: node junit.js\ntest: value is fixed\njunit: reports/junit.xml', { fix: 'fixed', files: { 'junit.js': junit } });
    const report = parsed<ProbeReport>(await cli(['probe', '--format', 'json'], repo.root));
    expect(report.results.map((r) => [r.at, r.verdict])).toEqual([
      ['base', 'measured'],
      ['head', 'fixed'],
    ]);
    expect(report.results[0]?.runs[0]).toEqual({ outcome: 'red', detail: 'is fixed failed' });
    expect(report.results[1]?.runs[0]).toEqual({ outcome: 'green', detail: 'every test passed' });
  });

  it('judges a run that writes no JUnit report by its exit, and never by the report an earlier run left', async () => {
    // Red the first time, with a report; the second time it passes and writes none.
    const script = [
      "const fs = require('node:fs');",
      "if (!fs.existsSync('seen')) {",
      "  fs.writeFileSync('seen', '');",
      "  fs.mkdirSync('reports', { recursive: true });",
      "  fs.writeFileSync('reports/junit.xml', '<testsuites><testsuite name=\"s\"><testcase classname=\"value\" name=\"is fixed\"><failure message=\"expected fixed\">got broken</failure></testcase></testsuite></testsuites>');",
      '  process.exit(1);',
      '}',
    ].join('\n');
    const repo = defect('id: v\nrun: node once.js\ntest: value is fixed\njunit: reports/junit.xml\nruns: 2', { files: { 'once.js': script } });
    const report = parsed<ProbeReport>(await cli(['probe', '--format', 'json'], repo.root));
    expect(report.results[0]?.runs).toEqual([
      { outcome: 'red', detail: 'is fixed failed' },
      { outcome: 'no-report', detail: 'the command passed and wrote no reports/junit.xml' },
    ]);
    const silent = defect('id: v\nrun: node -e "process.exit(1)"\ntest: value is fixed\njunit: reports/junit.xml');
    expect(parsed<ProbeReport>(await cli(['probe', '--format', 'json'], silent.root)).results[0]?.runs).toEqual([
      { outcome: 'wrong-failure', detail: 'the command failed before writing reports/junit.xml' },
    ]);
  });

  it('writes each probe file with a final newline, and runs the setup before the probe', async () => {
    const check = "const text = require('node:fs').readFileSync('data.txt', 'utf8'); console.log(text === 'x\\n' ? 'expected fixed' : JSON.stringify(text)); process.exit(1);";
    const repo = defect('id: v\nsetup: node -e "process.exit(0)"\nrun: node check.js\nsignature: expected fixed', { files: { 'check.js': check, 'data.txt': 'x' } });
    const report = parsed<ProbeReport>(await cli(['probe', '--format', 'json'], repo.root));
    expect(report.results.map((r) => [r.at, r.verdict])).toEqual([['base', 'measured']]);
  });

  it('runs one probe by --id, and says when there is none', async () => {
    const repo = defect('id: v\nrun: node probe.js\nsignature: expected fixed');
    expect(parsed<ProbeReport>(await cli(['probe', '--id', 'v', '--format', 'json'], repo.root)).results).toHaveLength(1);
    expect(await cli(['probe', '--id', 'w'], repo.root)).toMatchObject({ code: 2, stdout: 'brief 001 declares no probe named w\n' });
    const none = repository({ [BRIEF_FILE]: brief() });
    expect(await cli(['probe', '1'], none.root)).toMatchObject({ code: 0, stdout: 'brief 001 declares no probe\n' });
  });

  it('refuses a brief whose probes cannot be read', async () => {
    const repo = defect('id: v\nrun: node probe.js');
    const result = await cli(['probe'], repo.root);
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/^spec-harness: briefs\/001_rotate-tokens\.md:\d+: probe v does not say how it fails/);
  });

  it('stops when the setup fails, and when there is no base', async () => {
    const repo = defect('id: v\nsetup: node -e "console.log(\'no network\'); process.exit(3)"\nrun: node probe.js\nsignature: expected fixed');
    const result = await cli(['probe'], repo.root);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('the probe setup "node -e "console.log(\'no network\'); process.exit(3)"" failed at base:\nno network');
    const loud = defect('id: v\nsetup: node -e "process.stdout.write(\'a\'.repeat(1000) + \'b\'.repeat(2000)); process.exit(3)"\nrun: node probe.js\nsignature: expected fixed');
    // The last 2,000 characters of what it said, where a failure says why.
    expect((await cli(['probe'], loud.root)).stderr).toMatch(/failed at base:\nb{2000}\n$/);
    expect(worktrees(repo)).toHaveLength(1);
    const unbased = defect('id: v\nrun: node probe.js\nsignature: x');
    expect(await cli(['probe', '--base', 'nowhere'], unbased.root)).toMatchObject({ code: 2, stderr: 'spec-harness: "nowhere" names no commit\n' });
  });
});
