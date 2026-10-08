import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { INSTRUCTIONS, prompts, tools } from '../../src/server.js';
import { createMcpServer, type JsonObject, type ToolDefinition } from '../../src/vendor/spec-core/jsonrpc/index.js';
import { openWorkspace, parseOptions, version, type Workspace } from '../../src/workspace.js';
import { BIN, brief, BRIEF_FILE, cleanup, cli, repository, ROOT, temp, type Repository } from './helpers.js';

afterAll(cleanup);

let repo: Repository;
let workspace: Workspace;

beforeAll(async () => {
  repo = repository({
    [BRIEF_FILE]: brief({ affected: ['src/auth/**'], protected: ['src/db/**'] }),
    'briefs/002_next.md': brief({
      title: '002 - Next',
      affected: ['"src/[a"'],
      protected: ['"{./,lib}"'],
      dependsOn: ['1'],
      body: 'See [the ADR](../docs/adr/0003.md) and [the next](../docs/adr/0004.md).\n',
    }),
    'docs/adr/0003.md': '---\nstatus: accepted\n\n# ADR-0003\n',
    'docs/adr/0004.md': '---\nstatus draft\n---\n\n# ADR-0004\n',
    'briefs/archive/003_old.md': brief({ title: '003 - Old', status: 'archived' }),
    'src/db/schema.ts': 'table;\n',
  });
  repo.git('checkout', '-q', '-b', 'brief/001-rotate');
  workspace = await openWorkspace(parseOptions(['mcp']), { stdout: { write: () => true }, stderr: { write: () => true }, cwd: repo.root, env: {} });
});

function tool(name: string): ToolDefinition {
  const found = tools(workspace, {}).find((candidate) => candidate.descriptor.name === name);
  if (found === undefined) throw new Error(`no tool ${name}`);
  return found;
}

