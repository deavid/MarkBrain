/**
 * searchIndexStore — IndexedDB for the draft-proximity testbed.
 *
 * LAW 2: generated Q&A and embedding vectors NEVER live in ProjectSnapshot or
 * Firestore. One artifact's 60–200 KiB of Q&A plus its section vectors would
 * eat a third of the single Firestore document (hard cap 1,048,576 bytes)
 * before the chat thread even existed. This is a separate database, derived
 * from artifact text, rebuildable at any time, and safe to throw away.
 *
 * DB: markbrain-search-index
 * Store: artifact_index (keyPath 'key'), index 'byProject' on projectId.
 */

export interface GeneratedQaPair {
  id: string;
  sectionHeading: string;
  question: string;
  answer: string;
  keywords: string[];
}

export interface ArtifactSearchIndexRecord {
  key: string;
  projectId: string;
  artifactId: string;
  contentHash: string;
  updatedAt: number;
  qaPairs: GeneratedQaPair[];
  sectionIds: string[];
  sectionHeadings: string[];
  sectionSnippets: string[];
  sectionVectors: Float32Array[];
  qaVectors: Float32Array[];
  /**
   * Which stages have landed. Lets a half-built record RESUME instead of
   * restarting — with a 1,000-request/day embed quota, re-paying for work that
   * already succeeded is the difference between finishing a library and not.
   * Absent on legacy records, which were only ever written on full success.
   */
  stages?: {
    sectionsEmbedded: boolean;
    qaGenerated: boolean;
    qaEmbedded: boolean;
  };
  /**
   * The embedding model these vectors were built with (design-docs/16 §3.4).
   * Vectors from different embedding models are NOT comparable — a mismatch
   * must read as stale, or the proximity scores silently become garbage.
   * Absent on legacy records → treated as the current default model.
   */
  embedModel?: string;
}

const DB_NAME = 'markbrain-search-index';
const DB_VERSION = 1;
const STORE = 'artifact_index';
const BY_PROJECT = 'byProject';

const canUseIdb = typeof indexedDB !== 'undefined';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'key' });
        store.createIndex(BY_PROJECT, 'projectId', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('markbrain-search-index DB blocked by another tab'));
  });
}

/** Structured clone stores the typed array as-is; the guard covers a plain number[]. */
function toFloat32(v: Float32Array | number[]): Float32Array {
  return v instanceof Float32Array ? v : new Float32Array(v);
}

export function searchIndexKey(projectId: string, artifactId: string): string {
  return `${projectId}::${artifactId}`;
}

export async function loadProjectSearchIndex(
  projectId: string
): Promise<Map<string, ArtifactSearchIndexRecord>> {
  const map = new Map<string, ArtifactSearchIndexRecord>();
  if (!canUseIdb || !projectId) return map;

  let db: IDBDatabase | null = null;
  try {
    db = await openDb();
    const records = await new Promise<ArtifactSearchIndexRecord[]>((resolve, reject) => {
      const tx = db!.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).index(BY_PROJECT).getAll(projectId);
      req.onsuccess = () => resolve((req.result as ArtifactSearchIndexRecord[]) ?? []);
      req.onerror = () => reject(req.error);
    });
    for (const rec of records) {
      map.set(rec.artifactId, {
        ...rec,
        sectionVectors: (rec.sectionVectors || []).map(toFloat32),
        qaVectors: (rec.qaVectors || []).map(toFloat32),
      });
    }
    return map;
  } catch (err) {
    // A missing/blocked index is a cache miss, not a crash: the caller falls
    // back to section-only FTS and re-indexes on demand.
    return map;
  } finally {
    db?.close();
  }
}

export async function saveArtifactSearchIndex(record: ArtifactSearchIndexRecord): Promise<void> {
  if (!canUseIdb) return;
  let db: IDBDatabase | null = null;
  try {
    db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db!.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('search index put aborted'));
    });
  } finally {
    db?.close();
  }
}

export async function deleteArtifactSearchIndex(
  projectId: string,
  artifactId: string
): Promise<void> {
  if (!canUseIdb) return;
  let db: IDBDatabase | null = null;
  try {
    db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db!.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(searchIndexKey(projectId, artifactId));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('search index delete aborted'));
    });
  } finally {
    db?.close();
  }
}

export async function clearProjectSearchIndex(projectId: string): Promise<void> {
  if (!canUseIdb) return;
  const all = await loadProjectSearchIndex(projectId);
  await Promise.all(
    Array.from(all.keys()).map((artifactId) => deleteArtifactSearchIndex(projectId, artifactId))
  );
}
