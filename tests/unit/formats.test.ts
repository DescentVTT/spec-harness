import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { RULES } from '../../src/audit.js';
import { FINDING_FORMATS, formatFindings, formatGithub, formatGitlab, formatSarif, type FormatOptions } from '../../src/formats.js';
import type { Finding } from '../../src/types.js';

const BRIEF = 'briefs/012_rotate-tokens.md';
const OPTIONS: FormatOptions = { file: BRIEF, version: '9.9.9' };

const goal: Finding = {
  rule: 'goal-failed',
  severity: 'error',
  message: '"OldToken" in src: expected 0, found 2',
  hint: 'the round is not done until this holds',
  file: BRIEF,
  line: 30,
  subject: '"OldToken" in src',
};
const dependency: Finding = {
  rule: 'new-dependency',
  severity: 'warning',
  message: 'the round added npm dependency "left-pad" ^1.3.0 in package.json (dependencies)',
  hint: 'say in the brief why it is needed, or remove it',
  file: 'package.json',
  subject: 'left-pad (dependencies)',
};
const retired: Finding = { rule: 'premise-retired', severity: 'note', message: 'a premise no longer holds', hint: 'nothing to do', file: BRIEF, line: 12, subject: '"X" in src' };
const unmeasured: Finding = { rule: 'unmeasured', severity: 'warning', message: "the round's changes were not measured: no base", hint: 'pass --base <ref>' };

interface Issue {
  description: string;
  check_name: string;
  fingerprint: string;
  severity: string;
  location: { path: string; lines: { begin: number } };
}

const gitlab = (findings: readonly Finding[]): Issue[] => JSON.parse(formatGitlab(findings, OPTIONS)) as Issue[];
const fingerprints = (findings: readonly Finding[]): string[] => gitlab(findings).map((issue) => issue.fingerprint);

describe('GitLab Code Quality', () => {
  it('maps error to major, warning to minor and note to info, with the hint in the description', () => {
    expect(gitlab([goal, dependency, retired])).toEqual([
      {
        description: '"OldToken" in src: expected 0, found 2. the round is not done until this holds',
        check_name: 'goal-failed',
        fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
        severity: 'major',
        location: { path: BRIEF, lines: { begin: 30 } },
      },
      {
        description: 'the round added npm dependency "left-pad" ^1.3.0 in package.json (dependencies). say in the brief why it is needed, or remove it',
        check_name: 'new-dependency',
        fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
        severity: 'minor',
        location: { path: 'package.json', lines: { begin: 1 } },
      },
      {
        description: 'a premise no longer holds. nothing to do',
        check_name: 'premise-retired',
        fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
        severity: 'info',
        location: { path: BRIEF, lines: { begin: 12 } },
      },
    ]);
  });

  it('keeps one full stop between a message that ends with one and its hint', () => {
    const [issue] = gitlab([{ ...goal, message: 'Attribute "min" must be a non-negative integer, got "abc".' }]);
    expect(issue?.description).toBe('Attribute "min" must be a non-negative integer, got "abc". the round is not done until this holds');
  });

  it('places a finding with no file on the brief, and one with no line, or line 0, on line 1', () => {
    const [placed, zero] = gitlab([unmeasured, { ...goal, line: 0 }]);
    expect(placed?.location).toEqual({ path: BRIEF, lines: { begin: 1 } });
    expect(zero?.location).toEqual({ path: BRIEF, lines: { begin: 1 } });
  });

  it('is an empty list when there is nothing to report', () => {
    expect(formatGitlab([], OPTIONS)).toBe('[]\n');
  });
});

describe('a fingerprint', () => {
  it('stays when the message, the hint or the line changes, so a reworded finding is not a new one', () => {
    const [before] = fingerprints([goal]);
    expect(fingerprints([{ ...goal, message: '"OldToken" in src: expected 0, found 3', hint: 'another hint', line: 31 }])).toEqual([before]);
  });

  it('changes with the rule, the file or the subject: the finding\'s identity', () => {
    const [base] = fingerprints([goal]);
    for (const other of [{ ...goal, rule: 'premise-holds' }, { ...goal, file: 'briefs/013_x.md' }, { ...goal, subject: '"NewToken" in src' }]) {
      expect(fingerprints([other])[0]).not.toBe(base);
    }
  });

  it('is the SHA-256 of the rule, the file and the subject, the file being the brief for a finding without one', () => {
    const sha = (text: string): string => createHash('sha256').update(text).digest('hex');
    expect(fingerprints([goal, unmeasured])).toEqual([sha(`goal-failed\u0000${BRIEF}\u0000"OldToken" in src`), sha(`unmeasured\u0000${BRIEF}\u0000`)]);
  });

  it('tells two findings with one identity apart by their order, the first keeping the fingerprint it has alone', () => {
    const open = { rule: 'archive/open-task', severity: 'error' as const, message: '"a" is open', hint: 'tick it', file: BRIEF, line: 7 };
    const [alone] = fingerprints([open]);
    const pair = fingerprints([open, { ...open, message: '"b" is open', line: 8 }]);
    expect(pair[0]).toBe(alone);
    expect(pair[1]).not.toBe(alone);
    // Another identity between them leaves the count of the first alone.
    expect(fingerprints([open, goal, open])[2]).toBe(pair[1]);
  });
});