describe('the tools', () => {
  it('are the five a round needs, each described with its schema', () => {
    const list = tools(workspace, {});
    expect(list.map((t) => t.descriptor.name)).toEqual(['start_round', 'check_path', 'request_escalation', 'audit_round', 'list_rounds']);
    for (const t of list) expect(t.descriptor['inputSchema']).toMatchObject({ type: 'object', additionalProperties: false });
    expect(list.find((t) => t.descriptor.name === 'request_escalation')?.descriptor['annotations']).toMatchObject({ readOnlyHint: false });
    expect(list.find((t) => t.descriptor.name === 'check_path')?.descriptor['annotations']).toMatchObject({ readOnlyHint: true });
  });

  it('describe themselves and every argument they take, and refuse any other by the same names', async () => {
    for (const t of tools(workspace, {})) {
      const { name, title, description, inputSchema } = t.descriptor as unknown as {
        name: string;
        title: string;
        description: string;
        inputSchema: { properties: Record<string, { description: string }> };
      };
      // A model picks a tool, and fills in its arguments, from these words alone.
      expect(title.length, name).toBeGreaterThan(0);
      expect(description.length, name).toBeGreaterThan(0);
      const names = Object.keys(inputSchema.properties);
      for (const argument of names) expect(inputSchema.properties[argument]?.description.length, `${name}.${argument}`).toBeGreaterThan(0);
      const takes = names.length === 0 ? 'no arguments' : names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
      expect((await t.call({ zzz: 1 })).text, name).toBe(`Unknown argument "zzz"; this tool takes ${takes}.`);
    }
  });

  it('declare the type of every argument, and require the ones a call is refused without', () => {
    const shape = (value: unknown): unknown =>
      Array.isArray(value)
        ? value.map(shape)
        : typeof value === 'object' && value !== null
          ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'description').map(([key, inner]) => [key, shape(inner)]))
          : value;
    const schemas = Object.fromEntries(tools(workspace, {}).map((t) => [t.descriptor.name, shape(t.descriptor['inputSchema'])]));
    const text = { type: 'string' };
    const paths = { type: 'array', items: text };
    expect(schemas).toEqual({
      start_round: { type: 'object', properties: { brief: text, base: text }, additionalProperties: false },
      check_path: { type: 'object', properties: { paths, brief: text, base: text }, required: ['paths'], additionalProperties: false },
      request_escalation: {
        type: 'object',
        properties: {
          paths,
          reason: text,
          options: { type: 'array', items: { type: 'object', properties: { label: text, consequence: text }, required: ['label', 'consequence'] } },
          recommendation: text,
          brief: text,
        },
        required: ['paths', 'reason'],
        additionalProperties: false,
      },
      audit_round: { type: 'object', properties: { brief: text, base: text }, additionalProperties: false },
      list_rounds: { type: 'object', properties: {}, additionalProperties: false },
    });
  });

  it('tell a client which only read, and that each request for a ruling records another', () => {
    const reads = { readOnlyHint: true, idempotentHint: true, openWorldHint: false };
    expect(Object.fromEntries(tools(workspace, {}).map((t) => [t.descriptor.name, t.descriptor['annotations']]))).toEqual({
      start_round: reads,
      check_path: reads,
      request_escalation: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
      audit_round: reads,
      list_rounds: reads,
    });
  });

  it('start_round gives the context packet of the brief the branch names', async () => {
    const outcome = await tool('start_round').call({});
    expect(outcome.isError).toBeUndefined();
    expect(outcome.text.startsWith('# Round 001: Rotate tokens\n')).toBe(true);
    expect(outcome.structured).toEqual({
      brief: '001',
      included: [],
      omitted: [],
      unresolved: [],
      unclosedFrontMatter: [],
      unreadableFrontMatter: [],
      unreadableScope: [],
      unreadableProtections: [],
      unreadableRulingPaths: [],
    });
    const next = await tool('start_round').call({ brief: '2' });
    expect(next.structured).toEqual({
      brief: '002',
      included: ['docs/adr/0003.md', 'docs/adr/0004.md'],
      omitted: [],
      unresolved: [],
      unclosedFrontMatter: ['docs/adr/0003.md'],
      unreadableFrontMatter: [{ path: 'docs/adr/0004.md', line: 2, text: 'status draft', reason: 'not a "key: value" line' }],
      unreadableScope: [{ pattern: 'src/[a', reason: 'a "[" is never closed' }],
      unreadableProtections: [{ pattern: '{./,lib}', reason: 'the braces expand to "./", which names no path' }],
      unreadableRulingPaths: [],
    });
    expect(next.text).toContain('May write:\n- `src/[a`, which the guard cannot read: a "[" is never closed; it puts no path in the scope\n');
    expect(next.text).toContain('The scope could not be read: no pattern in `affectedFiles` can be read');
    expect(next.text).toContain(
      'Must not change without a ruling:\n- `{./,lib}`, which the guard cannot read: the braces expand to "./", which names no path; until it is fixed, the guard refuses every write but to the brief\n',
    );
    expect(next.text).toContain('Front matter opened on line 1 and never closed, so the status was not read; close the block with `---` on a line of its own:\n- `docs/adr/0003.md`\n');
    expect(next.text).toContain(
      'Front matter lines that are not `key: value` were not read, so a status written on one, if any, was not read either:\n- `docs/adr/0004.md`, line 2, `status draft`: not a "key: value" line\n',
    );
  });

  it('check_path decides each path, relative to the project, with the next step', async () => {
    const outcome = await tool('check_path').call({ paths: ['src/db/schema.ts', 'src/auth/a.ts', 'README.md'] });
    expect(outcome.text.split('\n')).toEqual([
      'deny: brief 001 does not empower this round to change src/db/schema.ts (protectedFiles: src/db/**). Next: if the round cannot be done without it, stop and ask for a ruling: spec-harness escalate --path <file> --reason <why>, or the request_escalation tool',
      "allow: src/auth/a.ts is in brief 001's scope (src/auth/**)",
      "warn: README.md is outside brief 001's scope, which covers src/auth/**. Next: if the round needs it, say so in briefs/001_rotate-tokens.md and add it to affectedFiles; the archive reports every file outside the scope",
    ]);
    const decisions = (outcome.structured as { decisions: { verdict: string }[] }).decisions;
    expect(decisions.map((d) => d.verdict)).toEqual(['deny', 'allow', 'warn']);
  });

  it('check_path refuses arguments it does not take', async () => {
    expect(await tool('check_path').call({ paths: [] })).toEqual({ text: '"paths" must be a non-empty array of strings.', isError: true });
    expect(await tool('check_path').call({ paths: 'a.ts' })).toEqual({ text: '"paths" must be a non-empty array of strings.', isError: true });
    expect(await tool('check_path').call({ paths: [1] })).toEqual({ text: '"paths" must be a non-empty array of strings.', isError: true });
    expect(await tool('check_path').call({ paths: ['a', 1] })).toEqual({ text: '"paths" must be a non-empty array of strings.', isError: true });
    expect(await tool('check_path').call({ paths: ['a'], path: 'b' })).toEqual({ text: 'Unknown argument "path"; this tool takes paths, brief and base.', isError: true });
    expect(await tool('check_path').call({ paths: ['a'], brief: 1 })).toEqual({ text: '"brief" must be a string.', isError: true });
    expect(await tool('check_path').call({ paths: ['a'], base: 1 })).toEqual({ text: '"base" must be a string.', isError: true });
    expect(await tool('start_round').call({ base: ['main'] })).toEqual({ text: '"base" must be a string.', isError: true });
    expect(await tool('start_round').call({ at: 'main' })).toEqual({ text: 'Unknown argument "at"; this tool takes brief and base.', isError: true });
    expect(await tool('check_path').call({ paths: ['a'], brief: '404' })).toEqual({ text: 'the flag names brief 404, and spec-brief knows no such brief', isError: true });
    expect(await tool('start_round').call({ brief: '3' })).toEqual({ text: 'the flag names brief 003, which is archived; a closed round writes nothing', isError: true });
  });

  it('refuse a brief, a base or a path that is given and names nothing, by the argument, where each was read as left out', async () => {
    // An empty brief was answered for the branch's brief, an empty base with
    // no ruling verified, and an empty path as the project itself.
    const brief = (value: string) => ({ text: `"brief" is ${JSON.stringify(value)}, which names no brief; give it a brief's id, or leave it out for the one SPEC_BRIEF or the branch names.`, isError: true });
    const base = (value: string) => ({ text: `"base" is ${JSON.stringify(value)}, which names no commit; give it a branch or a commit, or leave it out for the configured base.`, isError: true });
    expect(await tool('start_round').call({ brief: '' })).toEqual(brief(''));
    expect(await tool('check_path').call({ paths: ['a'], brief: ' ' })).toEqual(brief(' '));
    expect(await tool('audit_round').call({ brief: '\t' })).toEqual(brief('\t'));
    expect(await tool('request_escalation').call({ paths: ['a'], reason: 'r', brief: '' })).toEqual(brief(''));
    expect(await tool('start_round').call({ base: '' })).toEqual(base(''));
    expect(await tool('check_path').call({ paths: ['a'], base: ' ' })).toEqual(base(' '));
    expect(await tool('audit_round').call({ base: '' })).toEqual(base(''));
    expect(await tool('check_path').call({ paths: [''] })).toEqual({ text: '"paths[0]" is "", which names no file; give it the path of a file.', isError: true });
    expect(await tool('check_path').call({ paths: ['src/auth/a.ts', ' '] })).toEqual({ text: '"paths[1]" is " ", which names no file; give it the path of a file.', isError: true });
    // The argument is named before the brief is looked for.
    expect(await tool('check_path').call({ paths: ['a'], base: '', brief: '404' })).toEqual(base(''));
    // What names something is read as it was: an id with space around it, and a base that is one.
    expect((await tool('start_round').call({ brief: ' 2 ', base: 'main' })).structured).toMatchObject({ brief: '002' });
  });

  it('request_escalation records the request and tells the agent to stop', async () => {
    const outcome = await tool('request_escalation').call({
      paths: ['src/db/schema.ts'],
      reason: 'Rotation needs a column.',
      options: [{ label: 'Allow', consequence: 'one column' }, { label: 'Refuse' }],
      recommendation: 'Allow.',
    });
    expect(outcome.isError).toBeUndefined();
    expect(outcome.structured).toEqual({ id: 'E-001-1' });
    expect(outcome.text).toContain('# Escalation E-001-1');
    expect(outcome.text).toContain('1. **Allow** - one column\n2. **Refuse**\n');
    expect(outcome.text).toContain('## The agent recommends\n\nAllow.\n');
    expect(outcome.text.endsWith('\nStop here until a person rules on E-001-1.')).toBe(true);
    const state = join(workspace.commonDir, 'spec-harness', 'escalations');
    expect(existsSync(state) ? readdirSync(state) : []).toContain('E-001-1.json');
  });

  it('request_escalation refuses what it cannot record', async () => {
    const call = (args: JsonObject) => tool('request_escalation').call(args);
    expect(await call({ reason: 'r' })).toEqual({ text: '"paths" must be a non-empty array of strings.', isError: true });
    expect(await call({ paths: [], reason: 'r' })).toEqual({ text: '"paths" must be a non-empty array of strings.', isError: true });
    expect(await call({ paths: [1], reason: 'r' })).toEqual({ text: '"paths" must be a non-empty array of strings.', isError: true });
    expect(await call({ paths: ['a', 2], reason: 'r' })).toEqual({ text: '"paths" must be a non-empty array of strings.', isError: true });
    expect(await call({ paths: ['a'], reason: ' ' })).toEqual({ text: '"reason" is required.', isError: true });
    expect(await call({ paths: ['a'] })).toEqual({ text: '"reason" is required.', isError: true });
    expect(await call({ paths: ['a'], reason: 'r', options: 'x' })).toEqual({ text: '"options" must be an array.', isError: true });
    expect(await call({ paths: ['a'], reason: 'r', recommendation: 3 })).toEqual({ text: '"recommendation" must be a string.', isError: true });
    expect(await call({ paths: ['a', ''], reason: 'r' })).toEqual({ text: '"paths[1]" is "", which names no file; give it the path of a file.', isError: true });
    expect(await call({ paths: ['a'], reason: '' })).toEqual({ text: '"reason" is required.', isError: true });
    expect(await call({ paths: ['a'], reason: 'r', recommendation: ' ' })).toEqual({
      text: '"recommendation" is " ", which recommends nothing; say which option and why, or leave it out.',
      isError: true,
    });
    expect((await call({ paths: ['a'], reason: 'r', why: 'x' })).isError).toBe(true);
  });

  it('audit_round reports the audit\'s findings, what it measured, and its counts', async () => {
    const outcome = await tool('audit_round').call({});
    expect(outcome.text).toContain('warning unmeasured: the round\'s changes were not measured: main and HEAD are the same commit');
    expect(outcome.text).toMatch(
      /\n\nmeasured: goals: none declared · premises: none declared · archive: asked · rulings: none · dependencies: not measured\n\n\d+ error\(s\), \d+ warning\(s\), \d+ note\(s\)$/,
    );
    expect((outcome.structured as { counts: Record<string, number> }).counts.warning).toBeGreaterThanOrEqual(1);
    expect((outcome.structured as { findings: unknown[] }).findings).toContainEqual(
      expect.objectContaining({ rule: 'unmeasured', severity: 'warning', message: expect.stringContaining('main and HEAD are the same commit') }),
    );
    expect((outcome.structured as { measured: unknown }).measured).toMatchObject({ changes: 'unmeasured', archive: 'asked', assertions: 'run', goals: { held: 0, failed: 0 } });
    expect(await tool('audit_round').call({ base: 7 })).toEqual({ text: '"base" must be a string.', isError: true });
    const unbased = await tool('audit_round').call({ base: 'nowhere' });
    expect(unbased.text).toContain('"nowhere" names no commit');
  });

  it('audit_round says what it measured when it finds nothing, so nothing found is not read as nothing checked', async () => {
    const clean = repository({ [BRIEF_FILE]: brief({ affected: ['src/**'], body: '## Goals\n\n<!-- @assert-absence target="src" symbol="OldToken" -->\n' }), 'src/a.ts': 'a\n' });
    clean.git('checkout', '-q', '-b', 'brief/001-x');
    clean.write('src/b.ts', 'b\n');
    clean.commit('work');
    const other = await openWorkspace(parseOptions(['mcp']), { stdout: { write: () => true }, stderr: { write: () => true }, cwd: clean.root, env: {} });
    const audited = await tools(other, {}).find((t) => t.descriptor.name === 'audit_round')?.call({});
    expect(audited?.text).toBe(
      'The audit found nothing in what it measured.\n\nmeasured: goals: 1 held, 0 failed · premises: none declared · archive: asked · rulings: none · dependencies: 0 changed, 0 unread\n\n0 error(s), 0 warning(s), 0 note(s)',
    );
  });

  it('audit_round names a package the round allowed to run install scripts, and counts it in what it measured', async () => {
    const before = { name: 'x', dependencies: { sharp: '^0.33.0' } };
    const allowed = repository({ [BRIEF_FILE]: brief({ affected: ['**'] }), 'package.json': `${JSON.stringify(before)}\n` });
    allowed.git('checkout', '-q', '-b', 'brief/001-x');
    allowed.write('package.json', `${JSON.stringify({ ...before, allowScripts: { 'sharp@0.33.5': true } })}\n`);
    allowed.commit('work');
    const other = await openWorkspace(parseOptions(['mcp']), { stdout: { write: () => true }, stderr: { write: () => true }, cwd: allowed.root, env: {} });
    const audited = await tools(other, {}).find((t) => t.descriptor.name === 'audit_round')?.call({});
    expect(audited?.text).toBe(
      [
        'warning install-script-allowed: the round allowed "sharp@0.33.5" to run install scripts in package.json (allowScripts). Next: say in the brief why its install scripts must run, or remove the entry; an install script is code no reviewer read, run on every install',
        '',
        'measured: goals: none declared · premises: none declared · archive: asked · rulings: none · dependencies: 0 changed, 0 unread · install scripts: 1 changed',
        '',
        '0 error(s), 1 warning(s), 0 note(s)',
      ].join('\n'),
    );
    expect((audited?.structured as { measured: unknown }).measured).toMatchObject({ dependencies: { changed: 0, unread: 0 }, installScripts: { changed: 1 } });
  });

  it('list_rounds lists the live briefs and what each waits on', async () => {
    const outcome = await tool('list_rounds').call({});
    expect(outcome.text).toBe('001 Rotate tokens - active, wave -, ready\n002 Next - active, wave -, waits on 1');
    expect((outcome.structured as { briefs: { id: string }[] }).briefs.map((b) => b.id)).toEqual(['001', '002']);
    // The id is its own field, so the title does not say it again, here or in the text.
    expect((outcome.structured as { briefs: { title: string | null }[] }).briefs.map((b) => b.title)).toEqual(['Rotate tokens', 'Next']);
    expect(await tool('list_rounds').call({ all: true })).toEqual({ text: 'Unknown argument "all"; this tool takes no arguments.', isError: true });
  });

  it('list_rounds says when there is no live brief', async () => {
    const empty = repository({ 'briefs/archive/001_x.md': brief({ status: 'archived' }) });
    const other = await openWorkspace(parseOptions(['mcp']), { stdout: { write: () => true }, stderr: { write: () => true }, cwd: empty.root, env: {} });
    const listed = tools(other, {}).find((t) => t.descriptor.name === 'list_rounds');
    expect(await listed?.call({})).toEqual({ text: 'No live brief.', structured: { briefs: [] } });
  });

  it('reads the brief SPEC_BRIEF names when the branch names none', async () => {
    const plain = repository({ [BRIEF_FILE]: brief() });
    const other = await openWorkspace(parseOptions(['mcp']), { stdout: { write: () => true }, stderr: { write: () => true }, cwd: plain.root, env: {} });
    const start = (env: Record<string, string>) => tools(other, env).find((t) => t.descriptor.name === 'start_round')?.call({});
    expect((await start({ SPEC_BRIEF: '1' }))?.structured).toMatchObject({ brief: '001' });
    expect((await start({}))?.text).toContain('no brief is named');
  });

  it('request_escalation records a request with no options and no recommendation, and says neither', async () => {
    const outcome = await tool('request_escalation').call({ paths: ['src/db/schema.ts'], reason: 'A column.' });
    expect(outcome.isError).toBeUndefined();
    expect(outcome.text).toContain('## Why\n\nA column.\n\n## To rule\n');
    expect(outcome.text).not.toContain('## Options');
    expect(outcome.text).not.toContain('## The agent recommends');
  });

  it('request_escalation refuses a choice with no label, which the memo numbered and did not name, and writes nothing', async () => {
    const state = join(workspace.commonDir, 'spec-harness', 'escalations');
    const before = existsSync(state) ? readdirSync(state) : [];
    const call = (options: unknown) => tool('request_escalation').call({ paths: ['src/db/schema.ts'], reason: 'A column.', options } as JsonObject);
    const unnamed = (index: number, label: string) => ({
      text: `"options[${index}].label" is ${JSON.stringify(label)}, which names no choice; give the option a label, or leave the option out.`,
      isError: true,
    });
    expect(await call([{ label: '', consequence: 'no column' }])).toEqual(unnamed(0, ''));
    expect(await call([{ label: 'Allow', consequence: 'one column' }, { label: ' ', consequence: '' }])).toEqual(unnamed(1, ' '));
    // A choice with no label at all, and one that is no object, have none to name it by.
    expect(await call([{ consequence: 'no column' }])).toEqual({ text: '"options[0].label" must be a string.', isError: true });
    expect(await call([{ label: 5, consequence: 'x' }])).toEqual({ text: '"options[0].label" must be a string.', isError: true });
    expect(await call([{ label: 'Allow' }, 'Refuse'])).toEqual({ text: '"options[1].label" must be a string.', isError: true });
    expect(await call([null])).toEqual({ text: '"options[0].label" must be a string.', isError: true });
    expect(await call([{ label: 'Allow', consequence: 3 }])).toEqual({ text: '"options[0].consequence" must be a string.', isError: true });
    expect(existsSync(state) ? readdirSync(state) : []).toEqual(before);
  });

  it('request_escalation records a choice whose cost is left out as the choice alone, and trims both', async () => {
    const outcome = await tool('request_escalation').call({
      paths: ['src/db/schema.ts'],
      reason: 'A column.',
      options: [{ label: ' Allow ', consequence: ' one column ' }, { label: 'Refuse', consequence: null }, { label: 'Wait', consequence: ' ' }],
    });
    expect(outcome.isError).toBeUndefined();
    expect(outcome.text).toContain('## Options\n\n1. **Allow** - one column\n2. **Refuse**\n3. **Wait**\n');
    // No list of choices at all is none, as before.
    expect((await tool('request_escalation').call({ paths: ['src/db/schema.ts'], reason: 'A column.', options: null })).text).not.toContain('## Options');
  });

  it('request_escalation and audit_round act on the brief they are given', async () => {
    const other = await tool('request_escalation').call({ paths: ['lib/x.ts'], reason: 'r', brief: '2' });
    expect(other.structured).toEqual({ id: 'E-002-1' });
    expect(other.text).toContain('Brief 002 (`briefs/002_next.md`)');
    const nowhere = { text: 'the flag names brief 404, and spec-brief knows no such brief', isError: true };
    expect(await tool('request_escalation').call({ paths: ['a'], reason: 'r', brief: '404' })).toEqual(nowhere);
    expect(await tool('audit_round').call({ brief: '404' })).toEqual(nowhere);
    const audited = await tool('audit_round').call({ brief: '2' });
    expect((audited.structured as { findings: { file?: string }[] }).findings.map((f) => f.file).filter((file) => file !== undefined)).toContain('briefs/002_next.md');
    expect((await tool('audit_round').call({})).text).not.toContain('briefs/002_next.md');
  });

  it('audit_round gives each finding a line of its own', async () => {
    const outcome = await tool('audit_round').call({ brief: '2' });
    const findings = (outcome.structured as { findings: { severity: string; rule: string }[] }).findings;
    expect(findings.length).toBeGreaterThanOrEqual(2);
    const lines = (outcome.text.split('\n\n')[0] ?? '').split('\n');
    expect(lines.map((line) => line.slice(0, line.indexOf(':')))).toEqual(findings.map((f) => `${f.severity} ${f.rule}`));
  });

  it('start_round names the documents the budget leaves out and those it cannot find', async () => {
    const small = repository(
      { [BRIEF_FILE]: brief({ body: 'See [a](../docs/a.md) and [gone](../docs/gone.md).\n' }), 'docs/a.md': `# A\n\n${'text '.repeat(40)}\n` },
      { context: { budget: 100 } },
    );
    const other = await openWorkspace(parseOptions(['mcp']), { stdout: { write: () => true }, stderr: { write: () => true }, cwd: small.root, env: {} });
    const outcome = await tools(other, { SPEC_BRIEF: '1' }).find((t) => t.descriptor.name === 'start_round')?.call({});
    expect(outcome?.structured).toMatchObject({ included: [], omitted: ['docs/a.md'], unresolved: ['docs/gone.md'] });
  });

  it('list_rounds lists a brief without a title by its id, one without a status as unknown, and every brief one waits on', async () => {
    const untitled = [
      '---',
      'status: draft',
      'dependsOn: [1, 2]',
      '---',
      '',
      '## Intent',
      '',
      'x',
      '',
      '## Negative Scope',
      '',
      '- none',
      '',
      '## Invariants',
      '',
      '- [ ] y',
      '',
    ].join('\n');
    const unstated = untitled.replace('status: draft\ndependsOn: [1, 2]\n', '').replace('## Intent', '# 004 - Unstated\n\n## Intent');
    const many = repository({
      [BRIEF_FILE]: brief(),
      'briefs/002_other.md': brief({ title: '002 - Other' }),
      'briefs/003_untitled.md': untitled,
      'briefs/004_unstated.md': unstated,
    });
    const other = await openWorkspace(parseOptions(['mcp']), { stdout: { write: () => true }, stderr: { write: () => true }, cwd: many.root, env: {} });
    const listed = await tools(other, {}).find((t) => t.descriptor.name === 'list_rounds')?.call({});
    expect(listed?.text.split('\n')).toContain('003 - draft, wave -, waits on 1, 2');
    expect(listed?.text.split('\n')).toContain('004 Unstated - unknown, wave -, ready');
  });
});

