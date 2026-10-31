/**
 * Normalized, revision-tracked project repository (design-docs/21D §2).
 *
 * All operations are synchronous better-sqlite3 calls, user-scoped, and run
 * inside a single transaction per logical write:
 * - Every write bumps `projects.revision` by 1 and stamps touched rows.
 * - Snapshot saves UPSERT only — turns are NEVER deleted because a stale
 *   tab's in-memory list hadn't seen another device's newer rows
 *   (the multi-device anti-clobber law). Explicit deletes go through
 *   `applyAtomicMutation` (or replace-all) and record tombstones.
 * - `getProjectDelta` returns only rows with revision > since, so a phone
 *   waking from sleep pulls a sub-100-byte payload when nothing changed.
 */
import { createHash } from 'node:crypto';
import { getDb } from './index';
import { logServer } from '../lib/log';
import { enqueueIndex, deleteIndexRows } from '../jobs/serverArtifactIndexer';
// All entity shapes come from the client/server contract layer (shared/).
import type { ProjectSnapshot } from '../../shared/types/projectSnapshot';
import type { ProjectDeltaResponse } from '../../shared/types/projectDelta';
import type { Turn } from '../../shared/types/timeline';
import type { ChapterPartition } from '../../shared/types/chapters';
import type { UniversalArtifactDocument } from '../../shared/types/artifact';
import type { ArtifactRevision } from '../../shared/types/artifactRevision';
import type { SemanticEdge } from '../../shared/types/graph';
import { artifactFileName } from '../../shared/artifactFileName';
import type { ChatThread, ThreadFolder, ChatCapabilities, ChatAttachment } from '../../shared/types/threads';
import {
  DEFAULT_CHAT_CAPABILITIES,
  resolveCapabilities,
} from '../../shared/types/threads';
import type { ExtractedUnlink } from '../../shared/stream/types';
import { planTurnCommit } from '../../shared/turnCommit/planTurnCommit';

export type ProjectSnapshotWithRevision = ProjectSnapshot & { revision: number };

export type { ProjectDeltaResponse };

export type AtomicMutation =
  | { op: 'upsertArtifact'; artifact: UniversalArtifactDocument }
  | { op: 'deleteArtifact'; artifactId: string }
  | { op: 'upsertThread'; thread: ChatThread }
  | { op: 'deleteThread'; threadId: string }
  | { op: 'upsertFolder'; folder: ThreadFolder }
  | { op: 'deleteFolder'; folderId: string }
  | { op: 'upsertChapter'; threadId: string; chapter: ChapterPartition }
  | { op: 'deleteChapter'; chapterId: string }
  | {
      op: 'commitPair';
      threadId: string;
      userTurn: Turn;
      assistantTurn: Turn;
      artifacts?: UniversalArtifactDocument[];
      chapters?: ChapterPartition[];
    }
  | { op: 'replaceTurn'; threadId: string; turn: Turn };

type Db = ReturnType<typeof getDb>;

function jhash(value: unknown): string {
  return createHash('sha1').update(JSON.stringify(value)).digest('hex');
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

interface ProjectRow {
  project_id: string;
  name: string;
  code_name: string;
  description: string;
  color: string;
  active_thread_id: string | null;
  granularity_law: string;
  capabilities_json: string | null;
  doc_json?: string;
  revision: number;
  updated_at: number;
}

const SELECT_PROJECT = `SELECT project_id, name, code_name, description, color, active_thread_id,
  granularity_law, capabilities_json, doc_json, revision, updated_at FROM projects WHERE user_id = ? AND project_id = ?`;

/* ── assembly ─────────────────────────────────────────────────────────────── */

function assembleProject(db: Db, userId: number, row: ProjectRow): ProjectSnapshotWithRevision {
  const threads = (
    db
      .prepare('SELECT doc_json, title, title_version, folder_id, created_at, updated_at FROM threads WHERE user_id = ? AND project_id = ?')
      .all(userId, row.project_id) as Array<{
      doc_json: string;
      title: string;
      title_version: number;
      folder_id: string | null;
      created_at: number;
      updated_at: number;
    }>
  ).map((t) => {
    const doc = parseJson<ChatThread | null>(t.doc_json, null);
    if (doc && doc.id) return doc;
    // Legacy/thin row fallback → reconstruct the minimum ChatThread.
    return {
      id: '',
      folderId: t.folder_id,
      title: t.title,
      titleState: 'auto',
      titleVersion: t.title_version,
      createdAt: t.created_at,
      updatedAt: t.updated_at,
      lastActivityAt: t.updated_at,
      lifecycle: 'active',
      lastOutcome: 'ok',
      preview: '',
      attachments: [],
    } as ChatThread;
  }).filter((t) => t.id);

  const folders = (
    db
      .prepare('SELECT folder_id, name, order_index, doc_json FROM folders WHERE user_id = ? AND project_id = ? ORDER BY order_index ASC')
      .all(userId, row.project_id) as Array<{ folder_id: string; name: string; order_index: number; doc_json: string }>
  ).map((f) => {
    // Envelope law: doc_json is the canonical ThreadFolder (any future field
    // rides inside it); the columns are the SQL-usable projection + fallback.
    const doc = parseJson<ThreadFolder | null>(f.doc_json, null);
    if (doc && doc.id) return doc;
    return { id: f.folder_id, name: f.name, order: f.order_index } as ThreadFolder;
  });

  const turns = (
    db
      .prepare(
        'SELECT doc_json, role, content, timestamp, meta_json, seq, thread_id FROM turns WHERE user_id = ? AND project_id = ? ORDER BY seq ASC, timestamp ASC'
      )
      .all(userId, row.project_id) as Array<{
      doc_json: string;
      role: string;
      content: string;
      timestamp: number;
      meta_json: string;
      seq: number;
      thread_id: string | null;
    }>
  ).map((t) => {
    const doc = parseJson<Turn | null>(t.doc_json, null);
    if (doc && doc.id) return doc;
    return {
      id: '',
      role: t.role as Turn['role'],
      content: t.content,
      timestamp: t.timestamp,
      threadId: t.thread_id || undefined,
      meta: parseJson(t.meta_json, undefined),
    } as Turn;
  }).filter((t) => t.id);

  const chapters = (
    db
      .prepare(
        'SELECT doc_json, title, description, summary, granularity, order_index, start_turn_id, end_turn_id, chapter_thread_id FROM chapters WHERE user_id = ? AND project_id = ? ORDER BY order_index ASC'
      )
      .all(userId, row.project_id) as Array<{
      doc_json: string;
      title: string;
      description: string | null;
      summary: string | null;
      granularity: string;
      order_index: number;
      start_turn_id: string;
      end_turn_id: string | null;
      chapter_thread_id: string;
    }>
  ).map((c) => {
    const doc = parseJson<ChapterPartition | null>(c.doc_json, null);
    if (doc && doc.id) return doc;
    return {
      id: '',
      workspaceId: row.project_id,
      threadId: c.chapter_thread_id || undefined,
      title: c.title,
      description: c.description ?? undefined,
      summary: c.summary ?? undefined,
      granularity: c.granularity as ChapterPartition['granularity'],
      status: c.end_turn_id ? 'completed' : 'active',
      startIndex: Number(c.start_turn_id) || 0,
      endIndex: c.end_turn_id ? Number(c.end_turn_id) : undefined,
      createdAt: row.updated_at,
    } as ChapterPartition;
  }).filter((c) => c.id);

  const artifacts = (
    db
      .prepare('SELECT doc_json FROM artifacts WHERE user_id = ? AND project_id = ?')
      .all(userId, row.project_id) as Array<{ doc_json: string }>
  ).map((a) => parseJson<UniversalArtifactDocument | null>(a.doc_json, null)).filter((a): a is UniversalArtifactDocument => Boolean(a && a.id));

  const edges = (
    db
      .prepare('SELECT edge_json FROM edges WHERE user_id = ? AND project_id = ?')
      .all(userId, row.project_id) as Array<{ edge_json: string }>
  ).map((e) => parseJson<SemanticEdge | null>(e.edge_json, null)).filter((e): e is SemanticEdge => Boolean(e && e.id));

  // Envelope law: doc_json holds any project fields beyond the SQL columns —
  // future fields survive a SQLite round-trip with zero migrations. It never
  // overrides the column-backed fields (they are the SQL-usable projection).
  const extraMeta = parseJson<Record<string, unknown> | null>(row.doc_json, null);

  return {
    ...(extraMeta ?? {}),
    projectId: row.project_id,
    name: row.name,
    codeName: row.code_name,
    description: row.description,
    color: row.color,
    activeThreadId: row.active_thread_id ?? undefined,
    granularityLaw: row.granularity_law === 'user-only' ? 'user-only' : undefined,
    capabilities: parseJson<Partial<ChatCapabilities> | null>(row.capabilities_json, null) ?? undefined,
    updatedAt: row.updated_at,
    revision: row.revision,
    threads,
    folders,
    turns,
    chapters,
    artifacts,
    edges,
    revisions: loadArtifactRevisions(db, userId, row.project_id),
  };
}

/* ── row writers (inside a transaction) ───────────────────────────────────── */

function upsertProjectMeta(db: Db, userId: number, snap: ProjectSnapshot, newRev: number): void {
  const now = Date.now();
  // Envelope law: doc_json carries everything beyond the SQL columns. The
  // column-backed keys are excluded so the projection stays the projection —
  // otherwise reads would double-store (and drift) the same field.
  const COLUMN_KEYS = new Set([
    'projectId', 'turns', 'chapters', 'artifacts', 'edges', 'threads', 'folders', 'revisions',
    'name', 'codeName', 'description', 'color', 'activeThreadId', 'granularityLaw',
    'capabilities', 'updatedAt', 'revision',
  ]);
  const extraMeta: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(snap)) {
    if (!COLUMN_KEYS.has(k) && v !== undefined) extraMeta[k] = v;
  }
  db.prepare(
    `INSERT INTO projects (project_id, user_id, name, code_name, description, color, active_thread_id,
       granularity_law, capabilities_json, doc_json, revision, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, project_id) DO UPDATE SET
       name = excluded.name, code_name = excluded.code_name, description = excluded.description,
       color = excluded.color, active_thread_id = excluded.active_thread_id,
       granularity_law = excluded.granularity_law, capabilities_json = excluded.capabilities_json,
       doc_json = excluded.doc_json, revision = excluded.revision, updated_at = excluded.updated_at`
  ).run(
    snap.projectId,
    userId,
    snap.name ?? 'Untitled Project',
    snap.codeName ?? '',
    snap.description ?? '',
    snap.color ?? '#e05a66',
    snap.activeThreadId ?? null,
    snap.granularityLaw ?? 'user-only',
    snap.capabilities ? JSON.stringify(snap.capabilities) : null,
    JSON.stringify(extraMeta),
    newRev,
    snap.updatedAt || now
  );
}

