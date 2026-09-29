import { describe, expect, it } from 'vitest';

import { readRules, renderContext, titleOf, type CitedDocument, type ContextInput } from '../../src/context.js';
import { decide } from '../../src/guard.js';
import { row } from './helpers.js';

const BRIEF_TEXT = '---\nstatus: active\n---\n\n# 012 - Rotate tokens\n\n## Intent\n\nRotate them.\n\n\n';

function input(overrides: Partial<ContextInput> = {}): ContextInput {
  return {
    brief: row({ wave: 2 }),
    briefText: BRIEF_TEXT,
    dependencies: [],
    cited: [],
    rules: [],
    rulings: [],
    branch: 'brief/012-rotate',
    base: 'origin/main',
    budget: 60_000,
    ...overrides,
  };
}

function doc(path: string, text: string | null, title: string | null = null, status: string | null = null, unclosedFrontMatter = false): CitedDocument {
  return { path, title, status, text, unclosedFrontMatter };
}

/** The characters one cited document takes in the packet. */
function blockLength(cited: CitedDocument): number {
  const heading = `### \`${cited.path}\`${cited.title === null ? '' : ` - ${cited.title}`}${cited.status === null ? '' : ` (${cited.status})`}`;
  return [heading, '', '````markdown', (cited.text ?? '').trimEnd(), '````', ''].join('\n').length;
}

/** The characters of the packet before any cited document. */
function fixedLength(base: ContextInput): number {
  return renderContext({ ...base, cited: [] }).markdown.length - '\n## Documents the brief cites\n\nNone.\n'.length;
}

function section(markdown: string, heading: string): string {
  const start = markdown.indexOf(`## ${heading}\n`);
  expect(start, heading).toBeGreaterThanOrEqual(0);
  const next = markdown.indexOf('\n## ', start + 1);
  return markdown.slice(start, next < 0 ? undefined : next + 1);
}

describe('the header', () => {
  it('names the round, its title without the id, and where it runs', () => {
    const { markdown } = renderContext(input());
    expect(markdown.split('\n').slice(0, 3)).toEqual(['# Round 012: Rotate tokens', '', 'Status active · wave 2 · branch `brief/012-rotate` · measured from `origin/main`']);
  });

  it('leaves out what is not known', () => {
    const { markdown } = renderContext(input({ brief: row({ title: null, status: null }), branch: null, base: null }));
    expect(markdown.split('\n').slice(0, 3)).toEqual(['# Round 012', '', 'Status unknown']);
  });

  it('takes off only the brief\'s own id, however it is written', () => {
    const title = (id: string, text: string): string | undefined => renderContext(input({ brief: row({ id, title: text }) })).markdown.split('\n')[0];
    expect(title('012', '12 - Rotate tokens')).toBe('# Round 012: Rotate tokens');
    expect(title('012', '  012  -  Rotate')).toBe('# Round 012: Rotate');
    // A title whose first word is not the id keeps it.
    expect(title('012', 'Fix - the login bug')).toBe('# Round 012: Fix - the login bug');
    expect(title('012', '013 - Another brief')).toBe('# Round 012: 013 - Another brief');
    expect(title('012', 'Rotate tokens - part 2')).toBe('# Round 012: Rotate tokens - part 2');
    expect(title('012', '012-Rotate')).toBe('# Round 012: 012-Rotate');
    // spec-brief new writes an em dash; an en dash and a colon are read the same way.
    expect(title('012', '012 \u2014 Rotate tokens')).toBe('# Round 012: Rotate tokens');
    expect(title('012', '012 \u2013 Rotate tokens')).toBe('# Round 012: Rotate tokens');
    expect(title('012', '012: Rotate tokens')).toBe('# Round 012: Rotate tokens');
    expect(title('012', '013 \u2014 Another brief')).toBe('# Round 012: 013 \u2014 Another brief');
    expect(title('012', 'ADR-012: Tokens')).toBe('# Round 012: ADR-012: Tokens');
    expect(title('012', '012:Rotate')).toBe('# Round 012: 012:Rotate');
    expect(title('012', '012 \u2014Rotate')).toBe('# Round 012: 012 \u2014Rotate');
    expect(title('012', '012 : Rotate')).toBe('# Round 012: 012 : Rotate');
    expect(titleOf({ id: '012', title: null })).toBeNull();
    expect(titleOf({ id: '012', title: '012 \u2014 Rotate tokens' })).toBe('Rotate tokens');
    // Only at the start: an id later in the title is part of it.
    expect(title('012', 'Part 012 - the rest')).toBe('# Round 012: Part 012 - the rest');
  });

  it('is its own block, followed by the contract', () => {
    expect(renderContext(input()).markdown.startsWith(
      '# Round 012: Rotate tokens\n\nStatus active · wave 2 · branch `brief/012-rotate` · measured from `origin/main`\n\n## The contract\n',
    )).toBe(true);
  });
});

