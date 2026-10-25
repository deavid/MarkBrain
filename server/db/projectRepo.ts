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
import type { ProjectSnapshot } from '../../src/services/stores/projectStore';
import type { Turn } from '../../src/domains/01-dialogue-timeline/types';
import type { ChapterPartition } from '../../src/domains/02-chapter-segmentation/types';
import type { UniversalArtifactDocument } from '../../src/domains/01-artifact-document/types';
import type { SemanticEdge } from '../../src/domains/02-topological-graph/types';
import type { ChatThread, ThreadFolder } from '../../src/domains/06-chat-threads/types';

export type ProjectSnapshotWithRevision = ProjectSnapshot & { revision: number };

export interface ProjectDeltaResponse {
  projectId: string;
  revision: number;
  projectMeta?: {
    name: string;
    codeName: string;
    description: string;
    color: string;
    activeThreadId?: string;
    updatedAt: number;
  };
  threads: ChatThread[];
  folders: ThreadFolder[];
  turns: Turn[];
  chapters: ChapterPartition[];
  artifacts: UniversalArtifactDocument[];
  edges: SemanticEdge[];
  tombstones: Array<{ entityType: string; entityId: string }>;
  activeJobs: unknown[]; // populated in Phase 5 (21E)
}

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
  revision: number;
  updated_at: number;
}

const SELECT_PROJECT = `SELECT project_id, name, code_name, description, color, active_thread_id,
  granularity_law, revision, updated_at FROM projects WHERE user_id = ? AND project_id = ?`;

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
      .prepare('SELECT folder_id, name, order_index FROM folders WHERE user_id = ? AND project_id = ? ORDER BY order_index ASC')
      .all(userId, row.project_id) as Array<{ folder_id: string; name: string; order_index: number }>
  ).map((f) => ({ id: f.folder_id, name: f.name, order: f.order_index } as ThreadFolder));

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
      threadId: t.thread_id ?? undefined,
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

  return {
    projectId: row.project_id,
    name: row.name,
    codeName: row.code_name,
    description: row.description,
    color: row.color,
    activeThreadId: row.active_thread_id ?? undefined,
    granularityLaw: row.granularity_law === 'user-only' ? 'user-only' : undefined,
    updatedAt: row.updated_at,
    revision: row.revision,
    threads,
    folders,
    turns,
    chapters,
    artifacts,
    edges,
  };
}

/* ── row writers (inside a transaction) ───────────────────────────────────── */

function upsertProjectMeta(db: Db, userId: number, snap: ProjectSnapshot, newRev: number): void {
  const now = Date.now();
  db.prepare(
    `INSERT INTO projects (project_id, user_id, name, code_name, description, color, active_thread_id,
       granularity_law, revision, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, project_id) DO UPDATE SET
       name = excluded.name, code_name = excluded.code_name, description = excluded.description,
       color = excluded.color, active_thread_id = excluded.active_thread_id,
       granularity_law = excluded.granularity_law, revision = excluded.revision,
       updated_at = excluded.updated_at`
  ).run(
    snap.projectId,
    userId,
    snap.name ?? 'Untitled Project',
    snap.codeName ?? '',
    snap.description ?? '',
    snap.color ?? '#e05a66',
    snap.activeThreadId ?? null,
    snap.granularityLaw ?? 'user-only',
    newRev,
    snap.updatedAt || now
  );
}

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
    turn.threadId ?? null,
    turn.id,
    seq,
    turn.role,
    turn.content,
    turn.timestamp,
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
    thread.title,
    thread.titleVersion ?? 0,
    thread.folderId ?? null,
    thread.createdAt,
    thread.updatedAt,
    JSON.stringify(thread),
    rev
  );
}

function upsertFolder(db: Db, userId: number, projectId: string, folder: ThreadFolder, rev: number): void {
  db.prepare(
    `INSERT INTO folders (user_id, project_id, folder_id, name, order_index, revision)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, project_id, folder_id) DO UPDATE SET
       name = excluded.name, order_index = excluded.order_index, revision = excluded.revision`
  ).run(userId, projectId, folder.id, folder.name, folder.order ?? 0, rev);
}

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
    chapter.threadId ?? null,
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
  db.prepare(
    `INSERT INTO artifacts (user_id, project_id, artifact_id, doc_json, updated_at, revision)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, project_id, artifact_id) DO UPDATE SET
       doc_json = excluded.doc_json, updated_at = excluded.updated_at, revision = excluded.revision`
  ).run(userId, projectId, doc.id, JSON.stringify(doc), Date.now(), rev);
}

function upsertEdge(db: Db, userId: number, projectId: string, edge: SemanticEdge, rev: number): void {
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

function docChanged(db: Db, table: string, idCol: string, id: string, userId: number, projectId: string, nextDoc: string): boolean {
  const row = db
    .prepare(`SELECT doc_json FROM ${table} WHERE user_id = ? AND project_id = ? AND ${idCol} = ?`)
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
      `SELECT project_id, name, code_name, description, color, active_thread_id, granularity_law, revision, updated_at
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
      if (!docChanged(db, 'threads', 'thread_id', thread.id, userId, snapshot.projectId, JSON.stringify(thread))) continue;
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
      if (!docChanged(db, 'chapters', 'chapter_id', chapter.id, userId, snapshot.projectId, JSON.stringify(chapter))) return;
      upsertChapter(db, userId, snapshot.projectId, chapter, idx, newRev);
    });
    for (const artifact of snapshot.artifacts ?? []) {
      if (!docChanged(db, 'artifacts', 'artifact_id', artifact.id, userId, snapshot.projectId, JSON.stringify(artifact))) continue;
      upsertArtifact(db, userId, snapshot.projectId, artifact, newRev);
    }
    for (const edge of snapshot.edges ?? []) {
      if (!docChanged(db, 'edges', 'edge_id', edge.id, userId, snapshot.projectId, JSON.stringify(edge))) continue;
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
        case 'replaceTurn':
          upsertTurn(db, userId, projectId, { ...m.turn, threadId: m.threadId }, nextTurnSeq(), newRev);
          break;
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
    activeJobs: [],
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
    .prepare('SELECT folder_id, name, order_index FROM folders WHERE user_id = ? AND project_id = ? AND revision > ?')
    .all(userId, projectId, sinceRevision) as Array<{ folder_id: string; name: string; order_index: number }>;
  base.folders = deltaFolders.map((f) => ({ id: f.folder_id, name: f.name, order: f.order_index } as ThreadFolder));

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
