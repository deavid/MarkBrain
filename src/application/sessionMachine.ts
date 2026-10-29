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
  isOfflineReplica,
  openOfflineSession,
  listKnownReplicas,
  rememberReplica,
  getActiveIdbName,
  type KnownReplica,
} from '../services/workspaceSession';
import { authLogin, authLogout, type LoginResponse } from '../gateway/api';
import { rememberReArmKey, setVaultLocked, forgetReArmKey } from '../data/vaultReArm';
import { hydrateAccountSettingsFromVps } from '../data/modelConfig';
import { logger } from '../utils/logger';

export interface SessionDeps {
  getBackend: () => StorageBackend;
  setBackend: (backend: StorageBackend) => void;
  listUserProjects: () => Promise<ProjectSnapshot[]>;
  workspace: IWorkspaceDomain;
  /** Phase 1 of sign-out: drain pending writes NOW, while the session still
   *  works (pending debounced save + queued server mutations). Best-effort. */
  flushPendingWrites?: () => Promise<void>;
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
  /**
   * Sign Out variants (Package 3 §3.6): 'keep' drops the session only — the
   * local mirror + knownReplicas stay so the AuthGate offers "Open offline".
   * 'wipe' also deletes the replica's IndexedDB and forgets it.
   */
  signOutKeepReplica: () => Promise<void>;
  signOutWipeReplica: () => Promise<void>;
  /** Open a known replica from its local mirror, offline, no login call. */
  openOfflineReplica: (replica: KnownReplica) => Promise<void>;
  /** Known replicas for the AuthGate's "Offline replicas on this device" list. */
  knownReplicas: KnownReplica[];
  /** Re-pull the project list from the active backend (refresh button, replay aftermath). */
  loadUserCloudData: () => Promise<void>;
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
          if (!getVpsSession()?.offline) {
            // Live session: one login-time settings pull + remember the
            // replica so the gate can offer "Open offline" next time.
            rememberReplica(getVpsSession()!.baseUrl, getVpsSession()!.email);
            await Promise.all([loadUserCloudData(), hydrateAccountSettingsFromVps()]);
          } else {
            // Offline replica: mirror-only reads, no delta polling, no
            // network calls of any kind (Package 3 §3.6).
            await loadUserCloudData();
          }
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
      rememberReArmKey((data as LoginResponse & { rearmKey?: string }).rearmKey);
      setVaultLocked(!data.user.vaultUnlocked);
      setWorkspaceMode('vps');
      rememberReplica(baseUrl, data.user.email); // gate can offer "Open offline" later
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

  const signOutBase = useCallback(
    async (opts: { serverLogout: boolean; flushWrites?: boolean }) => {
      const leavingVps = getWorkspaceMode() === 'vps' && !isOfflineReplica();
      if (leavingVps) {
        // Phase 1 — FLUSH: drain pending writes NOW, while the session is
        // still valid on the server. The wipe variant skips this: it is about
        // to destroy the local copy on purpose.
        if (opts.flushWrites) {
          try {
            await deps.flushPendingWrites?.();
          } catch {
            /* best-effort — logout never blocks on a failing flush */
          }
        }
        // Phase 2 — DISARM: mode goes first, so the delta poller's per-pull
        // guard and the save guard see no vps session from here on. Nothing
        // new can start; a request already on the wire is the only survivor.
        clearWorkspaceMode();
        // Phase 3 — LOGOUT: invalidate the server session, then drop the
        // local one. Skipped for keep/wipe variants (no server logout call).
        if (opts.serverLogout) {
          try {
            await authLogout();
          } catch {
            /* server unreachable — local cleanup still proceeds */
          }
        }
      } else {
        clearWorkspaceMode();
      }
      clearVpsSession();
      forgetReArmKey();
      setVaultLocked(true);
      setCurrentUser(null);
      setCloudProjectsCount(null);
    },
    [deps.flushPendingWrites]
  );
  const signOut = useCallback(
    async () => signOutBase({ serverLogout: true, flushWrites: true }),
    [signOutBase]
  );

  // Package 3 §3.6: 'keep' leaves the IndexedDB mirror + knownReplicas entry
  // alone so the gate offers "Open offline"; 'wipe' destroys both for good.
  const signOutKeepReplica = useCallback(async () => signOutBase({ serverLogout: false, flushWrites: true }), [signOutBase]);
  const signOutWipeReplica = useCallback(async () => {
    const session = getVpsSession();
    if (session) {
      const { wipeReplicaStorage } = await import('../services/workspaceSession');
      await wipeReplicaStorage({
        baseUrl: session.baseUrl,
        email: session.email,
        idbName: getActiveIdbName(),
        lastUsedAt: Date.now(),
      });
    }
    await signOutBase({ serverLogout: false });
  }, [signOutBase]);

  /** Open a known replica from its local mirror — offline, no login call. */
  const openOfflineReplica = useCallback(
    async (replica: KnownReplica) => {
      setBackend('vps');
      openOfflineSession(replica);
      setCurrentUser({
        uid: `offline:${replica.email}`,
        email: replica.email,
        displayName: replica.email,
        photoURL: null,
        isOwner: false,
        mode: 'vps',
      });
      setAuthInitialized(true);
      await loadUserCloudData();
      logger.action('Session', `Opened offline replica: ${replica.email} @ ${replica.baseUrl}`);
    },
    [loadUserCloudData, setBackend]
  );

  // Refetched when the gate mounts; refreshed after every sign-out so a
  // fresh "wipe" is reflected immediately in the gate's replica list.
  const knownReplicas = useMemo(() => listKnownReplicas(), [currentUser, authInitialized]);

  return {
    currentUser,
    authInitialized,
    cloudProjectsCount,
    setCloudProjectsCount,
    signIn,
    continueLocal,
    signOut,
    signOutKeepReplica,
    signOutWipeReplica,
    openOfflineReplica,
    knownReplicas,
    loadUserCloudData,
  };
}
