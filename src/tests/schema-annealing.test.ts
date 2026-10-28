/**
 * Package 5 (design-docs/28 §5.4): declarative schema annealing.
 *
 * `annealDatabase` must converge any database — fresh, current, or old-shaped
 * — to `TABLES_SPEC` idempotently: running it twice leaves the identical
 * schema, and an old database gains the missing columns without touching
 * existing rows. No network, no DOM — plain Node + better-sqlite3.
 */
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { TABLES_SPEC, annealDatabase, type TableSpec } from '../../server/db/schemaSpec';
import { initDb, closeDbForTests } from '../../server/db';

function snapshotSchema(db: Database.Database): Record<string, string[]> {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as Array<{ name: string }>;
  const snap: Record<string, string[]> = {};
  for (const t of tables) {
    const cols = db.prepare(`PRAGMA table_info(${t.name})`).all() as Array<{ name: string }>;
    snap[t.name] = cols.map((c) => c.name).sort();
  }
  return snap;
}

describe('schema annealing', () => {
  it('creates every TABLES_SPEC table with all spec columns on a fresh :memory: db', () => {
    const db = new Database(':memory:');
    annealDatabase(db);
    const snap = snapshotSchema(db);
    for (const table of TABLES_SPEC) {
      expect(snap[table.name], `table ${table.name} missing`).toBeDefined();
      for (const col of table.columns) {
        expect(snap[table.name], `column ${table.name}.${col.name} missing`).toContain(col.name);
      }
    }
    db.close();
  });

  it('is idempotent: running annealDatabase twice produces the identical schema', () => {
    const db = new Database(':memory:');
    annealDatabase(db);
    const first = snapshotSchema(db);
    annealDatabase(db);
    const second = snapshotSchema(db);
    expect(second).toEqual(first);
    db.close();
  });

  it('converges an old-shaped db: missing columns are added without touching existing rows', () => {
    const db = new Database(':memory:');
    // A database from an older build: users predates vault_rearm_hash,
    // chapters predates doc_json/chapter_thread_id (the pre-21D shape —
    // every other column was already in the 21B CREATE, matching how the old
    // ad-hoc ensureColumn block upgraded real databases).
    db.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        kdf_salt BLOB NOT NULL,
        is_owner INTEGER NOT NULL DEFAULT 0,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE chapters (
        user_id INTEGER NOT NULL,
        project_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        chapter_id TEXT NOT NULL,
        start_turn_id TEXT NOT NULL,
        end_turn_id TEXT,
        title TEXT NOT NULL,
        description TEXT,
        summary TEXT,
        granularity TEXT NOT NULL DEFAULT 'full',
        order_index INTEGER NOT NULL DEFAULT 0,
        revision INTEGER NOT NULL,
        PRIMARY KEY (user_id, project_id, chapter_id)
      );
    `);
    db.prepare(
      "INSERT INTO users (email, password_hash, kdf_salt, is_owner, enabled, created_at) VALUES ('old@example.com', 'h', x'00', 1, 1, 123)"
    ).run();
    db.prepare(
      "INSERT INTO chapters (user_id, project_id, thread_id, chapter_id, start_turn_id, end_turn_id, title, granularity, order_index, revision) VALUES (1, 'p', 't', 'c1', '0', '5', 'Chapter', 'full', 0, 1)"
    ).run();

    annealDatabase(db);

    // Missing columns now exist…
    const userCols = (db.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>).map((c) => c.name);
    expect(userCols).toContain('vault_rearm_hash');
    const chapterCols = (db.prepare('PRAGMA table_info(chapters)').all() as Array<{ name: string }>).map(
      (c) => c.name,
    );
    expect(chapterCols).toContain('doc_json');
    expect(chapterCols).toContain('chapter_thread_id');

    // …existing rows are untouched…
    const user = db.prepare('SELECT email, created_at FROM users WHERE email = ?').get('old@example.com') as {
      email: string;
      created_at: number;
    };
    expect(user.email).toBe('old@example.com');
    expect(user.created_at).toBe(123);
    const chapter = db.prepare('SELECT title, order_index FROM chapters WHERE chapter_id = ?').get('c1') as {
      title: string;
      order_index: number;
    };
    expect(chapter.title).toBe('Chapter');
    expect(chapter.order_index).toBe(0);

    // …new NOT NULL DEFAULT columns backfill harmlessly…
    const backfilled = db.prepare('SELECT vault_rearm_hash FROM users WHERE email = ?').get('old@example.com') as {
      vault_rearm_hash: string;
    };
    expect(backfilled.vault_rearm_hash).toBe('');

    // …and a second anneal is a no-op.
    const before = snapshotSchema(db);
    annealDatabase(db);
    expect(snapshotSchema(db)).toEqual(before);
    db.close();
  });

  it('converges a test-local spec with a new dummy ColumnSpec without errors', () => {
    const db = new Database(':memory:');
    const dummy: TableSpec = {
      name: 'dummy_table',
      createSql: `CREATE TABLE IF NOT EXISTS dummy_table (
  id TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
)`,
      columns: [
        { name: 'id', ddl: 'id TEXT PRIMARY KEY' },
        { name: 'value', ddl: "value TEXT NOT NULL DEFAULT ''" },
      ],
    };
    const extended: TableSpec[] = [...TABLES_SPEC.map((t) => ({ ...t })), dummy];
    annealDatabase(db, extended);
    expect(snapshotSchema(db)['dummy_table']).toContain('value');

    // Now evolve the test-local spec with a brand-new column → converges.
    const evolved: TableSpec[] = extended.map((t) =>
      t.name === 'dummy_table'
        ? { ...t, columns: [...t.columns, { name: 'extra', ddl: "extra TEXT NOT NULL DEFAULT ''" }] }
        : t,
    );
    annealDatabase(db, evolved);
    expect(snapshotSchema(db)['dummy_table']).toContain('extra');

    // Idempotent against the evolved spec too.
    const before = snapshotSchema(db);
    annealDatabase(db, evolved);
    expect(snapshotSchema(db)).toEqual(before);
    db.close();
  });

  it('initDb(":memory:") boots through the annealer — spec shape, including future tables', () => {
    closeDbForTests();
    const db = initDb(':memory:');
    const cols = (table: string) =>
      (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name);
    // Columns that used to come from the ad-hoc ensureColumn block.
    expect(cols('users')).toContain('vault_rearm_hash');
    expect(cols('threads')).toContain('doc_json');
    expect(cols('turns')).toContain('doc_json');
    expect(cols('chapters')).toContain('doc_json');
    expect(cols('chapters')).toContain('chapter_thread_id');
    // Future-package tables the annealer pre-provisions (28 §1.3 / §4.2).
    expect(cols('artifact_revisions')).toContain('layers_json');
    expect(cols('api_call_logs')).toContain('t_send');
    // Indexes exist.
    const idx = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_api_call_logs_user_time'")
      .get();
    expect(idx).toBeDefined();
    closeDbForTests();
  });
});
