/**
 * firestoreStore — ProjectStore implementation over Cloud Firestore.
 *
 * Identity: every op is scoped to auth.currentUser's `users/{uid}/projects`
 * tree (security rules enforce isOwner). No signed-in user → load/list
 * degrade to null/[], while create/delete/replaceAll THROW a clear message —
 * exactly the per-op behavior persistenceService had before the split.
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
  },

  async list(): Promise<ProjectSnapshot[]> {
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
  },

  async save(snapshot: ProjectSnapshot): Promise<void> {
    const currentUser = auth.currentUser;
    if (!currentUser) return;

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
      });
    } catch (err: any) {
      logger.warn('Persistence', `Firestore save error for ${snapshot.projectId}`, err);
      if (err?.code === 'permission-denied') {
        handleFirestoreError(err, OperationType.WRITE, docPath);
      }
    }
  },

  async create(snapshot: ProjectSnapshot): Promise<void> {
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
