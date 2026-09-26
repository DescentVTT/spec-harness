import { describe, expect, it } from 'vitest';

import { audit, isPremise, type AssertionOutcome, type AuditInput } from '../../src/audit.js';
import { DEFAULT_CONFIG } from '../../src/config.js';
import type { DependencyChange } from '../../src/manifests.js';
import { row } from './helpers.js';

const FILE = 'briefs/012_rotate-tokens.md';

function input(overrides: Partial<AuditInput> = {}): AuditInput {
  return {
    brief: row(),
    unmeasured: null,
    dependencies: { changes: [], unread: [] },
    archive: { blocking: [], warnings: [] },
    assertions: [],
    premiseSections: DEFAULT_CONFIG.assertions.premises,
    unverifiedRulings: [],
    verifiedRulings: [],
    pluginLoaded: true,
    ...overrides,
  };
}

function outcome(ok: boolean, section: string | null, line = 20): AssertionOutcome {
  return { ok, description: `"X" in ${section ?? 'no section'}`, message: ok ? 'holds' : 'expected 0, found 2', line, section };
}

function change(before: string | null, after: string | null, name = 'left-pad'): DependencyChange {
  return { file: 'package.json', ecosystem: 'npm', section: 'dependencies', name, before, after };
}

describe('a clean round', () => {
  it('finds nothing and counts nothing', () => {
    expect(audit(input())).toEqual({ findings: [], counts: { error: 0, warning: 0, note: 0 } });
  });
});

describe('what could not be measured is a finding, never a silence', () => {
  it('reports a round whose changes were not measured', () => {
    const { findings } = audit(input({ unmeasured: 'main and HEAD are the same commit' }));
    expect(findings).toEqual([
      {
        rule: 'unmeasured',
        severity: 'warning',
        message: "the round's changes were not measured: main and HEAD are the same commit",
        hint: 'pass --base <ref>, set "base" in .spec-harness.json, or audit on the round\'s branch before it merges',
        file: FILE,
      },
    ]);
    expect('line' in (findings[0] as object)).toBe(false);
  });

  it('reports an archive it could not ask about', () => {
    expect(audit(input({ archive: { unavailable: 'spec-brief is not installed here' } })).findings).toEqual([
      {
        rule: 'archive-unchecked',
        severity: 'warning',
        message: 'what the archive would say is unknown: spec-brief is not installed here',
        hint: 'install spec-brief, or fix what stopped it',
        file: FILE,
      },
    ]);
  });

  it('reports assertions it could not run', () => {
    expect(audit(input({ assertions: { unavailable: 'spec-guard is not installed here' } })).findings).toEqual([
      {
        rule: 'assertions-unchecked',
        severity: 'warning',
        message: "the brief's assertions were not run: spec-guard is not installed here",
        hint: 'install spec-guard, or fix what stopped it',
        file: FILE,
      },
    ]);
  });

  it('reports a manifest it could not read', () => {
    expect(audit(input({ dependencies: { changes: [], unread: ['Cargo.toml'] } })).findings).toEqual([
      {
        rule: 'manifest-unread',
        severity: 'warning',
        message: 'Cargo.toml changed and could not be read for dependencies',
        hint: 'check its dependencies by hand; the audit cannot',
        file: 'Cargo.toml',
      },
    ]);
  });
});

