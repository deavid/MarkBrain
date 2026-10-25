/**
 * Workspace session — the single source of truth for which mode the browser
 * is in (design-docs/21C §1): `local` (IndexedDB, this device) or `vps`
 * (Connected VPS Workspace, SQLite behind the API).
 *
 * Storage keys (exact names are contract):
 *   localStorage['markbrain:workspaceMode'] = 'local' | 'vps'  (absent = no choice yet → AuthGate)
 *   localStorage['markbrain:vpsSession']    = JSON VpsSessionInfo
 *
 * Namespacing law: a draft or model setting written in one mode must never
 * bleed into the other — every mode-scoped localStorage key goes through
 * `getScopedStorageKey`, and the IndexedDB name through `getActiveIdbName`.
 */

export type WorkspaceMode = 'local' | 'vps';

export interface VpsSessionInfo {
  /** '' = same origin, or e.g. 'https://markbrain.unhaunter.com' */
  baseUrl: string;
  /** Bearer token from POST /api/auth/login */
  token: string;
  userId: number;
  email: string;
  isOwner: boolean;
  vaultUnlocked: boolean;
}

export const WORKSPACE_MODE_KEY = 'markbrain:workspaceMode';
export const VPS_SESSION_KEY = 'markbrain:vpsSession';

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Absent before the first AuthGate choice — callers treat null as "gate". */
export function getWorkspaceMode(): WorkspaceMode | null {
  const raw = storage()?.getItem(WORKSPACE_MODE_KEY) ?? null;
  return raw === 'local' || raw === 'vps' ? raw : null;
}

export function setWorkspaceMode(mode: WorkspaceMode): void {
  try {
    storage()?.setItem(WORKSPACE_MODE_KEY, mode);
  } catch {
    /* private mode — next read falls back to the gate */
  }
}

/** Forget the mode entirely (Sign Out returns the user to the AuthGate). */
export function clearWorkspaceMode(): void {
  try {
    storage()?.removeItem(WORKSPACE_MODE_KEY);
  } catch {
    /* ignore */
  }
}

export function getVpsSession(): VpsSessionInfo | null {
  try {
    const raw = storage()?.getItem(VPS_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as VpsSessionInfo;
    if (
      parsed &&
      typeof parsed.baseUrl === 'string' &&
      typeof parsed.token === 'string' &&
      typeof parsed.userId === 'number' &&
      typeof parsed.email === 'string'
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function saveVpsSession(session: VpsSessionInfo): void {
  try {
    storage()?.setItem(VPS_SESSION_KEY, JSON.stringify(session));
  } catch {
    /* ignore — session stays RAM-only for this tab */
  }
}

export function patchVpsSession(patch: Partial<VpsSessionInfo>): VpsSessionInfo | null {
  const current = getVpsSession();
  if (!current) return null;
  const next = { ...current, ...patch };
  saveVpsSession(next);
  return next;
}

export function clearVpsSession(): void {
  try {
    storage()?.removeItem(VPS_SESSION_KEY);
  } catch {
    /* ignore */
  }
}

function normalizeOrigin(url: string): string {
  if (!url) return window.location.origin;
  try {
    return new URL(url, typeof window === 'undefined' ? undefined : window.location.origin).origin;
  } catch {
    return url;
  }
}

/**
 * The IndexedDB name for the active workspace:
 *   local → 'markbrain-local'
 *   vps   → 'markbrain-vps:<origin>:<email>'  (per-server, per-account isolation)
 */
export function getActiveIdbName(): string {
  const mode = getWorkspaceMode();
  if (mode === 'vps') {
    const session = getVpsSession();
    if (session) {
      return `markbrain-vps:${normalizeOrigin(session.baseUrl)}:${session.email.toLowerCase()}`;
    }
  }
  return 'markbrain-local';
}

/**
 * Scope a localStorage key to the active workspace:
 *   local → 'markbrain:local:<baseKey>'
 *   vps   → 'markbrain:vps:<origin>:<email>:<baseKey>'
 * Absent mode behaves as local (the gate has not chosen yet; reads/defaults
 * must not collide with a future vps namespace).
 */
export function getScopedStorageKey(baseKey: string): string {
  const mode = getWorkspaceMode();
  if (mode === 'vps') {
    const session = getVpsSession();
    if (session) {
      return `markbrain:vps:${normalizeOrigin(session.baseUrl)}:${session.email.toLowerCase()}:${baseKey}`;
    }
  }
  return `markbrain:local:${baseKey}`;
}
