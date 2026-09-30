import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { brief, BRIEF_FILE, cleanup, cli, parsed, repository, SPEC_BRIEF, type Repository } from './helpers.js';

afterAll(cleanup);

const ADR = '---\nstatus: accepted\n---\n\n# ADR-0001: Sessions\n\nNo legacy gateway.\n\n<!-- @assert-absence target="src/auth" symbol="LegacyGateway" reason="the gateway is gone" -->\n';

let repo: Repository;

beforeAll(() => {
  repo = repository({
    [BRIEF_FILE]: brief({
      affected: ['src/auth/**'],
      protected: ['src/db/schema.ts'],
      dependsOn: ['2', '3', '9'],
      body: [
        '## Context',
        '',
        'See [the design](../docs/design.md), [the ADR](../docs/adr/0001-sessions.md#decision), [a missing note](../docs/gone.md),',
        '[the code](../src/auth/a.ts), [the directory](../src/auth/), [the site](https://example.com), [itself](001_rotate-tokens.md)',
        'and [the design again](../docs/design.md).',
        '',
      ].join('\n'),
    }),
    'briefs/002_live.md': brief({ title: '002 - Still going', status: 'draft' }),
    'briefs/archive/003_done.md': brief({ title: '003 - Done', status: 'archived' }),
    'docs/design.md': '---\nstatus: draft\n---\n\n# The design\n\nTokens rotate.\n',
    'docs/adr/0001-sessions.md': ADR,
    'src/auth/a.ts': 'a;\n',
    'src/db/schema.ts': 'table;\n',
  });
  repo.git('checkout', '-q', '-b', 'brief/001-rotate');
});

