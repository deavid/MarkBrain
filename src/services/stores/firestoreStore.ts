/**
 * firestoreStore — ProjectStore implementation over Cloud Firestore.
 *
 * Identity: every op is scoped to auth.currentUser's `users/{uid}/projects`
 * tree (security rules enforce isOwner). No signed-in user → load/create/
 * delete/replaceAll THROW a clear message; only list degrades to [] —
 * exactly the per-op behavior persistenceService had before the split.
 * load returns null ONLY for confirmed absence (doc doesn't exist): any
 * failure or missing identity throws, never null (null ≠ unknown — a
 * collapsed null would hydrate an empty project with the save gate open).
 *
 * Writes use setDoc(..., {merge:true}) so a save/import upserts fields instead
 * of replacing the document (except create, which writes a fresh doc without
 * merge — same as before). permission-denied is routed through
 * handleFirestoreError so the auth layer can react.
 */
import { doc, getDoc, getDocs, setDoc, deleteDoc, collection } from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from '../firebase';
import { logger } from '../../utils/logger';
import type { ProjectStore, ProjectSnapshot } from './projectStore';

export const firestoreStore: ProjectStore = {
  async load(projectId: string): Promise<ProjectSnapshot | null> {
    if (!auth || !db) {
      throw new Error('Cloud backend unavailable: FIREBASE_API_KEY is empty — this build is Local-mode only.');
    }
    const currentUser = auth.currentUser;
    // No session ≠ project absent: without identity we can't confirm the doc
    // is gone, so throw instead of returning null (null = absent ONLY).
    if (!currentUser) {
      throw new Error(`Cannot load project ${projectId}: no active Google session.`);
    }

    const docPath = `users/${currentUser.uid}/projects/${projectId}`;
    try {
      const projectRef = doc(db, 'users', currentUser.uid, 'projects', projectId);
      const docSnap = await getDoc(projectRef);
      if (docSnap.exists()) {
        return docSnap.data() as ProjectSnapshot;
      }
      return null; // confirmed absence — the only null this path may return
    } catch (err: any) {
      logger.warn('Persistence', `Firestore load failed for ${projectId}`, err);
      if (err?.code === 'permission-denied') {
        handleFirestoreError(err, OperationType.GET, docPath);
      }
      throw err; // failure ≠ absence — rethrow so the gate stays closed
    }
  },

  async list(): Promise<ProjectSnapshot[]> {
    const currentUser = auth?.currentUser;
    if (!currentUser || !db) return [];
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
  },

  async save(snapshot: ProjectSnapshot): Promise<void> {
    const currentUser = auth?.currentUser;
    if (!currentUser || !db) {
      // This no-op used to be invisible: the session looks fine, every save
      // drops on the floor, and the next refresh shows a project from whenever
      // the last good save happened.
      logger.warn(
        'Persistence',
        `Save skipped for ${snapshot.projectId}: ${!db ? 'Firestore not initialized' : 'no active Google session — this session will NOT be persisted'}`
      );
      return;
    }

    // Firestore rejects documents over 1,048,576 bytes with
    // failed-precondition — caught below, but size is the context that makes
    // the error actionable.
    const approxBytes = JSON.stringify(snapshot).length;
    if (approxBytes > 900_000) {
      logger.warn(
        'Persistence',
        `Snapshot ${snapshot.projectId} is ~${approxBytes} bytes; Firestore rejects docs over 1,048,576 — this save may fail`
      );
    }

    const docPath = `users/${currentUser.uid}/projects/${snapshot.projectId}`;
    try {
      const projectRef = doc(db, 'users', currentUser.uid, 'projects', snapshot.projectId);
      await setDoc(
        projectRef,
        {
          ...snapshot,
          userId: currentUser.uid,
          userEmail: currentUser.email,
        },
        { merge: true }
      );
      logger.info('Persistence', `Saved project snapshot to Firestore`, {
        uid: currentUser.uid,
        projectId: snapshot.projectId,
        approxBytes,
      });
    } catch (err: any) {
      logger.warn('Persistence', `Firestore save error for ${snapshot.projectId} (~${approxBytes} bytes, code=${err?.code ?? 'unknown'})`, err);
      if (err?.code === 'permission-denied') {
        handleFirestoreError(err, OperationType.WRITE, docPath);
      }
    }
  },

  async create(snapshot: ProjectSnapshot): Promise<void> {
    if (!auth || !db) {
      throw new Error('Cloud backend unavailable: FIREBASE_API_KEY is empty — this build is Local-mode only.');
    }
    const currentUser = auth.currentUser;
    if (!currentUser) {
      throw new Error('Cannot create a project without an active Google session.');
    }
    const projectRef = doc(db, 'users', currentUser.uid, 'projects', snapshot.projectId);
    await setDoc(projectRef, {
      ...snapshot,
      userId: currentUser.uid,
    });

    logger.info('Persistence', `Created new cloud project "${snapshot.name}" (${snapshot.projectId})`, {
      uid: currentUser.uid,
    });
    // meta included — WorkspaceDomain maps snap.name → display
  },

  async delete(projectId: string): Promise<void> {
    if (!auth || !db) {
      throw new Error('Cloud backend unavailable: FIREBASE_API_KEY is empty — this build is Local-mode only.');
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
  },

  async replaceAll(projects: ProjectSnapshot[]): Promise<void> {
    if (!auth || !db) {
      throw new Error('Cloud backend unavailable: FIREBASE_API_KEY is empty — this build is Local-mode only.');
    }
    const currentUser = auth.currentUser;
    if (!currentUser) {
      throw new Error('Sign in with Google before importing into Firestore.');
    }
    try {
      for (const p of projects) {
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
    logger.info('Persistence', `Imported ${projects.length} project(s) into Firestore`, { uid: currentUser.uid });
  },
};
