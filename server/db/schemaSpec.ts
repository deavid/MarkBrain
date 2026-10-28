/**
 * Declarative schema spec + annealer (design-docs/28 §5.2).
 *
 * The database schema is declared here as data, and `annealDatabase()`
 * converges any existing database (fresh, current, or old-shaped) to this
 * spec idempotently on every boot. Domain features should never need hand
 *written numbered SQL migrations: add a `TableSpec` (or `ColumnSpec`) here
 * and the annealer creates/adds it on the next boot.
 *
 * Rules (design-docs/28 §5.2/§5.3):
 *  - NEVER drop columns. Legacy columns stay in place forever; old rows keep
 *    being readable through them.
 *  - Envelope/doc_json pattern: `doc_json` (or `*_json`) holds the canonical
 *    domain document; the other columns are only what SQL actually filters,
 *    orders, or joins on. Columns that exist purely because older builds
 *    wrote them are marked LEGACY below — reads must prefer the JSON doc and
 *    fall back to them only when the doc is missing/`'{}'`.
 */
import type Database from 'better-sqlite3';
import { logServer } from '../lib/log';

export interface ColumnSpec {
  name: string;
  /** Full column definition, usable as `ALTER TABLE <t> ADD COLUMN <ddl>`. */
  ddl: string;
}

export interface TableSpec {
  name: string;
  /** Full `CREATE TABLE IF NOT EXISTS` statement (the canonical shape). */
  createSql: string;
  columns: ColumnSpec[];
  /** `CREATE INDEX IF NOT EXISTS` statements. */
  indexes?: string[];
}

/* ── table specs ─────────────────────────────────────────────────────────── */

const USERS: TableSpec = {
  name: 'users',
  createSql: `CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  kdf_salt BLOB NOT NULL,
  is_owner INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  vault_rearm_hash TEXT NOT NULL DEFAULT ''
)`,
  columns: [
    { name: 'id', ddl: 'id INTEGER PRIMARY KEY AUTOINCREMENT' },
    { name: 'email', ddl: 'email TEXT NOT NULL UNIQUE COLLATE NOCASE' },
    { name: 'password_hash', ddl: 'password_hash TEXT NOT NULL' },
    { name: 'kdf_salt', ddl: 'kdf_salt BLOB NOT NULL' },
    { name: 'is_owner', ddl: 'is_owner INTEGER NOT NULL DEFAULT 0' },
    { name: 'enabled', ddl: 'enabled INTEGER NOT NULL DEFAULT 1' },
    { name: 'created_at', ddl: 'created_at INTEGER NOT NULL' },
    // design 25: SHA-256 verifier of the derived vault key (a verifier, NOT
    // the key). Present → the authed tab may re-arm the vault without the
    // password after a server restart. Cleared by every manual lock.
    { name: 'vault_rearm_hash', ddl: "vault_rearm_hash TEXT NOT NULL DEFAULT ''" },
  ],
};

const SESSIONS: TableSpec = {
  name: 'sessions',
  createSql: `CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
)`,
  columns: [
    { name: 'token_hash', ddl: 'token_hash TEXT PRIMARY KEY' },
    { name: 'user_id', ddl: 'user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE' },
    { name: 'created_at', ddl: 'created_at INTEGER NOT NULL' },
    { name: 'expires_at', ddl: 'expires_at INTEGER NOT NULL' },
  ],
};

const USER_SECRETS: TableSpec = {
  name: 'user_secrets',
  createSql: `CREATE TABLE IF NOT EXISTS user_secrets (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  iv BLOB NOT NULL,
  auth_tag BLOB NOT NULL,
  ciphertext BLOB NOT NULL,
  updated_at INTEGER NOT NULL
)`,
  columns: [
    { name: 'user_id', ddl: 'user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE' },
    { name: 'iv', ddl: 'iv BLOB NOT NULL' },
    { name: 'auth_tag', ddl: 'auth_tag BLOB NOT NULL' },
    { name: 'ciphertext', ddl: 'ciphertext BLOB NOT NULL' },
    { name: 'updated_at', ddl: 'updated_at INTEGER NOT NULL' },
  ],
};