describe('the contract and the scope', () => {
  it('carries the brief in full, as the contract, before the scope', () => {
    // A four-backtick fence, so a brief's own fenced blocks cannot close it.
    const { markdown } = renderContext(input());
    const contract = `## The contract\n\n\`briefs/012_rotate-tokens.md\`, in full:\n\n\`\`\`\`markdown\n${BRIEF_TEXT.trimEnd()}\n\`\`\`\`\n\n## Scope`;
    expect(markdown).toContain(contract);
  });

  it('lists the scope as the guard reads it, and the rulings in force', () => {
    const scope = section(
      renderContext(
        input({
          brief: row({ affectedFiles: ['src/auth/**', 'tests/**'], protectedFiles: ['src/db/schema.ts'] }),
          rulings: [
            { id: 'R-012-1', paths: ['src/db/schema.ts', 'migrations/1.sql'], signer: 'p@example.com' },
            { id: 'R-012-2', paths: ['docs/**'], signer: 'q@example.com' },
          ],
        }),
      ).markdown,
      'Scope, as the guard reads it',
    );
    expect(scope).toBe(
      [
        '## Scope, as the guard reads it',
        '',
        'May write:',
        '- `src/auth/**`',
        '- `tests/**`',
        '',
        'Must not change without a ruling:',
        '- `src/db/schema.ts`',
        '',
        'Rulings in force:',
        '- R-012-1, signed by p@example.com: `src/db/schema.ts`, `migrations/1.sql`',
        '- R-012-2, signed by q@example.com: `docs/**`',
        '',
        '',
      ].join('\n'),
    );
  });

  it('says so when the brief declares no scope and holds no ruling', () => {
    const scope = section(renderContext(input({ brief: row({ affectedFiles: [], protectedFiles: [] }) })).markdown, 'Scope, as the guard reads it');
    expect(scope).toContain('May write:\n- nothing declared: every write is outside the scope\n');
    expect(scope).toContain('Must not change without a ruling:\n- nothing declared\n');
    expect(scope).toContain('Rulings in force:\n- none\n');
  });

  it('names each pattern the guard cannot read, with spec-core\'s reason, and lists the rest as before', () => {
    // Malformed, too large to compile, and braces that expand to no path, among patterns the guard reads.
    const huge = `${'{a,b}'.repeat(8)}/${'x'.repeat(300)}`;
    const brief = row({ affectedFiles: ['src/auth/**', 'src/[a', huge, '{./,src}', 'tests/**'], protectedFiles: ['src/db/schema.ts'] });
    const packet = renderContext(input({ brief }));
    expect(section(packet.markdown, 'Scope, as the guard reads it')).toBe(
      [
        '## Scope, as the guard reads it',
        '',
        'May write:',
        '- `src/auth/**`',
        '- `src/[a`, which the guard cannot read: a "[" is never closed; it puts no path in the scope',
        `- \`${huge}\`, which the guard cannot read: the pattern compiles to more than 65536 states; it puts no path in the scope`,
        '- `{./,src}`, which the guard cannot read: the braces expand to "./", which names no path; it puts no path in the scope',
        '- `tests/**`',
        '',
        'Must not change without a ruling:',
        '- `src/db/schema.ts`',
        '',
        'Rulings in force:',
        '- none',
        '',
        '',
      ].join('\n'),
    );
    expect(packet.unreadableScope).toEqual([
      { pattern: 'src/[a', reason: 'a "[" is never closed' },
      { pattern: huge, reason: 'the pattern compiles to more than 65536 states' },
      { pattern: '{./,src}', reason: 'the braces expand to "./", which names no path' },
    ]);
    // Each is a pattern the guard passes over, and names with the same reason.
    const outside = decide({ path: 'README.md', given: 'README.md', brief, rulings: [], outOfScope: 'warn' });
    expect(outside.because).toEqual(packet.unreadableScope.map(({ pattern, reason }) => `${pattern} (${reason})`));
  });

  it('names each protection the guard cannot read, with spec-core\'s reason and that every write is refused until it is fixed', () => {
    const huge = `${'{a,b}'.repeat(8)}/${'x'.repeat(300)}`;
    const brief = row({ affectedFiles: ['src/auth/**'], protectedFiles: ['src/db/**', 'src/[a', huge, '{./,src}', 'migrations/*.sql'] });
    const packet = renderContext(input({ brief, rulings: [{ id: 'R-012-1', paths: ['src/db/schema.ts'], signer: 'p@example.com' }] }));
    const refused = 'until it is fixed, the guard refuses every write but to the brief';
    expect(section(packet.markdown, 'Scope, as the guard reads it')).toBe(
      [
        '## Scope, as the guard reads it',
        '',
        'May write:',
        '- `src/auth/**`',
        '',
        'Must not change without a ruling:',
        '- `src/db/**`',
        `- \`src/[a\`, which the guard cannot read: a "[" is never closed; ${refused}`,
        `- \`${huge}\`, which the guard cannot read: the pattern compiles to more than 65536 states; ${refused}`,
        `- \`{./,src}\`, which the guard cannot read: the braces expand to "./", which names no path; ${refused}`,
        '- `migrations/*.sql`',
        '',
        'Rulings in force:',
        '- R-012-1, signed by p@example.com: `src/db/schema.ts`',
        '',
        '',
      ].join('\n'),
    );
    expect(packet.unreadableProtections).toEqual([
      { pattern: 'src/[a', reason: 'a "[" is never closed' },
      { pattern: huge, reason: 'the pattern compiles to more than 65536 states' },
      { pattern: '{./,src}', reason: 'the braces expand to "./", which names no path' },
    ]);
    // Neither the scope nor the ruling is named for a protection the guard cannot read.
    expect(packet.unreadableScope).toEqual([]);
    expect(packet.unreadableRulingPaths).toEqual([]);
    // The guard refuses a write in the scope and one the ruling allows, naming each with the same reason, and lets a write to the brief through.
    const rulings = [{ id: 'R-012-1', paths: ['src/db/schema.ts'], signer: 'p@example.com' }];
    for (const path of ['src/auth/a.ts', 'src/db/schema.ts']) {
      const decision = decide({ path, given: path, brief, rulings, outOfScope: 'warn' });
      expect(decision).toMatchObject({ verdict: 'deny', reason: 'unreadable-protection' });
      expect(decision.because).toEqual(packet.unreadableProtections.map(({ pattern, reason }) => `${pattern} (${reason})`));
    }
    expect(decide({ path: brief.file, given: brief.file, brief, rulings, outOfScope: 'deny' }).verdict).toBe('allow');
  });

  it('names each path of a ruling the guard cannot read, with spec-core\'s reason and that it allows nothing', () => {
    const huge = `${'{a,b}'.repeat(8)}/${'x'.repeat(300)}`;
    const rulings = [
      { id: 'R-012-1', paths: ['src/db/schema.ts', 'src/db/[a', huge], signer: 'p@example.com' },
      { id: 'R-012-2', paths: ['{./,src}'], signer: 'q@example.com' },
      { id: 'R-012-3', paths: ['docs/**', 'migrations/*.sql'], signer: 'p@example.com' },
    ];
    const brief = row({ affectedFiles: ['src/auth/**'], protectedFiles: ['src/**', 'migrations/**'] });
    const packet = renderContext(input({ brief, rulings }));
    expect(section(packet.markdown, 'Scope, as the guard reads it')).toContain(
      [
        'Rulings in force:',
        '- R-012-1, signed by p@example.com: `src/db/schema.ts`, `src/db/[a` (which the guard cannot read: a "[" is never closed; it allows nothing), ' +
          `\`${huge}\` (which the guard cannot read: the pattern compiles to more than 65536 states; it allows nothing)`,
        '- R-012-2, signed by q@example.com: `{./,src}` (which the guard cannot read: the braces expand to "./", which names no path; it allows nothing)',
        '- R-012-3, signed by p@example.com: `docs/**`, `migrations/*.sql`',
        '',
        '',
      ].join('\n'),
    );
    expect(packet.unreadableRulingPaths).toEqual([
      { ruling: 'R-012-1', pattern: 'src/db/[a', reason: 'a "[" is never closed' },
      { ruling: 'R-012-1', pattern: huge, reason: 'the pattern compiles to more than 65536 states' },
      { ruling: 'R-012-2', pattern: '{./,src}', reason: 'the braces expand to "./", which names no path' },
    ]);
    expect(packet.unreadableScope).toEqual([]);
    expect(packet.unreadableProtections).toEqual([]);
    // The guard passes over each: a protected path it names stays refused, and the ruling's readable path still allows.
    const decision = (path: string) => decide({ path, given: path, brief, rulings, outOfScope: 'warn' });
    for (const path of ['src/db/[a', 'src/a.ts', 'src/db/other.ts']) expect(decision(path), path).toMatchObject({ verdict: 'deny', reason: 'protected' });
    expect(decision('src/db/schema.ts')).toMatchObject({ verdict: 'allow', reason: 'ruled', because: ['R-012-1'] });
    expect(decision('migrations/1.sql')).toMatchObject({ verdict: 'allow', reason: 'ruled', because: ['R-012-3'] });
  });

  it('lists a pattern the guard can read as written, however it looks', () => {
    // A lone brace is a literal, a slash inside braces is a directory's contents, and ./ under a directory is what it holds.
    const patterns = ['}', '{src/,docs/*.md}', 'src/{./,a}', '[!a]*', 'src'];
    const packet = renderContext(
      input({ brief: row({ affectedFiles: patterns, protectedFiles: patterns }), rulings: [{ id: 'R-012-1', paths: patterns, signer: 'p@example.com' }] }),
    );
    expect(packet).toMatchObject({ unreadableScope: [], unreadableProtections: [], unreadableRulingPaths: [] });
    const lines = patterns.map((pattern) => `- \`${pattern}\``).join('\n');
    const scope = section(packet.markdown, 'Scope, as the guard reads it');
    expect(scope).toContain(`May write:\n${lines}\n\n`);
    expect(scope).toContain(`Must not change without a ruling:\n${lines}\n\n`);
    expect(scope).toContain(`Rulings in force:\n- R-012-1, signed by p@example.com: ${patterns.map((pattern) => `\`${pattern}\``).join(', ')}\n`);
    expect(packet.markdown).not.toContain('cannot read');
  });
});

describe('dependencies', () => {
  it('says whether each is done', () => {
    const dependencies = [
      row({ id: '007', title: '007 - Tokens', phase: 'archived', status: 'archived' }),
      row({ id: '008', title: null, status: 'draft' }),
      row({ id: '009', title: 'Nine', status: null }),
    ];
    const text = section(renderContext(input({ dependencies })).markdown, 'Depends on');
    // Each title without the id it repeats, as the round's own.
    expect(text).toBe('## Depends on\n\n- 007 Tokens: archived, done\n- 008: still draft\n- 009 Nine: still live\n\n');
  });

  it('says nothing is waited on when nothing is', () => {
    expect(section(renderContext(input()).markdown, 'Depends on')).toBe('## Depends on\n\n- nothing\n\n');
  });
});

describe('the rules in force', () => {
  it('groups the rules by the document that states them', () => {
    const rules = [
      { document: 'docs/adr/0001.md', line: 5, kind: 'assert-absence', description: '"Legacy" must not appear in src', reason: 'it is gone' },
      { document: 'docs/adr/0002.md', line: 9, kind: 'assert-layers', description: 'layers point inward', reason: null },
      { document: 'docs/adr/0001.md', line: 12, kind: 'assert-count', description: 'one session manager', reason: null },
    ];
    expect(section(renderContext(input({ rules })).markdown, 'Rules in force for this scope')).toBe(
      [
        '## Rules in force for this scope',
        '',
        '### docs/adr/0001.md',
        '',
        '- line 5: "Legacy" must not appear in src - it is gone',
        '- line 12: one session manager',
        '',
        '### docs/adr/0002.md',
        '',
        '- line 9: layers point inward',
        '',
        '',
      ].join('\n'),
    );
  });

  it('tells an empty answer from one that could not be had', () => {
    expect(section(renderContext(input({ rules: [] })).markdown, 'Rules in force for this scope')).toContain('spec-guard holds no rule over this scope.');
    const unavailable = section(renderContext(input({ rules: { unavailable: 'spec-guard is not installed here' } })).markdown, 'Rules in force for this scope');
    expect(unavailable).toContain(
      'The rules spec-guard holds this code to could not be read: spec-guard is not installed here. Treat every ADR as binding until they can.',
    );
    expect(unavailable).not.toContain('holds no rule');
    const none = section(renderContext(input({ rules: { none: 'no spec file matched its patterns' } })).markdown, 'Rules in force for this scope');
    expect(none).toBe('## Rules in force for this scope\n\nspec-guard holds no rule over this scope: no spec file matched its patterns.\n\n');
  });

  it('says the scope could not be read when no pattern in it can be, rather than that spec-guard holds no rule', () => {
    // spec-guard is asked about no path for such a scope, so its answer is empty whatever rules are in force.
    const packet = renderContext(input({ brief: row({ affectedFiles: ['src/[a', '{./,src}'] }), rules: [] }));
    expect(section(packet.markdown, 'Rules in force for this scope')).toBe(
      '## Rules in force for this scope\n\nThe scope could not be read: no pattern in `affectedFiles` can be read, so spec-guard was not asked for the rules over it. Treat every ADR as binding until the scope is fixed.\n\n',
    );
    expect(packet.unreadableScope.map(({ pattern }) => pattern)).toEqual(['src/[a', '{./,src}']);
  });

  it('says spec-guard holds no rule when the scope declares nothing, or a pattern in it can be read', () => {
    const rules = (affectedFiles: string[]): string => section(renderContext(input({ brief: row({ affectedFiles }), rules: [] })).markdown, 'Rules in force for this scope');
    for (const affectedFiles of [[], ['src/**'], ['src/[a', 'src/**'], ['src/**', '{./,src}']]) {
      expect(rules(affectedFiles), affectedFiles.join(' ')).toBe('## Rules in force for this scope\n\nspec-guard holds no rule over this scope.\n\n');
    }
  });

  it('reads spec-guard\'s query, the rules in force once each', () => {
    const rule = (document: string, line: number, extra: Record<string, unknown> = {}) => ({ document, line, kind: 'assert-absence', description: `d${line}`, ...extra });
    const document = {
      specFiles: ['docs/adr/0001.md'],
      results: [
        { path: 'src/auth', rules: [rule('docs/adr/0001.md', 5, { reason: 'gone' }), rule('docs/adr/0001.md', 9, { inForce: false })] },
        { path: 'src/db', rules: [rule('docs/adr/0001.md', 5, { reason: 'gone' }), rule('docs/adr/0002.md', 5, { inForce: true, reason: null })] },
        { path: 'src/none' },
      ],
    };
    expect(readRules({ code: 0, document, stderr: '' })).toEqual([
      { document: 'docs/adr/0001.md', line: 5, kind: 'assert-absence', description: 'd5', reason: 'gone' },
      { document: 'docs/adr/0002.md', line: 5, kind: 'assert-absence', description: 'd5', reason: null },
    ]);
    expect(readRules({ code: 0, document: {}, stderr: '' })).toEqual([]);
    expect(readRules({ code: 0, document: null, stderr: '' })).toEqual([]);
  });

  it('tells a repository whose patterns match no spec from specs that could not be read', () => {
    const none = { none: 'no spec file matched its patterns ("specs" in its configuration, docs/**/*.md by default)' };
    expect(readRules({ code: 2, document: { specFiles: [], results: [{ path: 'src', rules: [] }] }, stderr: '' })).toEqual(none);
    expect(readRules({ code: 2, document: { specFiles: ['docs/a.md'] }, stderr: 'spec-guard: docs/a.md: a directive cannot be read\nmore\n' })).toEqual({
      unavailable: 'spec-guard exited 2: docs/a.md: a directive cannot be read',
    });
    expect(readRules({ code: 2, document: {}, stderr: '  \n' })).toEqual({ unavailable: 'spec-guard exited 2' });
    expect(readRules({ code: -1, document: { specFiles: 'none' }, stderr: 'killed' })).toEqual({ unavailable: 'spec-guard exited -1: killed' });
  });

  it('tells the agent how the round works: guard, escalate, dispositions, audit', () => {
    // The one part of the packet that is workflow rather than fact; the agent reads it as written.
    expect(section(renderContext(input()).markdown, 'How this round works')).toBe(
      [
        '## How this round works',
        '',
        '- Before writing a file, ask whether the round may: `spec-harness guard <path>`, or the `check_path` tool.',
        '- A protected file is changed only under a ruling a person signs. If the round cannot be done without one, stop and ask: `spec-harness escalate --path <file> --reason <why>`, or the `request_escalation` tool. Do not work around it.',
        '- Every box in the brief ends ticked, or with a note under it that starts with a disposition (`**Delegated`, `**Accepted debt`, `**Rejected`, or what the repository configures).',
        "- When the work is done, run `spec-harness audit` and fix what it reports. The archive is a person's decision, not the round's.",
        '',
        '',
      ].join('\n'),
    );
  });
});

describe('the cited documents and the budget', () => {
  it('includes cited documents whole, in the order the brief cites them, with title and status', () => {
    const packet = renderContext(input({ cited: [doc('docs/b.md', '# B\n\nbody b\n\n', 'B', 'accepted'), doc('docs/a.md', 'body a')] }));
    expect(packet.included).toEqual(['docs/b.md', 'docs/a.md']);
    expect(packet.omitted).toEqual([]);
    expect(packet.unresolved).toEqual([]);
    expect(packet.unclosedFrontMatter).toEqual([]);
    expect(section(packet.markdown, 'Documents the brief cites')).toBe(
      '## Documents the brief cites\n\n### `docs/b.md` - B (accepted)\n\n````markdown\n# B\n\nbody b\n````\n\n### `docs/a.md`\n\n````markdown\nbody a\n````\n',
    );
  });

  it('says None when the brief cites nothing', () => {
    const packet = renderContext(input());
    expect(packet.markdown.endsWith('## Documents the brief cites\n\nNone.\n')).toBe(true);
    expect(packet).toMatchObject({ included: [], omitted: [], unresolved: [], unclosedFrontMatter: [], unreadableScope: [], unreadableProtections: [], unreadableRulingPaths: [] });
  });

  it('fills the budget exactly, and names a document that would pass it', () => {
    const a = doc('docs/a.md', 'a'.repeat(100));
    const b = doc('docs/b.md', 'b'.repeat(100));
    const exact = fixedLength(input()) + blockLength(a);
    expect(renderContext(input({ cited: [a, b], budget: exact })).included).toEqual(['docs/a.md']);
    const short = renderContext(input({ cited: [a, b], budget: exact - 1 }));
    expect(short).toMatchObject({ included: [], omitted: ['docs/a.md', 'docs/b.md'] });
    expect(section(short.markdown, 'Documents the brief cites')).toBe(
      `## Documents the brief cites\n\nLeft out to stay within ${exact - 1} characters; read them when the work reaches them:\n- \`docs/a.md\`\n- \`docs/b.md\`\n`,
    );
  });

  it('leaves out a document too large and still includes a later one that fits', () => {
    const large = doc('docs/large.md', 'x'.repeat(5000));
    const small = doc('docs/small.md', 'y');
    const budget = fixedLength(input()) + blockLength(small) + 10;
    const packet = renderContext(input({ cited: [large, small], budget }));
    expect(packet.included).toEqual(['docs/small.md']);
    expect(packet.omitted).toEqual(['docs/large.md']);
    expect(packet.markdown).toContain('### `docs/small.md`');
    expect(packet.markdown).not.toContain('x'.repeat(100));
  });

  it('never leaves out the contract, however small the budget', () => {
    const packet = renderContext(input({ budget: 1, cited: [doc('docs/a.md', 'a')] }));
    expect(packet.markdown).toContain(BRIEF_TEXT.trimEnd());
    expect(packet.omitted).toEqual(['docs/a.md']);
  });

  it('says only what is missing when every citation is missing', () => {
    const packet = renderContext(input({ cited: [doc('docs/gone.md', null)] }));
    expect(packet.markdown.endsWith('## Documents the brief cites\n\nCited but not found in the repository:\n- `docs/gone.md`\n')).toBe(true);
  });

  it('names a citation that resolves to nothing, apart from the budget', () => {
    const packet = renderContext(input({ cited: [doc('docs/gone.md', null), doc('docs/a.md', 'a')], budget: fixedLength(input()) }));
    expect(packet).toMatchObject({ included: [], omitted: ['docs/a.md'], unresolved: ['docs/gone.md'] });
    expect(packet.markdown.endsWith('- `docs/a.md`\n\nCited but not found in the repository:\n- `docs/gone.md`\n')).toBe(true);
    expect(packet.markdown).not.toContain('None.');
  });

  it('names a document whose front matter is never closed: its status was not read, and closing the block is the fix', () => {
    const adr = doc('docs/adr/0003.md', '---\nstatus: accepted\n\n# Tokens\n', 'Tokens', null, true);
    const packet = renderContext(input({ cited: [adr, doc('docs/a.md', 'a', 'A', 'draft')] }));
    // Still included whole: the note is about the status, and fails nothing.
    expect(packet).toMatchObject({ included: ['docs/adr/0003.md', 'docs/a.md'], omitted: [], unresolved: [], unclosedFrontMatter: ['docs/adr/0003.md'] });
    expect(section(packet.markdown, 'Documents the brief cites')).toBe(
      [
        '## Documents the brief cites',
        '',
        '### `docs/adr/0003.md` - Tokens',
        '',
        '````markdown',
        '---',
        'status: accepted',
        '',
        '# Tokens',
        '````',
        '',
        '### `docs/a.md` - A (draft)',
        '',
        '````markdown',
        'a',
        '````',
        '',
        'Front matter opened on line 1 and never closed, so the status was not read; close the block with `---` on a line of its own:',
        '- `docs/adr/0003.md`',
        '',
      ].join('\n'),
    );
  });

  it('names a document whose front matter is never closed when the budget leaves it out, and after every other note', () => {
    const adr = doc('docs/adr/0003.md', '---\nstatus: accepted\n', null, null, true);
    const packet = renderContext(input({ cited: [doc('docs/gone.md', null), adr], budget: fixedLength(input()) }));
    expect(packet).toMatchObject({ included: [], omitted: ['docs/adr/0003.md'], unresolved: ['docs/gone.md'], unclosedFrontMatter: ['docs/adr/0003.md'] });
    expect(packet.markdown.endsWith(
      '- `docs/gone.md`\n\nFront matter opened on line 1 and never closed, so the status was not read; close the block with `---` on a line of its own:\n- `docs/adr/0003.md`\n',
    )).toBe(true);
  });

  it('says nothing of front matter when every cited document\'s closes or there is none', () => {
    const packet = renderContext(input({ cited: [doc('docs/a.md', '---\nstatus: draft\n---\n\n# A\n', 'A', 'draft'), doc('docs/b.md', '# B\n', 'B')] }));
    expect(packet.unclosedFrontMatter).toEqual([]);
    expect(packet.markdown).not.toContain('never closed');
  });
});
