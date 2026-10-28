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
  /**
   * Bearer token from POST /api/auth/login. '' in offline replica mode —
   * no network calls are made, reads come from the IndexedDB mirror only.
   */
  token: string;
  userId: number;
  email: string;
  isOwner: boolean;
  vaultUnlocked: boolean;
  /** True when the workspace is opened from the local mirror (VPS unreachable). */
  offline?: boolean;
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

// ---------------------------------------------------------------------------
// Known replicas (Package 3 §3.6) — which VPS workspaces have a local mirror
// on this device, so the AuthGate can offer "Open offline" without login.
// ---------------------------------------------------------------------------

export const KNOWN_REPLICAS_KEY = 'markbrain:knownReplicas';

export interface KnownReplica {
  baseUrl: string;
  email: string;
  idbName: string;
  lastUsedAt: number;
}

/** The IndexedDB name for a replica (same law as getActiveIdbName). */
export function idbNameForReplica(baseUrl: string, email: string): string {
  return `markbrain-vps:${normalizeOrigin(baseUrl)}:${email.toLowerCase()}`;
}

function isValidReplica(r: unknown): r is KnownReplica {
  if (!r || typeof r !== 'object') return false;
  const cand = r as Partial<KnownReplica>;
  return (
    typeof cand.baseUrl === 'string' &&
    typeof cand.email === 'string' &&
    typeof cand.idbName === 'string' &&
    typeof cand.lastUsedAt === 'number'
  );
}

export function listKnownReplicas(): KnownReplica[] {
  try {
    const raw = storage()?.getItem(KNOWN_REPLICAS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidReplica).sort((a, b) => b.lastUsedAt - a.lastUsedAt);
  } catch {
    return [];
  }
}

export function rememberReplica(baseUrl: string, email: string): void {
  try {
    const store = storage();
    if (!store) return;
    const existing = listKnownReplicas();
    const now = Date.now();
    const next = existing.filter(
      (r) => r.baseUrl !== baseUrl || r.email.toLowerCase() !== email.toLowerCase()
    );
    next.push({ baseUrl, email, idbName: idbNameForReplica(baseUrl, email), lastUsedAt: now });
    store.setItem(KNOWN_REPLICAS_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

export function forgetReplica(baseUrl: string, email: string): void {
  try {
    const store = storage();
    if (!store) return;
    const next = listKnownReplicas().filter(
      (r) => r.baseUrl !== baseUrl || r.email.toLowerCase() !== email.toLowerCase()
    );
    store.setItem(KNOWN_REPLICAS_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

/**
 * True when the workspace is opened from a local mirror (VPS unreachable):
 * mode=vps + a session with `offline: true` (token '' — no login call made).
 */
export function isOfflineReplica(): boolean {
  const session = getVpsSession();
  return !!session?.offline;
}

/**
 * Enter the workspace from a local mirror without any login call
 * (Package 3 §3.6): mode=vps, session with token:'' and offline:true.
 * The mirror keeps its own copy of the model settings and drafts via the
 * regular per-replica scoping (getScopedStorageKey / getActiveIdbName).
 */
export function openOfflineSession(replica: KnownReplica): void {
  setWorkspaceMode('vps');
  saveVpsSession({
    baseUrl: replica.baseUrl,
    token: '',
    userId: 0,
    email: replica.email,
    isOwner: false,
    vaultUnlocked: false,
    offline: true,
  });
  rememberReplica(replica.baseUrl, replica.email);
}

/**
 * Wipe a replica off this device: drop the knownReplicas entry and delete its
 * whole IndexedDB database. Call only from the explicit "Sign out & wipe"
 * choice — this destroys the local mirror permanently.
 */
export async function wipeReplicaStorage(replica: KnownReplica): Promise<void> {
  forgetReplica(replica.baseUrl, replica.email);
  if (typeof indexedDB === 'undefined') return;
  await new Promise<void>((resolve) => {
    try {
      const req = indexedDB.deleteDatabase(replica.idbName);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
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