// Envelope contract (design-docs/28 §5.3): `doc_json` is the canonical Turn.
// `role`/`content`/`timestamp`/`meta_json` are legacy duplicates kept in sync
// so old rows (and the legacy fallback in assembleProject/turnRowHash) stay
// honest; they are never the source of truth for a read when doc_json is set.
function upsertTurn(db: Db, userId: number, projectId: string, turn: Turn, seq: number, rev: number): void {
  const doc = JSON.stringify(turn);
  db.prepare(
    `INSERT INTO turns (user_id, project_id, thread_id, turn_id, seq, role, content, timestamp, meta_json, doc_json, revision)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, project_id, turn_id) DO UPDATE SET
       thread_id = excluded.thread_id, seq = excluded.seq, role = excluded.role,
       content = excluded.content, timestamp = excluded.timestamp,
       meta_json = excluded.meta_json, doc_json = excluded.doc_json, revision = excluded.revision`
  ).run(
    userId,
    projectId,
    turn.threadId ?? '', // thread_id is NOT NULL; absent thread scoping lives in doc_json
    turn.id,
    seq,
    turn.role,
    turn.content ?? '', // content NOT NULL
    turn.timestamp ?? Date.now(), // timestamp NOT NULL
    JSON.stringify(turn.meta ?? null),
    doc,
    rev
  );
}

function turnRowHash(db: Db, userId: number, projectId: string, turnId: string): string | null {
  const row = db
    .prepare('SELECT doc_json, content, meta_json FROM turns WHERE user_id = ? AND project_id = ? AND turn_id = ?')
    .get(userId, projectId, turnId) as { doc_json: string; content: string; meta_json: string } | undefined;
  if (!row) return null;
  if (row.doc_json && row.doc_json !== '{}') {
    return jhash(parseJson(row.doc_json, null));
  }
  return jhash({ content: row.content, meta: parseJson(row.meta_json, null) });
}

function upsertThread(db: Db, userId: number, projectId: string, thread: ChatThread, rev: number): void {
  db.prepare(
    `INSERT INTO threads (user_id, project_id, thread_id, title, title_version, folder_id, created_at, updated_at, doc_json, revision)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, project_id, thread_id) DO UPDATE SET
       title = excluded.title, title_version = excluded.title_version, folder_id = excluded.folder_id,
       updated_at = excluded.updated_at, doc_json = excluded.doc_json, revision = excluded.revision`
  ).run(
    userId,
    projectId,
    thread.id,
    thread.title ?? '', // title NOT NULL
    thread.titleVersion ?? 0,
    thread.folderId ?? null, // folder_id is nullable
    thread.createdAt ?? Date.now(), // created_at NOT NULL
    thread.updatedAt ?? Date.now(), // updated_at NOT NULL
    JSON.stringify(thread),
    rev
  );
}

