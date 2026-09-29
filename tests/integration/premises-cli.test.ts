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
  });
});
