import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG } from '../../src/config.js';
import { describeActive, EXIT_ERROR, EXIT_FAILED, EXIT_OK, namedId, parseOptions, UsageError, type Workspace } from '../../src/workspace.js';
import { row } from './helpers.js';

function usage(argv: string[]): string {
  try {
    parseOptions(argv);
  } catch (error) {
    expect(error).toBeInstanceOf(UsageError);
    expect((error as Error).name).toBe('UsageError');
    return (error as Error).message;
  }
  throw new Error('parseOptions accepted the arguments');
}

describe('the exit codes', () => {
  it('are the family\'s', () => {
    expect([EXIT_OK, EXIT_FAILED, EXIT_ERROR]).toEqual([0, 1, 2]);
  });
});

describe('options', () => {
  it('reads the command and its positionals, and defaults every flag', () => {
    expect(parseOptions(['guard', 'a.ts', 'b.ts'])).toEqual({
      command: 'guard',
      positionals: ['a.ts', 'b.ts'],
      given: [],
      brief: undefined,
      base: undefined,
      root: undefined,
      format: 'pretty',
      strict: false,
      help: false,
      version: false,
      write: false,
      gitHook: false,
      paths: [],
      reason: undefined,
      options: [],
      recommend: undefined,
      list: false,
      show: undefined,
      allow: false,
      deny: false,
      note: undefined,
      id: undefined,
      at: undefined,
    });
    expect(parseOptions([]).command).toBeUndefined();
  });

  it('reads every flag', () => {
    const options = parseOptions([
      'escalate',
      '--brief', '012',
      '--base', 'origin/main',
      '--root', '/repo',
      '--format', 'json',
      '--strict',
      '--write',
      '--git-hook',
      '--path', 'a.ts',
      '--path', 'b.ts',
      '--reason', 'why',
      '--option', 'Allow: cost',
      '--option', 'Refuse',
      '--recommend', 'Allow',
      '--list',
      '--show', 'E-1',
      '--allow',
      '--deny',
      '--note', 'n',
      '--id', 'p',
      '--at', 'head',
    ]);
    expect(options).toEqual({
      command: 'escalate',
      positionals: [],
      // Each once, in the order given, by its long name.
      given: ['brief', 'base', 'root', 'format', 'strict', 'write', 'git-hook', 'path', 'reason', 'option', 'recommend', 'list', 'show', 'allow', 'deny', 'note', 'id', 'at'],
      brief: '012',
      base: 'origin/main',
      root: '/repo',
      format: 'json',
      strict: true,
      help: false,
      version: false,
      write: true,
      gitHook: true,
      paths: ['a.ts', 'b.ts'],
      reason: 'why',
      options: ['Allow: cost', 'Refuse'],
      recommend: 'Allow',
      list: true,
      show: 'E-1',
      allow: true,
      deny: true,
      note: 'n',
      id: 'p',
      at: 'head',
    });
  });

  it('lists the options given by their long names, each once and in the order given', () => {
    expect(parseOptions(['guard', 'a.ts', '--strict', '--brief', '1']).given).toEqual(['strict', 'brief']);
    expect(parseOptions(['escalate', '--path', 'a', '--reason', 'r', '--path', 'b']).given).toEqual(['path', 'reason']);
    expect(parseOptions(['-v', '-h']).given).toEqual(['version', 'help']);
  });

  it('reads the short forms of help and version', () => {
    expect(parseOptions(['-h'])).toMatchObject({ help: true, version: false });
    expect(parseOptions(['-v'])).toMatchObject({ help: false, version: true });
    expect(parseOptions(['--help', '--version'])).toMatchObject({ help: true, version: true });
  });

  it('reads every probe position, and pretty as a format', () => {
    for (const at of ['base', 'head', 'both'] as const) expect(parseOptions(['probe', '--at', at]).at).toBe(at);
    expect(parseOptions(['audit', '--format', 'pretty']).format).toBe('pretty');
  });

  it('refuses a format or a probe position it does not know', () => {
    expect(usage(['audit', '--format', 'xml'])).toBe('--format must be pretty, json, gitlab, sarif or github, not "xml"');
    expect(usage(['audit', '--format', 'SARIF'])).toBe('--format must be pretty, json, gitlab, sarif or github, not "SARIF"');
    expect(usage(['probe', '--at', 'tip'])).toBe('--at must be base, head or both, not "tip"');
  });

  it('reads the formats that place findings for audit and premises, and for no other command (spec-core ADR-0005)', () => {
    for (const format of ['gitlab', 'sarif', 'github'] as const) {
      expect(parseOptions(['audit', '--format', format]).format).toBe(format);
      expect(parseOptions(['premises', '--format', format]).format).toBe(format);
      expect(usage(['doctor', '--format', format])).toBe(`--format ${format} is for audit and premises; doctor prints pretty or json`);
      expect(usage(['context', '--format', format])).toBe(`--format ${format} is for audit and premises; context prints pretty or json`);
    }
    // Every command reads pretty and json; with no command, help is printed and the format is never used.
    for (const command of ['doctor', 'guard', 'init', 'rulings']) expect(parseOptions([command, '--format', 'json']).format).toBe('json');
    expect(parseOptions(['--format', 'sarif', '--help'])).toMatchObject({ help: true, format: 'sarif' });
  });

  it('refuses an unknown flag, and a flag missing its value', () => {
    expect(usage(['guard', '--force'])).toContain("Unknown option '--force'");
    expect(usage(['guard', '--brief'])).toContain('--brief');
    expect(usage(['guard', '--strict=yes'])).toContain('--strict');
  });
});

