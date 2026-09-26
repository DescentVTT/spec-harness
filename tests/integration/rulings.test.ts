import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Decision } from '../../src/guard.js';
import type { EscalationRequest } from '../../src/rulings.js';
import { tools } from '../../src/server.js';
import type { Finding } from '../../src/types.js';
import { openWorkspace, parseOptions } from '../../src/workspace.js';
import { brief, BRIEF_FILE, cleanup, cli, commitSigned, hasSshKeygen, installHarness, parsed, repository, signingKey, temp, type Repository } from './helpers.js';

afterAll(cleanup);

const FILES = {
  'src/db/schema.ts': 'table;\n',
  'src/db/other.ts': 'other;\n',
  'src/auth/a.ts': 'a;\n',
};

function round(extra: Record<string, string> = {}): Repository {
  const repo = repository({ [BRIEF_FILE]: brief({ affected: ['src/auth/**'], protected: ['src/db/**'] }), ...FILES, ...extra });
  repo.git('checkout', '-q', '-b', 'brief/001-rotate');
  return repo;
}

function escalations(repo: Repository): string[] {
  const directory = join(repo.git('rev-parse', '--path-format=absolute', '--git-common-dir'), 'spec-harness', 'escalations');
  return existsSync(directory) ? readdirSync(directory).sort() : [];
}

async function decision(repo: Repository, path: string): Promise<Decision> {
  const result = await cli(['guard', path, '--format', 'json'], repo.root);
  return parsed<{ decisions: Decision[] }>(result).decisions[0] as Decision;
}

interface RulingsDocument {
  rows: { id: string; decision: string; line: number }[];
  verified: { id: string; paths: string[]; signer: string }[];
  unverified: { id: string; reason: string }[];
  problems: Finding[];
}

async function rulings(repo: Repository): Promise<RulingsDocument & { code: number }> {
  const result = await cli(['rulings', '--format', 'json'], repo.root);
  return { ...parsed<RulingsDocument>(result), code: result.code };
}

describe('escalate', () => {
  let repo: Repository;
  beforeAll(() => {
    repo = round();
  });

  it('needs the paths and the reason', async () => {
    const result = await cli(['escalate', '--path', 'src/db/schema.ts'], repo.root);
    expect(result).toMatchObject({ code: 2, stderr: 'spec-harness: escalate needs --path <file> (repeatable) and --reason <why>; or --list, or --show <id>\n' });
    expect(await cli(['escalate', '--list'], repo.root)).toMatchObject({ code: 0, stdout: 'no escalation is waiting\n' });
  });

  it('records the request outside the work tree and prints the memo, exiting 1 while it waits', async () => {
    const result = await cli(
      ['escalate', '--path', 'src/db/schema.ts', '--reason', 'Rotation needs a rotated_at column.', '--option', 'Allow: one additive column', '--option', 'Refuse', '--recommend', 'Allow; it is additive.'],
      repo.root,
    );
    expect(result.code).toBe(1);
    expect(result.stdout.startsWith('# Escalation E-001-1\n\nBrief 001 (`briefs/001_rotate-tokens.md`) on `brief/001-rotate` at `')).toBe(true);
    expect(result.stdout).toContain('1. **Allow** - one additive column\n2. **Refuse** - \n');
    expect(result.stdout).toContain('## The agent recommends\n\nAllow; it is additive.\n');
    expect(escalations(repo)).toEqual(['E-001-1.json']);
    // In-flight state is not the repository's: nothing for git status to show.
    expect(repo.git('status', '--porcelain')).toBe('');
  });

  it('numbers the next request after the last, and lists, shows and prints them as JSON', async () => {
    const second = await cli(['escalate', '--path', 'src/db/other.ts', '--path', 'src/db/schema.ts', '--reason', 'Two\nlines.', '--format', 'json'], repo.root);
    expect(second.code).toBe(1);
    const document = parsed<{ request: EscalationRequest; memo: string }>(second);
    expect(document.request).toMatchObject({ id: 'E-001-2', brief: '001', briefFile: BRIEF_FILE, paths: ['src/db/other.ts', 'src/db/schema.ts'], options: [], recommendation: null, branch: 'brief/001-rotate' });
    expect(document.request.head).toBe(repo.git('rev-parse', 'HEAD'));
    expect(document.memo).toContain('# Escalation E-001-2');

    const list = await cli(['escalate', '--list'], repo.root);
    expect(list.stdout).toBe('E-001-1  brief 001  src/db/schema.ts  Rotation needs a rotated_at column.\nE-001-2  brief 001  src/db/other.ts, src/db/schema.ts  Two\n');
    const listed = parsed<{ waiting: EscalationRequest[] }>(await cli(['escalate', '--list', '--format', 'json'], repo.root));
    expect(listed.waiting.map((request) => request.id)).toEqual(['E-001-1', 'E-001-2']);
    expect((await cli(['escalate', '--show', 'E-001-2'], repo.root)).stdout).toBe(document.memo);
    expect(parsed<{ request: EscalationRequest }>(await cli(['escalate', '--show', 'E-001-1', '--format', 'json'], repo.root)).request.id).toBe('E-001-1');
    expect(await cli(['escalate', '--show', 'E-001-9'], repo.root)).toMatchObject({ code: 2, stderr: 'spec-harness: no escalation "E-001-9" is waiting\n' });
  });

  it('skips a request it cannot read rather than listing nothing true', async () => {
    const directory = join(repo.git('rev-parse', '--path-format=absolute', '--git-common-dir'), 'spec-harness', 'escalations');
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(directory, 'E-001-0.json'), '{ broken');
    writeFileSync(join(directory, 'notes.txt'), 'x');
    expect(parsed<{ waiting: EscalationRequest[] }>(await cli(['escalate', '--list', '--format', 'json'], repo.root)).waiting.map((r) => r.id)).toEqual([
      'E-001-1',
      'E-001-2',
    ]);
  });

  it('needs a brief to escalate against', async () => {
    const plain = repository({ [BRIEF_FILE]: brief() });
    const result = await cli(['escalate', '--path', 'a', '--reason', 'b'], plain.root);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('no brief is named');
  });
});

