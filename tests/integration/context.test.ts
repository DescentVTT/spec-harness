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
});