interface Sarif {
  $schema: string;
  version: string;
  runs: {
    invocations?: { executionSuccessful: boolean; toolExecutionNotifications: { level: string; message: { text: string } }[] }[];
    tool: { driver: { name: string; version: string; informationUri: string; rules: { id: string; shortDescription: { text: string } }[] } };
    results: {
      ruleId: string;
      level: string;
      message: { text: string };
      locations: { physicalLocation: { artifactLocation: { uri: string; uriBaseId: string }; region: { startLine: number } } }[];
      partialFingerprints: { specHarnessFinding: string };
    }[];
  }[];
}

describe('SARIF', () => {
  const sarif = (findings: readonly Finding[], options: FormatOptions = OPTIONS): Sarif => JSON.parse(formatSarif(findings, options)) as Sarif;

  it('is SARIF 2.1.0 from spec-harness at its version, each rule described once', () => {
    const document = sarif([goal, dependency, { ...goal, line: 40 }, { rule: 'archive/protected-file', severity: 'error', message: 'm', hint: 'h' }]);
    expect(document.$schema).toBe('https://json.schemastore.org/sarif-2.1.0.json');
    expect(document.version).toBe('2.1.0');
    const driver = document.runs[0]?.tool.driver;
    expect(driver).toMatchObject({ name: 'spec-harness', version: '9.9.9', informationUri: 'https://github.com/DescentVTT/spec-harness' });
    expect(driver?.rules).toEqual([
      { id: 'archive/protected-file', shortDescription: { text: "A reason spec-brief's archive gives: protected-file." } },
      { id: 'goal-failed', shortDescription: { text: RULES['goal-failed'] } },
      { id: 'new-dependency', shortDescription: { text: RULES['new-dependency'] } },
    ]);
  });

  it('carries each finding at its level and place, with its hint, and GitLab\'s fingerprint', () => {
    const results = sarif([goal, retired, unmeasured]).runs[0]?.results ?? [];
    expect(results.map((r) => [r.ruleId, r.level, r.message.text])).toEqual([
      ['goal-failed', 'error', '"OldToken" in src: expected 0, found 2. the round is not done until this holds'],
      ['premise-retired', 'note', 'a premise no longer holds. nothing to do'],
      ['unmeasured', 'warning', "the round's changes were not measured: no base. pass --base <ref>"],
    ]);
    expect(results.map((r) => r.locations[0]?.physicalLocation)).toEqual([
      { artifactLocation: { uri: BRIEF, uriBaseId: '%SRCROOT%' }, region: { startLine: 30 } },
      { artifactLocation: { uri: BRIEF, uriBaseId: '%SRCROOT%' }, region: { startLine: 12 } },
      { artifactLocation: { uri: BRIEF, uriBaseId: '%SRCROOT%' }, region: { startLine: 1 } },
    ]);
    expect(results.map((r) => r.partialFingerprints.specHarnessFinding)).toEqual(fingerprints([goal, retired, unmeasured]));
  });

  it('says what the run measured in a note beside the results, even with none, and nothing when not told', () => {
    const measured = sarif([], { ...OPTIONS, summary: 'measured: goals: none declared' }).runs[0];
    expect(measured?.results).toEqual([]);
    expect(measured?.invocations).toEqual([{ executionSuccessful: true, toolExecutionNotifications: [{ level: 'note', message: { text: 'measured: goals: none declared' } }] }]);
    expect(sarif([]).runs[0]?.invocations).toBeUndefined();
  });

  it('describes a rule it has no words for by its id', () => {
    expect(sarif([{ rule: 'something-new', severity: 'note', message: 'm', hint: 'h' }]).runs[0]?.tool.driver.rules).toEqual([{ id: 'something-new', shortDescription: { text: 'something-new' } }]);
  });
});

describe('GitHub workflow commands', () => {
  it('puts each finding on its line, titled with the tool and the rule, at its level', () => {
    expect(formatGithub([goal, dependency, retired, unmeasured], OPTIONS)).toBe(
      [
        `::error file=${BRIEF},line=30,title=spec-harness goal-failed::"OldToken" in src: expected 0, found 2. the round is not done until this holds`,
        '::warning file=package.json,line=1,title=spec-harness new-dependency::the round added npm dependency "left-pad" ^1.3.0 in package.json (dependencies). say in the brief why it is needed, or remove it',
        `::notice file=${BRIEF},line=12,title=spec-harness premise-retired::a premise no longer holds. nothing to do`,
        `::warning file=${BRIEF},line=1,title=spec-harness unmeasured::the round's changes were not measured: no base. pass --base <ref>`,
        '',
      ].join('\n'),
    );
  });

  it('escapes what would end the command, or a property', () => {
    const odd: Finding = { rule: 'archive/x', severity: 'error', message: '100% done\r\nnext', hint: 'a, b: c', file: 'dir,a:b/%.md', line: 3 };
    expect(formatGithub([odd], OPTIONS)).toBe('::error file=dir%2Ca%3Ab/%25.md,line=3,title=spec-harness archive/x::100%25 done%0D%0Anext. a, b: c\n');
  });

  it('prints nothing when there is nothing to annotate', () => {
    expect(formatGithub([], OPTIONS)).toBe('');
  });
});

describe('the formats', () => {
  it('are the three that place findings, each rendered by its own writer', () => {
    expect(FINDING_FORMATS).toEqual(['gitlab', 'sarif', 'github']);
    expect(formatFindings('gitlab', [goal], OPTIONS)).toBe(formatGitlab([goal], OPTIONS));
    expect(formatFindings('sarif', [goal], OPTIONS)).toBe(formatSarif([goal], OPTIONS));
    expect(formatFindings('github', [goal], OPTIONS)).toBe(formatGithub([goal], OPTIONS));
  });
});
