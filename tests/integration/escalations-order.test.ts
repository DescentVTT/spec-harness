/**
 * The requests waiting on a person, listed in the order of their ids whatever
 * order the directory gives them in. Windows gives names in order and Linux
 * in the order its filesystem keeps them, so readdir here gives them in
 * reverse, and the test holds on every host. It has a file of its own because
 * the mock reaches everything this file imports.
 */

import { afterAll, describe, expect, it, vi } from 'vitest';

import type { EscalationRequest } from '../../src/rulings.js';
import { brief, BRIEF_FILE, cleanup, cli, parsed, repository } from './helpers.js';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const reversed = async (path: string): Promise<string[]> => (await actual.readdir(path)).reverse();
  return { ...actual, readdir: reversed };
});

afterAll(cleanup);

describe('escalate --list', () => {
  it('lists the requests in the order of their ids, whatever order the directory gives them in', async () => {
    const repo = repository({ [BRIEF_FILE]: brief({ affected: ['src/auth/**'], protected: ['src/db/**'] }) });
    repo.git('checkout', '-q', '-b', 'brief/001-rotate');
    for (const path of ['src/db/a.ts', 'src/db/b.ts', 'src/db/c.ts']) await cli(['escalate', '--path', path, '--reason', 'r'], repo.root);
    const listed = parsed<{ waiting: EscalationRequest[] }>(await cli(['escalate', '--list', '--format', 'json'], repo.root));
    expect(listed.waiting.map((request) => [request.id, request.paths])).toEqual([
      ['E-001-1', ['src/db/a.ts']],
      ['E-001-2', ['src/db/b.ts']],
      ['E-001-3', ['src/db/c.ts']],
    ]);
  });
});
