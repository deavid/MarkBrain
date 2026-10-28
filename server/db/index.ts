/**
 * VPS SQLite foundation (design-docs/21B §2).
 *
 * One file-backed database for the VPS workspace, plus `:memory:` for unit
 * tests (milliseconds, zero disk cleanup). WAL + foreign keys on. The schema
 * is declared in `schemaSpec.ts` (`TABLES_SPEC`) and converged idempotently
 * on every boot by `annealDatabase()` — no hand-written numbered migrations.
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { annealDatabase } from './schemaSpec';

let db: Database.Database | null = null;

/**
 * Initialize (or replace) the process-wide database.
 * `location` defaults to `process.env.MARKBRAIN_DB_PATH` or `<cwd>/data/markbrain.sqlite`.
 * Pass `':memory:'` for tests.
 */
export function initDb(location?: string): Database.Database {
  const target =
    location ?? process.env.MARKBRAIN_DB_PATH ?? path.resolve(process.cwd(), 'data', 'markbrain.sqlite');
  if (target !== ':memory:') {
    fs.mkdirSync(path.dirname(target), { recursive: true });
  }
  const next = new Database(target);
  next.pragma('journal_mode = WAL');
  next.pragma('foreign_keys = ON');
  // Declarative schema (design-docs/28 §5.2): converge to TABLES_SPEC on
  // every boot — creates missing tables, adds missing columns, never drops
  // anything. Replaces the old raw-SCHEMA exec plus the ad-hoc ensureColumn
  // block (21D doc_json columns, chapter_thread_id, design-25
  // vault_rearm_hash), which now live as regular ColumnSpecs.
  annealDatabase(next);
  if (db) {
    try {
      db.close();
    } catch {
      /* already closed */
    }
  }
  db = next;
  return next;
}

/** Lazily-initialized handle: file DB on first server request, unless a test called `initDb(':memory:')` first. */
export function getDb(): Database.Database {
  if (!db) return initDb();
  return db;
}

/** Test seam: drop the current handle without touching the file layer. */
export function closeDbForTests(): void {
  if (db) {
    try {
      db.close();
    } catch {
      /* already closed */
    }
  }
  db = null;
}