const USER_SETTINGS: TableSpec = {
  name: 'user_settings',
  createSql: `CREATE TABLE IF NOT EXISTS user_settings (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  model_slots_json TEXT NOT NULL DEFAULT '{}',
  chat_tier TEXT NOT NULL DEFAULT 'free',
  updated_at INTEGER NOT NULL
)`,
  columns: [
    { name: 'user_id', ddl: 'user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE' },
    { name: 'model_slots_json', ddl: "model_slots_json TEXT NOT NULL DEFAULT '{}'" },
    { name: 'chat_tier', ddl: "chat_tier TEXT NOT NULL DEFAULT 'free'" },
    { name: 'updated_at', ddl: 'updated_at INTEGER NOT NULL' },
  ],
};

const PROJECTS: TableSpec = {
  name: 'projects',
  createSql: `CREATE TABLE IF NOT EXISTS projects (
  project_id TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Untitled Project',
  code_name TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '#e05a66',
  active_thread_id TEXT,
  granularity_law TEXT NOT NULL DEFAULT 'user-only',
  capabilities_json TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, project_id)
)`,
  columns: [
    { name: 'project_id', ddl: 'project_id TEXT NOT NULL' },
    { name: 'user_id', ddl: 'user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE' },
    { name: 'name', ddl: "name TEXT NOT NULL DEFAULT 'Untitled Project'" },
    { name: 'code_name', ddl: "code_name TEXT NOT NULL DEFAULT ''" },
    { name: 'description', ddl: "description TEXT NOT NULL DEFAULT ''" },
    { name: 'color', ddl: "color TEXT NOT NULL DEFAULT '#e05a66'" },
    { name: 'active_thread_id', ddl: 'active_thread_id TEXT' },
    { name: 'granularity_law', ddl: "granularity_law TEXT NOT NULL DEFAULT 'user-only'" },
    { name: 'capabilities_json', ddl: 'capabilities_json TEXT' },
    { name: 'revision', ddl: 'revision INTEGER NOT NULL DEFAULT 1' },
    { name: 'updated_at', ddl: 'updated_at INTEGER NOT NULL' },
  ],
};

// Envelope: `doc_json` is the canonical ChatThread. `title`, `title_version`
// and `folder_id` are read by list queries and the job runner — kept live.
// `created_at`/`updated_at` are ordering/bookkeeping. Nothing else is legacy
// here today.
const THREADS: TableSpec = {
  name: 'threads',
  createSql: `CREATE TABLE IF NOT EXISTS threads (
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
)`,
  columns: [
    { name: 'user_id', ddl: 'user_id INTEGER NOT NULL' },
    { name: 'project_id', ddl: 'project_id TEXT NOT NULL' },
    { name: 'thread_id', ddl: 'thread_id TEXT NOT NULL' },
    { name: 'title', ddl: 'title TEXT NOT NULL' },
    { name: 'title_version', ddl: 'title_version INTEGER NOT NULL DEFAULT 0' },
    { name: 'folder_id', ddl: 'folder_id TEXT' },
    { name: 'created_at', ddl: 'created_at INTEGER NOT NULL' },
    { name: 'updated_at', ddl: 'updated_at INTEGER NOT NULL' },
    { name: 'revision', ddl: 'revision INTEGER NOT NULL' },
    { name: 'doc_json', ddl: "doc_json TEXT NOT NULL DEFAULT '{}'" },
  ],
};

const FOLDERS: TableSpec = {
  name: 'folders',
  createSql: `CREATE TABLE IF NOT EXISTS folders (
  user_id INTEGER NOT NULL,
  project_id TEXT NOT NULL,
  folder_id TEXT NOT NULL,
  name TEXT NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL,
  PRIMARY KEY (user_id, project_id, folder_id),
  FOREIGN KEY (user_id, project_id) REFERENCES projects(user_id, project_id) ON DELETE CASCADE
)`,
  columns: [
    { name: 'user_id', ddl: 'user_id INTEGER NOT NULL' },
    { name: 'project_id', ddl: 'project_id TEXT NOT NULL' },
    { name: 'folder_id', ddl: 'folder_id TEXT NOT NULL' },
    { name: 'name', ddl: 'name TEXT NOT NULL' },
    { name: 'order_index', ddl: 'order_index INTEGER NOT NULL DEFAULT 0' },
    { name: 'revision', ddl: 'revision INTEGER NOT NULL' },
  ],
};