function upsertFolder(db: Db, userId: number, projectId: string, folder: ThreadFolder, rev: number): void {
  db.prepare(
    `INSERT INTO folders (user_id, project_id, folder_id, name, order_index, doc_json, revision)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, project_id, folder_id) DO UPDATE SET
       name = excluded.name, order_index = excluded.order_index, doc_json = excluded.doc_json,
       revision = excluded.revision`
  ).run(userId, projectId, folder.id, folder.name ?? '', folder.order ?? 0, JSON.stringify(folder), rev); // name NOT NULL
}

// Envelope contract (design-docs/28 §5.3): `doc_json` is the canonical
// ChapterPartition. `title`/`description`/`summary`/`granularity`/
// `start_turn_id`/`end_turn_id` are legacy duplicates kept in sync for the
// legacy fallback in assembleProject; doc_json wins on every read.
function upsertChapter(db: Db, userId: number, projectId: string, chapter: ChapterPartition, orderIndex: number, rev: number): void {
  db.prepare(
    `INSERT INTO chapters (user_id, project_id, thread_id, chapter_id, start_turn_id, end_turn_id, title,
       description, summary, granularity, order_index, doc_json, chapter_thread_id, revision)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, project_id, chapter_id) DO UPDATE SET
       title = excluded.title, description = excluded.description, summary = excluded.summary,
       granularity = excluded.granularity, order_index = excluded.order_index,
       doc_json = excluded.doc_json, chapter_thread_id = excluded.chapter_thread_id,
       revision = excluded.revision`
  ).run(
    userId,
    projectId,
    chapter.threadId ?? '', // thread_id is NOT NULL; absent thread scoping lives in doc_json
    chapter.id,
    String(chapter.startIndex ?? 0),
    chapter.endIndex !== undefined && chapter.endIndex !== null ? String(chapter.endIndex) : null,
    chapter.title,
    chapter.description ?? null,
    chapter.summary ?? null,
    chapter.granularity ?? 'full',
    orderIndex,
    JSON.stringify(chapter),
    chapter.threadId ?? '',
    rev
  );
}

function upsertArtifact(db: Db, userId: number, projectId: string, doc: UniversalArtifactDocument, rev: number): void {
  if (!doc?.id) throw new Error('upsertArtifact: artifact.id is required.'); // artifact_id NOT NULL
  db.prepare(
    `INSERT INTO artifacts (user_id, project_id, artifact_id, doc_json, updated_at, revision)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, project_id, artifact_id) DO UPDATE SET
       doc_json = excluded.doc_json, updated_at = excluded.updated_at, revision = excluded.revision`
  ).run(userId, projectId, doc.id, JSON.stringify(doc), Date.now(), rev);
  // 21F: server-side semantic indexing (FIFO, content-hash deduped).
  enqueueIndex(userId, projectId, doc.id);
}

function upsertEdge(db: Db, userId: number, projectId: string, edge: SemanticEdge, rev: number): void {
  if (!edge?.id) throw new Error('upsertEdge: edge.id is required.'); // edge_id NOT NULL
  db.prepare(
    `INSERT INTO edges (user_id, project_id, edge_id, edge_json, revision)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, project_id, edge_id) DO UPDATE SET
       edge_json = excluded.edge_json, revision = excluded.revision`
  ).run(userId, projectId, edge.id, JSON.stringify(edge), rev);
}

function recordTombstone(db: Db, userId: number, projectId: string, entityType: string, entityId: string, rev: number): void {
  db.prepare(
    'INSERT INTO tombstones (user_id, project_id, entity_type, entity_id, revision) VALUES (?, ?, ?, ?, ?)'
  ).run(userId, projectId, entityType, entityId, rev);
}

/* ── artifact revisions (design-docs/28 §1.3 — persistent 4-layer history) ── */

/** Upsert one revision row for an artifact (same envelope pattern as the other domain tables). */
function upsertArtifactRevision(
  db: Db,
  userId: number,
  projectId: string,
  artifactId: string,
  revision: ArtifactRevision,
  rev: number
): void {
  db.prepare(
    `INSERT INTO artifact_revisions (user_id, project_id, artifact_id, version, timestamp, actor,
       change_summary, provenance_json, title, layers_json, doc_json, revision)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, project_id, artifact_id, version) DO UPDATE SET
       timestamp = excluded.timestamp, actor = excluded.actor,
       change_summary = excluded.change_summary, provenance_json = excluded.provenance_json,
       title = excluded.title, layers_json = excluded.layers_json, doc_json = excluded.doc_json,
       revision = excluded.revision`
  ).run(
    userId,
    projectId,
    artifactId,
    revision.version,
    revision.timestamp,
    revision.actor,
    revision.changeSummary,
    JSON.stringify(revision.provenance ?? {}),
    revision.title ?? '',
    JSON.stringify(revision.layers ?? {}),
    // Envelope law: the full revision doc is canonical — future fields ride
    // here with zero SQL migrations. The columns stay in sync as the
    // SQL-usable projection (and the legacy fallback for old rows).
    JSON.stringify(revision),
    rev
  );
}

/** Upsert a client-provided revision list for one artifact. Client versions win; nothing is deleted. */
export function upsertArtifactRevisions(
  db: Db,
  userId: number,
  projectId: string,
  artifactId: string,
  revisions: ArtifactRevision[],
  newRev: number
): void {
  for (const r of revisions) {
    if (!r || typeof r.version !== 'number') continue;
    upsertArtifactRevision(db, userId, projectId, artifactId, r, newRev);
  }
}

/** Load the full revision history of a project, keyed by artifact id. */
export function loadArtifactRevisions(db: Db, userId: number, projectId: string): Record<string, ArtifactRevision[]> {
  const rows = db
    .prepare(
      'SELECT artifact_id, version, timestamp, actor, change_summary, provenance_json, title, layers_json, doc_json FROM artifact_revisions WHERE user_id = ? AND project_id = ? ORDER BY artifact_id ASC, version ASC'
    )
    .all(userId, projectId) as Array<{
    artifact_id: string;
    version: number;
    timestamp: number;
    actor: string;
    change_summary: string;
    provenance_json: string;
    title: string;
    layers_json: string;
    doc_json: string;
  }>;
  const out: Record<string, ArtifactRevision[]> = {};
  for (const r of rows) {
    const list = (out[r.artifact_id] ??= []);
    // Envelope law: the doc_json revision doc wins when present (any future
    // field rides inside it); legacy columns reconstruct older rows.
    const doc = parseJson<ArtifactRevision | null>(r.doc_json, null);
    if (doc && doc.version !== undefined) {
      list.push(doc);
      continue;
    }
    list.push({
      version: r.version,
      timestamp: r.timestamp,
      actor: r.actor === 'user' ? 'user' : 'ai',
      changeSummary: r.change_summary,
      provenance: parseJson(r.provenance_json, {}) || undefined,
      title: r.title,
      layers: parseJson(r.layers_json, { subtitle: '', description: '', summary: '', body: '' }),
    });
  }
  return out;
}

