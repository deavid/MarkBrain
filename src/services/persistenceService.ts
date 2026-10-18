import { db, auth, handleFirestoreError, OperationType } from './firebase';
import { doc, getDoc, getDocs, setDoc, deleteDoc, collection } from 'firebase/firestore';
import { logger } from '../utils/logger';
import { HEADLESS_FIXTURE } from '../data/headlessFixture';
import {
  localListProjects,
  localLoadProject,
  localPutProject,
  localReplaceAll,
  localDeleteProject,
} from './localBackend';

export interface ProjectSnapshot {
  projectId: string;
  turns: any[];
  chapters: any[];
  artifacts: any[];
  edges: any[];
  updatedAt: number;
  // Present on list/create docs (mapped into workspace metadata):
  name?: string;
  codeName?: string;
  description?: string;
  color?: string;
}

/**
 * ── The port ─────────────────────────────────────────────────────────────
 * persistenceService is the SINGLE module that knows more than one storage
 * backend exists. Everything else in the app calls these functions and stays
 * backend-agnostic:
 *
 *   - 'firestore' (default): Storage IS Firebase — per-user rules tree.
 *   - 'local': IndexedDB (localBackend.ts) — no account, this browser only.
 *
 * The backend choice is a meta-key in localStorage (markbrain:backend) —
 * meta-use of localStorage, not a data mirror. Data lives in exactly one
 * place per session. Orthogonal to capture/fixture guards, which run first.
 */
export type StorageBackend = 'firestore' | 'local';

const BACKEND_KEY = 'markbrain:backend';
export const LOCAL_UID = 'local';

export function getBackend(): StorageBackend {
  try {
    return window.localStorage.getItem(BACKEND_KEY) === 'local' ? 'local' : 'firestore';
  } catch {
    return 'firestore';
  }
}

export function setBackend(backend: StorageBackend): void {
  try {
    if (backend === 'firestore') window.localStorage.removeItem(BACKEND_KEY);
    else window.localStorage.setItem(BACKEND_KEY, backend);
  } catch { /* storage unavailable → next boot defaults to firestore */ }
  logger.info('Persistence', `Backend → ${backend}`);
}

/**
 * Capture-mode guards (dev-only).
 *
 * `?capture=1` and `?fixture=1` (dev server only) put the app in a
 * read-ONLY capture state: every save path becomes a no-op, so headless
 * screenshot runs — fixture or real-session — can never write anywhere.
 *
 * `import.meta.env.DEV` is inlined at build time: in a production build
 * both functions collapse to `false` and the branches tree-shake away.
 */
const devParam = (name: string): boolean =>
  import.meta.env.DEV &&
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).has(name);

export const isFixtureMode = (): boolean => devParam('fixture');
export const isCaptureMode = (): boolean => devParam('fixture') || devParam('capture');

/**
 * Save a project snapshot to the ACTIVE backend.
 * (capture/fixture runs never write — guard runs before any dispatch.)
 */
export async function saveProjectSnapshot(
  projectId: string,
  snapshot: Omit<ProjectSnapshot, 'projectId' | 'updatedAt'>
): Promise<void> {
  if (isCaptureMode()) return; // capture/fixture runs never write

  const fullSnapshot: ProjectSnapshot = {
    projectId,
    turns: snapshot.turns,
    chapters: snapshot.chapters,
    artifacts: snapshot.artifacts,
    edges: snapshot.edges,
    updatedAt: Date.now(),
  };

  if (getBackend() === 'local') {
    await localPutProject(fullSnapshot);
    logger.info('Persistence', `Saved project snapshot to IndexedDB`, { projectId });
    return;
  }

  const currentUser = auth.currentUser;
  if (!currentUser) return;

  const docPath = `users/${currentUser.uid}/projects/${projectId}`;
  try {
    const projectRef = doc(db, 'users', currentUser.uid, 'projects', projectId);
    await setDoc(
      projectRef,
      {
        ...fullSnapshot,
        userId: currentUser.uid,
        userEmail: currentUser.email,
      },
      { merge: true }
    );
    logger.info('Persistence', `Saved project snapshot to Firestore`, { uid: currentUser.uid, projectId });
  } catch (err: any) {
    logger.warn('Persistence', `Firestore save error for ${projectId}`, err);
    if (err?.code === 'permission-denied') {
      handleFirestoreError(err, OperationType.WRITE, docPath);
    }
  }
}

