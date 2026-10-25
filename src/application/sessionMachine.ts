/**
 * Session machine — the boot identity, workspace-mode aware (design-docs/21C).
 *
 * Boot law:
 * - mode absent            → currentUser = null → AuthGate (first choice)
 * - mode 'local'           → Local Workspace pseudo-user
 * - mode 'vps' + session    → Connected VPS user from the stored session
 *
 * `signIn(email, password, baseUrl?)` performs the real VPS login
 * (POST /api/auth/login), persists VpsSessionInfo, flips mode to 'vps'.
 * `continueLocal` flips mode to 'local'. `signOut` returns to the gate
 * (clears the VPS session when leaving Connected mode). Which storage
 * backend a session writes to lives in persistenceService — not here.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { WorkspaceUser } from '../types';
import type { IWorkspaceDomain } from '../domains/00-workspace';
import type { ProjectSnapshot } from '../services/stores/projectStore';
import type { StorageBackend } from '../services/persistenceService';
import {
  getWorkspaceMode,
  setWorkspaceMode,
  clearWorkspaceMode,
  getVpsSession,
  saveVpsSession,
  clearVpsSession,
} from '../services/workspaceSession';
import { authLogin, authLogout, type LoginResponse } from '../gateway/api';
import { hydrateAccountSettingsFromVps } from '../data/modelConfig';
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
  /** null = "project list not resolved yet" — App holds its boot loader on this */
  cloudProjectsCount: number | null;
  setCloudProjectsCount: Dispatch<SetStateAction<number | null>>;
  /** VPS login (Phase 21C gate). Throws on bad credentials/network. */
  signIn: (email: string, password: string, baseUrl?: string) => Promise<WorkspaceUser>;
  continueLocal: () => Promise<void>;
  signOut: () => Promise<void>;
}

function userFromSession(): WorkspaceUser | null {
  const session = getVpsSession();
  if (!session) return null;
  return {
    uid: String(session.userId),
    email: session.email,
    displayName: session.email,
    photoURL: null,
    isOwner: session.isOwner,
    mode: 'vps',
  };
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
  const [currentUser, setCurrentUser] = useState<WorkspaceUser | null>(null);
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

  // Boot: resolve the stored workspace mode once (21C §1).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      const mode = getWorkspaceMode();
      if (mode === 'vps') {
        const user = userFromSession();
        if (user) {
          setCurrentUser(user);
          setAuthInitialized(true);
          await Promise.all([loadUserCloudData(), hydrateAccountSettingsFromVps()]);
          return;
        }
        // Session unreadable — fall through to the gate.
        clearVpsSession();
        clearWorkspaceMode();
      } else if (mode === 'local') {
        setCurrentUser(LOCAL_USER);
        setAuthInitialized(true);
        await loadUserCloudData();
        return;
      }
      // Mode absent: first choice at the AuthGate.
      setCurrentUser(null);
      setAuthInitialized(true);
      setCloudProjectsCount(null); // no workspace until a choice is made
    })();
    return () => {
      cancelled = true;
    };
  }, [LOCAL_USER, loadUserCloudData]);

  /** Real VPS login (21C §3): credential check → persist session → boot connected. */
  const signIn = useCallback(
    async (email: string, password: string, baseUrl: string = ''): Promise<WorkspaceUser> => {
      const res = await authLogin(baseUrl, email.trim(), password);
      if (!res.ok) {
        let message = `Login failed (HTTP ${res.status}).`;
        try {
          const body = (await res.json()) as { error?: string };
          if (body?.error) message = body.error;
        } catch {
          /* keep generic */
        }
        throw new Error(message);
      }
      const data = (await res.json()) as LoginResponse;
      saveVpsSession({
        baseUrl,
        token: data.token,
        userId: data.user.id,
        email: data.user.email,
        isOwner: data.user.isOwner,
        vaultUnlocked: data.user.vaultUnlocked,
      });
      setWorkspaceMode('vps');
      const user: WorkspaceUser = {
        uid: String(data.user.id),
        email: data.user.email,
        displayName: data.user.email,
        photoURL: null,
        isOwner: data.user.isOwner,
        mode: 'vps',
      };
      setCurrentUser(user);
      setAuthInitialized(true);
      await Promise.all([loadUserCloudData(), hydrateAccountSettingsFromVps()]);
      logger.action('Session', `Signed in to server workspace: ${data.user.email}`);
      return user;
    },
    [loadUserCloudData]
  );

  const continueLocal = useCallback(async () => {
    setBackend('local');
    setWorkspaceMode('local');
    setCurrentUser(LOCAL_USER);
    setAuthInitialized(true);
    await loadUserCloudData();
  }, [loadUserCloudData, LOCAL_USER, setBackend]);

  const signOut = useCallback(async () => {
    // Leaving Connected mode: best-effort server logout, then drop the session.
    if (getWorkspaceMode() === 'vps') {
      try {
        await authLogout();
      } catch {
        /* server unreachable — local cleanup still proceeds */
      }
      clearVpsSession();
    }
    clearWorkspaceMode();
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