/** Next artifact_revisions version for one artifact (server-side recorder). */
function nextArtifactRevisionVersion(db: Db, userId: number, projectId: string, artifactId: string): number {
  const row = db
    .prepare(
      'SELECT COALESCE(MAX(version), 0) AS v FROM artifact_revisions WHERE user_id = ? AND project_id = ? AND artifact_id = ?'
    )
    .get(userId, projectId, artifactId) as { v: number };
  return row.v + 1;
}

/**
 * Server-side revision record for the AI upsert path (design-docs/28 §1.5):
 * snapshots the artifact's OLD state before an upsert overwrites it, or the
 * NEW state when the artifact is being created (version 1).
 */
function recordServerArtifactRevision(
  db: Db,
  userId: number,
  projectId: string,
  doc: UniversalArtifactDocument,
  provenance: { threadId?: string; turnId?: string; turnIndex?: number | null },
  rev: number
): void {
  const existingRow = db
    .prepare('SELECT doc_json FROM artifacts WHERE user_id = ? AND project_id = ? AND artifact_id = ?')
    .get(userId, projectId, doc.id) as { doc_json: string } | undefined;
  const existing = existingRow?.doc_json
    ? parseJson<UniversalArtifactDocument | null>(existingRow.doc_json, null)
    : null;
  const snapshot: UniversalArtifactDocument = existing ?? doc;
  const creating = !existing;
  upsertArtifactRevision(
    db,
    userId,
    projectId,
    doc.id,
    {
      version: nextArtifactRevisionVersion(db, userId, projectId, doc.id),
      timestamp: Date.now(),
      actor: 'ai',
      changeSummary: creating
        ? `Created from chat: ${doc.current?.description || ''}`
        : `Update from chat: ${doc.current?.description || ''}`,
      provenance: Object.keys(provenance).length > 0 ? provenance : undefined,
      title: snapshot.title ?? '',
      layers: {
        subtitle: snapshot.current?.subtitle ?? '',
        description: snapshot.current?.description ?? '',
        summary: snapshot.current?.summary ?? '',
        body: snapshot.current?.body ?? '',
      },
    },
    rev
  );
}

function docChanged(db: Db, table: string, idCol: string, jsonCol: string, id: string, userId: number, projectId: string, nextDoc: string): boolean {
  const row = db
    .prepare(`SELECT ${jsonCol} AS doc_json FROM ${table} WHERE user_id = ? AND project_id = ? AND ${idCol} = ?`)
    .get(userId, projectId, id) as { doc_json?: string } | undefined;
  if (!row || !row.doc_json || row.doc_json === '{}') return true;
  try {
    return jhash(JSON.parse(row.doc_json)) !== jhash(JSON.parse(nextDoc));
  } catch {
    return true;
  }
}

/* ── public API ───────────────────────────────────────────────────────────── */

