import { describe, expect, it } from 'vitest';

import { HELP } from '../../src/cli.js';
import { emptyValue, isBlank, refusal } from '../../src/usage.js';
import { parseOptions, UsageError } from '../../src/workspace.js';

/** Why a command line is refused, with every `--root` a directory unless the test names those that are. */
function refused(argv: readonly string[], isDirectory: (path: string) => boolean = () => true): string | null {
  return refusal(parseOptions(argv), isDirectory);
}

/** What each command reads of a command line, as the README's table has it. */
const TAKES: Readonly<Record<string, readonly string[]>> = {
  context: ['brief', 'base', 'root', 'format'],
  guard: ['brief', 'base', 'root', 'format', 'strict'],
  hook: ['brief', 'base', 'root'],
  escalate: ['brief', 'root', 'format', 'path', 'reason', 'option', 'recommend', 'list', 'show'],
  rule: ['root', 'format', 'allow', 'deny', 'note'],
  rulings: ['brief', 'base', 'root', 'format'],
  audit: ['brief', 'base', 'root', 'format', 'strict'],
  probe: ['brief', 'base', 'root', 'format', 'id', 'at'],
  premises: ['brief', 'root', 'format', 'strict'],
  init: ['root', 'format', 'write', 'git-hook'],
  mcp: ['root'],
  doctor: ['brief', 'base', 'root', 'format', 'strict'],
};

/** Every option there is, as a person gives it. */
const GIVEN: Readonly<Record<string, readonly string[]>> = {
  brief: ['--brief', '012'],
  base: ['--base', 'main'],
  root: ['--root', 'elsewhere'],
  format: ['--format', 'json'],
  strict: ['--strict'],
  write: ['--write'],
  'git-hook': ['--git-hook'],
  path: ['--path', 'src/a.ts'],
  reason: ['--reason', 'why'],
  option: ['--option', 'Allow: one column'],
  recommend: ['--recommend', 'Allow.'],
  list: ['--list'],
  show: ['--show', 'E-012-1'],
  allow: ['--allow'],
  deny: ['--deny'],
  note: ['--note', 'n'],
  id: ['--id', 'p'],
  at: ['--at', 'base'],
};

/** A command with the argument it needs, where it needs one: `hook git`, since `hook claude` is read apart. */
const line = (command: string): string[] => (command === 'hook' ? ['hook', 'git'] : [command]);

describe('a command line that names something', () => {
  it('runs: every command with the options it reads and the arguments it takes', () => {
    for (const argv of [
      ['context'],
      ['context', '012', '--base', 'origin/main', '--root', 'elsewhere', '--format', 'json'],
      ['context', '--brief', '012'],
      ['guard', 'a.ts', 'b.ts', 'c.ts', '--brief', '1', '--base', 'main', '--strict', '--format', 'json'],
      ['hook', 'git', '--brief', '1', '--base', 'main', '--root', 'elsewhere'],
      ['escalate', '--path', 'a.ts', '--path', 'b.ts', '--reason', 'why', '--option', 'Allow: one column', '--option', 'Refuse', '--recommend', 'Allow.', '--brief', '1', '--format', 'json'],
      ['escalate', '--list'],
      ['escalate', '--show', 'E-012-1'],
      ['rule', 'E-012-1', '--allow', '--note', 'Add rotated_at only.', '--format', 'json'],
      ['rulings', '012', '--base', 'main'],
      ['audit', '--strict', '--format', 'sarif'],
      ['probe', '012', '--at', 'base', '--id', 'p'],
      ['premises', '--strict', '--brief', '1', '--format', 'gitlab'],
      ['init', '--write', '--git-hook', '--format', 'json'],
      ['mcp', '--root', 'elsewhere'],
      ['doctor', '--brief', '1', '--base', 'main', '--strict', '--format', 'json'],
    ]) {
      expect(refused(argv), argv.join(' ')).toBeNull();
    }
  });

  it('keeps a name that has space around it, which every command trims', () => {
    expect(refused(['guard', 'a.ts', '--brief', ' 12 '])).toBeNull();
    expect(refused(['escalate', '--path', 'a.ts', '--reason', ' why '])).toBeNull();
  });

  it('says nothing of no command, or of a word that is none: the command line answers those', () => {
    expect(refused([])).toBeNull();
    expect(refused(['--root', ''])).toBeNull();
    expect(refused(['archive', 'extra', '--note', 'x'])).toBeNull();
    // An object answers to more names than a map was given.
    expect(refused(['constructor', '--note', 'x'])).toBeNull();
    expect(refused(['toString', 'extra'])).toBeNull();
  });
});