describe('the archive', () => {
  it('carries each of its reasons as it gave them, blocking first', () => {
    const report = audit(
      input({
        archive: {
          blocking: [{ rule: 'open-task', severity: 'error', message: '"x" is open', hint: 'tick it', file: FILE, line: 19 }],
          warnings: [{ rule: 'out-of-scope', severity: 'warning', message: 'outside.txt', hint: 'widen', file: FILE }],
        },
      }),
    );
    expect(report.findings).toEqual([
      { rule: 'archive/open-task', severity: 'error', message: '"x" is open', hint: 'tick it', file: FILE, line: 19 },
      { rule: 'archive/out-of-scope', severity: 'warning', message: 'outside.txt', hint: 'widen', file: FILE },
    ]);
    expect(report.counts).toEqual({ error: 1, warning: 1, note: 0 });
  });

  const refused = (path: string | undefined, rule = 'protected-file') => ({
    rule,
    severity: 'error' as const,
    message: `the round changed ${path ?? 'files'}, which this brief protects`,
    hint: 'revert the change, or record the departure in the brief before archiving it',
    file: FILE,
    line: 7,
    ...(path === undefined ? {} : { path }),
  });
  const signed = [
    { id: 'R-012-1', paths: ['src/db/**'], signer: 'person@example.com' },
    { id: 'R-012-2', paths: ['src/api.ts'], signer: 'other@example.com' },
  ];

  it('says a protected file a verified ruling covers is refused because spec-brief does not load the plugin', () => {
    const { findings } = audit(input({ archive: { blocking: [refused('src/db/schema.ts'), refused('src/api.ts')], warnings: [] }, verifiedRulings: signed, pluginLoaded: false }));
    const loadIt = 'but spec-brief does not load spec-harness\'s plugin, which is how its archive learns of signed rulings: add "@descent-vtt/spec-harness/spec-brief-plugin" to "plugins" in its configuration, or run spec-harness init --write';
    expect(findings).toEqual([
      { rule: 'archive/protected-file', severity: 'error', message: 'the round changed src/db/schema.ts, which this brief protects', hint: `ruling R-012-1, signed by person@example.com, allows it, ${loadIt}`, file: FILE, line: 7 },
      { rule: 'archive/protected-file', severity: 'error', message: 'the round changed src/api.ts, which this brief protects', hint: `ruling R-012-2, signed by other@example.com, allows it, ${loadIt}`, file: FILE, line: 7 },
    ]);
  });

  it('says where to look when spec-brief loads the plugin and refuses the file all the same', () => {
    const { findings } = audit(input({ archive: { blocking: [refused('src/db/schema.ts')], warnings: [] }, verifiedRulings: signed, pluginLoaded: true }));
    expect(findings[0]?.hint).toBe(
      'ruling R-012-1, signed by person@example.com, allows it, and the archive still refused it: check that spec-brief loads the spec-harness installed here and measures from the same base (spec-harness doctor)',
    );
  });

  it('keeps spec-brief\'s own hint where no verified ruling covers the file, or the reason is another', () => {
    const hint = 'revert the change, or record the departure in the brief before archiving it';
    const { findings } = audit(
      input({
        archive: { blocking: [refused('src/other.ts'), refused(undefined), refused('src/db/schema.ts', 'open-task')], warnings: [refused('src/db/x.ts', 'out-of-scope')] },
        verifiedRulings: signed,
        pluginLoaded: false,
      }),
    );
    expect(findings.map((f) => f.hint)).toEqual([hint, hint, hint, hint]);
    expect(audit(input({ archive: { blocking: [refused('src/db/schema.ts')], warnings: [] }, pluginLoaded: false })).findings[0]?.hint).toBe(hint);
  });
});

describe('the brief\'s assertions', () => {
  it('fails a goal that does not hold, and says nothing of one that does', () => {
    const { findings } = audit(input({ assertions: [outcome(false, 'Invariants', 30), outcome(true, 'Invariants'), outcome(false, null, 40)] }));
    expect(findings).toEqual([
      {
        rule: 'goal-failed',
        severity: 'error',
        message: '"X" in Invariants: expected 0, found 2',
        hint: 'the round is not done until this holds',
        file: FILE,
        line: 30,
      },
      { rule: 'goal-failed', severity: 'error', message: '"X" in no section: expected 0, found 2', hint: 'the round is not done until this holds', file: FILE, line: 40 },
    ]);
  });

  it('warns about a premise that still holds, and notes one the round retired', () => {
    const { findings, counts } = audit(input({ assertions: [outcome(true, 'The Defect, Measured', 12), outcome(false, 'Premises', 14)] }));
    expect(findings).toEqual([
      {
        rule: 'premise-holds',
        severity: 'warning',
        message: 'a premise still holds after the round: "X" in The Defect, Measured',
        hint: 'the round set out to change what this premise states; check that it did, or move the assertion out of the premises',
        file: FILE,
        line: 12,
      },
      { rule: 'premise-retired', severity: 'note', message: 'a premise no longer holds, as the round intended: "X" in Premises', hint: 'nothing to do', file: FILE, line: 14 },
    ]);
    expect(counts).toEqual({ error: 0, warning: 1, note: 1 });
  });

  it('reads the premise sections the repository configured', () => {
    const { findings } = audit(input({ premiseSections: ['Before'], assertions: [outcome(false, 'before'), outcome(false, 'The Defect, Measured')] }));
    expect(findings.map((f) => f.rule)).toEqual(['premise-retired', 'goal-failed']);
  });
});

describe('premise subsections', () => {
  it('reads an assertion under a subsection of a premise section as a premise', () => {
    const nested = { ...outcome(true, 'Before'), enclosing: ['The Defect, Measured', 'Before'] };
    expect(audit(input({ assertions: [nested] })).findings.map((f) => f.rule)).toEqual(['premise-holds']);
    const goal = { ...outcome(false, 'Detail'), enclosing: ['Invariants', 'Detail'] };
    expect(audit(input({ assertions: [goal] })).findings.map((f) => f.rule)).toEqual(['goal-failed']);
  });
});