describe('rule', () => {
  it('needs an id, exactly one decision and a note', async () => {
    const repo = round();
    expect(await cli(['rule'], repo.root)).toMatchObject({ code: 2, stderr: 'spec-harness: rule needs the escalation id, such as E-012-1\n' });
    expect(await cli(['rule', 'E-001-1', '--note', 'x'], repo.root)).toMatchObject({ code: 2, stderr: 'spec-harness: rule needs exactly one of --allow or --deny\n' });
    expect((await cli(['rule', 'E-001-1', '--allow', '--deny', '--note', 'x'], repo.root)).code).toBe(2);
    expect(await cli(['rule', 'E-001-1', '--allow', '--note', ' '], repo.root)).toMatchObject({
      code: 2,
      stderr: 'spec-harness: rule needs --note: what exactly is allowed, or why not\n',
    });
    expect(await cli(['rule', 'E-001-1', '--allow', '--note', 'x'], repo.root)).toMatchObject({
      code: 2,
      stderr: 'spec-harness: no escalation "E-001-1" is waiting; spec-harness escalate --list shows those that are\n',
    });
  });

  it('stops with exit 2 when the brief the request names is gone', async () => {
    const repo = round();
    await cli(['escalate', '--path', 'src/db/schema.ts', '--reason', 'r'], repo.root);
    repo.git('rm', '-q', BRIEF_FILE);
    expect(await cli(['rule', 'E-001-1', '--allow', '--note', 'x'], repo.root)).toEqual({ code: 2, stdout: '', stderr: `spec-harness: ${BRIEF_FILE} cannot be read\n` });
    expect(escalations(repo)).toEqual(['E-001-1.json']);
  });

  it('writes a refusal into the brief, retires the request, and a refusal verifies nothing', async () => {
    const repo = round();
    await cli(['escalate', '--path', 'src/db/schema.ts', '--reason', 'r'], repo.root);
    const result = await cli(['rule', 'e-001-1', '--deny', '--note', 'Keep the schema.', '--format', 'json'], repo.root);
    expect(result.code).toBe(0);
    expect(parsed(result)).toMatchObject({
      command: 'rule',
      ruling: 'R-001-1',
      file: BRIEF_FILE,
      row: '| R-001-1 | `src/db/schema.ts` | deny | Keep the schema. |',
      commit: `git commit -S -m "ruling R-001-1: deny" -- ${BRIEF_FILE}`,
    });
    expect(repo.read(BRIEF_FILE).endsWith('\n## Rulings\n\n| Ruling | Paths | Decision | Note |\n| --- | --- | --- | --- |\n| R-001-1 | `src/db/schema.ts` | deny | Keep the schema. |\n')).toBe(true);
    expect(escalations(repo)).toEqual([]);
    const pretty = await cli(['rulings'], repo.root);
    expect(pretty).toMatchObject({ code: 0, stdout: 'R-001-1  deny  src/db/schema.ts  refused\n' });
  });

  it('reports rows it cannot read as problems, and a brief with none', async () => {
    const empty = round();
    expect(await cli(['rulings'], empty.root)).toMatchObject({ code: 0, stdout: 'brief 001 holds no ruling\n' });
    const bad = round();
    bad.write(BRIEF_FILE, `${bad.read(BRIEF_FILE)}\n## Rulings\n\n| Ruling | Paths | Decision |\n| --- | --- | --- |\n| R-001-1 | \`a\` | perhaps |\n`);
    const result = await rulings(bad);
    expect(result.code).toBe(1);
    expect(result.problems).toEqual([
      { rule: 'ruling-unreadable', severity: 'warning', message: 'ruling R-001-1 decides "perhaps"; a decision is allow or deny', hint: 'a ruling row is | id | `paths` | allow or deny | note |', file: BRIEF_FILE, line: 25 },
    ]);
  });
});

