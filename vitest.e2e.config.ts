import { configDefaults, defineConfig } from 'vitest/config';

/**
 * The SLOW lane (design-docs/22): real-server end-to-end journeys.
 *
 * `npm test` (the fast everyday gate) EXCLUDES this directory via
 * vite.config.ts. Run it explicitly: `npm run test:e2e`. These tests boot the
 * real Express app on a real socket and talk to a fake LLM API server at the
 * fetch boundary — they own the seams unit tests cannot cross (reload, retry,
 * watcher attach), at the cost of seconds instead of milliseconds.
 */
export default defineConfig({
  test: {
    include: ['src/tests/e2e/**/*.test.ts'],
    exclude: [...configDefaults.exclude],
    // Real HTTP journeys: generous per-test budget (each `it` also sets its own).
    testTimeout: 20_000,
    hookTimeout: 20_000,
    // One server + shared SQLite per file → files run in parallel, tests in a
    // file stay sequential (the journeys share state by design).
    fileParallelism: true,
    pool: 'threads',
  },
});