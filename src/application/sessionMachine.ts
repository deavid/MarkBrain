/**
 * Session machine — the boot identity, the Local Workspace branch, and the
 * boot-gate state App waits on (`authInitialized`, `cloudProjectsCount`).
 *
 * Firebase sign-in is gone (design-docs/19, Phase 1): every session boots as
 * the Local Workspace pseudo-user. Phase 21C re-wires `signIn` to the VPS
 * account login (`POST /api/auth/login`) and adds the mode switch — until
 * then `signIn` simply continues locally. Which backend a session actually
 * writes to lives entirely in persistenceService (getBackend/setBackend) — do
 * not make that decision here.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { WorkspaceUser } from '../types';
import type { IWorkspaceDomain } from '../domains/00-workspace';
import type { ProjectSnapshot } from '../services/stores/projectStore';
import type { StorageBackend } from '../services/persistenceService';
import { logger } from '../utils/logger';

export interface SessionDeps {
  getBackend: () => StorageBackend;
  setBackend: (backend: StorageBackend) => void;
  listUserProjects: () => Promise<ProjectSnapshot[]>;
  workspace: IWorkspaceDomain;
}

export interface SessionMachine {
  currentUser: WorkspaceUser | null;
  authInitialized: boolean;
  /** null = "project list not resolved yet" (App holds its boot loader on this) */
  cloudProjectsCount: number | null;
  setCloudProjectsCount: Dispatch<SetStateAction<number | null>>;
  signIn: () => Promise<WorkspaceUser>;
  continueLocal: () => Promise<void>;
  signOut: () => Promise<void>;
}

export function useSessionMachine(deps: SessionDeps): SessionMachine {
  const { getBackend, setBackend, listUserProjects, workspace } = deps;

  const LOCAL_USER = useMemo<WorkspaceUser>(
    () => ({
      uid: 'local',
      email: 'local@markbrain.local',
      displayName: 'Local Workspace',
      photoURL: null,
      mode: 'local',
    }),
    []
  );
  const [currentUser, setCurrentUser] = useState<WorkspaceUser | null>(() => LOCAL_USER);
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

  // Boot identity: resolve immediately as the Local Workspace user and load
  // its project list. (Phase 21C re-introduces an auth observer here for the
  // VPS session.)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      setCurrentUser(LOCAL_USER);
      setAuthInitialized(true);
      await loadUserCloudData();
    })();
    return () => {
      cancelled = true;
    };
  }, [LOCAL_USER, loadUserCloudData]);

  const signIn = useCallback(async () => {
    // Phase 21C: VPS login form. Today the gate offers Local Workspace only.
    return LOCAL_USER;
  }, [LOCAL_USER]);

  const continueLocal = useCallback(async () => {
    setBackend('local');
    setCurrentUser(LOCAL_USER);
    setAuthInitialized(true);
    await loadUserCloudData();
  }, [loadUserCloudData, LOCAL_USER, setBackend]);

  const signOut = useCallback(async () => {
    setCurrentUser(null);
    setCloudProjectsCount(null);
  }, []);

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