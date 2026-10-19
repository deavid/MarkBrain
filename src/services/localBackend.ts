/**
 * localBackend — IndexedDB adapter for the Local branch.
 *
 * PRIVATE to stores/localStore: no other module may import this file.
 * The branching knowledge lives in persistenceService (one dispatch through
 * the ProjectStore port); this is just the IndexedDB half behind the same
 * canonical ProjectSnapshot model.
 *
 * DB:    markbrain-local
 * Store: projects (keyPath: projectId)
 * Shape: ProjectSnapshot — identical to what a Firestore project doc holds,
 *        so export/import round-trips across backends byte-for-byte.
 *
 * Why IndexedDB and not localStorage: 5MB quota dies on artifacts + turns
 * + graph. Same primitive Firebase's own auth persistence prefers.
 */
import type { ProjectSnapshot } from './stores/projectStore';

const DB_NAME = 'markbrain-local';
const DB_VERSION = 1;
const STORE = 'projects';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'projectId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('markbrain-local DB blocked by another tab'));
  });
}

/** Read all records. */
export async function localListProjects(): Promise<ProjectSnapshot[]> {
  const db = await openDb();
  try {
    return await new Promise<ProjectSnapshot[]>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve((req.result as ProjectSnapshot[]) ?? []);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

/** Read one record by projectId; null when absent. */
export async function localLoadProject(projectId: string): Promise<ProjectSnapshot | null> {
  const db = await openDb();
  try {
    return await new Promise<ProjectSnapshot | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(projectId);
      req.onsuccess = () => resolve((req.result as ProjectSnapshot | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

/** Upsert one record (save and create are the same operation here). */
export async function localPutProject(snapshot: ProjectSnapshot): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(snapshot);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('local put aborted'));
    });
  } finally {
    db.close();
  }
}

/**
 * Delete one record by projectId (no-op when absent).
 */
export async function localDeleteProject(projectId: string): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(projectId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('local delete aborted'));
    });
  } finally {
    db.close();
  }
}

/**
 * Replace the entire local store with `projects` — import semantics.
 * One transaction: either the whole restore lands or nothing does.
 */
export async function localReplaceAll(projects: ProjectSnapshot[]): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      store.clear();
      for (const p of projects) store.put(p);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('local replace aborted'));
    });
  } finally {
    db.close();
  }
}