describe('the help', () => {
  /** The commands the help gives an option to, read as a person reads it: a sentence is one line, wherever it wraps. */
  const said = (option: string): string[] => {
    const list = new RegExp(`--${option} .*? For ([a-z, ]+?)\\.`).exec(HELP.replace(/\s+/g, ' '))?.[1] ?? '';
    return list.split(/, | and /).sort();
  };
  const reading = (option: string): string[] => Object.keys(TAKES).filter((command) => (TAKES[command] as readonly string[]).includes(option)).sort();

  it('gives each option that not every command reads to the commands that read it', () => {
    for (const option of ['brief', 'base', 'strict']) expect(said(option), option).toEqual(reading(option));
    expect(HELP).toContain('--root <dir>        Run from another directory, which must exist. For every command.\n');
    expect(reading('root')).toEqual(Object.keys(TAKES).sort());
    expect(HELP.replace(/\s+/g, ' ')).toContain('audit and premises also gitlab, sarif or github. For every command but hook and mcp.');
    expect(Object.keys(TAKES).filter((command) => !reading('format').includes(command))).toEqual(['hook', 'mcp']);
  });

  it('says what is refused, and the two commands that read their line another way', () => {
    expect(HELP).toContain(
      [
        'An option a command does not read, an argument it does not take, and an option or an',
        'argument given an empty value are refused, exit 2, not read as if they were not there.',
        'doctor says an empty --brief or --base in its report, and hook claude reads its line',
        'as every release has.',
        '',
      ].join('\n'),
    );
  });
});

describe('an option a command does not read', () => {
  it('is refused by the command, with the options it does read', () => {
    expect(refused(['doctor', '--note', 'x'])).toBe('doctor does not take --note; its options are --brief, --base, --root, --format and --strict');
    expect(refused(['init', '--base', 'main'])).toBe('init does not take --base; its options are --root, --format, --write and --git-hook');
    expect(refused(['hook', 'git', '--strict'])).toBe('hook does not take --strict; its options are --brief, --base and --root');
    expect(refused(['mcp', '--brief', '012'])).toBe('mcp does not take --brief; its only option is --root');
  });

  it('is every option but those the table gives the command, and none of those', () => {
    for (const [command, takes] of Object.entries(TAKES)) {
      for (const [option, given] of Object.entries(GIVEN)) {
        const answer = refused([...line(command), ...given]);
        if (takes.includes(option)) expect(answer, `${command} --${option}`).toBeNull();
        else expect(answer, `${command} --${option}`).toMatch(new RegExp(`^${command} does not take --${option}; its (?:only option is|options are) `));
      }
    }
  });

  it('is named before a value it was given nothing for, and is the first of two on the line', () => {
    expect(refused(['doctor', '--id', ''])).toBe('doctor does not take --id; its options are --brief, --base, --root, --format and --strict');
    expect(refused(['mcp', '--strict', '--note', 'x'])).toBe('mcp does not take --strict; its only option is --root');
    expect(refused(['mcp', '--note', 'x', '--strict'])).toBe('mcp does not take --note; its only option is --root');
  });
});

describe('an argument a command does not take', () => {
  it('is refused with every argument given, and what the command takes', () => {
    expect(refused(['doctor', 'extra'])).toBe('doctor takes no argument, not "extra"');
    for (const command of ['escalate', 'premises', 'init', 'mcp']) expect(refused([command, 'mydir'])).toBe(`${command} takes no argument, not "mydir"`);
    expect(refused(['context', '012', 'extra'])).toBe('context takes one argument at most, a brief\'s id, not "012", "extra"');
    for (const command of ['rulings', 'audit', 'probe']) expect(refused([command, '012', 'x', 'y'])).toBe(`${command} takes one argument at most, a brief's id, not "012", "x", "y"`);
    expect(refused(['rule', 'E-012-1', 'extra', '--allow', '--note', 'n'])).toBe('rule takes one argument, the escalation\'s id, not "E-012-1", "extra"');
    expect(refused(['hook', 'git', 'extra'])).toBe('hook takes one argument, "claude" or "git", not "git", "extra"');
    // Shown as JSON, where an empty one can be seen.
    expect(refused(['doctor', ''])).toBe('doctor takes no argument, not ""');
  });

  it('is none of a guard\'s paths, however many', () => {
    expect(refused(['guard', 'a', 'b', 'c', 'd', 'e', 'f'])).toBeNull();
  });

  it('is not the word after hook, which hook itself reads', () => {
    expect(refused(['hook'])).toBeNull();
    expect(refused(['hook', 'bogus'])).toBeNull();
    expect(refused(['hook', ''])).toBeNull();
  });
});

