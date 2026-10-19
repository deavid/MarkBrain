/**
 * Session machine — auth observer, gate branches (Google / Local), backend
 * switch on continueLocal/signOut, and the boot-gate state App waits on
 * (`authInitialized`, `cloudProjectsCount`).
 *
 * Extracted verbatim from DomainRegistry.tsx (mechanical split — ZERO
 * behavior change, ZERO change to the registry's public API). Dependencies
 * (firebase + persistence entry points, workspace) arrive via parameters so
 * the machine is unit-testable; DomainRegistry injects the real ones.
 *
 * Session shape: TWO branches at the gate (Google / Local), but everything
 * downstream just sees `currentUser` — the Local branch presents a
 * display-only pseudo-user so App/Sidebar/Genesis stay backend-agnostic.
 * Storage branch lives entirely in persistenceService (getBackend/setBackend).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { User } from 'firebase/auth';
import type { IWorkspaceDomain } from '../domains/00-workspace';
import type { ProjectSnapshot } from '../services/stores/projectStore';
import type { StorageBackend } from '../services/persistenceService';
import { logger } from '../utils/logger';

export interface SessionDeps {
  auth: { currentUser: User | null };
  signInWithGoogle: () => Promise<User>;
  logOut: () => Promise<void>;
  subscribeToAuth: (callback: (user: User | null) => void) => () => void;
  getBackend: () => StorageBackend;
  setBackend: (backend: StorageBackend) => void;
  /** Backend-agnostic project list (firestore tree / local store). */
  listUserProjects: () => Promise<ProjectSnapshot[]>;
  /** Registry write-through — [] clears registry → Genesis. */
  workspace: IWorkspaceDomain;
}

export interface SessionMachine {
  currentUser: User | null;
  authInitialized: boolean;
  /** null = "cloud project list not resolved yet" (App holds its boot loader on this) */
  cloudProjectsCount: number | null;
  /** For callers that resolve the count themselves (create/delete workspace). */
  setCloudProjectsCount: Dispatch<SetStateAction<number | null>>;
  signIn: () => Promise<User>;
  continueLocal: () => Promise<void>;
  signOut: () => Promise<void>;
}

export function useSessionMachine(deps: SessionDeps): SessionMachine {
  const {
    auth,
    signInWithGoogle,
    logOut,
    subscribeToAuth,
    getBackend,
    setBackend,
    listUserProjects,
    workspace,
  } = deps;

  const LOCAL_USER = useMemo(
    () =>
      ({
        uid: 'local',
        email: 'local@markbrain.local',
        displayName: 'Local Space',
        photoURL: null,
      }) as unknown as User,
    []
  );
  const [currentUser, setCurrentUser] = useState<User | null>(() =>
    getBackend() === 'local' ? LOCAL_USER : auth.currentUser
  );
  const [authInitialized, setAuthInitialized] = useState<boolean>(false);
  const [cloudProjectsCount, setCloudProjectsCount] = useState<number | null>(null);

  // Project LIST — the single boot path for the workspace registry.
  // listUserProjects never throws (it catches → []), but every path must set
  // the count: the App boot gate waits on `cloudProjectsCount !== null`.
  // Backend-agnostic: it resolves its own scope (firestore tree / local store).
  const loadUserCloudData = useCallback(async () => {
    try {
      const userProjects = await listUserProjects();
      setCloudProjectsCount(userProjects.length);
      workspace.loadUserProjects(userProjects); // [] clears registry → Genesis
    } catch (err) {
      logger.warn('DomainRegistry', 'Error loading project list', err);
      setCloudProjectsCount(0);
    }
  }, [listUserProjects, workspace]);

  // Auth observer: Google sign-in state. In Local mode the Firebase observer
  // fires `null` on every reload — that must NOT knock the session back to
  // the gate, so Local mode keeps the pseudo-user and loads local projects.
  useEffect(() => {
    const unsubAuth = subscribeToAuth(async (user) => {
      if (getBackend() === 'local') {
        setCurrentUser(LOCAL_USER);
        setAuthInitialized(true);
        await loadUserCloudData();
        return;
      }
      setCurrentUser(user);
      setAuthInitialized(true);
      if (user) {
        await loadUserCloudData();
      } else {
        setCloudProjectsCount(null);
      }
    });

    return unsubAuth;
  }, [loadUserCloudData, LOCAL_USER, subscribeToAuth, getBackend]);

  const signIn = useCallback(async () => {
    return await signInWithGoogle();
  }, [signInWithGoogle]);

  // Gate branch 2: enter the Local space — no account, IndexedDB only.
  const continueLocal = useCallback(async () => {
    setBackend('local');
    setCurrentUser(LOCAL_USER);
    setAuthInitialized(true);
    await loadUserCloudData();
  }, [loadUserCloudData, LOCAL_USER, setBackend]);

  // Sign out from EITHER branch: reset backend to firestore + clear session.
  const signOut = useCallback(async () => {
    setBackend('firestore');
    try {
      await logOut(); // no-op when there is no Firebase user (Local mode)
    } catch {
      /* already signed out */
    }
    setCurrentUser(null);
    setCloudProjectsCount(null);
  }, [setBackend, logOut]);

  return {
    currentUser,
    authInitialized,
    cloudProjectsCount,
    setCloudProjectsCount,
    signIn,
    continueLocal,
    signOut,
  };
}