describe('premise sections', () => {
  it('are named without case, emphasis, a leading number or a trailing colon', () => {
    const premises = DEFAULT_CONFIG.assertions.premises;
    for (const heading of ['The Defect, Measured', 'the defect, measured', '2. The Defect, Measured', '**Premises**', 'Preconditions:', '  Premises  ', '3) *The Defect, Measured*']) {
      expect(isPremise(heading, premises), heading).toBe(true);
    }
  });

  it('are not a heading that only resembles one, or no heading', () => {
    const premises = DEFAULT_CONFIG.assertions.premises;
    for (const heading of ['The Defect', 'Measured', 'Premises and goals', 'Invariants', '']) {
      expect(isPremise(heading, premises), heading).toBe(false);
    }
    expect(isPremise(null, premises)).toBe(false);
    expect(isPremise('Premises', [])).toBe(false);
  });

  it('keep a numbered premise heading from failing the round that retired it', () => {
    // Read as a goal, the retired premise would be an error on a round that did its job.
    const { findings } = audit(input({ assertions: [outcome(false, '3. **The Defect, Measured:**')] }));
    expect(findings.map((f) => f.rule)).toEqual(['premise-retired']);
  });
});

describe('rulings', () => {
  it('reports each ruling that allows nothing, and why', () => {
    expect(audit(input({ unverifiedRulings: [{ id: 'R-012-1', reason: 'its row is not committed' }] })).findings).toEqual([
      {
        rule: 'ruling-unverified',
        severity: 'warning',
        message: 'ruling R-012-1 allows nothing: its row is not committed',
        hint: "a ruling counts when the commit that last changed its row is signed by a key in the base branch's allowed signers",
        file: FILE,
      },
    ]);
  });
});

describe('dependencies', () => {
  it('warns about a dependency the round added, with its version when it has one', () => {
    const { findings } = audit(input({ dependencies: { changes: [change(null, '^1.3.0'), change(null, '', 'serde')], unread: [] } }));
    expect(findings).toEqual([
      {
        rule: 'new-dependency',
        severity: 'warning',
        message: 'the round added npm dependency "left-pad" ^1.3.0 in package.json (dependencies)',
        hint: 'say in the brief why it is needed, or remove it; a new dependency is code no reviewer read',
        file: 'package.json',
      },
      {
        rule: 'new-dependency',
        severity: 'warning',
        message: 'the round added npm dependency "serde" in package.json (dependencies)',
        hint: 'say in the brief why it is needed, or remove it; a new dependency is code no reviewer read',
        file: 'package.json',
      },
    ]);
  });

  it('notes a dependency removed or moved to another version', () => {
    const { findings, counts } = audit(input({ dependencies: { changes: [change('1.0.0', null), change('1.0.0', '2.0.0')], unread: [] } }));
    expect(findings).toEqual([
      { rule: 'dependency-removed', severity: 'note', message: 'the round removed "left-pad" from package.json (dependencies)', hint: 'nothing to do', file: 'package.json' },
      {
        rule: 'dependency-changed',
        severity: 'note',
        message: 'the round moved "left-pad" from 1.0.0 to 2.0.0 in package.json (dependencies)',
        hint: 'nothing to do, if the brief meant it',
        file: 'package.json',
      },
    ]);
    expect(counts).toEqual({ error: 0, warning: 0, note: 2 });
  });
});

describe('the report', () => {
  it('orders its parts and counts every severity', () => {
    const report = audit(
      input({
        unmeasured: 'no base',
        archive: { blocking: [{ rule: 'protected-file', severity: 'error', message: 'm', hint: 'h' }], warnings: [] },
        assertions: [outcome(false, 'Invariants'), outcome(false, 'Premises')],
        unverifiedRulings: [{ id: 'R-1', reason: 'r' }],
        dependencies: { changes: [change(null, '1'), change('1', null)], unread: ['go.mod'] },
      }),
    );
    expect(report.findings.map((f) => f.rule)).toEqual([
      'unmeasured',
      'archive/protected-file',
      'goal-failed',
      'premise-retired',
      'ruling-unverified',
      'manifest-unread',
      'new-dependency',
      'dependency-removed',
    ]);
    expect(report.counts).toEqual({ error: 2, warning: 4, note: 2 });
    // An archive reason with no file names none.
    expect('file' in (report.findings[1] as object)).toBe(false);
  });
});