/**
 * Load a project snapshot from the ACTIVE backend. Returns null when absent
 * — there is no silent fallback to paper over misses.
 */
export async function loadProjectSnapshot(
  projectId: string
): Promise<ProjectSnapshot | null> {
  if (isFixtureMode()) {
    return projectId === HEADLESS_FIXTURE.projectId ? HEADLESS_FIXTURE : null;
  }

  if (getBackend() === 'local') {
    return localLoadProject(projectId);
  }

  const currentUser = auth.currentUser;
  if (!currentUser) return null;

  const docPath = `users/${currentUser.uid}/projects/${projectId}`;
  try {
    const projectRef = doc(db, 'users', currentUser.uid, 'projects', projectId);
    const docSnap = await getDoc(projectRef);
    if (docSnap.exists()) {
      return docSnap.data() as ProjectSnapshot;
    }
    return null;
  } catch (err: any) {
    logger.warn('Persistence', `Firestore load failed for ${projectId}`, err);
    if (err?.code === 'permission-denied') {
      handleFirestoreError(err, OperationType.GET, docPath);
    }
    return null;
  }
}

/**
 * List all projects on the ACTIVE backend.
 * (No userId param — each backend resolves its own scope: firestore → the
 * signed-in user's tree, local → the whole local store.)
 */
export async function listUserProjects(): Promise<ProjectSnapshot[]> {
  if (isFixtureMode()) return [HEADLESS_FIXTURE];

  if (getBackend() === 'local') {
    const list = await localListProjects();
    logger.info('Persistence', `Listed ${list.length} local IndexedDB projects`);
    return list;
  }

  const currentUser = auth.currentUser;
  if (!currentUser) return [];
  try {
    const projectsCol = collection(db, 'users', currentUser.uid, 'projects');
    const snap = await getDocs(projectsCol);
    const list: ProjectSnapshot[] = [];
    snap.forEach((d) => {
      list.push(d.data() as ProjectSnapshot);
    });
    logger.info('Persistence', `Listed ${list.length} Firestore projects for user ${currentUser.uid}`);
    return list;
  } catch (err: any) {
    logger.warn('Persistence', `Failed to list projects for user ${currentUser.uid}:`, err);
    return [];
  }
}

/**
 * Create a new project on the ACTIVE backend.
 * (No userId param — firestore resolves the signed-in user and throws a
 * clear error when there isn't one; local needs no identity.)
 */
export async function createCloudProject(meta: {
  id: string;
  name: string;
  codeName: string;
  description: string;
  color?: string;
}): Promise<ProjectSnapshot> {
  const genesisChapterId = `chap-genesis-${Date.now().toString(36)}`;
  const snapshot: ProjectSnapshot = {
    projectId: meta.id,
    turns: [],
    chapters: [
      {
        id: genesisChapterId,
        projectId: meta.id,
        title: 'Genesis Architecture',
        summary: '',
        keyPoints: [],
        status: 'active',
        startIndex: 0,
        createdAt: Date.now(),
      },
    ],
    artifacts: [],
    edges: [],
    updatedAt: Date.now(),
  };

  if (getBackend() === 'local') {
    const full: ProjectSnapshot = {
      ...snapshot,
      name: meta.name,
      codeName: meta.codeName,
      description: meta.description,
      color: meta.color || '#3b82f6',
    };
    await localPutProject(full);
    logger.info('Persistence', `Created new local project "${meta.name}" (${meta.id})`);
    return full; // meta included — WorkspaceDomain maps snap.name → display
  }

  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('Cannot create a project without an active Google session.');
  }
  const withMeta: ProjectSnapshot = {
    ...snapshot,
    name: meta.name,
    codeName: meta.codeName,
    description: meta.description,
    color: meta.color || '#3b82f6',
  };
  const projectRef = doc(db, 'users', currentUser.uid, 'projects', meta.id);
  await setDoc(projectRef, {
    ...withMeta,
    userId: currentUser.uid,
  });

  logger.info('Persistence', `Created new cloud project "${meta.name}" (${meta.id})`, { uid: currentUser.uid });
  return withMeta; // meta included — WorkspaceDomain maps snap.name → display
}

