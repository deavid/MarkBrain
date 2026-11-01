/**
 * localBackend — IndexedDB adapter for the Local branch.
 *
 * Shared by stores/localStore (local mode) and stores/vpsStore (21D: the
 * isolated markbrain-vps:<origin>:<email> mirror) — both parameterized by
 * getActiveIdbName(), so this file itself stays mode-agnostic.
 * The branching knowledge lives in persistenceService (one dispatch through
 * the ProjectStore port); this is just the IndexedDB half behind the same
 * canonical ProjectSnapshot model.
 *
 * DB:    markbrain-local (namespaced per replica/workspace)
 * Stores:
 *    projects — project META blobs (name, codeName, threads, folders,
 *               artifacts, edges, revisions...) WITHOUT turns
 *    turns    — ONE RECORD PER TURN (long-chat Phase 3.2, design-docs/31
 *               §3.4): keyPath [projectId, id], indexes byProject and
 *               byProjectThread [projectId, threadId, seq]. Appending a
 *               message writes exactly the changed turn records — never the
 *               whole project history. All record logic is pure and lives in
 *               turnRecords.ts; this file is the thin IDB shell.
 *
 * v1→v2 upgrade: inside the upgrade transaction every legacy blob's embedded
 * turns array becomes per-turn records and the blob is rewritten bare —
 * atomic, so no half-migrated state can ever exist. After the upgrade the
 * two-store shape is THE shape; reads always reassemble from both stores.
 */
import { getActiveIdbName } from './workspaceSession';
import {
  TURNS_STORE,
  IDX_BY_PROJECT,
  IDX_BY_PROJECT_THREAD,
  toTurnRecord,
  diffTurnRecords,
  reassembleProject,
  migrateProjectBlob,
  turnSignature,
  type TurnIndex,
  type TurnRecord,
} from './turnRecords';
import type { ProjectSnapshot, Turn } from './stores/projectStore';

/** The DB version IS the split-turns upgrade: 1 = monolithic, 2 = split. */
const DB_VERSION = 2;
const PROJECTS_STORE = 'projects';

/** Session-side index of what is ALREADY on disk: projectId → (turnId → signature). */
const writtenTurnIndex = new Map<string, TurnIndex>();

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(getActiveIdbName(), DB_VERSION); // re-read per open — mode can flip at runtime
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(PROJECTS_STORE)) {
        db.createObjectStore(PROJECTS_STORE, { keyPath: 'projectId' });
      }
      if (db.objectStoreNames.contains(TURNS_STORE)) return; // already at the split shape
      const turns = db.createObjectStore(TURNS_STORE, { keyPath: ['projectId', 'id'] });
      turns.createIndex(IDX_BY_PROJECT, ['projectId']);
      turns.createIndex(IDX_BY_PROJECT_THREAD, ['projectId', 'threadId', 'seq']);
      // v1→v2: lift every legacy blob's embedded turns into records — INSIDE
      // the upgrade transaction, so the migration is atomic.
      const projects = req.transaction!.objectStore(PROJECTS_STORE);
      const cursorReq = projects.openCursor();
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor) return;
        const legacy = cursor.value as Record<string, unknown> | null;
        if (legacy && Array.isArray(legacy.turns)) {
          const { blob, records } = migrateProjectBlob(legacy as Record<string, unknown>);
          cursor.update({ ...blob, projectId: cursor.key });
          const projectId = String(cursor.key);
          for (const r of records) turns.put(r);
          // Seed the session index with what the migration wrote.
          const idx = writtenTurnIndex.get(projectId) ?? new Map();
          for (const r of records) idx.set(r.id, turnSignature(r));
          writtenTurnIndex.set(projectId, idx);
        }
        cursor.continue();
      };
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('markbrain-local DB blocked by another tab'));
  });
}

