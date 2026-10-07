import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // The integration tests spawn git and the sibling tools: milliseconds on a
    // Linux runner, and on a Windows workstation with real-time scanning, over
    // a second a process - several seconds when other work holds the CPU, and
    // an audit or a probe is a few dozen processes.
    testTimeout: 300_000,
    hookTimeout: 300_000,
    // A temporary directory of the run's own, removed with all a failed test
    // left in it when the run ends, and the end of what stopped runs left
    // behind. The mutation sweeps run without it, on a runner that is thrown
    // away.
    globalSetup: ['tests/temporary.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/vendor/**', 'src/index.ts', 'src/types.ts'],
      reporter: ['text', 'lcov'],
      thresholds: {
        lines: 95,
        statements: 95,
        functions: 95,
        branches: 90,
      },
    },
  },
});
