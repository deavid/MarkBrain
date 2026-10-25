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
import { getActiveIdbName } from './workspaceSession';

// Active-workspace DB name: 'markbrain-local' in local mode, namespaced
// 'markbrain-vps:<origin>:<email>' in Connected VPS mode (21C §1).
const DB_NAME = getActiveIdbName();
const DB_VERSION = 1;
const STORE = 'projects';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(getActiveIdbName(), DB_VERSION); // re-read per open — mode can flip at runtime
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

/** Import semantics: one transaction, so the whole restore lands or none of it does. */
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