/** Read one project's turn records via the byProject index (keys + docs). */
async function readTurnRecords(db: IDBDatabase, projectId: string): Promise<TurnRecord[]> {
  return new Promise<TurnRecord[]>((resolve, reject) => {
    const tx = db.transaction(TURNS_STORE, 'readonly');
    const idx = tx.objectStore(TURNS_STORE).index(IDX_BY_PROJECT);
    const req = idx.openCursor(IDBKeyRange.only([projectId]));
    const out: TurnRecord[] = [];
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) {
        resolve(out);
        return;
      }
      out.push(cursor.value as TurnRecord);
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

/** Dehydrate a snapshot: the meta blob (turns stripped) + its turn docs. */
function splitSnapshot(snapshot: ProjectSnapshot): {
  blob: Record<string, unknown>;
  turns: Turn[];
} {
  const { turns, ...blob } = snapshot as ProjectSnapshot & Record<string, unknown>;
  return { blob, turns: turns ?? [] };
}

export async function localListProjects(): Promise<ProjectSnapshot[]> {
  const db = await openDb();
  try {
    const blobs = await new Promise<Record<string, unknown>[]>((resolve, reject) => {
      const tx = db.transaction(PROJECTS_STORE, 'readonly');
      const req = tx.objectStore(PROJECTS_STORE).getAll();
      req.onsuccess = () => resolve((req.result as Record<string, unknown>[]) ?? []);
      req.onerror = () => reject(req.error);
    });
    const out: ProjectSnapshot[] = [];
    for (const blob of blobs) {
      const projectId = String(blob.projectId ?? '');
      const records = await readTurnRecords(db, projectId);
      out.push(reassembleProject(blob, records));
    }
    return out;
  } finally {
    db.close();
  }
}

export async function localLoadProject(projectId: string): Promise<ProjectSnapshot | null> {
  const db = await openDb();
  try {
    const blob = await new Promise<Record<string, unknown> | undefined>((resolve, reject) => {
      const tx = db.transaction(PROJECTS_STORE, 'readonly');
      const req = tx.objectStore(PROJECTS_STORE).get(projectId);
      req.onsuccess = () => resolve(req.result as Record<string, unknown> | undefined);
      req.onerror = () => reject(req.error);
    });
    if (!blob) return null;
    const records = await readTurnRecords(db, projectId);
    return reassembleProject(blob, records);
  } finally {
    db.close();
  }
}

export async function localPutProject(snapshot: ProjectSnapshot): Promise<void> {
  const projectId = snapshot.projectId;
  const { blob, turns } = splitSnapshot(snapshot);
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([PROJECTS_STORE, TURNS_STORE], 'readwrite');
      const projects = tx.objectStore(PROJECTS_STORE);
      const turnsStore = tx.objectStore(TURNS_STORE);

      // The append-per-message law: write ONLY the new/changed records.
      // `writtenTurnIndex` mirrors what is on disk; a save before any load
      // (cache cold) upserts everything once and seeds the index.
      const prev = writtenTurnIndex.get(projectId);
      const { upserts, deletes } = diffTurnRecords(prev, turns);
      for (const t of upserts) {
        turnsStore.put(toTurnRecord(projectId, t, turns.findIndex((x) => x.id === t.id)));
      }
      for (const id of deletes) turnsStore.delete([projectId, id]);

      // Keep the session index in step with what this transaction writes.
      const idx = new Map<string, string>();
      for (const t of turns) {
        if (t?.id) idx.set(t.id, turnSignature(toTurnRecord(projectId, t, turns.findIndex((x) => x.id === t.id))));
      }
      writtenTurnIndex.set(projectId, idx);

      projects.put({ ...blob, projectId });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('local put aborted'));
    });
  } finally {
    db.close();
  }
}

export async function localDeleteProject(projectId: string): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([PROJECTS_STORE, TURNS_STORE], 'readwrite');
      tx.objectStore(PROJECTS_STORE).delete(projectId);
      const idx = tx.objectStore(TURNS_STORE).index(IDX_BY_PROJECT);
      const cursorReq = idx.openKeyCursor(IDBKeyRange.only([projectId]));
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor) return;
        cursor.delete();
        cursor.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('local delete aborted'));
    });
    writtenTurnIndex.delete(projectId);
  } finally {
    db.close();
  }
}

/** Import semantics: one transaction, so the whole restore lands or none of it does. */
export async function localReplaceAll(projects: ProjectSnapshot[]): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([PROJECTS_STORE, TURNS_STORE], 'readwrite');
      const projectsStore = tx.objectStore(PROJECTS_STORE);
      const turnsStore = tx.objectStore(TURNS_STORE);
      projectsStore.clear();
      turnsStore.clear();
      for (const snapshot of projects) {
        const projectId = snapshot.projectId;
        const { blob, turns } = splitSnapshot(snapshot);
        turns.forEach((t, seq) => {
          if (t?.id) turnsStore.put(toTurnRecord(projectId, t, seq));
        });
        projectsStore.put({ ...blob, projectId });
        // The import IS the new disk truth: rebuild the session index.
        const idx = new Map<string, string>();
        turns.forEach((t, seq) => {
          if (t?.id) idx.set(t.id, turnSignature(toTurnRecord(projectId, t, seq)));
        });
        writtenTurnIndex.set(projectId, idx);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('local replace aborted'));
    });
  } finally {
    db.close();
  }
}