// Envelope: `doc_json` is the canonical Turn. `role`/`content`/`timestamp`/
// `meta_json` are LEGACY envelope duplicates kept for rows written by older
// builds (never dropped): reads go through doc_json and fall back to them
// only when the doc is missing/`'{}'`. `seq`/`thread_id` stay live (ordering
// and scoping). Writes keep filling them so the fallback stays honest.
const TURNS: TableSpec = {
  name: 'turns',
  createSql: `CREATE TABLE IF NOT EXISTS turns (
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
)`,
  columns: [
    { name: 'user_id', ddl: 'user_id INTEGER NOT NULL' },
    { name: 'project_id', ddl: 'project_id TEXT NOT NULL' },
    { name: 'thread_id', ddl: 'thread_id TEXT NOT NULL' },
    { name: 'turn_id', ddl: 'turn_id TEXT NOT NULL' },
    { name: 'seq', ddl: 'seq INTEGER NOT NULL' },
    { name: 'role', ddl: 'role TEXT NOT NULL' },
    { name: 'content', ddl: 'content TEXT NOT NULL' },
    { name: 'timestamp', ddl: 'timestamp INTEGER NOT NULL' },
    { name: 'meta_json', ddl: "meta_json TEXT NOT NULL DEFAULT '{}'" },
    { name: 'doc_json', ddl: "doc_json TEXT NOT NULL DEFAULT '{}'" },
    { name: 'revision', ddl: 'revision INTEGER NOT NULL' },
  ],
};

// Envelope: `doc_json` is the canonical ChapterPartition. `title`/
// `description`/`summary`/`granularity`/`start_turn_id`/`end_turn_id` are
// LEGACY envelope duplicates kept for rows written by older builds (never
// dropped): reads prefer doc_json and fall back only when it is missing/
// `'{}'`. `thread_id`/`chapter_id`/`order_index`/`chapter_thread_id` stay
// live (PK, ordering, thread-scoped queries). Writes keep filling the legacy
// columns so the fallback stays honest.
const CHAPTERS: TableSpec = {
  name: 'chapters',
  createSql: `CREATE TABLE IF NOT EXISTS chapters (
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
)`,
  columns: [
    { name: 'user_id', ddl: 'user_id INTEGER NOT NULL' },
    { name: 'project_id', ddl: 'project_id TEXT NOT NULL' },
    { name: 'thread_id', ddl: 'thread_id TEXT NOT NULL' },
    { name: 'chapter_id', ddl: 'chapter_id TEXT NOT NULL' },
    { name: 'start_turn_id', ddl: 'start_turn_id TEXT NOT NULL' },
    { name: 'end_turn_id', ddl: 'end_turn_id TEXT' },
    { name: 'title', ddl: 'title TEXT NOT NULL' },
    { name: 'description', ddl: 'description TEXT' },
    { name: 'summary', ddl: 'summary TEXT' },
    { name: 'granularity', ddl: "granularity TEXT NOT NULL DEFAULT 'full'" },
    { name: 'order_index', ddl: 'order_index INTEGER NOT NULL DEFAULT 0' },
    { name: 'doc_json', ddl: "doc_json TEXT NOT NULL DEFAULT '{}'" },
    { name: 'chapter_thread_id', ddl: "chapter_thread_id TEXT NOT NULL DEFAULT ''" },
    { name: 'revision', ddl: 'revision INTEGER NOT NULL' },
  ],
};

const ARTIFACTS: TableSpec = {
  name: 'artifacts',
  createSql: `CREATE TABLE IF NOT EXISTS artifacts (
  user_id INTEGER NOT NULL,
  project_id TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  doc_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  PRIMARY KEY (user_id, project_id, artifact_id),
  FOREIGN KEY (user_id, project_id) REFERENCES projects(user_id, project_id) ON DELETE CASCADE
)`,
  columns: [
    { name: 'user_id', ddl: 'user_id INTEGER NOT NULL' },
    { name: 'project_id', ddl: 'project_id TEXT NOT NULL' },
    { name: 'artifact_id', ddl: 'artifact_id TEXT NOT NULL' },
    { name: 'doc_json', ddl: 'doc_json TEXT NOT NULL' },
    { name: 'updated_at', ddl: 'updated_at INTEGER NOT NULL' },
    { name: 'revision', ddl: 'revision INTEGER NOT NULL' },
  ],
};