export function listProjectsForUser(userId: number): ProjectSnapshotWithRevision[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT project_id, name, code_name, description, color, active_thread_id, granularity_law, capabilities_json, doc_json, revision, updated_at
       FROM projects WHERE user_id = ? ORDER BY updated_at DESC`
    )
    .all(userId) as ProjectRow[];
  return rows.map((r) => assembleProject(db, userId, r));
}

export function loadProjectForUser(userId: number, projectId: string): ProjectSnapshotWithRevision | null {
  const db = getDb();
  const row = db.prepare(SELECT_PROJECT).get(userId, projectId) as ProjectRow | undefined;
  if (!row) return null;
  return assembleProject(db, userId, row);
}

/**
 * Snapshot save with row-level merging (21D §2.3).
 * Upserts changed rows, bumps ONE revision per call, NEVER deletes entities
 * missing from the incoming snapshot (anti-clobber law).
 */
export function applyProjectSnapshotDiff(userId: number, snapshot: ProjectSnapshot): { revision: number } {
  const db = getDb();
  const tx = db.transaction((): { revision: number } => {
    const cur = db.prepare(SELECT_PROJECT).get(userId, snapshot.projectId) as ProjectRow | undefined;
    const newRev = (cur?.revision ?? 0) + 1;
    upsertProjectMeta(db, userId, snapshot, newRev);

    snapshot.turns?.forEach((turn, idx) => {
      if (turnRowHash(db, userId, snapshot.projectId, turn.id) === jhash(turn)) return; // unchanged
      upsertTurn(db, userId, snapshot.projectId, turn, idx, newRev);
    });
    for (const thread of snapshot.threads ?? []) {
      if (!docChanged(db, 'threads', 'thread_id', 'doc_json', thread.id, userId, snapshot.projectId, JSON.stringify(thread))) continue;
      upsertThread(db, userId, snapshot.projectId, thread, newRev);
    }
    (snapshot.folders ?? []).forEach((folder, idx) => {
      const row = db
        .prepare('SELECT name, order_index FROM folders WHERE user_id = ? AND project_id = ? AND folder_id = ?')
        .get(userId, snapshot.projectId, folder.id) as { name: string; order_index: number } | undefined;
      if (row && row.name === folder.name && row.order_index === (folder.order ?? idx)) return;
      upsertFolder(db, userId, snapshot.projectId, folder, newRev);
    });
    snapshot.chapters?.forEach((chapter, idx) => {
      if (!docChanged(db, 'chapters', 'chapter_id', 'doc_json', chapter.id, userId, snapshot.projectId, JSON.stringify(chapter))) return;
      upsertChapter(db, userId, snapshot.projectId, chapter, idx, newRev);
    });
    for (const artifact of snapshot.artifacts ?? []) {
      if (!docChanged(db, 'artifacts', 'artifact_id', 'doc_json', artifact.id, userId, snapshot.projectId, JSON.stringify(artifact))) continue;
      upsertArtifact(db, userId, snapshot.projectId, artifact, newRev);
    }
    // Package 1: revision history rides the snapshot (client is the source of
    // truth for history; server rows are upserted, never deleted here).
    const snapshotRevisions = snapshot.revisions ?? {};
    for (const [artifactId, revisions] of Object.entries(snapshotRevisions)) {
      if (!revisions || revisions.length === 0) continue;
      upsertArtifactRevisions(db, userId, snapshot.projectId, artifactId, revisions, newRev);
    }
    for (const edge of snapshot.edges ?? []) {
      if (!docChanged(db, 'edges', 'edge_id', 'edge_json', edge.id, userId, snapshot.projectId, JSON.stringify(edge))) continue;
      upsertEdge(db, userId, snapshot.projectId, edge, newRev);
    }
    return { revision: newRev };
  });
  return tx();
}

/** Apply one explicit atomic mutation; bumps revision inside the transaction. */
export function applyAtomicMutation(
  userId: number,
  projectId: string,
  mutations: AtomicMutation | AtomicMutation[]
): { revision: number } {
  const db = getDb();
  const list = Array.isArray(mutations) ? mutations : [mutations];
  const tx = db.transaction((): { revision: number } => {
    let cur = db.prepare(SELECT_PROJECT).get(userId, projectId) as ProjectRow | undefined;
    if (!cur) {
      // Mutations target an existing project; create an empty shell so a
      // race (create + immediate commitPair) cannot 404.
      upsertProjectMeta(db, userId, { projectId, turns: [], chapters: [], artifacts: [], edges: [], updatedAt: Date.now() } as ProjectSnapshot, 0);
      cur = db.prepare(SELECT_PROJECT).get(userId, projectId) as ProjectRow;
    }
    const newRev = cur.revision + 1;
    db.prepare('UPDATE projects SET revision = ?, updated_at = ? WHERE user_id = ? AND project_id = ?').run(
      newRev,
      Date.now(),
      userId,
      projectId
    );

    const nextTurnSeq = (): number => {
      const row = db
        .prepare('SELECT COALESCE(MAX(seq), -1) AS m FROM turns WHERE user_id = ? AND project_id = ?')
        .get(userId, projectId) as { m: number };
      return row.m + 1;
    };

    for (const m of list) {
      switch (m.op) {
        case 'upsertArtifact':
          upsertArtifact(db, userId, projectId, m.artifact, newRev);
          break;
        case 'deleteArtifact': {
          db.prepare('DELETE FROM artifacts WHERE user_id = ? AND project_id = ? AND artifact_id = ?').run(userId, projectId, m.artifactId);
          db.prepare('DELETE FROM artifact_revisions WHERE user_id = ? AND project_id = ? AND artifact_id = ?').run(userId, projectId, m.artifactId);
          deleteIndexRows(userId, projectId, m.artifactId);
          recordTombstone(db, userId, projectId, 'artifact', m.artifactId, newRev);
          break;
        }
        case 'upsertThread':
          upsertThread(db, userId, projectId, m.thread, newRev);
          break;
        case 'deleteThread': {
          db.prepare('DELETE FROM turns WHERE user_id = ? AND project_id = ? AND thread_id = ?').run(userId, projectId, m.threadId);
          db.prepare('DELETE FROM threads WHERE user_id = ? AND project_id = ? AND thread_id = ?').run(userId, projectId, m.threadId);
          recordTombstone(db, userId, projectId, 'thread', m.threadId, newRev);
          break;
        }
        case 'upsertFolder':
          upsertFolder(db, userId, projectId, m.folder, newRev);
          break;
        case 'deleteFolder': {
          db.prepare('DELETE FROM folders WHERE user_id = ? AND project_id = ? AND folder_id = ?').run(userId, projectId, m.folderId);
          recordTombstone(db, userId, projectId, 'folder', m.folderId, newRev);
          break;
        }
        case 'upsertChapter':
          upsertChapter(db, userId, projectId, m.chapter, 0, newRev);
          break;
        case 'deleteChapter': {
          db.prepare('DELETE FROM chapters WHERE user_id = ? AND project_id = ? AND chapter_id = ?').run(userId, projectId, m.chapterId);
          recordTombstone(db, userId, projectId, 'chapter', m.chapterId, newRev);
          break;
        }
        case 'commitPair': {
          upsertTurn(db, userId, projectId, { ...m.userTurn, threadId: m.threadId }, nextTurnSeq(), newRev);
          upsertTurn(db, userId, projectId, { ...m.assistantTurn, threadId: m.threadId }, nextTurnSeq(), newRev);
          for (const a of m.artifacts ?? []) upsertArtifact(db, userId, projectId, a, newRev);
          (m.chapters ?? []).forEach((c, i) => upsertChapter(db, userId, projectId, c, i, newRev));
          break;
        }
        case 'replaceTurn': {
          // Partial replacement payloads (e.g. {id, content} on regenerate) merge
          // into the stored turn — a bare upsert would crash NOT NULL columns
          // (role/timestamp) and re-seq the row to the end of the timeline.
          const row = db
            .prepare('SELECT doc_json, seq FROM turns WHERE user_id = ? AND project_id = ? AND turn_id = ?')
            .get(userId, projectId, m.turn.id) as { doc_json: string; seq: number } | undefined;
          const prev = parseJson<Turn | null>(row?.doc_json, null);
          const merged = { ...(prev ?? {}), ...m.turn, threadId: m.threadId } as Turn;
          if (!merged.role || merged.content === undefined || merged.timestamp === undefined) {
            throw new Error(
              `replaceTurn: turn ${m.turn.id} is not stored yet and the replacement is missing role, content, or timestamp.`
            );
          }
          upsertTurn(db, userId, projectId, merged, row?.seq ?? nextTurnSeq(), newRev);
          break;
        }
        default: {
          const never: never = m;
          throw new Error(`Unknown mutation: ${JSON.stringify(never)}`);
        }
      }
    }
    return { revision: newRev };
  });
  return tx();
}

/* ── chat jobs (21E) ──────────────────────────────────────────────────────── */

export interface ChatJobSummary {
  jobId: string;
  threadId: string;
  kind: 'send' | 'regenerate';
  state: string;
  askText: string;
  partialText: string;
  errorReason: string | null;
  model: string;
}

/** Non-completed jobs for a project — what delta/GET /jobs expose (21E §3). */
export function getJobSummaryRows(userId: number, projectId: string): ChatJobSummary[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT job_id, thread_id, kind, state, ask_text, partial_text, error_reason, model
       FROM chat_jobs WHERE user_id = ? AND project_id = ? AND state != 'completed'
       ORDER BY created_at ASC`
    )
    .all(userId, projectId) as Array<{
    job_id: string;
    thread_id: string;
    kind: string;
    state: string;
    ask_text: string;
    partial_text: string;
    error_reason: string | null;
    model: string;
  }>;
  return rows.map((r) => ({
    jobId: r.job_id,
    threadId: r.thread_id,
    kind: r.kind as 'send' | 'regenerate',
    state: r.state,
    askText: r.ask_text,
    partialText: r.partial_text,
    errorReason: r.error_reason,
    model: r.model,
  }));
}

/** Bare revision bump (job failure/stop, chores) — creates the shell row if needed. */
export function bumpProjectRevision(userId: number, projectId: string): number {
  const db = getDb();
  const tx = db.transaction((): number => {
    const cur = db.prepare(SELECT_PROJECT).get(userId, projectId) as ProjectRow | undefined;
    if (!cur) {
      upsertProjectMeta(
        db,
        userId,
        { projectId, name: 'Untitled Project', turns: [], chapters: [], artifacts: [], edges: [], updatedAt: Date.now() } as ProjectSnapshot,
        1
      );
      return 1;
    }
    const next = cur.revision + 1;
    db.prepare('UPDATE projects SET revision = ?, updated_at = ? WHERE user_id = ? AND project_id = ?').run(
      next,
      Date.now(),
      userId,
      projectId
    );
    return next;
  });
  return tx();
}

