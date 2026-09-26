/**
 * A round as the README tells it, in a repository made the way most are:
 * `git init`, a remote added and pushed to, which records no default branch.
 * init, then a protected file refused, escalated, ruled on and signed, then
 * allowed, and the archive and the audit accepting the round - with the real
 * spec-brief loading this package's plugin from the project's node_modules.
 */

import { execFileSync } from 'node:child_process';

import { afterAll, describe, expect, it } from 'vitest';

import type { Finding } from '../../src/types.js';
import {
  brief,
  BRIEF_FILE,
  cleanup,
  cli,
  commitSigned,
  hasSshKeygen,
  install,
  installHarness,
  parsed,
  repository,
  SPEC_BRIEF,
  signingKey,
  temp,
} from './helpers.js';

afterAll(cleanup);

describe.skipIf(!hasSshKeygen())('a round from init to the archive (needs ssh-keygen on PATH)', () => {
  it('allows a protected file once a person signs the ruling, and the archive and the audit accept the round', async () => {
    const repo = repository({ 'README.md': '# x\n', 'src/auth/token.ts': 'token;\n', 'src/db/schema.ts': 'table;\n' }, null);
    for (const name of ['spec-brief', 'spec-guard'] as const) install(repo.root, name);
    installHarness(repo.root);
    repo.write('.gitignore', 'node_modules/\n');
    const remote = temp();
    execFileSync('git', ['init', '-q', '--bare', remote]);
    repo.git('remote', 'add', 'origin', remote);
    repo.git('push', '-q', '-u', 'origin', 'main');
    // As git before 2.48 leaves a repository it did not clone, whatever the
    // installed git does on a fetch.
    repo.git('update-ref', '--no-deref', '-d', 'refs/remotes/origin/HEAD');

    // init, and the person's allowed signers, on main.
    const init = await cli(['init', '--write'], repo.root);
    expect(init.code).toBe(0);
    expect(JSON.parse(repo.read('.spec-harness.json'))).toEqual({ base: 'main' });
    expect(JSON.parse(repo.read('.spec-brief.json')).plugins).toEqual(['@descent-vtt/spec-harness/spec-brief-plugin']);
    const person = signingKey(temp());
    repo.write('.github/allowed_signers', person.signers);
    // The heading as spec-brief new writes it, with an em dash after the id.
    repo.write(BRIEF_FILE, brief({ affected: ['src/auth/**'], protected: ['src/db/schema.ts'], title: '001 \u2014 Rotate tokens' }));
    repo.commit('spec tools, and brief 001');
    repo.git('push', '-q', 'origin', 'main');
    const doctor = await cli(['doctor'], repo.root);
    expect(doctor.stdout).toContain('\nsigners .github/allowed_signers is on main\n');
    expect(doctor.stdout).toContain("\nplugin  spec-brief loads spec-harness's plugin (.spec-brief.json)");

    // The agent's round: the protected file is refused until a person rules.
    repo.git('checkout', '-q', '-b', 'brief/001-rotate-tokens');
    repo.write('src/auth/token.ts', 'token;\nrotate;\n');
    repo.commit('round 001: rotate tokens');
    expect((await cli(['context'], repo.root)).stdout.startsWith('# Round 001: Rotate tokens\n')).toBe(true);
    expect((await cli(['guard', 'src/db/schema.ts'], repo.root)).code).toBe(1);
    expect((await cli(['escalate', '--path', 'src/db/schema.ts', '--reason', 'Rotation needs a column.'], repo.root)).code).toBe(1);
    expect((await cli(['rule', 'E-001-1', '--allow', '--note', 'One column.'], repo.root)).code).toBe(0);
    commitSigned(repo, person.key, 'ruling R-001-1: allow');

    const guard = await cli(['guard', 'src/db/schema.ts'], repo.root);
    expect(guard).toMatchObject({ code: 0, stdout: 'ok       src/db/schema.ts is protected by brief 001, and ruling R-001-1, signed by t@example.com, allows it\n' });
    const hookInput = JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Edit', cwd: repo.root, tool_input: { file_path: 'src/db/schema.ts' } });
    expect(await cli(['hook', 'claude'], repo.root, { stdin: hookInput })).toEqual({ code: 0, stdout: '', stderr: '' });
    repo.write('src/db/schema.ts', 'table;\ncolumn;\n');
    repo.commit('round 001: a rotated_at column');

    // The archive waives the file through the plugin, and the audit is clean.
    const archive = JSON.parse(
      execFileSync(process.execPath, [SPEC_BRIEF, 'archive', '001', '--base', 'main', '--dry-run', '--format', 'json', '--no-color'], { cwd: repo.root, encoding: 'utf8' }),
    ) as { plan: { refused: boolean; blocking: { rule: string }[]; warnings: { rule: string; message: string }[] } };
    expect(archive.plan.refused).toBe(false);
    expect(archive.plan.blocking).toEqual([]);
    expect(archive.plan.warnings.map((w) => w.rule)).toContain('waived');
    const audit = await cli(['audit', '--format', 'json'], repo.root);
    const findings = parsed<{ findings: Finding[] }>(audit).findings;
    expect(findings.filter((f) => f.severity !== 'note')).toEqual([]);
    expect(audit.code).toBe(0);
  });
});
