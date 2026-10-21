/**
 * Session machine — the auth observer, the two gate branches (Google / Local),
 * the backend switch on continueLocal/signOut, and the boot-gate state App waits
 * on (`authInitialized`, `cloudProjectsCount`).
 *
 * Two branches at the gate, but everything downstream sees only
 * `currentUser`: the Local branch presents a display-only pseudo-user so App,
 * Sidebar and Genesis stay backend-agnostic. Which backend a session actually
 * writes to lives entirely in persistenceService (getBackend/setBackend) — do
 * not make that decision here.
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
  listUserProjects: () => Promise<ProjectSnapshot[]>;
  workspace: IWorkspaceDomain;
}

export interface SessionMachine {
  currentUser: User | null;
  authInitialized: boolean;
  /** null = "cloud project list not resolved yet" (App holds its boot loader on this) */
  cloudProjectsCount: number | null;
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

  // Every path must set the count: the App boot gate waits on `cloudProjectsCount !== null`.
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

  const continueLocal = useCallback(async () => {
    setBackend('local');
    setCurrentUser(LOCAL_USER);
    setAuthInitialized(true);
    await loadUserCloudData();
  }, [loadUserCloudData, LOCAL_USER, setBackend]);

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