export interface CommitJobInput {
  userId: number;
  projectId: string;
  threadId: string;
  kind: 'send' | 'regenerate';
  targetTurnId: string | null;
  askText: string;
  replyText: string;
  model: string;
  stagedAttachments: unknown[];
  artifacts: Array<{
    id: string;
    title: string;
    type: 'document' | 'chapter';
    content: { subtitle: string; description: string; summary: string; body: string };
  }>;
  shifts: Array<{ title: string; subtitle?: string; description?: string; summary?: string }>;
  /**
   * Parsed <link> tags from the demuxer (chatJobRunner passes finalDemux.links).
   * THE data path for graph links: the runner hands the commit the DEMUXED
   * clean text (tags already stripped), so re-parsing replyText finds nothing —
   * the parsed links must ride this field. Absent → fall back to parsing
   * replyText (paths that receive un-demuxed text).
   */
  links?: Array<{ source: string; target: string; kind: string }>;
  /** Parsed <unlink> tags — break the link(s) between a pair (kind narrows). */
  unlinks?: Array<{ source: string; target: string; kind: string | null }>;
  /**
   * Resolved chat capabilities the job ran with (Package 2 §2.4). Absent →
   * DEFAULT_CHAT_CAPABILITIES. A capability that is OFF means its buffered
   * blocks are IGNORED at commit, exactly like the client apply path.
   */
  capabilities?: Partial<ChatCapabilities>;
  pairKey: string;
  isFallbackPartial?: boolean;
  /**
   * Token telemetry for the assistant turn (mirror of the client commitPair's
   * TurnMeta). Server jobs used to commit turns with NO tokens — the mirror
   * showed "0 in · 0 out · 0 total tok" for every send-and-forget reply
   * (found live 2026-10-25).
   */
  telemetry?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    latencyMs?: number;
    timeToFirstChunkMs?: number;
    /** Flight-recorder row id — written into the assistant turn meta. */
    callId?: string;
  };
}

/**
 * ONE transaction commits the job's result (21E §2.3.5): pair (or regenerate
 * replacement), buffered artifacts, topic-shift chapters, thread touch, and
 * a revision bump — then the chat_jobs row is deleted by the caller.
 *
 * Phase 3: the DECISIONS live in the shared pure planner
 * (shared/turnCommit/planTurnCommit.ts) — the same code the client
 * sendQueue path runs. This function gathers the state, builds the request,
 * and APPLIES the returned plan inside the transaction (same revision-bump /
 * rollback semantics as before).
 */
