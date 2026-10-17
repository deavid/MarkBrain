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
}

const LOCAL_STORAGE_PREFIX = 'markbrain_data_';

/**
 * Save project snapshot to localStorage and Firestore (if authenticated)
 */
export async function saveProjectSnapshot(
  projectId: string,
  snapshot: Omit<ProjectSnapshot, 'projectId' | 'updatedAt'>
): Promise<void> {
  const fullSnapshot: ProjectSnapshot = {
    projectId,
    turns: snapshot.turns,
    chapters: snapshot.chapters,
    artifacts: snapshot.artifacts,
    edges: snapshot.edges,
    updatedAt: Date.now(),
  };

  // 1. Always save to LocalStorage for instant resilience & offline support
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(
        `${LOCAL_STORAGE_PREFIX}${projectId}`,
        JSON.stringify(fullSnapshot)
      );
      logger.info('Persistence', `Saved local snapshot for project ${projectId}`, {
        turns: fullSnapshot.turns.length,
        chapters: fullSnapshot.chapters.length,
        artifacts: fullSnapshot.artifacts.length,
      });
    }
  } catch (err) {
    logger.warn('Persistence', `LocalStorage save failed for ${projectId}`, err);
  }

  // 2. Save to Firebase Firestore if user is authenticated
  const currentUser = auth.currentUser;
  if (currentUser) {
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
      logger.info('Persistence', `Successfully synced project ${projectId} to Firestore cloud`, { uid: currentUser.uid });
    } catch (err: any) {
      logger.warn('Persistence', `Firestore save error for ${projectId}`, err);
      if (err?.code === 'permission-denied') {
        handleFirestoreError(err, OperationType.WRITE, docPath);
      }
    }
  }
}

/**
 * Synchronous local storage read for immediate zero-flash domain initialization
 */
export function getStoredSnapshotSync(projectId: string): ProjectSnapshot | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = window.localStorage.getItem(`${LOCAL_STORAGE_PREFIX}${projectId}`);
      if (raw) {
        return JSON.parse(raw) as ProjectSnapshot;
      }
    }
  } catch (err) {
    console.warn('[Persistence] LocalStorage sync read failed:', err);
  }
  return null;
}

/**
 * Load project snapshot from Firestore (if authenticated) or LocalStorage
 */
export async function loadProjectSnapshot(
  projectId: string
): Promise<ProjectSnapshot | null> {
  // 1. Try Firestore if user is authenticated
  const currentUser = auth.currentUser;
  if (currentUser) {
    const docPath = `users/${currentUser.uid}/projects/${projectId}`;
    try {
      const projectRef = doc(db, 'users', currentUser.uid, 'projects', projectId);
      const docSnap = await getDoc(projectRef);
      if (docSnap.exists()) {
        const data = docSnap.data() as ProjectSnapshot;
        // Keep local storage in sync with cloud
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.setItem(
            `${LOCAL_STORAGE_PREFIX}${projectId}`,
            JSON.stringify(data)
          );
        }
        console.log(`[Persistence] Loaded project ${projectId} from Firestore`);
        return data;
      }
    } catch (err: any) {
      console.warn('[Persistence] Firestore load failed, falling back to local:', err);
      if (err?.code === 'permission-denied') {
        handleFirestoreError(err, OperationType.GET, docPath);
      }
    }
  }

  // 2. Fall back to LocalStorage
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = window.localStorage.getItem(`${LOCAL_STORAGE_PREFIX}${projectId}`);
      if (raw) {
        return JSON.parse(raw) as ProjectSnapshot;
      }
    }
  } catch (err) {
    console.warn('[Persistence] LocalStorage load failed:', err);
  }

  return null;
}

/**
 * List all projects belonging to the authenticated user from Firestore
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
 * Create a new architectural project for the user in Firestore
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

  logger.info('Persistence', `Created new cloud project "${meta.name}" (${meta.id}) for user ${userId}`);
  return snapshot;
}
