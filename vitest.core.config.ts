import { defineConfig } from 'vitest/config';

/**
 * The unit suite: every test that reads no disk and spawns no process, which
 * is what the core mutation sweep holds the pure modules to. Under per-test
 * coverage an integration test that spawns git would run for every mutant it
 * reaches.
 */
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
  },
});