const EDGES: TableSpec = {
  name: 'edges',
  createSql: `CREATE TABLE IF NOT EXISTS edges (
  user_id INTEGER NOT NULL,
  project_id TEXT NOT NULL,
  edge_id TEXT NOT NULL,
  edge_json TEXT NOT NULL,
  revision INTEGER NOT NULL,
  PRIMARY KEY (user_id, project_id, edge_id),
  FOREIGN KEY (user_id, project_id) REFERENCES projects(user_id, project_id) ON DELETE CASCADE
)`,
  columns: [
    { name: 'user_id', ddl: 'user_id INTEGER NOT NULL' },
    { name: 'project_id', ddl: 'project_id TEXT NOT NULL' },
    { name: 'edge_id', ddl: 'edge_id TEXT NOT NULL' },
    { name: 'edge_json', ddl: 'edge_json TEXT NOT NULL' },
    { name: 'revision', ddl: 'revision INTEGER NOT NULL' },
  ],
};

const TOMBSTONES: TableSpec = {
  name: 'tombstones',
  createSql: `CREATE TABLE IF NOT EXISTS tombstones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  project_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  revision INTEGER NOT NULL
)`,
  columns: [
    { name: 'id', ddl: 'id INTEGER PRIMARY KEY AUTOINCREMENT' },
    { name: 'user_id', ddl: 'user_id INTEGER NOT NULL' },
    { name: 'project_id', ddl: 'project_id TEXT NOT NULL' },
    { name: 'entity_type', ddl: 'entity_type TEXT NOT NULL' },
    { name: 'entity_id', ddl: 'entity_id TEXT NOT NULL' },
    { name: 'revision', ddl: 'revision INTEGER NOT NULL' },
  ],
};

const CHAT_JOBS: TableSpec = {
  name: 'chat_jobs',
  createSql: `CREATE TABLE IF NOT EXISTS chat_jobs (
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
  capabilities_json TEXT,
  state TEXT NOT NULL,
  partial_text TEXT NOT NULL DEFAULT '',
  error_reason TEXT,
  buffered_artifacts_json TEXT NOT NULL DEFAULT '[]',
  buffered_shifts_json TEXT NOT NULL DEFAULT '[]',
  result_user_turn_id TEXT,
  result_assistant_turn_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)`,
  columns: [
    { name: 'job_id', ddl: 'job_id TEXT PRIMARY KEY' },
    { name: 'user_id', ddl: 'user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE' },
    { name: 'project_id', ddl: 'project_id TEXT NOT NULL' },
    { name: 'thread_id', ddl: 'thread_id TEXT NOT NULL' },
    { name: 'kind', ddl: "kind TEXT NOT NULL DEFAULT 'send'" },
    { name: 'target_turn_id', ddl: 'target_turn_id TEXT' },
    { name: 'ask_text', ddl: 'ask_text TEXT NOT NULL' },
    { name: 'compiled_prompt', ddl: 'compiled_prompt TEXT NOT NULL' },
    { name: 'system_instruction', ddl: 'system_instruction TEXT' },
    { name: 'model', ddl: 'model TEXT NOT NULL' },
    { name: 'staged_attachments_json', ddl: "staged_attachments_json TEXT NOT NULL DEFAULT '[]'" },
    { name: 'capabilities_json', ddl: 'capabilities_json TEXT' },
    { name: 'state', ddl: 'state TEXT NOT NULL' },
    { name: 'partial_text', ddl: "partial_text TEXT NOT NULL DEFAULT ''" },
    { name: 'error_reason', ddl: 'error_reason TEXT' },
    { name: 'buffered_artifacts_json', ddl: "buffered_artifacts_json TEXT NOT NULL DEFAULT '[]'" },
    { name: 'buffered_shifts_json', ddl: "buffered_shifts_json TEXT NOT NULL DEFAULT '[]'" },
    { name: 'result_user_turn_id', ddl: 'result_user_turn_id TEXT' },
    { name: 'result_assistant_turn_id', ddl: 'result_assistant_turn_id TEXT' },
    { name: 'created_at', ddl: 'created_at INTEGER NOT NULL' },
    { name: 'updated_at', ddl: 'updated_at INTEGER NOT NULL' },
  ],
};