function workspace(branch: string | null, branches = DEFAULT_CONFIG.branches): Workspace {
  return {
    root: '/repo',
    commonDir: '/repo/.git',
    config: { ...DEFAULT_CONFIG, branches },
    siblings: {
      root: '/repo',
      locate: () => ({ kind: 'absent', reason: 'not in a unit test' }),
      briefs: async () => [],
      json: async () => ({ absent: 'not in a unit test' }),
    },
    branch,
    cwd: '/repo',
  };
}

describe('the named id', () => {
  it('is the flag, then SPEC_BRIEF, then the branch, trimmed', () => {
    expect(namedId(workspace('brief/3-x'), parseOptions(['guard', '--brief', ' 1 ']), { SPEC_BRIEF: '2' })).toBe('1');
    expect(namedId(workspace('brief/3-x'), parseOptions(['guard', '--brief', ' ']), { SPEC_BRIEF: ' 2 ' })).toBe('2');
    expect(namedId(workspace('brief/3-x'), parseOptions(['guard']), { SPEC_BRIEF: '' })).toBe('3');
    expect(namedId(workspace('nh/brief-4'), parseOptions(['guard']), {})).toBe('4');
  });

  it('is none on a detached head or a branch no template reads', () => {
    expect(namedId(workspace(null), parseOptions(['guard']), {})).toBeNull();
    expect(namedId(workspace('main'), parseOptions(['guard']), {})).toBeNull();
    expect(namedId(workspace('brief/3', ['work/{id}']), parseOptions(['guard']), {})).toBeNull();
  });
});

describe('describing the active brief', () => {
  it('gives the brief it found', () => {
    const brief = row();
    expect(describeActive({ kind: 'found', brief, source: 'branch' })).toEqual({ brief, note: undefined, problem: null });
  });

  it('gives the reason there is none as a note, not a problem', () => {
    expect(describeActive({ kind: 'none', reason: 'no brief is named' })).toEqual({ brief: null, note: 'no brief is named', problem: null });
  });

  it('makes a named brief spec-brief does not know, or an archived one, a problem', () => {
    expect(describeActive({ kind: 'unknown', id: '99', source: 'flag' })).toEqual({
      brief: null,
      note: undefined,
      problem: 'the flag names brief 99, and spec-brief knows no such brief',
    });
    expect(describeActive({ kind: 'archived', brief: row({ id: '007' }), source: 'environment' })).toEqual({
      brief: null,
      note: undefined,
      problem: 'the environment names brief 007, which is archived; a closed round writes nothing',
    });
  });
});