describe('the prompts', () => {
  it('are the four skills, without their front matter, with the argument appended', async () => {
    const list = prompts();
    expect(list.map((p) => p.descriptor.name)).toEqual(['draft-brief', 'split-goal', 'run-round', 'close-round']);
    const run = list.find((p) => p.descriptor.name === 'run-round');
    const message = (await run?.get({ brief: '012' })) as { description: string; messages: { role: string; content: { type: string; text: string } }[] };
    expect(message.description).toBe('Run a round');
    expect(message.messages[0]?.role).toBe('user');
    const text = message.messages[0]?.content.text ?? '';
    expect(text.startsWith('# Run a round')).toBe(true);
    expect(text).not.toContain('name: run-round');
    expect(text.endsWith('\n\nbrief: 012')).toBe(true);
    const bare = (await run?.get({ brief: '' })) as { messages: { content: { text: string } }[] };
    expect(bare.messages[0]?.content.text.endsWith('brief: ')).toBe(false);
  });

  it('each take one optional argument, named for what it appends, and serve the skill alone without it', async () => {
    const skills = { 'draft-brief': 'request', 'split-goal': 'goal', 'run-round': 'brief', 'close-round': 'brief' };
    const titles = new Set<string>();
    for (const prompt of prompts()) {
      const { name, title, arguments: args } = prompt.descriptor as unknown as { name: keyof typeof skills; title: string; arguments: { name: string; description: string; required: boolean }[] };
      expect(title.length, name).toBeGreaterThan(0);
      titles.add(title);
      expect(args.map((a) => ({ name: a.name, required: a.required })), name).toEqual([{ name: skills[name], required: false }]);
      expect(args[0]?.description.length, name).toBeGreaterThan(0);
      const skill = readFileSync(join(ROOT, 'skills', name, 'SKILL.md'), 'utf8');
      const body = skill.slice(skill.indexOf('\n---\n', 4) + '\n---\n'.length).trim();
      const bare = (await prompt.get({})) as { description: string; messages: { role: string; content: { type: string; text: string } }[] };
      expect(bare).toEqual({ description: title, messages: [{ role: 'user', content: { type: 'text', text: body } }] });
      const given = (await prompt.get({ [skills[name]]: 'x' })) as { messages: { content: { text: string } }[] };
      expect(given.messages[0]?.content.text, name).toBe(`${body}\n\n${skills[name]}: x`);
    }
    expect(titles.size).toBe(4);
  });
});

