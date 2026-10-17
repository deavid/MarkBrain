import { db, auth, handleFirestoreError, OperationType } from './firebase';
import { doc, getDoc, setDoc, collection, getDocs } from 'firebase/firestore';
import { logger } from '../utils/logger';

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
 * Save a project snapshot to Firestore — the ONLY storage.
 * (There is no localStorage mirror anymore; Storage IS Firebase.)
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
 * Load a project snapshot from Firestore. Returns null when absent or
 * signed out — there is no silent local fallback to paper over misses.
 */
export async function loadProjectSnapshot(
  projectId: string
): Promise<ProjectSnapshot | null> {
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
 * List all projects belonging to the authenticated user.
 */
export async function listUserProjects(userId: string): Promise<ProjectSnapshot[]> {
  try {
    const projectsCol = collection(db, 'users', userId, 'projects');
    const snap = await getDocs(projectsCol);
    const list: ProjectSnapshot[] = [];
    snap.forEach((d) => {
      list.push(d.data() as ProjectSnapshot);
    });
    logger.info('Persistence', `Listed ${list.length} Firestore projects for user ${userId}`);
    return list;
  } catch (err: any) {
    logger.warn('Persistence', `Failed to list projects for user ${userId}:`, err);
    return [];
  }
}

/**
 * Create a new project document in Firestore.
 */
export async function createCloudProject(
  userId: string,
  meta: {
    id: string;
    name: string;
    codeName: string;
    description: string;
    color?: string;
  }
): Promise<ProjectSnapshot> {
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

  const projectRef = doc(db, 'users', userId, 'projects', meta.id);
  await setDoc(projectRef, {
    ...snapshot,
    name: meta.name,
    codeName: meta.codeName,
    description: meta.description,
    color: meta.color || '#3b82f6',
    userId,
  });

  logger.info('Persistence', `Created new cloud project "${meta.name}" (${meta.id})`, { uid: userId });
  return snapshot;
}