describe.skipIf(!hasSshKeygen())('a ruling is a row whose commit a person signed (needs ssh-keygen on PATH)', () => {
  let repo: Repository;
  let key: string;
  let signers: string;

  beforeAll(async () => {
    const keys = temp();
    const made = signingKey(keys);
    key = made.key;
    signers = made.signers;
    repo = round({ '.github/allowed_signers': made.signers });
    await cli(['escalate', '--path', 'src/db/schema.ts', '--reason', 'Rotation needs a column.'], repo.root);
    await cli(['rule', 'E-001-1', '--allow', '--note', 'One column.'], repo.root);
  });

  it('allows nothing while the row is not committed', async () => {
    const state = await rulings(repo);
    expect(state.code).toBe(1);
    expect(state.verified).toEqual([]);
    expect(state.unverified).toEqual([{ id: 'R-001-1', reason: 'its row is not committed' }]);
    expect(await decision(repo, 'src/db/schema.ts')).toMatchObject({ verdict: 'deny', reason: 'protected' });
  });

  it('allows the paths it names once a person signs the commit, and no others', async () => {
    commitSigned(repo, key, 'ruling R-001-1: allow');
    const state = await rulings(repo);
    expect(state.code).toBe(0);
    expect(state.verified).toEqual([{ id: 'R-001-1', paths: ['src/db/schema.ts'], signer: 't@example.com' }]);
    expect((await cli(['rulings'], repo.root)).stdout).toBe('R-001-1  allow  src/db/schema.ts  signed by t@example.com\n');
    expect(await decision(repo, 'src/db/schema.ts')).toMatchObject({ verdict: 'allow', reason: 'ruled', because: ['R-001-1'] });
    expect(await decision(repo, 'src/db/other.ts')).toMatchObject({ verdict: 'deny', reason: 'protected' });
    expect((await cli(['context'], repo.root)).stdout).toContain('Rulings in force:\n- R-001-1, signed by t@example.com: `src/db/schema.ts`\n');
  });

  it('does not lend a signed line\'s commit to an uncommitted row written where that line was', async () => {
    // At HEAD, the line this row now occupies is the signed ruling's. Blamed
    // at HEAD, the agent's own row would verify without anyone signing it.
    const signed = '| R-001-1 | `src/db/schema.ts` | allow | One column. |';
    const text = repo.read(BRIEF_FILE);
    repo.write(BRIEF_FILE, text.replace(signed, `| R-001-2 | \`src/db/other.ts\` | allow | The agent's own. |\n${signed}`));
    try {
      const state = await rulings(repo);
      expect(state.verified.map((r) => r.id)).toEqual(['R-001-1']);
      expect(state.unverified).toEqual([{ id: 'R-001-2', reason: 'its row is not committed' }]);
      expect(await decision(repo, 'src/db/other.ts')).toMatchObject({ verdict: 'deny', reason: 'protected' });
      expect(await decision(repo, 'src/db/schema.ts')).toMatchObject({ verdict: 'allow', reason: 'ruled' });
    } finally {
      repo.git('checkout', '--', BRIEF_FILE);
    }
  });

  it('allows nothing once anyone edits the row without signing', async () => {
    repo.write(BRIEF_FILE, repo.read(BRIEF_FILE).replace('`src/db/schema.ts` | allow', '`src/db/**` | allow'));
    const tampered = repo.commit('widen the ruling');
    const state = await rulings(repo);
    expect(state.code).toBe(1);
    expect(state.verified).toEqual([]);
    expect(state.unverified).toEqual([{ id: 'R-001-1', reason: `commit ${tampered.slice(0, 12)} last changed its row, and it is not signed` }]);
    expect(await decision(repo, 'src/db/schema.ts')).toMatchObject({ verdict: 'deny', reason: 'protected' });
    expect(await decision(repo, 'src/db/other.ts')).toMatchObject({ verdict: 'deny', reason: 'protected' });
    const audit = parsed<{ findings: Finding[] }>(await cli(['audit', '--format', 'json'], repo.root));
    expect(audit.findings.find((f) => f.rule === 'ruling-unverified')?.message).toBe(
      `ruling R-001-1 allows nothing: commit ${tampered.slice(0, 12)} last changed its row, and it is not signed`,
    );
  });

  it('counts only the signers the base branch lists, never the round\'s own', async () => {
    const keys = temp();
    const stranger = signingKey(keys, 'stranger@example.com');
    const other = round();
    // The round adds its own signer; the base branch has none.
    other.write('.github/allowed_signers', stranger.signers);
    await cli(['escalate', '--path', 'src/db/schema.ts', '--reason', 'r'], other.root);
    await cli(['rule', 'E-001-1', '--allow', '--note', 'n'], other.root);
    commitSigned(other, stranger.key, 'ruling');
    const state = await rulings(other);
    expect(state.unverified).toEqual([{ id: 'R-001-1', reason: 'main has no .github/allowed_signers, so no signature can count' }]);
    expect(await decision(other, 'src/db/schema.ts')).toMatchObject({ reason: 'protected' });
  });

  it('does not count a good signature by a key the base branch does not list', async () => {
    const keys = temp();
    const listed = signingKey(keys, 'person@example.com');
    const unlisted = signingKey(temp(), 'agent@example.com');
    const other = round({ '.github/allowed_signers': listed.signers });
    await cli(['escalate', '--path', 'src/db/schema.ts', '--reason', 'r'], other.root);
    await cli(['rule', 'E-001-1', '--allow', '--note', 'n'], other.root);
    const commit = commitSigned(other, unlisted.key, 'ruling');
    const state = await rulings(other);
    expect(state.verified).toEqual([]);
    expect(state.unverified[0]?.reason.startsWith(`commit ${commit.slice(0, 12)} last changed its row, and `)).toBe(true);
    expect(state.unverified[0]?.reason).not.toContain('it is not signed');
  });

  it('reads the signers from the base --base names in guard, context and the server, as rulings does', async () => {
    // No remote and no base configured: without the flag there is no base.
    const other = repository({ [BRIEF_FILE]: brief({ affected: ['src/auth/**'], protected: ['src/db/**'] }), ...FILES, '.github/allowed_signers': signers }, { base: null });
    other.git('checkout', '-q', '-b', 'brief/001-rotate');
    await cli(['escalate', '--path', 'src/db/schema.ts', '--reason', 'r'], other.root);
    await cli(['rule', 'E-001-1', '--allow', '--note', 'n'], other.root);
    commitSigned(other, key, 'ruling R-001-1: allow');
    expect(parsed<RulingsDocument>(await cli(['rulings', '--base', 'main', '--format', 'json'], other.root)).verified.map((r) => r.id)).toEqual(['R-001-1']);

    expect(await decision(other, 'src/db/schema.ts')).toMatchObject({ verdict: 'deny', reason: 'protected' });
    const guarded = await cli(['guard', 'src/db/schema.ts', '--base', 'main', '--format', 'json'], other.root);
    expect(guarded.code).toBe(0);
    expect(parsed<{ decisions: Decision[] }>(guarded).decisions[0]).toMatchObject({ verdict: 'allow', reason: 'ruled', because: ['R-001-1'] });

    expect((await cli(['context'], other.root)).stdout).toContain('Rulings in force:\n- none\n');
    const context = await cli(['context', '--base', 'main'], other.root);
    expect(context.stdout).toContain(' · measured from `main`\n');
    expect(context.stdout).toContain('Rulings in force:\n- R-001-1, signed by t@example.com: `src/db/schema.ts`\n');

    const workspace = await openWorkspace(parseOptions(['mcp']), { stdout: { write: () => true }, stderr: { write: () => true }, cwd: other.root, env: {} });
    const tool = (name: string) => tools(workspace, {}).find((candidate) => candidate.descriptor.name === name);
    expect((await tool('check_path')?.call({ paths: ['src/db/schema.ts'] }))?.text).toMatch(/^deny: /);
    expect((await tool('check_path')?.call({ paths: ['src/db/schema.ts'], base: 'main' }))?.text).toBe(
      'allow: src/db/schema.ts is protected by brief 001, and ruling R-001-1, signed by t@example.com, allows it',
    );
    expect((await tool('start_round')?.call({}))?.text).toContain('Rulings in force:\n- none\n');
    expect((await tool('start_round')?.call({ base: 'main' }))?.text).toContain('Rulings in force:\n- R-001-1, signed by t@example.com: `src/db/schema.ts`\n');
  });

  it('says why the archive refuses a file a signed ruling allows, until spec-brief loads the plugin, which waives it', async () => {
    const other = round({ '.github/allowed_signers': signers });
    installHarness(other.root);
    await cli(['escalate', '--path', 'src/db/schema.ts', '--reason', 'r'], other.root);
    await cli(['rule', 'E-001-1', '--allow', '--note', 'One column.'], other.root);
    commitSigned(other, key, 'ruling R-001-1: allow');
    other.write('src/db/schema.ts', 'table;\ncolumn;\n');
    other.commit('round 001: a column');

    const audit = async () => parsed<{ findings: Finding[] }>(await cli(['audit', '--format', 'json'], other.root)).findings;
    const refused = (await audit()).filter((f) => f.rule === 'archive/protected-file');
    expect(refused).toHaveLength(1);
    expect(refused[0]?.hint).toContain('ruling R-001-1, signed by t@example.com, allows it, but spec-brief does not load spec-harness\'s plugin');
    expect((await cli(['doctor'], other.root)).stdout).toContain('\nplugin  spec-brief has no configuration at the root, so it loads no plugin');

    other.write('.spec-brief.json', `${JSON.stringify({ plugins: ['@descent-vtt/spec-harness/spec-brief-plugin'] })}\n`);
    other.commit('spec-brief: load the spec-harness plugin');
    const findings = await audit();
    expect(findings.filter((f) => f.severity === 'error')).toEqual([]);
    expect(findings.map((f) => f.rule)).toContain('archive/waived');
    expect((await cli(['doctor'], other.root)).stdout).toContain("\nplugin  spec-brief loads spec-harness's plugin (.spec-brief.json)");
  });

  it('says a ruling cannot count with no base to read the signers from', async () => {
    const result = await cli(['rulings', '--base', 'no-such-ref', '--format', 'json'], repo.root);
    expect(parsed<RulingsDocument>(result).unverified).toEqual([
      { id: 'R-001-1', reason: 'no base to read the allowed signers from: "no-such-ref" names no commit' },
    ]);
  });
});