describe('a value that names nothing', () => {
  it('is refused by the name of its option, shown as JSON, with what to do', () => {
    expect(refused(['guard', 'a.ts', '--brief', ''])).toBe('--brief is "", which names no brief; give it a brief\'s id, or leave it out for the one SPEC_BRIEF or the branch names');
    expect(refused(['audit', '--base', ''])).toBe('--base is "", which names no commit; give it a branch or a commit, or leave it out for the configured base');
    expect(refused(['init', '--root', ''])).toBe('--root is "", which names no directory; give it one, or leave it out to run in the current directory');
    expect(refused(['escalate', '--path', '', '--reason', 'why'])).toBe('--path is "", which names no file; give it the path of a file');
    expect(refused(['escalate', '--path', 'a.ts', '--reason', ''])).toBe('--reason is "", which gives no reason; say why the round cannot be done without the file');
    expect(refused(['escalate', '--path', 'a.ts', '--reason', 'why', '--option', ''])).toBe('--option is "", which names no choice; give it "<label>: <cost>", or leave it out');
    expect(refused(['escalate', '--path', 'a.ts', '--reason', 'why', '--recommend', ''])).toBe('--recommend is "", which recommends nothing; say which option and why, or leave it out');
    expect(refused(['escalate', '--show', ''])).toBe('--show is "", which names no escalation; give it an id, as spec-harness escalate --list prints them');
    expect(refused(['probe', '--id', ''])).toBe('--id is "", which names no probe; give it a probe\'s id, or leave it out to run every probe');
  });

  it('is one of only space, a tab or a line break, each shown as it is', () => {
    expect(refused(['guard', 'a.ts', '--brief', ' '])).toMatch(/^--brief is " ", which names no brief; /);
    expect(refused(['guard', 'a.ts', '--root', '\t'])).toMatch(/^--root is "\\t", which names no directory; /);
    expect(refused(['escalate', '--path', 'a.ts', '--reason', ' \n '])).toMatch(/^--reason is " \\n ", which gives no reason; /);
  });

  it('is any one of the values an option was given more than once', () => {
    expect(refused(['escalate', '--path', 'a.ts', '--path', ' ', '--reason', 'why'])).toMatch(/^--path is " ", which names no file; /);
    expect(refused(['escalate', '--path', 'a.ts', '--reason', 'why', '--option', 'Allow: one', '--option', ''])).toMatch(/^--option is "", which names no choice; /);
  });

  it('is held to every option the help gives a value', () => {
    // --format and --at take one of a few words, which the parser holds them
    // to, the empty one refused with any other; rule refuses its own --note.
    const elsewhere = ['format', 'at', 'note'];
    const valued = [...HELP.matchAll(/--([a-z-]+) "?</g)].map((match) => match[1] as string);
    expect([...new Set(valued)].sort()).toEqual(['at', 'base', 'brief', 'format', 'id', 'note', 'option', 'path', 'reason', 'recommend', 'root', 'show']);
    for (const option of new Set(valued)) {
      if (elsewhere.includes(option)) continue;
      const command = Object.keys(TAKES).find((name) => name !== 'doctor' && (TAKES[name] as readonly string[]).includes(option)) as string;
      for (const value of ['', '  ']) {
        const argv = [...line(command), `--${option}`, value];
        expect(refused(argv)?.startsWith(`--${option} is ${JSON.stringify(value)}, which `), argv.join(' ')).toBe(true);
      }
    }
    for (const argv of [['doctor', '--format', ''], ['probe', '--at', '']]) {
      expect(() => parseOptions(argv), argv.join(' ')).toThrow(UsageError);
    }
  });

  it('is said in a tool\'s words for its argument as in the command line\'s for its option', () => {
    expect(emptyValue('"brief"', 'brief', ' ')).toBe('"brief" is " ", which names no brief; give it a brief\'s id, or leave it out for the one SPEC_BRIEF or the branch names');
    expect(emptyValue('"paths[1]"', 'path', '')).toBe('"paths[1]" is "", which names no file; give it the path of a file');
  });

  it('is told from one that names something by what is left when the space around it is gone', () => {
    expect(['', ' ', '\t', '\n', ' \r\n '].map(isBlank)).toEqual([true, true, true, true, true]);
    expect(['a', ' a ', '0', '.'].map(isBlank)).toEqual([false, false, false, false]);
  });
});

describe('an argument that names nothing', () => {
  it('is refused with what it was given as, and what to do', () => {
    expect(refused(['guard', ''])).toBe('guard was given "" as a path, which names none; give it the paths the round would write');
    expect(refused(['guard', 'src/a.ts', ' '])).toBe('guard was given " " as a path, which names none; give it the paths the round would write');
    for (const command of ['context', 'rulings', 'audit', 'probe']) {
      expect(refused([command, ''])).toBe(`${command} was given "" as the brief, which names none; give it a brief's id, or leave it out for the one --brief, SPEC_BRIEF or the branch names`);
    }
    expect(refused(['rule', '', '--allow', '--note', 'n'])).toBe('rule was given "" as the escalation, which names none; give it an id, as spec-harness escalate --list prints them');
  });
});

describe('a --root that is no directory', () => {
  const only = (...directories: string[]) => (path: string) => directories.includes(path);

  it('is refused by name, a file or a path that is not there, for every command but Claude Code\'s hook', () => {
    const words = 'which is not a directory; give it one that exists, or leave it out to run in the current directory';
    expect(refused(['doctor', '--root', 'notes.txt'], only('adir'))).toBe(`--root is "notes.txt", ${words}`);
    for (const command of Object.keys(TAKES)) expect(refused([...line(command), '--root', 'nowhere'], only('adir')), command).toBe(`--root is "nowhere", ${words}`);
  });

  it('is not one that is there, and nothing is asked of the disk where no root is given', () => {
    expect(refused(['doctor', '--root', 'adir'], only('adir'))).toBeNull();
    const never = (): boolean => {
      throw new Error('asked');
    };
    expect(refused(['doctor'], never)).toBeNull();
    // An empty one is refused as naming nothing, before the disk is asked what it is.
    expect(refused(['doctor', '--root', ' '], never)).toMatch(/^--root is " ", which names no directory; /);
  });
});

describe('doctor', () => {
  it('is left to say an empty --brief or --base in its report, and no other empty value', () => {
    expect(refused(['doctor', '--brief', ''])).toBeNull();
    expect(refused(['doctor', '--base', ' '])).toBeNull();
    expect(refused(['doctor', '--brief', '', '--base', ''])).toBeNull();
    expect(refused(['doctor', '--root', ''])).toMatch(/^--root is "", which names no directory; /);
  });
});

describe("Claude Code's hook", () => {
  // The line is in the settings and the plugin of every release since 0.1.0,
  // and exit 2 from it holds every write of a session (ADR-0005).
  it('is read as every release has read it, whatever else is on its line', () => {
    for (const rest of [
      [],
      ['extra'],
      ['extra', 'more', ''],
      ['--strict', '--format', 'json'],
      ['--note', 'x', '--write', '--list', '--id', 'p'],
      ['--brief', ''],
      ['--base', ' '],
      ['--root', ''],
      ['--path', '', '--reason', ''],
    ]) {
      expect(refused(['hook', 'claude', ...rest], () => false), rest.join(' ')).toBeNull();
    }
  });

  it('is the one hook that is: git\'s is held to the rule', () => {
    expect(refused(['hook', 'git', 'extra'])).not.toBeNull();
    expect(refused(['hook', 'git', '--note', 'x'])).not.toBeNull();
    expect(refused(['hook', 'git', '--brief', ''])).toMatch(/^--brief is "", /);
    expect(refused(['hook', 'git', '--root', 'nowhere'], () => false)).toMatch(/^--root is "nowhere", which is not a directory; /);
    // And claude anywhere but first is an argument like any other.
    expect(refused(['hook', 'git', 'claude'])).toBe('hook takes one argument, "claude" or "git", not "git", "claude"');
    expect(refused(['guard', 'claude', '--note', 'x'])).toMatch(/^guard does not take --note; /);
  });
});
