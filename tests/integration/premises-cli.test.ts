/**
 * `premises` through the command line, and the plugin's edges; the round
 * trips with real signatures are in premises-and-plugin.test.ts.
 */

import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import specHarnessPlugin, { waive } from '../../src/plugin.js';
import { brief, BRIEF_FILE, cleanup, cli, parsed, repository, SPEC_BRIEF, temp, write } from './helpers.js';

afterAll(cleanup);

describe('premises on the command line', () => {
  it('passes with nothing to check when no brief is live', async () => {
    const repo = repository({ 'briefs/archive/001_done.md': brief({ status: 'archived' }) });
    expect(await cli(['premises'], repo.root)).toEqual({ code: 0, stdout: 'no live brief\n', stderr: '' });
    expect(parsed(await cli(['premises', '--format', 'json'], repo.root))).toMatchObject({ command: 'premises', ok: true, checked: 0, findings: [] });
  });

  it('reads a numbered, emphasised premise heading as the premise section', async () => {
    const body = ['## 3. **The Defect, Measured:**', '', '<!-- @assert-count target="src" symbol="legacyCall" min="1" -->', ''].join('\n');
    const repo = repository({ [BRIEF_FILE]: brief({ affected: ['src/**'], body }), 'src/a.ts': 'modernCall();\n' });
    const result = await cli(['premises', '--format', 'json'], repo.root);
    expect(result.code).toBe(1);
    expect(parsed<{ premises: number; findings: { rule: string }[] }>(result)).toMatchObject({ premises: 1, findings: [{ rule: 'stale-premise' }] });
  });

  it('checks the premises of a live brief whatever its status says', async () => {
    const body = ['## The Defect, Measured', '', '<!-- @assert-count target="src" symbol="legacyCall" min="1" -->', ''].join('\n');
    const repo = repository({ [BRIEF_FILE]: brief({ status: 'draft', affected: ['src/**'], body }), 'src/a.ts': 'modernCall();\n' });
    const result = await cli(['premises', '--format', 'json'], repo.root);
    expect(result.code).toBe(1);
    expect(parsed<{ findings: { rule: string }[] }>(result).findings.map((f) => f.rule)).toEqual(['stale-premise']);
  });

  it('passes --strict when every premise holds and spec-guard reads them all', async () => {
    const body = ['## The Defect, Measured', '', '<!-- @assert-count target="src" symbol="legacyCall" min="1" -->', ''].join('\n');
    const repo = repository({ [BRIEF_FILE]: brief({ affected: ['src/**'], body }), 'src/a.ts': 'legacyCall();\n' });
    const result = await cli(['premises', '--strict', '--format', 'json'], repo.root);
    expect(result.code).toBe(0);
    expect(parsed(result)).toMatchObject({ command: 'premises', ok: true, briefs: 1, premises: 1, unreadable: 0, findings: [] });
  });

  it('sorts what spec-guard reports to the brief whose file it names, however the path is written, and nothing it places nowhere', async () => {
    // Lines 23 and 24 are under the premise heading of both briefs.
    const body = ['## The Defect, Measured', '', 'first', 'second', ''].join('\n');
    const report = {
      results: [
        { ok: false, description: 'd', message: 'placed in brief 001', spec: { file: 'briefs\\001_rotate-tokens.md', line: 23 } },
        { ok: false, description: 'd', message: 'placed nowhere' },
      ],
      errors: [
        { message: 'unreadable in brief 002', raw: '<!-- @assert-count -->', spec: { file: 'briefs/002_next.md', line: 23 } },
        { message: 'placed nowhere' },
        { message: 'written nowhere', spec: { file: 'briefs/002_next.md', line: 24 } },
      ],
    };
    const fake = temp();
    write(fake, 'guard.js', `process.stdout.write(${JSON.stringify(JSON.stringify(report))});\n`);
    const repo = repository(
      { [BRIEF_FILE]: brief({ body }), 'briefs/002_next.md': brief({ title: '002 - Next', body }) },
      { tools: { 'spec-brief': ['node', SPEC_BRIEF], 'spec-guard': ['node', join(fake, 'guard.js')] } },
    );
    const result = await cli(['premises', '--format', 'json'], repo.root, { env: {} });
    expect(result.code).toBe(1);
    const read = parsed<{ premises: number; unreadable: number; findings: { rule: string; file: string; line: number; subject?: string }[] }>(result);
    expect(read).toMatchObject({ premises: 1, unreadable: 2 });
    expect(read.findings.map(({ rule, file, line, subject }) => ({ rule, file, line, subject }))).toEqual([
      { rule: 'stale-premise', file: BRIEF_FILE, line: 23, subject: expect.any(String) },
      { rule: 'assertion-unreadable', file: 'briefs/002_next.md', line: 23, subject: '<!-- @assert-count -->' },
      { rule: 'assertion-unreadable', file: 'briefs/002_next.md', line: 24, subject: '' },
    ]);
  });

  it('cannot be trusted when spec-guard cannot run the assertions', async () => {
    const fake = temp();
    write(fake, 'guard.js', 'process.stdout.write("{}"); process.exit(2);\n');
    const repo = repository({ [BRIEF_FILE]: brief() }, { tools: { 'spec-brief': ['node', SPEC_BRIEF], 'spec-guard': ['node', join(fake, 'guard.js')] } });
    expect(await cli(['premises'], repo.root)).toEqual({ code: 2, stdout: '', stderr: "spec-harness: spec-guard could not run the briefs' assertions\n" });
  });
});