export function commitJobPairTransaction(input: CommitJobInput): {
  revision: number;
  userTurnId: string;
  assistantTurnId: string;
} {
  const db = getDb();
  const tx = db.transaction(() => {
    const cur = db.prepare(SELECT_PROJECT).get(input.userId, input.projectId) as ProjectRow | undefined;
    if (!cur) {
      upsertProjectMeta(
        db,
        input.userId,
        {
          projectId: input.projectId,
          name: 'Untitled Project',
          turns: [],
          chapters: [],
          artifacts: [],
          edges: [],
          updatedAt: Date.now(),
        } as ProjectSnapshot,
        0
      );
    }
    const newRev = (cur?.revision ?? 0) + 1;
    db.prepare('UPDATE projects SET revision = ?, updated_at = ? WHERE user_id = ? AND project_id = ?').run(
      newRev,
      Date.now(),
      input.userId,
      input.projectId
    );

    const now = Date.now();
    const caps = resolveCapabilities(null, input.capabilities ?? DEFAULT_CHAT_CAPABILITIES);

    // Graph-link fallback (David's receipts law, 2026-10-30): the runner hands
    // the commit the DEMUXED clean text plus the PARSED links; paths that
    // receive un-demuxed text fall back to parsing here. The planner strips
    // any residual tags from the stored reply again defensively.
    const parseLinks = (text: string): Array<{ source: string; target: string; kind: string }> => {
      const out: Array<{ source: string; target: string; kind: string }> = [];
      for (const tag of text.match(/<link\b[^>]*>/gi) ?? []) {
        const source = /source\s*=\s*"([^"]*)"/i.exec(tag)?.[1];
        const target = /target\s*=\s*"([^"]*)"/i.exec(tag)?.[1];
        const kind = /kind\s*=\s*"([^"]*)"/i.exec(tag)?.[1];
        if (source && target && kind) out.push({ source, target, kind });
      }
      return out;
    };
    const links = input.links && input.links.length > 0 ? input.links : parseLinks(input.replyText);

    /* ── Gather the state the planner needs (pure reads, inside the tx) ── */
    const stateArtifacts: Array<Pick<UniversalArtifactDocument, 'id' | 'code' | 'title'>> = [];
    for (const row of db
      .prepare('SELECT artifact_id, doc_json FROM artifacts WHERE user_id = ? AND project_id = ?')
      .all(input.userId, input.projectId) as Array<{ artifact_id: string; doc_json: string }>) {
      try {
        const doc = JSON.parse(row.doc_json) as { id?: string; code?: string; title?: string };
        if (doc.id) stateArtifacts.push({ id: doc.id, code: doc.code ?? '', title: doc.title ?? '' });
      } catch {
        /* thin row */
      }
    }
    const stateEdges: SemanticEdge[] = [];
    for (const row of db
      .prepare('SELECT edge_json FROM edges WHERE user_id = ? AND project_id = ?')
      .all(input.userId, input.projectId) as Array<{ edge_json: string }>) {
      try {
        const e = JSON.parse(row.edge_json) as SemanticEdge;
        if (e && e.id && e.sourceId && e.targetId) stateEdges.push(e);
      } catch {
        /* thin row */
      }
    }
    const chapterRows = db
      .prepare(
        'SELECT chapter_id, doc_json, order_index FROM chapters WHERE user_id = ? AND project_id = ? AND chapter_thread_id = ? ORDER BY order_index ASC'
      )
      .all(input.userId, input.projectId, input.threadId) as Array<{
      chapter_id: string;
      doc_json: string;
      order_index: number;
    }>;
    const stateChapters: ChapterPartition[] = [];
    const chapterOrder = new Map<string, number>();
    for (const r of chapterRows) {
      const doc = parseJson<ChapterPartition | null>(r.doc_json, null);
      if (doc) {
        stateChapters.push(doc);
        chapterOrder.set(doc.id, r.order_index);
      }
    }
    const threadTurnsCount = (db
      .prepare('SELECT COUNT(*) AS n FROM turns WHERE user_id = ? AND project_id = ? AND thread_id = ?')
      .get(input.userId, input.projectId, input.threadId) as { n: number }).n;

    /* ── Regenerate: the current turn doc + its index within the thread ── */
    let existingAssistantTurn: Turn | null = null;
    let targetSeq = 0;
    let targetTurnIndex = Math.max(0, threadTurnsCount - 1);
    if (input.kind === 'regenerate' && input.targetTurnId) {
      const row = db
        .prepare('SELECT doc_json, seq FROM turns WHERE user_id = ? AND project_id = ? AND turn_id = ?')
        .get(input.userId, input.projectId, input.targetTurnId) as { doc_json: string; seq: number } | undefined;
      targetSeq = row?.seq ?? 0;
      try {
        existingAssistantTurn = row?.doc_json ? (JSON.parse(row.doc_json) as Turn) : null;
      } catch {
        existingAssistantTurn = null;
      }
      if (!existingAssistantTurn) {
        existingAssistantTurn = {
          id: input.targetTurnId,
          role: 'assistant',
          content: '',
          timestamp: now,
          threadId: input.threadId,
        };
      }
      // The replaced turn's index WITHIN its thread (AI-attachment law) —
      // count the thread's turns that precede it by seq.
      targetTurnIndex = (db
        .prepare(
          'SELECT COUNT(*) AS n FROM turns WHERE user_id = ? AND project_id = ? AND thread_id = ? AND seq < ?'
        )
        .get(input.userId, input.projectId, input.threadId, targetSeq) as { n: number }).n;
    }

    /* ── Plan (pure, shared with the client) ── */
    const plan = planTurnCommit({
      kind: input.kind,
      threadId: input.threadId,
      pairKey: input.pairKey,
      projectId: input.projectId,
      targetTurnId: input.targetTurnId,
      existingAssistantTurn,
      targetTurnIndex,
      askText: input.askText,
      cleanReply: input.replyText,
      artifactUpserts: input.artifacts,
      topicShift: input.shifts.length > 0 ? input.shifts[input.shifts.length - 1] : null,
      links,
      unlinks: (input.unlinks ?? []) as ExtractedUnlink[],
      stagedAttachments: (input.stagedAttachments ?? []) as ChatAttachment[],
      capabilities: caps,
      telemetry: {
        ...(input.telemetry ?? {}),
        model: input.model,
        isFallback: Boolean(input.isFallbackPartial),
      },
      now,
      ids: {
        userTurnId: `turn-user-${input.pairKey}`,
        assistantTurnId: input.targetTurnId ?? `turn-ai-${input.pairKey}`,
      },
      state: {
        artifacts: stateArtifacts,
        edges: stateEdges,
        threadTurnsCount,
        chapters: stateChapters,
      },
    });

    /* ── Apply the plan: same transaction, same revision-bump/rollback ── */
    if (plan.userTurn) {
      const seqRow = db
        .prepare('SELECT COALESCE(MAX(seq), -1) AS m FROM turns WHERE user_id = ? AND project_id = ?')
        .get(input.userId, input.projectId) as { m: number };
      const base = seqRow.m + 1;
      upsertTurn(db, input.userId, input.projectId, plan.userTurn, base, newRev);
      upsertTurn(db, input.userId, input.projectId, plan.assistantTurn, base + 1, newRev);
    } else {
      // Regenerate replaces the reply in place — same seq, same id.
      upsertTurn(db, input.userId, input.projectId, plan.assistantTurn, targetSeq, newRev);
    }

    // Package 1 §1.5: record the artifact's history in the SAME transaction
    // as the pair commit — old state for existing notes, birth state for new
    // ones. recordServerArtifactRevision snapshots from the DB, which still
    // holds the pre-upsert state — exactly the revision the plan carries.
    for (const op of plan.artifactOps) {
      recordServerArtifactRevision(
        db,
        input.userId,
        input.projectId,
        op.artifact,
        op.revision.provenance,
        newRev
      );
      upsertArtifact(db, input.userId, input.projectId, op.artifact, newRev);
    }

    if (plan.chapterOp) {
      const { boundaryToRetitle, chapterToSeal, create } = plan.chapterOp;
      if (boundaryToRetitle) {
        // A cut already exists here — the plan already retitled the doc;
        // upsert it at its own order slot, never duplicate.
        upsertChapter(
          db,
          input.userId,
          input.projectId,
          boundaryToRetitle,
          chapterOrder.get(boundaryToRetitle.id) ?? stateChapters.length,
          newRev
        );
      } else {
        if (chapterToSeal) {
          const sealed = stateChapters.find((c) => c.id === chapterToSeal.id);
          if (sealed) {
            sealed.status = 'completed';
            sealed.endIndex = chapterToSeal.endIndex;
            upsertChapter(
              db,
              input.userId,
              input.projectId,
              sealed,
              chapterOrder.get(sealed.id) ?? stateChapters.length,
              newRev
            );
          }
        }
        if (create) {
          // The planner stays deterministic: the id is assigned HERE.
          const chId = `ch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
          upsertChapter(
            db,
            input.userId,
            input.projectId,
            { ...create, id: chId },
            stateChapters.length,
            newRev
          );
        }
      }
    }

    for (const e of plan.edgeUpserts) {
      upsertEdge(db, input.userId, input.projectId, e, newRev);
    }
    for (const edgeId of plan.edgeDeletes) {
      db.prepare('DELETE FROM edges WHERE user_id = ? AND project_id = ? AND edge_id = ?').run(
        input.userId,
        input.projectId,
        edgeId
      );
      recordTombstone(db, input.userId, input.projectId, 'edge', edgeId, newRev);
    }
    if (plan.receipts.length > 0) {
      // Receipts ride the assistant turn doc itself (written by upsertTurn
      // above) — no second UPDATE, nothing left that can fail the pair.
      logServer(
        'info',
        'JOBS',
        `Pair committed with ${plan.edgeUpserts.length} graph link(s), ${plan.receipts.length} receipt(s)`
      );
    }

    // Touch the thread (preview + lastOutcome) so the sidebar reflects the pair.
    const threadRow = db
      .prepare('SELECT doc_json FROM threads WHERE user_id = ? AND project_id = ? AND thread_id = ?')
      .get(input.userId, input.projectId, input.threadId) as { doc_json: string } | undefined;
    if (threadRow?.doc_json && threadRow.doc_json !== '{}') {
      try {
        const threadDoc = JSON.parse(threadRow.doc_json) as Record<string, unknown>;
        threadDoc.lastOutcome = plan.threadTouch.lastOutcome;
        threadDoc.lastActivityAt = plan.threadTouch.lastActivityAt;
        threadDoc.preview = plan.threadTouch.preview;
        db.prepare(
          'UPDATE threads SET doc_json = ?, updated_at = ?, revision = ? WHERE user_id = ? AND project_id = ? AND thread_id = ?'
        ).run(JSON.stringify(threadDoc), now, newRev, input.userId, input.projectId, input.threadId);
      } catch {
        /* leave thin row */
      }
    }

    return {
      revision: newRev,
      userTurnId: plan.userTurn?.id ?? '',
      assistantTurnId: plan.assistantTurn.id,
    };
  });
  return tx();
}


/** Only rows with revision > sinceRevision (21D §2.5). */
export function getProjectDelta(userId: number, projectId: string, sinceRevision: number): ProjectDeltaResponse | null {
  const db = getDb();
  const row = db.prepare(SELECT_PROJECT).get(userId, projectId) as ProjectRow | undefined;
  if (!row) return null;

  const base: ProjectDeltaResponse = {
    projectId,
    revision: row.revision,
    threads: [],
    folders: [],
    turns: [],
    chapters: [],
    artifacts: [],
    edges: [],
    tombstones: [],
    activeJobs: getJobSummaryRows(userId, projectId),
  };
  if (row.revision > sinceRevision) {
    base.projectMeta = {
      name: row.name,
      codeName: row.code_name,
      description: row.description,
      color: row.color,
      activeThreadId: row.active_thread_id ?? undefined,
      updatedAt: row.updated_at,
    };
  }

  const deltaTurns = db
    .prepare('SELECT doc_json, revision FROM turns WHERE user_id = ? AND project_id = ? AND revision > ? ORDER BY seq ASC')
    .all(userId, projectId, sinceRevision) as Array<{ doc_json: string; revision: number }>;
  base.turns = deltaTurns.map((t) => parseJson<Turn | null>(t.doc_json, null)).filter((t): t is Turn => Boolean(t?.id));

  const deltaThreads = db
    .prepare('SELECT doc_json FROM threads WHERE user_id = ? AND project_id = ? AND revision > ?')
    .all(userId, projectId, sinceRevision) as Array<{ doc_json: string }>;
  base.threads = deltaThreads.map((t) => parseJson<ChatThread | null>(t.doc_json, null)).filter((t): t is ChatThread => Boolean(t?.id));

  const deltaFolders = db
    .prepare('SELECT folder_id, name, order_index, doc_json FROM folders WHERE user_id = ? AND project_id = ? AND revision > ?')
    .all(userId, projectId, sinceRevision) as Array<{ folder_id: string; name: string; order_index: number; doc_json: string }>;
  base.folders = deltaFolders.map((f) => {
    const doc = parseJson<ThreadFolder | null>(f.doc_json, null);
    if (doc && doc.id) return doc;
    return { id: f.folder_id, name: f.name, order: f.order_index } as ThreadFolder;
  });

  const deltaChapters = db
    .prepare('SELECT doc_json FROM chapters WHERE user_id = ? AND project_id = ? AND revision > ? ORDER BY order_index ASC')
    .all(userId, projectId, sinceRevision) as Array<{ doc_json: string }>;
  base.chapters = deltaChapters.map((c) => parseJson<ChapterPartition | null>(c.doc_json, null)).filter((c): c is ChapterPartition => Boolean(c?.id));

  const deltaArtifacts = db
    .prepare('SELECT doc_json FROM artifacts WHERE user_id = ? AND project_id = ? AND revision > ?')
    .all(userId, projectId, sinceRevision) as Array<{ doc_json: string }>;
  base.artifacts = deltaArtifacts.map((a) => parseJson<UniversalArtifactDocument | null>(a.doc_json, null)).filter((a): a is UniversalArtifactDocument => Boolean(a?.id));

  const deltaEdges = db
    .prepare('SELECT edge_json FROM edges WHERE user_id = ? AND project_id = ? AND revision > ?')
    .all(userId, projectId, sinceRevision) as Array<{ edge_json: string }>;
  base.edges = deltaEdges.map((e) => parseJson<SemanticEdge | null>(e.edge_json, null)).filter((e): e is SemanticEdge => Boolean(e?.id));

  // Revision rows stamped after the cursor — mirrors the artifacts above so a
  // waking device picks up the new History without a full snapshot reload.
  const deltaRevisionRows = db
    .prepare(
      'SELECT artifact_id, version, timestamp, actor, change_summary, provenance_json, title, layers_json, doc_json FROM artifact_revisions WHERE user_id = ? AND project_id = ? AND revision > ? ORDER BY artifact_id ASC, version ASC'
    )
    .all(userId, projectId, sinceRevision) as Array<{
    artifact_id: string;
    version: number;
    timestamp: number;
    actor: string;
    change_summary: string;
    provenance_json: string;
    title: string;
    layers_json: string;
    doc_json: string;
  }>;
  if (deltaRevisionRows.length > 0) {
    const revs: Record<string, ArtifactRevision[]> = {};
    for (const r of deltaRevisionRows) {
      const list = (revs[r.artifact_id] ??= []);
      const doc = parseJson<ArtifactRevision | null>(r.doc_json, null);
      if (doc && doc.version !== undefined) {
        list.push(doc);
        continue;
      }
      list.push({
        version: r.version,
        timestamp: r.timestamp,
        actor: r.actor === 'user' ? 'user' : 'ai',
        changeSummary: r.change_summary,
        provenance: parseJson(r.provenance_json, {}) || undefined,
        title: r.title,
        layers: parseJson(r.layers_json, { subtitle: '', description: '', summary: '', body: '' }),
      });
    }
    base.revisions = revs;
  }

  const deltaTombs = db
    .prepare('SELECT entity_type, entity_id FROM tombstones WHERE user_id = ? AND project_id = ? AND revision > ?')
    .all(userId, projectId, sinceRevision) as Array<{ entity_type: string; entity_id: string }>;
  base.tombstones = deltaTombs.map((t) => ({ entityType: t.entity_type, entityId: t.entity_id }));

  return base;
}

export function deleteProjectForUser(userId: number, projectId: string): boolean {
  const db = getDb();
  const tx = db.transaction(() => {
    const info = db.prepare('DELETE FROM projects WHERE user_id = ? AND project_id = ?').run(userId, projectId);
    db.prepare('DELETE FROM tombstones WHERE user_id = ? AND project_id = ?').run(userId, projectId);
    return info.changes > 0;
  });
  return tx();
}

/** Import snapshots for a user inside ONE transaction (ProjectStore.replaceAll). */
export function replaceAllProjectsForUser(userId: number, projects: ProjectSnapshot[]): { revision: number } {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM projects WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM tombstones WHERE user_id = ?').run(userId);
    let lastRev = 0;
    for (const snap of projects) {
      const rev = 1;
      upsertProjectMeta(db, userId, snap, rev);
      snap.turns?.forEach((t, i) => upsertTurn(db, userId, snap.projectId, t, i, rev));
      for (const t of snap.threads ?? []) upsertThread(db, userId, snap.projectId, t, rev);
      snap.folders?.forEach((f) => upsertFolder(db, userId, snap.projectId, f, rev));
      snap.chapters?.forEach((c, i) => upsertChapter(db, userId, snap.projectId, c, i, rev));
      for (const a of snap.artifacts ?? []) upsertArtifact(db, userId, snap.projectId, a, rev);
      for (const [artifactId, revisions] of Object.entries(snap.revisions ?? {})) {
        if (!revisions || revisions.length === 0) continue;
        upsertArtifactRevisions(db, userId, snap.projectId, artifactId, revisions, rev);
      }
      for (const e of snap.edges ?? []) upsertEdge(db, userId, snap.projectId, e, rev);
      lastRev = rev;
    }
    return { revision: lastRev };
  });
  return tx();
}

/** Create a project row (ProjectStore.create) at revision 1. */
export function createProjectForUser(userId: number, snapshot: ProjectSnapshot): { revision: number; project: ProjectSnapshotWithRevision } {
  const result = applyProjectSnapshotDiff(userId, snapshot);
  const project = loadProjectForUser(userId, snapshot.projectId);
  if (!project) throw new Error('Project creation failed.');
  return { revision: result.revision, project };
}