describe('the server', () => {
  const handle = () => createMcpServer({ name: 'spec-harness', version: '0.1.0', instructions: INSTRUCTIONS, tools: tools(workspace, {}), prompts: prompts() });

  it('answers initialize with its instructions and capabilities', async () => {
    const answer = await handle()({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
    expect(answer).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: { protocolVersion: '2025-06-18', capabilities: { tools: {}, prompts: {} }, serverInfo: { name: 'spec-harness' }, instructions: INSTRUCTIONS },
    });
    expect(INSTRUCTIONS).toContain('start_round');
  });

  it('lists its tools, calls check_path and gets a prompt', async () => {
    const server = handle();
    const list = (await server({ jsonrpc: '2.0', id: 2, method: 'tools/list' })) as unknown as { result: { tools: { name: string }[] } };
    expect(list.result.tools.map((t) => t.name)).toContain('check_path');
    const call = (await server({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'check_path', arguments: { paths: ['src/db/schema.ts'] } } })) as unknown as {
      result: { content: { type: string; text: string }[]; structuredContent: { decisions: { verdict: string; reason: string }[] }; isError?: boolean };
    };
    expect(call.result.isError).toBeUndefined();
    expect(call.result.content[0]?.text.startsWith('deny: brief 001 does not empower')).toBe(true);
    expect(call.result.structuredContent.decisions[0]).toMatchObject({ verdict: 'deny', reason: 'protected' });
    const prompt = (await server({ jsonrpc: '2.0', id: 4, method: 'prompts/get', params: { name: 'close-round', arguments: { brief: '001' } } })) as unknown as {
      result: { messages: { content: { text: string } }[] };
    };
    expect(prompt.result.messages[0]?.content.text).toContain('brief: 001');
  });

  it('reports a failing tool to the model, not as a protocol error', async () => {
    const broken = await openWorkspace(parseOptions(['mcp']), { stdout: { write: () => true }, stderr: { write: () => true }, cwd: repo.root, env: {} });
    const server = createMcpServer({
      name: 'spec-harness',
      version: '0',
      instructions: '',
      tools: tools({ ...broken, siblings: { ...broken.siblings, briefs: async () => Promise.reject(new Error('spec-brief is gone')) } }, {}),
    });
    const answer = (await server({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'list_rounds', arguments: {} } })) as unknown as { result: { isError: boolean; content: { text: string }[] } };
    expect(answer.result).toMatchObject({ isError: true, content: [{ type: 'text', text: 'spec-harness failed: spec-brief is gone' }] });
  });
});

