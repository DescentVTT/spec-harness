import { describe, expect, it } from 'vitest';

import { literal } from '../../src/literal.js';

describe('a table written through literal()', () => {
  it('is the table it was given, and neither a copy nor nothing', () => {
    // Every table of the command line is built through this function as its
    // module loads. Were it to answer nothing, each of those modules would
    // throw before a test of theirs ran, and a mutation sweep counts a file
    // that does not load as no failure. This file loads nothing but the
    // function, so it is the test that fails.
    const table = { check: { options: ['root', 'format'], most: 1 } };
    expect(literal(table)).toBe(table);
  });

  it('reads each value as its own literal type, as a const assertion does', () => {
    const kinds = literal(['claude', 'git']);
    // The compiler holds this line: where the function gave string[], a
    // string would not be assignable to the one word.
    const first: 'claude' = kinds[0];
    expect(first).toBe('claude');
  });
});