const ARTIFACT_INDEX_SECTIONS: TableSpec = {
  name: 'artifact_index_sections',
  createSql: `CREATE TABLE IF NOT EXISTS artifact_index_sections (
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
)`,
  columns: [
    { name: 'user_id', ddl: 'user_id INTEGER NOT NULL' },
    { name: 'project_id', ddl: 'project_id TEXT NOT NULL' },
    { name: 'artifact_id', ddl: 'artifact_id TEXT NOT NULL' },
    { name: 'section_id', ddl: 'section_id TEXT NOT NULL' },
    { name: 'content_hash', ddl: 'content_hash TEXT NOT NULL' },
    { name: 'heading', ddl: 'heading TEXT NOT NULL' },
    { name: 'text', ddl: 'text TEXT NOT NULL' },
    { name: 'qa_json', ddl: "qa_json TEXT NOT NULL DEFAULT '[]'" },
    { name: 'section_vec_json', ddl: "section_vec_json TEXT NOT NULL DEFAULT '[]'" },
    { name: 'qa_vecs_json', ddl: "qa_vecs_json TEXT NOT NULL DEFAULT '[]'" },
    { name: 'model', ddl: 'model TEXT NOT NULL' },
    { name: 'updated_at', ddl: 'updated_at INTEGER NOT NULL' },
  ],
};

const TTS_CACHE: TableSpec = {
  name: 'tts_cache',
  createSql: `CREATE TABLE IF NOT EXISTS tts_cache (
  cache_key TEXT PRIMARY KEY,
  model TEXT NOT NULL,
  voice TEXT NOT NULL,
  file_path TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  last_accessed_at INTEGER NOT NULL
)`,
  columns: [
    { name: 'cache_key', ddl: 'cache_key TEXT PRIMARY KEY' },
    { name: 'model', ddl: 'model TEXT NOT NULL' },
    { name: 'voice', ddl: 'voice TEXT NOT NULL' },
    { name: 'file_path', ddl: 'file_path TEXT NOT NULL' },
    { name: 'byte_size', ddl: 'byte_size INTEGER NOT NULL' },
    { name: 'created_at', ddl: 'created_at INTEGER NOT NULL' },
    { name: 'last_accessed_at', ddl: 'last_accessed_at INTEGER NOT NULL' },
  ],
};

// Package 1 (design-docs/28 §1.3): persistent artifact revision history.
// Created eagerly by the annealer so Package 1 only needs to write rows.
const ARTIFACT_REVISIONS: TableSpec = {
  name: 'artifact_revisions',
  createSql: `CREATE TABLE IF NOT EXISTS artifact_revisions (
  user_id INTEGER NOT NULL,
  project_id TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  timestamp INTEGER NOT NULL,
  actor TEXT NOT NULL DEFAULT 'ai',
  change_summary TEXT NOT NULL DEFAULT '',
  provenance_json TEXT NOT NULL DEFAULT '{}',
  title TEXT NOT NULL DEFAULT '',
  layers_json TEXT NOT NULL DEFAULT '{}',
  revision INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, project_id, artifact_id, version),
  FOREIGN KEY (user_id, project_id) REFERENCES projects(user_id, project_id) ON DELETE CASCADE
)`,
  columns: [
    { name: 'user_id', ddl: 'user_id INTEGER NOT NULL' },
    { name: 'project_id', ddl: 'project_id TEXT NOT NULL' },
    { name: 'artifact_id', ddl: 'artifact_id TEXT NOT NULL' },
    { name: 'version', ddl: 'version INTEGER NOT NULL' },
    { name: 'timestamp', ddl: 'timestamp INTEGER NOT NULL' },
    { name: 'actor', ddl: "actor TEXT NOT NULL DEFAULT 'ai'" },
    { name: 'change_summary', ddl: "change_summary TEXT NOT NULL DEFAULT ''" },
    { name: 'provenance_json', ddl: "provenance_json TEXT NOT NULL DEFAULT '{}'" },
    { name: 'title', ddl: "title TEXT NOT NULL DEFAULT ''" },
    { name: 'layers_json', ddl: "layers_json TEXT NOT NULL DEFAULT '{}'" },
    // Package 1: same revision-stamp envelope as every other domain table —
    // getProjectDelta filters revision rows by it. Added by the annealer.
    { name: 'revision', ddl: 'revision INTEGER NOT NULL DEFAULT 0' },
  ],
};