describe('context', () => {
  it('gives the contract, the scope, the dependencies, the rules and the cited documents', async () => {
    const result = await cli(['context'], repo.root);
    expect(result.code).toBe(0);
    const text = result.stdout;
    expect(text.startsWith('# Round 001: Rotate tokens\n\nStatus active · branch `brief/001-rotate` · measured from `main`\n')).toBe(true);
    expect(text).toContain(`\`${BRIEF_FILE}\`, in full:`);
    expect(text).toContain('Rotate the session token on every privilege change.');
    expect(text).toContain('May write:\n- `src/auth/**`\n');
    expect(text).toContain('Must not change without a ruling:\n- `src/db/schema.ts`\n');
    expect(text).toContain('Rulings in force:\n- none\n');
    // spec-brief reports dependencies as the front matter spells them; 2 is brief 002.
    expect(text).toContain('## Depends on\n\n- 002 Still going: still draft\n- 003 Done: archived, done\n- 9 (no such brief): still unknown\n');
    expect(text).toContain('### docs/adr/0001-sessions.md\n\n- line 9: "LegacyGateway" must not appear in src/auth - the gateway is gone');
    expect(text).toContain('### `docs/design.md` - The design (draft)\n\n````markdown\n---\nstatus: draft\n---\n\n# The design\n\nTokens rotate.\n````');
    expect(text).toContain('### `docs/adr/0001-sessions.md` - ADR-0001: Sessions (accepted)');
    expect(text).toContain('Cited but not found in the repository:\n- `docs/gone.md`\n');
    expect(text).not.toContain('`src/auth/a.ts`\n\n````');
    expect(text.endsWith('\n')).toBe(true);
  });

  it('reports what it included, left out and could not find, in JSON', async () => {
    const result = await cli(['context', '--format', 'json'], repo.root);
    expect(result.code).toBe(0);
    const packet = parsed<{ command: string; brief: string; markdown: string; included: string[]; omitted: string[]; unresolved: string[] }>(result);
    expect(packet).toMatchObject({
      command: 'context',
      brief: '001',
      included: ['docs/design.md', 'docs/adr/0001-sessions.md'],
      omitted: [],
      // A link to code or a directory is not a document, and is not missing either.
      unresolved: ['docs/gone.md'],
      unreadableScope: [],
      unreadableProtections: [],
      unreadableRulingPaths: [],
    });
  });

  it('names a brief by its positional id, over the branch', async () => {
    const result = await cli(['context', '2', '--format', 'json'], repo.root);
    expect(parsed<{ brief: string }>(result).brief).toBe('002');
  });

  it('names the documents the budget leaves out', async () => {
    const small = repository({ [BRIEF_FILE]: brief({ body: 'See [a](../docs/a.md).\n' }), 'docs/a.md': '# A\n\ntext\n' }, { context: { budget: 100 } });
    const result = await cli(['context', '1', '--format', 'json'], small.root);
    expect(parsed<{ included: string[]; omitted: string[] }>(result)).toMatchObject({ included: [], omitted: ['docs/a.md'] });
    expect(parsed<{ markdown: string }>(result).markdown).toContain('Left out to stay within 100 characters');
  });

  it('includes the document a badge links to, and not the badge', async () => {
    // The image is missing on purpose: taken for a cited document, it would
    // show as a link that resolves to nothing.
    const badged = repository({ [BRIEF_FILE]: brief({ body: 'See [![b](img/x.png)](../docs/a.md).\n' }), 'docs/a.md': '# A\n\ntext\n' });
    const result = await cli(['context', '1', '--format', 'json'], badged.root);
    expect(result.code).toBe(0);
    const packet = parsed<{ markdown: string; included: string[]; omitted: string[]; unresolved: string[] }>(result);
    expect(packet).toMatchObject({ included: ['docs/a.md'], omitted: [], unresolved: [] });
    expect(packet.markdown).toContain('### `docs/a.md` - A\n');
    expect(packet.markdown).not.toContain('`briefs/img/x.png`');
  });

  it('says the rules could not be read when spec-guard is not there, rather than that there are none', async () => {
    const bare = repository({ [BRIEF_FILE]: brief({ affected: ['src/**'] }) }, { tools: { 'spec-brief': ['node', SPEC_BRIEF] } });
    const result = await cli(['context', '1'], bare.root);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('The rules spec-guard holds this code to could not be read: spec-guard is not installed here');
  });

  it('says spec-guard holds no rule when no spec file matches its patterns, rather than that it failed', async () => {
    const nodocs = repository({ [BRIEF_FILE]: brief({ affected: ['src/**'] }) });
    const result = await cli(['context', '1'], nodocs.root);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(
      '## Rules in force for this scope\n\nspec-guard holds no rule over this scope: no spec file matched its patterns ("specs" in its configuration, docs/**/*.md by default).\n',
    );
    expect(result.stdout).not.toContain('Treat every ADR as binding');
    const unscoped = repository({ [BRIEF_FILE]: brief() });
    expect((await cli(['context', '1'], unscoped.root)).stdout).toContain('spec-guard holds no rule over this scope.');
  });

  it('asks spec-guard about the directory a trailing slash inside braces names, and not the whole repository', async () => {
    const adr = `${ADR}\n<!-- @assert-absence target="lib" symbol="OldLib" reason="lib is frozen" -->\n`;
    const braces = repository({
      [BRIEF_FILE]: brief({ affected: ['"{src/,docs/*.md}"'] }),
      'docs/adr/0001-sessions.md': adr,
      'src/auth/a.ts': 'a;\n',
      'lib/b.ts': 'b;\n',
    });
    const result = await cli(['context', '1'], braces.root);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('### docs/adr/0001-sessions.md\n\n- line 9: "LegacyGateway" must not appear in src/auth - the gateway is gone\n');
    expect(result.stdout).not.toContain('lib is frozen');
  });

  it('keeps the rules over the rest of the scope when a pattern in it is rooted, alone or on a brace alternative', async () => {
    // spec-guard refuses a path outside the repository, and with it the
    // whole question: asked about /docs beside src, it answered for neither.
    // A rooted base puts no path in the scope, and is not asked about.
    const rooted = repository({
      'briefs/001_braced.md': brief({ title: '001 - Braced', affected: ['"{/docs,src/**}"'] }),
      'briefs/002_alone.md': brief({ title: '002 - Alone', affected: ['/docs', 'src/**'] }),
      'docs/adr/0001-sessions.md': ADR,
      'src/auth/a.ts': 'a;\n',
    });
    const rules = async (id: string): Promise<string> => {
      const result = await cli(['context', id], rooted.root);
      expect(result.code).toBe(0);
      const text = result.stdout;
      return text.slice(text.indexOf('## Rules in force for this scope'), text.indexOf('## How this round works'));
    };
    const braced = await rules('1');
    expect(braced).toBe(await rules('2'));
    expect(braced).not.toContain('outside the root');
    expect(braced).toContain('### docs/adr/0001-sessions.md\n\n- line 9: "LegacyGateway" must not appear in src/auth - the gateway is gone\n');
    const scope = (await cli(['context', '1'], rooted.root)).stdout;
    expect(scope).toContain(
      "May write:\n- `{/docs,src/**}`, an alternative of which a leading `/` roots at the filesystem's root: that alternative puts no path in the scope, and spec-guard is not asked about it\n",
    );
    expect((await cli(['context', '2'], rooted.root)).stdout).toContain(
      "May write:\n- `/docs`, which a leading `/` roots at the filesystem's root: it puts no path in the scope, and spec-guard is not asked about it\n- `src/**`\n",
    );
    // Nothing in the scope but a rooted pattern: spec-guard is asked nothing, and the packet says so.
    rooted.write('briefs/003_only.md', brief({ title: '003 - Only', affected: ['/docs'] }));
    expect(await rules('3')).toContain('No pattern in `affectedFiles` puts a path in the scope: each is rooted at the filesystem');
    const decisions = async (id: string): Promise<string[][]> => {
      const result = await cli(['guard', '--brief', id, 'docs/adr/0001-sessions.md', 'src/auth/a.ts', '--format', 'json'], rooted.root);
      return parsed<{ decisions: { path: string; reason: string }[] }>(result).decisions.map((d) => [d.path, d.reason]);
    };
    expect(await decisions('1')).toEqual([
      ['docs/adr/0001-sessions.md', 'out-of-scope'],
      ['src/auth/a.ts', 'in-scope'],
    ]);
    expect(await decisions('2')).toEqual(await decisions('1'));
  });

  describe('asks spec-guard about a name with no glob syntax as it is on disk', () => {
    // One rule per place a question can reach: the scope's own code, a file
    // beside the one named, a directory not yet created, and code outside.
    const rules = [
      '<!-- @assert-absence target="src/auth" symbol="LegacyGateway" reason="the gateway is gone" -->',
      '<!-- @assert-absence target="src/auth/b.ts" symbol="Bee" reason="b is sealed" -->',
      '<!-- @assert-absence target="src/feature/impl" symbol="Imp" reason="the feature stays pure" -->',
      '<!-- @assert-absence target="lib" symbol="OldLib" reason="lib is frozen" -->',
    ];
    let named: Repository;
    const scope = async (id: string): Promise<string> => {
      const result = await cli(['context', id], named.root);
      expect(result.code).toBe(0);
      return result.stdout.slice(result.stdout.indexOf('## Rules in force for this scope'));
    };

    beforeAll(() => {
      named = repository({
        'briefs/001_directory.md': brief({ title: '001 - A directory', affected: ['src'] }),
        'briefs/002_file.md': brief({ title: '002 - A file', affected: ['src/auth/a.ts'] }),
        'briefs/003_new-directory.md': brief({ title: '003 - Not yet created', affected: ['src/feature'] }),
        'briefs/004_new-top.md': brief({ title: '004 - Not yet created, at the top', affected: ['tools'] }),
        // Quoted, or YAML reads the braces as a mapping.
        'briefs/005_no-path.md': brief({ title: '005 - Braces that expand to no path', affected: ['"{./,lib}"', 'src/auth/a.ts'] }),
        'docs/adr/0001-rules.md': `---\nstatus: accepted\n---\n\n# ADR-0001: Rules\n\n${rules.join('\n')}\n`,
        'src/auth/a.ts': 'a;\n',
        'src/auth/b.ts': 'b;\n',
        'lib/b.ts': 'b;\n',
      });
    });

    it('asks about a directory that exists, and not the whole repository', async () => {
      const text = await scope('1');
      for (const reason of ['the gateway is gone', 'b is sealed', 'the feature stays pure']) expect(text).toContain(reason);
      expect(text).not.toContain('lib is frozen');
    });

    it('asks about a file that exists, and not the directory holding it', async () => {
      const text = await scope('2');
      expect(text).toContain('the gateway is gone');
      expect(text).not.toContain('b is sealed');
      expect(text).not.toContain('lib is frozen');
    });

    it('asks about a name not yet created through the directory that will hold it, which covers it as a directory too', async () => {
      const text = await scope('3');
      // Asked about as itself, spec-guard would read src/feature as a file and leave this out.
      expect(text).toContain('the feature stays pure');
      expect(text).not.toContain('lib is frozen');
      // At the top, that directory is the root, as before.
      expect(await scope('4')).toContain('lib is frozen');
    });

    it('asks nothing about a pattern spec-core refuses, and about the rest of the scope as before', async () => {
      // {./,lib} read as ./ or lib, and ./ as the root's contents, asked about the whole repository.
      const text = await scope('5');
      expect(text).toContain('the gateway is gone');
      for (const reason of ['b is sealed', 'the feature stays pure', 'lib is frozen']) expect(text).not.toContain(reason);
    });

    it('leaves what the guard allows as it was: the name as a file or as a directory', async () => {
      const result = await cli(['guard', '--brief', '1', 'src', 'src/auth/a.ts', 'lib/b.ts', '--format', 'json'], named.root);
      expect(parsed<{ decisions: { path: string; reason: string }[] }>(result).decisions.map((d) => [d.path, d.reason])).toEqual([
        ['src', 'in-scope'],
        ['src/auth/a.ts', 'in-scope'],
        ['lib/b.ts', 'out-of-scope'],
      ]);
    });
  });

  describe('names a pattern in the scope or a protection the guard cannot read', () => {
    const huge = `${'{a,b}'.repeat(8)}/${'x'.repeat(300)}`;
    let unread: Repository;

    beforeAll(() => {
      unread = repository({
        // Quoted, or YAML reads the brackets and braces as its own.
        'briefs/001_mixed.md': brief({ title: '001 - Some readable', affected: ['src/auth/**', '"src/[a"', `"${huge}"`, '"{./,lib}"'] }),
        'briefs/002_none.md': brief({ title: '002 - None readable', affected: ['"src/[a"', '"{./,lib}"'] }),
        'briefs/003_protections.md': brief({ title: '003 - Protections', affected: ['src/auth/**'], protected: ['lib/**', '"src/[a"', `"${huge}"`, '"{./,lib}"'] }),
        'docs/adr/0001-sessions.md': `${ADR}\n<!-- @assert-absence target="lib" symbol="OldLib" reason="lib is frozen" -->\n`,
        'src/auth/a.ts': 'a;\n',
        'lib/b.ts': 'b;\n',
      });
    });

    it('with spec-core\'s reason, in the packet and in JSON, and asks spec-guard about the rest of the scope', async () => {
      const result = await cli(['context', '1', '--format', 'json'], unread.root);
      expect(result.code).toBe(0);
      const packet = parsed<{ markdown: string; unreadableScope: { pattern: string; reason: string }[] }>(result);
      expect(packet.unreadableScope).toEqual([
        { pattern: 'src/[a', reason: 'a "[" is never closed' },
        { pattern: huge, reason: 'the pattern compiles to more than 65536 states' },
        { pattern: '{./,lib}', reason: 'the braces expand to "./", which names no path' },
      ]);
      expect(packet.markdown).toContain(
        [
          'May write:',
          '- `src/auth/**`',
          '- `src/[a`, which the guard cannot read: a "[" is never closed; it puts no path in the scope',
          `- \`${huge}\`, which the guard cannot read: the pattern compiles to more than 65536 states; it puts no path in the scope`,
          '- `{./,lib}`, which the guard cannot read: the braces expand to "./", which names no path; it puts no path in the scope',
          '',
        ].join('\n'),
      );
      expect(packet.markdown).toContain('### docs/adr/0001-sessions.md\n\n- line 9: "LegacyGateway" must not appear in src/auth - the gateway is gone\n');
      expect(packet.markdown).not.toContain('lib is frozen');
      expect(packet.markdown).not.toContain('The scope could not be read');
    });

    it('says the scope could not be read when no pattern in it can be, rather than that spec-guard holds no rule over it', async () => {
      const result = await cli(['context', '2', '--format', 'json'], unread.root);
      expect(result.code).toBe(0);
      const packet = parsed<{ markdown: string; unreadableScope: { pattern: string }[] }>(result);
      expect(packet.unreadableScope.map(({ pattern }) => pattern)).toEqual(['src/[a', '{./,lib}']);
      expect(packet.markdown).toContain(
        '## Rules in force for this scope\n\nThe scope could not be read: no pattern in `affectedFiles` can be read, so spec-guard was not asked for the rules over it. Treat every ADR as binding until the scope is fixed.\n',
      );
      expect(packet.markdown).not.toContain('holds no rule');
    });

    it('names each protection it cannot read, with spec-core\'s reason and that the guard refuses every write until it is fixed', async () => {
      const result = await cli(['context', '3', '--format', 'json'], unread.root);
      expect(result.code).toBe(0);
      const packet = parsed<{ markdown: string; unreadableScope: unknown[]; unreadableProtections: { pattern: string; reason: string }[]; unreadableRulingPaths: unknown[] }>(result);
      expect(packet.unreadableProtections).toEqual([
        { pattern: 'src/[a', reason: 'a "[" is never closed' },
        { pattern: huge, reason: 'the pattern compiles to more than 65536 states' },
        { pattern: '{./,lib}', reason: 'the braces expand to "./", which names no path' },
      ]);
      expect(packet).toMatchObject({ unreadableScope: [], unreadableRulingPaths: [] });
      const refused = 'until it is fixed, the guard refuses every write but to the brief';
      expect(packet.markdown).toContain(
        [
          'Must not change without a ruling:',
          '- `lib/**`',
          `- \`src/[a\`, which the guard cannot read: a "[" is never closed; ${refused}`,
          `- \`${huge}\`, which the guard cannot read: the pattern compiles to more than 65536 states; ${refused}`,
          `- \`{./,lib}\`, which the guard cannot read: the braces expand to "./", which names no path; ${refused}`,
          '',
        ].join('\n'),
      );
      // As the guard decides: a write in the scope is refused, naming each with the same reason.
      const guarded = await cli(['guard', 'src/auth/a.ts', 'briefs/003_protections.md', '--brief', '3', '--format', 'json'], unread.root);
      const [inScope, own] = parsed<{ decisions: { verdict: string; reason: string; because: string[] }[] }>(guarded).decisions;
      expect(inScope).toMatchObject({ verdict: 'deny', reason: 'unreadable-protection', because: packet.unreadableProtections.map(({ pattern, reason }) => `${pattern} (${reason})`) });
      expect(own).toMatchObject({ verdict: 'allow', reason: 'brief-file' });
    });
  });

  it('passes on what spec-guard said when it could not read its specs, and gives the rest of the packet', async () => {
    const broken = repository({ [BRIEF_FILE]: brief({ affected: ['src/**'] }), 'package.json': JSON.stringify({ specGuard: { bogus: 1 } }), 'docs/adr/0001.md': ADR });
    const result = await cli(['context', '1'], broken.root);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('The rules spec-guard holds this code to could not be read: spec-guard exited 2 without JSON: spec-guard: package.json: unknown option "bogus"');
    expect(result.stdout).toContain('. Treat every ADR as binding until they can.');
    expect(result.stdout).toContain('## The contract');
  });

  it('refuses to guess a brief when none is named', async () => {
    const result = await cli(['context'], repository({ [BRIEF_FILE]: brief() }).root);
    expect(result.code).toBe(2);
    expect(result.stderr).toBe('spec-harness: no brief is named: pass --brief <id>, set SPEC_BRIEF, or work on a branch named like brief/<id>-<topic>\n');
  });

  it('refuses a named brief spec-brief does not know', async () => {
    const result = await cli(['context', '404'], repo.root);
    expect(result).toMatchObject({ code: 2, stderr: 'spec-harness: the flag names brief 404, and spec-brief knows no such brief\n' });
  });

  it('says a cited document\'s front matter is never closed, so its status was not read, and still exits 0', async () => {
    // The design's `---` is a thematic break under its title, not front matter.
    const unclosed = repository({
      [BRIEF_FILE]: brief({ body: 'See [the ADR](../docs/adr/0003-tokens.md) and [the design](../docs/design.md).\n' }),
      'docs/adr/0003-tokens.md': '---\nstatus: accepted\n\n# ADR-0003: Tokens\n\nRotate them.\n',
      'docs/design.md': '# The design\n\n---\n\nTokens rotate.\n',
    });
    const result = await cli(['context', '1', '--format', 'json'], unclosed.root);
    expect(result.code).toBe(0);
    const packet = parsed<{ markdown: string; included: string[]; unclosedFrontMatter: string[] }>(result);
    expect(packet).toMatchObject({ included: ['docs/adr/0003-tokens.md', 'docs/design.md'], unclosedFrontMatter: ['docs/adr/0003-tokens.md'] });
    expect(packet.markdown).toContain('### `docs/adr/0003-tokens.md` - ADR-0003: Tokens\n');
    expect(packet.markdown.endsWith(
      'Front matter opened on line 1 and never closed, so the status was not read; close the block with `---` on a line of its own:\n- `docs/adr/0003-tokens.md`\n',
    )).toBe(true);
    unclosed.write('docs/adr/0003-tokens.md', '---\nstatus: accepted\n---\n\n# ADR-0003: Tokens\n\nRotate them.\n');
    const closed = parsed<{ markdown: string; unclosedFrontMatter: string[] }>(await cli(['context', '1', '--format', 'json'], unclosed.root));
    expect(closed.unclosedFrontMatter).toEqual([]);
    expect(closed.markdown).toContain('### `docs/adr/0003-tokens.md` - ADR-0003: Tokens (accepted)\n');
  });

  it('names a line of a cited document\'s front matter that is not `key: value`, and still exits 0', async () => {
    const unread = repository({
      [BRIEF_FILE]: brief({ body: 'See [the ADR](../docs/adr/0003-tokens.md).\n' }),
      'docs/adr/0003-tokens.md': '---\ntitle: Tokens\nstatus accepted\n---\n\n# ADR-0003: Tokens\n',
    });
    const result = await cli(['context', '1', '--format', 'json'], unread.root);
    expect(result.code).toBe(0);
    const packet = parsed<{ markdown: string; included: string[]; unclosedFrontMatter: string[]; unreadableFrontMatter: unknown[] }>(result);
    expect(packet).toMatchObject({ included: ['docs/adr/0003-tokens.md'], unclosedFrontMatter: [] });
    expect(packet.unreadableFrontMatter).toEqual([{ path: 'docs/adr/0003-tokens.md', line: 3, text: 'status accepted', reason: 'not a "key: value" line' }]);
    expect(packet.markdown).toContain('### `docs/adr/0003-tokens.md` - ADR-0003: Tokens\n');
    expect(packet.markdown.endsWith(
      'Front matter lines that are not `key: value` were not read, so a status written on one, if any, was not read either:\n- `docs/adr/0003-tokens.md`, line 3, `status accepted`: not a "key: value" line\n',
    )).toBe(true);
    unread.write('docs/adr/0003-tokens.md', '---\ntitle: Tokens\nstatus: accepted\n---\n\n# ADR-0003: Tokens\n');
    const fixed = parsed<{ markdown: string; unreadableFrontMatter: unknown[] }>(await cli(['context', '1', '--format', 'json'], unread.root));
    expect(fixed.unreadableFrontMatter).toEqual([]);
    expect(fixed.markdown).toContain('### `docs/adr/0003-tokens.md` - ADR-0003: Tokens (accepted)\n');
  });
});
