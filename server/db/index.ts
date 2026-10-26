/**
 * VPS SQLite foundation (design-docs/21B §2).
 *
 * One file-backed database for the VPS workspace, plus `:memory:` for unit
 * tests (milliseconds, zero disk cleanup). WAL + foreign keys on. The schema
 * is the Phase 2 contract — Phase 21D sync and 21E jobs read/write these
 * tables; do not reshape without a migration plan.
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

let db: Database.Database | null = null;

/** Exact schema from design-docs/21B §2. */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  kdf_salt BLOB NOT NULL,
  is_owner INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_secrets (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  iv BLOB NOT NULL,
  auth_tag BLOB NOT NULL,
  ciphertext BLOB NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_settings (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  model_slots_json TEXT NOT NULL DEFAULT '{}',
  chat_tier TEXT NOT NULL DEFAULT 'free',
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  project_id TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Untitled Project',
  code_name TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '#e05a66',
  active_thread_id TEXT,
  granularity_law TEXT NOT NULL DEFAULT 'user-only',
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, project_id)
);

CREATE TABLE IF NOT EXISTS threads (
  user_id INTEGER NOT NULL,
  project_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  title TEXT NOT NULL,
  title_version INTEGER NOT NULL DEFAULT 0,
  folder_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  doc_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (user_id, project_id, thread_id),
  FOREIGN KEY (user_id, project_id) REFERENCES projects(user_id, project_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS folders (
  user_id INTEGER NOT NULL,
  project_id TEXT NOT NULL,
  folder_id TEXT NOT NULL,
  name TEXT NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL,
  PRIMARY KEY (user_id, project_id, folder_id),
  FOREIGN KEY (user_id, project_id) REFERENCES projects(user_id, project_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS turns (
  user_id INTEGER NOT NULL,
  project_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  meta_json TEXT NOT NULL DEFAULT '{}',
  doc_json TEXT NOT NULL DEFAULT '{}',
  revision INTEGER NOT NULL,
  PRIMARY KEY (user_id, project_id, turn_id),
  FOREIGN KEY (user_id, project_id) REFERENCES projects(user_id, project_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS chapters (
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
  doc_json TEXT NOT NULL DEFAULT '{}',
  chapter_thread_id TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL,
  PRIMARY KEY (user_id, project_id, chapter_id),
  FOREIGN KEY (user_id, project_id) REFERENCES projects(user_id, project_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS artifacts (
  user_id INTEGER NOT NULL,
  project_id TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  doc_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  PRIMARY KEY (user_id, project_id, artifact_id),
  FOREIGN KEY (user_id, project_id) REFERENCES projects(user_id, project_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS edges (
  user_id INTEGER NOT NULL,
  project_id TEXT NOT NULL,
  edge_id TEXT NOT NULL,
  edge_json TEXT NOT NULL,
  revision INTEGER NOT NULL,
  PRIMARY KEY (user_id, project_id, edge_id),
  FOREIGN KEY (user_id, project_id) REFERENCES projects(user_id, project_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tombstones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  project_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  revision INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_jobs (
  job_id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'send',
  target_turn_id TEXT,
  ask_text TEXT NOT NULL,
  compiled_prompt TEXT NOT NULL,
  system_instruction TEXT,
  model TEXT NOT NULL,
  staged_attachments_json TEXT NOT NULL DEFAULT '[]',
  state TEXT NOT NULL,
  partial_text TEXT NOT NULL DEFAULT '',
  error_reason TEXT,
  buffered_artifacts_json TEXT NOT NULL DEFAULT '[]',
  buffered_shifts_json TEXT NOT NULL DEFAULT '[]',
  result_user_turn_id TEXT,
  result_assistant_turn_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS artifact_index_sections (
  user_id INTEGER NOT NULL,
  project_id TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  section_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  heading TEXT NOT NULL,
  text TEXT NOT NULL,
  qa_json TEXT NOT NULL DEFAULT '[]',
  section_vec_json TEXT NOT NULL DEFAULT '[]',
  qa_vecs_json TEXT NOT NULL DEFAULT '[]',
  model TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, project_id, artifact_id, section_id),
  FOREIGN KEY (user_id, project_id) REFERENCES projects(user_id, project_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tts_cache (
  cache_key TEXT PRIMARY KEY,
  model TEXT NOT NULL,
  voice TEXT NOT NULL,
  file_path TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  last_accessed_at INTEGER NOT NULL
);
`;

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
  next.exec(SCHEMA);
  // 21D: full-entity JSON columns for domain objects whose table shape is
  // thinner than the client type (threads/chapters/turns). Guarded ALTERs so
  // databases created before Phase 4 upgrade in place; fresh DBs get them
  // via the CREATE path below (columns must exist there too).
  const ensureColumn = (table: string, column: string, ddl: string) => {
    const cols = next.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === column)) next.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  };
  ensureColumn('threads', 'doc_json', `doc_json TEXT NOT NULL DEFAULT '{}'`);
  ensureColumn('chapters', 'doc_json', `doc_json TEXT NOT NULL DEFAULT '{}'`);
  ensureColumn('turns', 'doc_json', `doc_json TEXT NOT NULL DEFAULT '{}'`);
  // CHAPTER thread scoping for delta assembly (chapter rows carry threadId in doc, column helps queries)
  ensureColumn('chapters', 'chapter_thread_id', `chapter_thread_id TEXT NOT NULL DEFAULT ''`);
  // design 25: SHA-256 verifier of the derived vault key (a verifier, NOT the
  // key). Present → the authed tab may re-arm the vault without the password
  // after a server restart. Cleared by every manual lock.
  ensureColumn('users', 'vault_rearm_hash', `vault_rearm_hash TEXT NOT NULL DEFAULT ''`);
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
