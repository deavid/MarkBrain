/**
 * THE FILE DB IS OFF-LIMITS TO TESTS (David 2026-10-30).
 *
 * A graph-link test leaked rows into the live dev database: its
 * `initDb(':memory:')` call lost a race with a lazy `getDb()`, which
 * initializes with the FILE path when no handle exists yet.
 *
 * This setup pins the default BEFORE any test module loads, so every lazy
 * `getDb()` — in any test, at any import order — resolves to ':memory:'.
 * Tests that need a REAL server on a real socket own their own tmp file
 * via MARKBRAIN_DB_PATH explicitly (vitest.e2e.config.ts lane).
 */
process.env.MARKBRAIN_DB_PATH = ':memory:';