/**
 * Delete a project from the ACTIVE backend — permanent. Dispatch is the
 * same shape as every other CRUD op: local = IDB delete, firestore = deleteDoc
 * under the signed-in user's tree (rules enforce isOwner).
 */
export async function deleteProject(projectId: string): Promise<void> {
  if (isCaptureMode()) return; // capture/fixture runs never write

  if (getBackend() === 'local') {
    await localDeleteProject(projectId);
    logger.info('Persistence', `Deleted project ${projectId} from IndexedDB`);
    return;
  }

  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('Sign in with Google before deleting cloud projects.');
  }
  const docPath = `users/${currentUser.uid}/projects/${projectId}`;
  try {
    await deleteDoc(doc(db, 'users', currentUser.uid, 'projects', projectId));
    logger.info('Persistence', `Deleted project ${projectId} from Firestore`, { uid: currentUser.uid });
  } catch (err: any) {
    logger.warn('Persistence', `Firestore delete failed for ${projectId}`, err);
    if (err?.code === 'permission-denied') {
      handleFirestoreError(err, OperationType.WRITE, docPath);
    }
    throw err;
  }
}

/**
 * ── Canonical database export / import ───────────────────────────────────
 * This format IS the architecture: both backends speak these exact
 * ProjectSnapshots, so a file exported from Firestore restores into local
 * (and vice versa). Round-trip test: export → fresh browser → import →
 * same UI, same data.
 */
export interface DatabaseExport {
  format: 'markbrain-database';
  version: 1;
  exportedAt: number;
  backend: StorageBackend; // informational — where it was exported FROM
  projects: ProjectSnapshot[];
}

export async function exportDatabase(): Promise<DatabaseExport> {
  const projects = await listUserProjects();
  const data: DatabaseExport = {
    format: 'markbrain-database',
    version: 1,
    exportedAt: Date.now(),
    backend: getBackend(),
    projects,
  };
  logger.info('Persistence', `Exported database: ${projects.length} project(s) from ${data.backend}`);
  return data;
}

export function serializeDatabase(data: DatabaseExport): string {
  return JSON.stringify(data, null, 2);
}

/** Parse + validate a database export file. Throws with a clear message. */
export function parseDatabaseExport(json: string): DatabaseExport {
  let data: any;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error('Not valid JSON — expected a MarkBrain database export file.');
  }
  if (data?.format !== 'markbrain-database' || data.version !== 1) {
    throw new Error('Not a MarkBrain database export (expected format "markbrain-database", version 1).');
  }
  if (!Array.isArray(data.projects)) {
    throw new Error('Export file has no projects array.');
  }
  for (const p of data.projects) {
    if (!p || typeof p.projectId !== 'string' || !p.projectId) {
      throw new Error('Export contains a project entry without a projectId.');
    }
  }
  return data as DatabaseExport;
}

/**
 * Import a database export into the ACTIVE backend.
 * Local: full replace in one transaction (restore semantics).
 * Firestore: upserts into the signed-in user's tree (never deletes remote
 * docs not in the file — a restore must not silently destroy extra data
 * written after the export).
 * Returns the number of projects written.
 */
export async function importDatabase(data: DatabaseExport): Promise<number> {
  if (isCaptureMode()) return 0; // capture/fixture runs never write

  if (getBackend() === 'local') {
    await localReplaceAll(data.projects);
    logger.info('Persistence', `Imported ${data.projects.length} project(s) into IndexedDB (full replace)`);
    return data.projects.length;
  }

  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('Sign in with Google before importing into Firestore.');
  }
  try {
    for (const p of data.projects) {
      const projectRef = doc(db, 'users', currentUser.uid, 'projects', p.projectId);
      await setDoc(
        projectRef,
        { ...p, userId: currentUser.uid, userEmail: currentUser.email },
        { merge: true }
      );
    }
  } catch (err: any) {
    logger.warn('Persistence', `Firestore import failed: ${err}`, err);
    if (err?.code === 'permission-denied') {
      handleFirestoreError(err, OperationType.WRITE, `users/${currentUser.uid}/projects`);
    }
    throw err;
  }
  logger.info('Persistence', `Imported ${data.projects.length} project(s) into Firestore`, { uid: currentUser.uid });
  return data.projects.length;
}