// Package 4 (design-docs/28 §4.2): ephemeral API call flight recorder (7d).
// Created eagerly by the annealer so Package 4 only needs to write rows.
const API_CALL_LOGS: TableSpec = {
  name: 'api_call_logs',
  createSql: `CREATE TABLE IF NOT EXISTS api_call_logs (
  id TEXT PRIMARY KEY,
  user_id INTEGER,
  kind TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  t_send INTEGER NOT NULL,
  t_ack INTEGER,
  t_first_token INTEGER,
  t_end INTEGER,
  status TEXT NOT NULL,
  request_json TEXT NOT NULL,
  response_text TEXT,
  usage_json TEXT,
  error_text TEXT,
  job_id TEXT,
  turn_id TEXT
)`,
  columns: [
    { name: 'id', ddl: 'id TEXT PRIMARY KEY' },
    { name: 'user_id', ddl: 'user_id INTEGER' },
    { name: 'kind', ddl: 'kind TEXT NOT NULL' },
    { name: 'provider', ddl: 'provider TEXT NOT NULL' },
    { name: 'model', ddl: 'model TEXT NOT NULL' },
    { name: 't_send', ddl: 't_send INTEGER NOT NULL' },
    { name: 't_ack', ddl: 't_ack INTEGER' },
    { name: 't_first_token', ddl: 't_first_token INTEGER' },
    { name: 't_end', ddl: 't_end INTEGER' },
    { name: 'status', ddl: 'status TEXT NOT NULL' },
    { name: 'request_json', ddl: 'request_json TEXT NOT NULL' },
    { name: 'response_text', ddl: 'response_text TEXT' },
    { name: 'usage_json', ddl: 'usage_json TEXT' },
    { name: 'error_text', ddl: 'error_text TEXT' },
    { name: 'job_id', ddl: 'job_id TEXT' },
    { name: 'turn_id', ddl: 'turn_id TEXT' },
  ],
  indexes: ['CREATE INDEX IF NOT EXISTS idx_api_call_logs_user_time ON api_call_logs(user_id, t_send DESC)'],
};

/** The whole server schema, in convergence order. */
export const TABLES_SPEC: TableSpec[] = [
  USERS,
  SESSIONS,
  USER_SECRETS,
  USER_SETTINGS,
  PROJECTS,
  THREADS,
  FOLDERS,
  TURNS,
  CHAPTERS,
  ARTIFACTS,
  EDGES,
  TOMBSTONES,
  CHAT_JOBS,
  ARTIFACT_INDEX_SECTIONS,
  TTS_CACHE,
  ARTIFACT_REVISIONS,
  API_CALL_LOGS,
];

/* ── annealer ────────────────────────────────────────────────────────────── */

function tableExists(db: Database.Database, name: string): boolean {
  return Boolean(
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name),
  );
}

function existingColumns(db: Database.Database, table: string): Set<string> {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return new Set(cols.map((c) => c.name));
}

/**
 * Converge the database to the spec, idempotently:
 *  - missing table → `CREATE TABLE IF NOT EXISTS`;
 *  - existing table missing a column → `ALTER TABLE ... ADD COLUMN`;
 *  - indexes created with `IF NOT EXISTS`.
 * Columns are never dropped; legacy columns stay for old rows. Logs one
 * `info` entry per actual change and nothing on a converged database.
 * Pass a custom `tables` spec to converge against something other than
 * `TABLES_SPEC` (used by tests).
 */
export function annealDatabase(db: Database.Database, tables: readonly TableSpec[] = TABLES_SPEC): void {
  const changes: string[] = [];
  const run = db.transaction(() => {
    for (const table of tables) {
      if (!tableExists(db, table.name)) {
        db.exec(table.createSql);
        changes.push(`created table ${table.name}`);
      } else {
        const have = existingColumns(db, table.name);
        for (const col of table.columns) {
          if (!have.has(col.name)) {
            db.exec(`ALTER TABLE ${table.name} ADD COLUMN ${col.ddl}`);
            changes.push(`added column ${table.name}.${col.name}`);
          }
        }
      }
      for (const idx of table.indexes ?? []) db.exec(idx);
    }
  });
  run();
  for (const change of changes) logServer('info', 'db', `schema anneal: ${change}`);
}