describe('the mcp command', () => {
  const session = `${[
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'check_path', arguments: { paths: ['src/db/schema.ts'] } } },
  ]
    .map((message) => JSON.stringify(message))
    .join('\n')}\n`;

  const answers = (stdout: string) =>
    stdout
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line) as { id: number; result: { serverInfo?: unknown; structuredContent?: { decisions: { verdict: string }[] } } })
      .sort((a, b) => a.id - b.id);

  it('answers for the project CLAUDE_PROJECT_DIR names, one line per answer, as spec-harness at its version', async () => {
    const served = await cli(['mcp'], temp(), { env: { CLAUDE_PROJECT_DIR: repo.root }, stdin: session });
    expect(served).toMatchObject({ code: 0, stderr: '' });
    expect(served.stdout.endsWith('}\n')).toBe(true);
    const [initialized, called] = answers(served.stdout);
    expect(initialized?.result.serverInfo).toEqual({ name: 'spec-harness', version: version() });
    expect(called?.result.structuredContent?.decisions.map((d) => d.verdict)).toEqual(['deny']);
  });

  it('answers for --root over CLAUDE_PROJECT_DIR, and for where it runs when that is empty', async () => {
    const rooted = await cli(['mcp', '--root', repo.root], temp(), { env: { CLAUDE_PROJECT_DIR: temp() }, stdin: session });
    expect(rooted.code).toBe(0);
    expect(answers(rooted.stdout)[1]?.result.structuredContent?.decisions.map((d) => d.verdict)).toEqual(['deny']);
    const here = await cli(['mcp'], repo.root, { env: { CLAUDE_PROJECT_DIR: '' }, stdin: session });
    expect(here.code).toBe(0);
    expect(answers(here.stdout)).toHaveLength(2);
  });
});