describe('the spec-brief plugin', () => {
  it('is named spec-harness, adds no rule, and waives through its waive hook', () => {
    expect(specHarnessPlugin()).toEqual({ name: 'spec-harness', rules: [], waive });
  });

  it('waives nothing, and asks git nothing, when no protected file is refused', async () => {
    const context = { root: temp(), brief: { id: '001', file: BRIEF_FILE, text: '' }, findings: [{ rule: 'open-task' }], base: null, commit: null };
    expect(await waive(context)).toEqual([]);
  });

  it('reads the paths a finding lists, and waives none of them without a signed ruling', async () => {
    const repo = repository({ [BRIEF_FILE]: brief({ protected: ['src/**'] }) });
    const waivers = await waive({
      root: repo.root,
      brief: { id: '001', file: BRIEF_FILE, text: repo.read(BRIEF_FILE) },
      findings: [{ rule: 'protected-file', paths: ['src/a.ts', 'src/b.ts'] }],
      base: null,
      commit: null,
    });
    expect(waivers).toEqual([]);
  });
});

describe('premises for a forge', () => {
  const body = ['## The Defect, Measured', '', '<!-- @assert-count target="src" symbol="legacyCall" min="1" -->', ''].join('\n');

  it('places each stale premise on its brief, and fails as the other formats do', async () => {
    const repo = repository({ [BRIEF_FILE]: brief({ affected: ['src/**'], body }), 'src/a.ts': 'modernCall();\n' });
    const gitlab = await cli(['premises', '--format', 'gitlab'], repo.root);
    expect(gitlab.code).toBe(1);
    expect(JSON.parse(gitlab.stdout)).toEqual([
      {
        description: expect.stringMatching(/^brief 001's premise no longer holds: .+\. what the brief was written against has changed; archive the brief/),
        check_name: 'stale-premise',
        fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
        severity: 'major',
        location: { path: BRIEF_FILE, lines: { begin: 22 } },
      },
    ]);
    const github = await cli(['premises', '--format', 'github'], repo.root);
    expect(github.stdout.startsWith(`::error file=${BRIEF_FILE},line=22,title=spec-harness stale-premise::brief 001's premise no longer holds: `)).toBe(true);
    const sarif = JSON.parse((await cli(['premises', '--format', 'sarif'], repo.root)).stdout) as { runs: { invocations: { toolExecutionNotifications: { message: { text: string } }[] }[] }[] };
    expect(sarif.runs[0]?.invocations[0]?.toolExecutionNotifications[0]?.message.text).toBe('1 premise(s) in 1 live brief(s), 1 no longer hold');
  });

  it('prints an empty report, and passes, when no brief is live', async () => {
    const repo = repository({ 'briefs/archive/001_done.md': brief({ status: 'archived' }) });
    expect(await cli(['premises', '--format', 'gitlab'], repo.root)).toEqual({ code: 0, stdout: '[]\n', stderr: '' });
    expect(await cli(['premises', '--format', 'github'], repo.root)).toEqual({ code: 0, stdout: '', stderr: '' });
    const sarif = JSON.parse((await cli(['premises', '--format', 'sarif'], repo.root)).stdout) as { runs: { invocations: { toolExecutionNotifications: { message: { text: string } }[] }[] }[] };
    expect(sarif.runs[0]?.invocations[0]?.toolExecutionNotifications[0]?.message.text).toBe('no live brief');
  });
});

describe('premises in a CI run on a detached head', () => {
  const body = ['## The Defect, Measured', '', '<!-- @assert-count target="src" symbol="legacyCall" min="1" -->', ''].join('\n');

  /** A round that retired its premise, checked out as CI checks it out: the commit, on no branch. */
  function detached(): ReturnType<typeof repository> {
    const repo = repository({ [BRIEF_FILE]: brief({ affected: ['src/**'], body }), 'src/a.ts': 'legacyCall();\n' });
    repo.git('checkout', '-q', '-b', 'brief/001-retire');
    repo.write('src/a.ts', 'modernCall();\n');
    repo.commit('the round');
    repo.git('checkout', '-q', '--detach');
    return repo;
  }

  it('reads the branch the forge names, so the round\'s own retired premise fails nothing', async () => {
    const repo = detached();
    for (const env of [{ GITHUB_HEAD_REF: 'brief/001-retire' }, { CI_MERGE_REQUEST_SOURCE_BRANCH_NAME: 'brief/001-retire' }, { GITHUB_REF_TYPE: 'branch', GITHUB_REF_NAME: 'brief/001-retire' }, { CI_COMMIT_BRANCH: 'brief/001-retire' }]) {
      const result = await cli(['premises', '--format', 'json'], repo.root, { env });
      expect(result.code, JSON.stringify(env)).toBe(0);
      expect(parsed<{ findings: { rule: string }[] }>(result).findings.map((f) => f.rule), JSON.stringify(env)).toEqual(['premise-retired']);
    }
  });

  it('reads the brief SPEC_BRIEF names, trimmed, as doctor does', async () => {
    const repo = detached();
    const result = await cli(['premises', '--format', 'json'], repo.root, { env: { SPEC_BRIEF: ' 1 ' } });
    expect(result.code).toBe(0);
    expect(parsed<{ findings: { rule: string }[] }>(result).findings.map((f) => f.rule)).toEqual(['premise-retired']);
    expect(parsed<{ brief: string }>(await cli(['doctor', '--format', 'json'], repo.root, { env: { SPEC_BRIEF: ' 1 ' } })).brief).toBe('1');
    // A blank one names nothing.
    expect(parsed<{ brief: string | null }>(await cli(['doctor', '--format', 'json'], repo.root, { env: { SPEC_BRIEF: ' ' } })).brief).toBeNull();
  });

  it('names no brief without them, as before, and the premise is stale', async () => {
    const result = await cli(['premises', '--format', 'json'], detached().root, { env: {} });
    expect(result.code).toBe(1);
    expect(parsed<{ findings: { rule: string }[] }>(result).findings.map((f) => f.rule)).toEqual(['stale-premise']);
  });

  it('keeps the branch checked out over what the forge names', async () => {
    const repo = detached();
    repo.git('checkout', '-q', 'main');
    const result = await cli(['premises', '--format', 'json'], repo.root, { env: { GITHUB_HEAD_REF: 'brief/001-retire' } });
    // On main the round's change is not there, so the premise holds: nothing to report either way.
    expect(parsed<{ findings: unknown[] }>(result).findings).toEqual([]);
    expect((await cli(['doctor'], repo.root, { env: { GITHUB_HEAD_REF: 'brief/001-retire' } })).stdout).toContain('\nbranch  main\nbrief   (none named)\n');
    repo.git('checkout', '-q', '--detach', 'brief/001-retire');
    expect((await cli(['doctor'], repo.root, { env: { GITHUB_HEAD_REF: 'brief/001-retire' } })).stdout).toContain(
      '\nbranch  brief/001-retire (detached; GITHUB_HEAD_REF names it)\nbrief   001\n',
    );
  });
});

describe('a premise spec-guard cannot read', () => {
  const body = [
    '## The Defect, Measured',
    '',
    '<!-- @assert-count target="src" symbol="legacyCall" min="1" -->',
    '<!-- @assert-count target="src" min="1" -->',
    '',
    '## Goals',
    '',
    '<!-- @assert-absence target="src" -->',
    '',
  ].join('\n');

  it('is a warning, where it was dropped, which fails the run under --strict; a goal spec-guard cannot read is the audit\'s', async () => {
    const repo = repository({ [BRIEF_FILE]: brief({ affected: ['src/**'], body }), 'src/a.ts': 'legacyCall();\n' });
    const result = await cli(['premises'], repo.root);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe(
      [
        `warning  ${BRIEF_FILE}:23  spec-guard cannot read a premise of brief 001, so whether it still holds is not checked: @assert-count requires a non-empty symbol="..." attribute.`,
        `         fix the directive in ${BRIEF_FILE}; until spec-guard can read it, nothing checks what it states`,
        "1 premise(s) in 1 live brief(s), 0 no longer hold; 1 premise(s) spec-guard cannot read, so not checked",
        '',
      ].join('\n'),
    );
    const strict = await cli(['premises', '--strict', '--format', 'json'], repo.root);
    expect(strict.code).toBe(1);
    expect(parsed<{ ok: boolean; premises: number; unreadable: number; findings: { rule: string; subject: string }[] }>(strict)).toMatchObject({
      ok: false,
      premises: 1,
      unreadable: 1,
      findings: [{ rule: 'assertion-unreadable', subject: '<!-- @assert-count target="src" min="1" -->' }],
    });
    expect(parsed<{ ok: boolean }>(await cli(['premises', '--format', 'json'], repo.root)).ok).toBe(true);
    // On the round's own brief the warning stands, and is no premise the round retired.
    expect((await cli(['premises', '--brief', '1'], repo.root)).stdout).toContain(
      '\n1 premise(s) in 1 live brief(s), 0 no longer hold; 1 premise(s) spec-guard cannot read, so not checked\n',
    );
    const gitlab = JSON.parse((await cli(['premises', '--format', 'gitlab'], repo.root)).stdout) as { check_name: string; severity: string }[];
    expect(gitlab.map((issue) => [issue.check_name, issue.severity])).toEqual([['assertion-unreadable', 'minor']]);
  });
});
