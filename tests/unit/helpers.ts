import type { BriefRow } from '../../src/types.js';

/** A brief as spec-brief lists it, with only what a test cares about spelled out. */
export function row(overrides: Partial<BriefRow> = {}): BriefRow {
  return {
    id: '012',
    file: 'briefs/012_rotate-tokens.md',
    title: '012 - Rotate tokens',
    phase: 'live',
    status: 'active',
    type: null,
    wave: null,
    dependsOn: [],
    affectedFiles: ['src/auth/**'],
    protectedFiles: ['src/db/schema.ts'],
    tasks: { total: 0, checked: 0 },
    ready: true,
    waitingOn: [],
    ...overrides,
  };
}