describe('over stdio, as a client runs it', () => {
  it('serves initialize, tools/list and a check_path call from the built command line', async () => {
    if (!existsSync(join(ROOT, 'dist', 'cli.js'))) throw new Error('dist/cli.js is missing: run "npm run build" before the suite');
    const child = spawn(process.execPath, [BIN, 'mcp'], { cwd: repo.root, env: { ...process.env, SPEC_BRIEF: '' }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    const messages = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'check_path', arguments: { paths: ['src/db/schema.ts', 'src/auth/x.ts'] } } },
    ];
    child.stdin.end(`${messages.map((m) => JSON.stringify(m)).join('\n')}\n`);
    const code = await new Promise<number | null>((resolve) => child.once('close', resolve));
    expect(stderr).toBe('');
    expect(code).toBe(0);
    const answers = stdout
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { id: number; result: Record<string, unknown> })
      .sort((a, b) => a.id - b.id);
    expect(answers.map((a) => a.id)).toEqual([1, 2, 3]);
    expect(answers[0]?.result).toMatchObject({ serverInfo: { name: 'spec-harness' }, instructions: INSTRUCTIONS });
    expect((answers[1]?.result['tools'] as { name: string }[]).map((t) => t.name)).toEqual(['start_round', 'check_path', 'request_escalation', 'audit_round', 'list_rounds']);
    const decisions = (answers[2]?.result['structuredContent'] as { decisions: { verdict: string }[] }).decisions;
    expect(decisions.map((d) => d.verdict)).toEqual(['deny', 'allow']);
  });
});
