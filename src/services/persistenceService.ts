import { logger } from '../utils/logger';
import { sanitizeForStorage } from '../utils/storageSanitize';
import { HEADLESS_FIXTURE } from '../data/headlessFixture';
import type { ChapterPartition } from '../domains/02-chapter-segmentation/types';
import { firestoreStore } from './stores/firestoreStore';
import { localStore } from './stores/localStore';
import { hydrateSnapshot } from './stores/hydrate';
import type { ProjectStore, ProjectSnapshot } from './stores/projectStore';

export type { ProjectSnapshot } from './stores/projectStore';

/**
 * ── The port ─────────────────────────────────────────────────────────────
 * persistenceService is the SINGLE module that knows more than one storage
 * backend exists — and even it only dispatches ONCE, through getStore().
 * Everything else in the app calls these functions and stays backend-agnostic:
 *
 *   - 'firestore' (default): Storage IS Firebase — per-user rules tree
 *     (stores/firestoreStore.ts).
 *   - 'local': IndexedDB (stores/localStore.ts → localBackend.ts) — no
 *     account, this browser only.
 *
 * The ProjectStore port (stores/projectStore.ts) is the anticorruption
 * boundary: CRUD shape only, no Firebase and no IndexedDB types leak upward.
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
    logger.warn('Persistence', 'localStorage unavailable — defaulting to firestore backend');
    return 'firestore';
  }
}

export function setBackend(backend: StorageBackend): void {
  try {
    if (backend === 'firestore') window.localStorage.removeItem(BACKEND_KEY);
    else window.localStorage.setItem(BACKEND_KEY, backend);
  } catch {
    logger.warn('Persistence', 'setBackend: storage write failed — backend choice not persisted');
  }
  logger.info('Persistence', `Backend → ${backend}`);
}

/**
 * THE single dispatch point. Read per call — setBackend() can flip the
 * backend at runtime (sign-in gate: Local space vs Google), so a cached
 * store would go stale; never memoize the result.
 */
function getStore(): ProjectStore {
  return getBackend() === 'local' ? localStore : firestoreStore;
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

  // Strip undefined BEFORE touching either backend: Firestore throws
  // "Unsupported field value: undefined" on setDoc (default settings), which
  // used to make every save fail silently after an import — session fine,
  // everything gone on reload. See utils/storageSanitize.ts.
  const fullSnapshot: ProjectSnapshot = sanitizeForStorage({
    projectId,
    turns: snapshot.turns,
    chapters: snapshot.chapters,
    artifacts: snapshot.artifacts,
    edges: snapshot.edges,
    threads: snapshot.threads,
    folders: snapshot.folders,
    activeThreadId: snapshot.activeThreadId,
    updatedAt: Date.now(),
    // Meta must ride along: IndexedDB put() REPLACES the record — without
    // these the first auto-save wipes name/codeName/description/color.
    name: snapshot.name,
    codeName: snapshot.codeName,
    description: snapshot.description,
    color: snapshot.color,
  });

  await getStore().save(fullSnapshot);
}

/**
 * Load a project snapshot from the ACTIVE backend. Returns null ONLY for
 * confirmed absence — there is no silent fallback to paper over misses.
 * Backend failures (network, permission, no session, IDB errors) THROW:
 * unknown must never collapse into null, or the loader would hydrate an
 * empty project with the save gate open and the next save would wipe the
 * real snapshot (merge over empty arrays).
 */
export async function loadProjectSnapshot(
  projectId: string
): Promise<ProjectSnapshot | null> {
  const snap = await loadSnapshotRaw(projectId);
  return snap ? hydrateSnapshot(snap) : null;
}

async function loadSnapshotRaw(
  projectId: string
): Promise<ProjectSnapshot | null> {
  if (isFixtureMode()) {
    return projectId === HEADLESS_FIXTURE.projectId ? HEADLESS_FIXTURE : null;
  }

  return getStore().load(projectId);
}

/**
 * List all projects on the ACTIVE backend.
 * (No userId param — each backend resolves its own scope: firestore → the
 * signed-in user's tree, local → the whole local store.)
 */
export async function listUserProjects(): Promise<ProjectSnapshot[]> {
  if (isFixtureMode()) return [HEADLESS_FIXTURE];

  return getStore().list();
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
        workspaceId: meta.id,
        title: 'Genesis Chapter',
        summary: '',
        keyPoints: [],
        status: 'active',
        startIndex: 0,
        createdAt: Date.now(),
      }
    ],
    artifacts: [],
    edges: [],
    updatedAt: Date.now(),
  };
  const withMeta: ProjectSnapshot = {
    ...snapshot,
    name: meta.name,
    codeName: meta.codeName,
    description: meta.description,
    color: meta.color || '#3b82f6',
  };

  await getStore().create(withMeta);
  return withMeta; // meta included — WorkspaceDomain maps snap.name → display
}

/**
 * Delete a project from the ACTIVE backend — permanent. Dispatch is the
 * same shape as every other CRUD op: local = IDB delete, firestore = deleteDoc
 * under the signed-in user's tree (rules enforce isOwner).
 */
export async function deleteProject(projectId: string): Promise<void> {
  if (isCaptureMode()) return; // capture/fixture runs never write

  await getStore().delete(projectId);
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

  await getStore().replaceAll(data.projects);
  return data.projects.length;
}
