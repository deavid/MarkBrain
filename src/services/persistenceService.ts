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
 * The only module that knows more than one storage backend exists, and even it
 * dispatches once, in getStore(). Everything above calls these functions and
 * stays backend-agnostic; the ProjectStore port keeps Firebase and IndexedDB
 * types from leaking upward.
 *
 * Two backends: 'firestore' (default, per-user tree) and 'local' (IndexedDB, no
 * account, this browser only). The choice is a meta-key in localStorage
 * (markbrain:backend) — meta-use of localStorage, not a data mirror. Data
 * itself lives in exactly one place per session.
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
 * Last successfully persisted JSON per project. Firestore meters writes against
 * document size (100KB chunks) out of a small daily free quota, so a save of
 * unchanged content is the most expensive no-op there is — every duplicate
 * flush, re-select or debounced echo used to cost several write units.
 */
const lastSavedJson = new Map<string, string>();

export async function saveProjectSnapshot(
  projectId: string,
  snapshot: Omit<ProjectSnapshot, 'projectId' | 'updatedAt'>
): Promise<void> {
  if (isCaptureMode()) return;

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

  // Fingerprint CONTENT only: updatedAt moves on every call by design and must
  // not count as a change (it would defeat the whole comparison).
  const { updatedAt: _ignored, ...content } = fullSnapshot;
  const json = JSON.stringify(content);
  if (lastSavedJson.get(projectId) === json) return; // nothing changed: no write

  // The store must reject on failure (quota, permission) — otherwise the
  // fingerprint would mark unsaved content as saved and it would never retry.
  await getStore().save(fullSnapshot);
  lastSavedJson.set(projectId, json);
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

/** Each backend resolves its own scope: Firestore → the signed-in user's tree, local → the whole store. */
export async function listUserProjects(): Promise<ProjectSnapshot[]> {
  if (isFixtureMode()) return [HEADLESS_FIXTURE];

  return getStore().list();
}

/** Firestore resolves the signed-in user and throws without one; local needs no identity. */
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
        description: '',
        granularity: 'full',
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

/** Permanent. Local = IDB delete; Firestore = deleteDoc under the user's tree (rules enforce isOwner). */
export async function deleteProject(projectId: string): Promise<void> {
  if (isCaptureMode()) return;

  await getStore().delete(projectId);
}

/**
 * The canonical export/import format. Both backends speak these exact
 * ProjectSnapshots, so a file exported from Firestore restores into local and
 * vice versa. scripts/roundtrip-test.cjs is the acceptance test.
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

/** Returns the number of projects written. */
export async function importDatabase(data: DatabaseExport): Promise<number> {
  if (isCaptureMode()) return 0;

  await getStore().replaceAll(data.projects);
  return data.projects.length;
}
