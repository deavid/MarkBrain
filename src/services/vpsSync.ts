/**
 * vpsSync — replays the offline outbox against the VPS (2026-10-26 design).
 *
 * Contract with vpsStore/offlineOutbox:
 * - While offline, vpsStore.save resolves after writing the IndexedDB mirror
 *   and queues WHAT changed (entity ids + scalars + baseRevision) in the
 *   outbox. Nothing is lost, nothing is pushed.
 * - On reconnect ('online' event), on app boot with pending records, and
 *   whenever the user hits the sidebar refresh, replayOutbox() runs:
 *
 *   for each dirty project:
 *     GET server copy
 *       404            → project was created offline → POST the mirror whole
 *       revision match → nobody wrote since we mirrored → push mirror whole
 *       otherwise      → entity-level merge: LOCAL wins for the ids it went
 *                        dirty on (and for offline removals), SERVER wins for
 *                        everything else → PUT merged
 *
 * No clock trust (no updatedAt judging), no 409 machinery: the revision
 * counter only decides wholesale-push vs merge. Last-write-wins per entity is
 * the accepted policy — single user, offline windows are note-taking.
 *
 * Event-driven only, never a timer: replay fires on connection events and
 * explicit user action. A failing replay leaves the outbox intact for the
 * next event (attempts counter is informational) — that IS the backoff.
 */
import { logger } from '../utils/logger';
import { apiFetch } from '../gateway/api';
import { getWorkspaceMode, getVpsSession } from './workspaceSession';
import { localLoadProject, localPutProject } from './localBackend';
import {
  getAllRecords,
  clearDirty,
  bumpAttempts,
  OUTBOX_CHANGED_EVENT,
  type OutboxRecord,
} from './offlineOutbox';
import type { ProjectSnapshot } from './stores/projectStore';

type MirrorWithRevision = ProjectSnapshot & { revision?: number };

function isNetworkFailure(err: unknown): boolean {
  return err instanceof TypeError || (err as { name?: string })?.name === 'TypeError';
}

class ReplayAuthError extends Error {
  constructor() {
    super('session expired — sign in to sync');
    this.name = 'ReplayAuthError';
  }
}

/**
 * Entity-level merge: overlay the offline mirror's dirty entities onto the
 * server snapshot. Server wins for every id the phone did not touch; local
 * removals are honoured; local scalars (name, color, active thread...) win
 * when they went dirty offline.
 */
export function mergeSnapshot(
  server: ProjectSnapshot,
  mirror: ProjectSnapshot,
  rec: OutboxRecord
): ProjectSnapshot {
  const merged: ProjectSnapshot = {
    ...server,
    updatedAt: mirror.updatedAt, // last human edit, not sync time
  };

  type WithId = { id: string };
  const overlay = (col: keyof Pick<ProjectSnapshot, 'turns' | 'chapters' | 'artifacts' | 'edges' | 'threads' | 'folders'>) => {
    const serverList = (merged[col] ?? []) as WithId[];
    const mirrorList = (mirror[col] ?? []) as WithId[];
    const added = rec.dirty.added[col];
    const byId = new Map(serverList.filter((e) => e).map((e) => [e.id, e]));
    for (const e of mirrorList) {
      if (!e) continue;
      if (added.has(e.id) || !byId.has(e.id)) byId.set(e.id, e); // local wins on dirty ids; new ids append
    }
    (merged[col] as unknown as WithId[]) = [...byId.values()];
  };

  overlay('turns');
  overlay('chapters');
  overlay('artifacts');
  overlay('edges');
  overlay('threads');
  overlay('folders');

  for (const field of rec.scalars) {
    (merged as unknown as Record<string, unknown>)[field] = (mirror as unknown as Record<string, unknown>)[field];
  }
  return merged;
}

/**
 * Explicit dependency handed in from above (Phase 6 layering): the flush of
 * the persistent mutation queue lives in src/application — a service must not
 * reach up into it, so the composition root passes it in via initVpsSync.
 */
export interface VpsSyncDeps {
  flushServerMutations: (projectId: string) => Promise<void>;
}

let syncDeps: VpsSyncDeps | null = null;

async function replayOne(rec: OutboxRecord): Promise<'synced' | 'failed'> {
  // Entity deletions made offline ride the persistent mutation queue (see
  // offlineOutbox header) — flush them FIRST so the GET below sees the
  // post-tombstone server state and the merge cannot resurrect deleted rows.
  if (!syncDeps) throw new Error('vpsSync: flushServerMutations dependency not wired — call initVpsSync(deps) first');
  await syncDeps.flushServerMutations(rec.projectId);
  const mirror = await localLoadProject(rec.projectId);
  if (!mirror) {
    // Mirror record gone (project deleted online → delete() cleared this; or
    // user wiped local data): nothing to push.
    clearDirty(rec.projectId);
    return 'synced';
  }

  const get = await apiFetch(`/api/projects/${encodeURIComponent(rec.projectId)}`);
  if (get.status === 401 || get.status === 403) throw new ReplayAuthError();
  if (get.status === 404) {
      // Created offline — the server has never seen it. POST the mirror whole.
    const create = await apiFetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project: mirror }),
    });
    if (create.status === 401 || create.status === 403) throw new ReplayAuthError();
    if (!create.ok) throw new Error(`offline replay create failed: HTTP ${create.status}`);
    clearDirty(rec.projectId);
    logger.warn('vpsSync', `replayed: created ${rec.projectId} on server`);
    return 'synced';
  }
  if (!get.ok) throw new Error(`offline replay load failed: HTTP ${get.status}`);

  const body = (await get.json()) as { project: MirrorWithRevision & { revision: number } };
  const serverRevision = body.project.revision;
  const baseMatches = rec.baseRevision != null && serverRevision === rec.baseRevision;

  let toPush: ProjectSnapshot;
  if (baseMatches) {
    // Nobody wrote since the phone last synced: the mirror IS the newest state.
    toPush = mirror;
  } else {
    toPush = mergeSnapshot(body.project, mirror, rec);
    logger.warn(
      'vpsSync',
      `merging ${rec.projectId}: server revision ${serverRevision} != base ${rec.baseRevision} — entity-level overlay`
    );
  }

  const put = await apiFetch(`/api/projects/${encodeURIComponent(rec.projectId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(toPush),
  });
  if (put.status === 401 || put.status === 403) throw new ReplayAuthError();
  if (!put.ok) throw new Error(`offline replay save failed: HTTP ${put.status}`);
  const putBody = (await put.json()) as { revision: number };
  // Mirror adopts the merged state + fresh revision so the next offline window
  // diffs from what the server actually has now.
  await localPutProject({ ...toPush, revision: putBody.revision } as MirrorWithRevision);
  clearDirty(rec.projectId);
  return 'synced';
}

/** Replay everything pending. Returns how many projects synced. */
export async function replayOutbox(): Promise<number> {
  const records = getAllRecords();
  if (records.length === 0) return 0;
  if (getWorkspaceMode() !== 'vps' || !getVpsSession()) return 0;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 0;

  let synced = 0;
  for (const rec of records) {
    try {
      const ok = await replayOne(rec);
      if (ok === 'synced') synced += 1;
    } catch (err) {
      if (err instanceof ReplayAuthError) {
        logger.warn('vpsSync', 'session expired — remaining unsynced edits stay queued until sign-in');
        break; // stop the loop; records remain for the next attempt after re-auth
      }
      bumpAttempts(rec.projectId);
      if (isNetworkFailure(err)) {
        logger.warn('vpsSync', `connection lost mid-replay — ${rec.projectId} stays queued`, err);
        break;
      }
      logger.warn('vpsSync', `replay failed for ${rec.projectId} — stays queued`, err);
    }
  }
  if (synced > 0 && typeof window !== 'undefined') window.dispatchEvent(new Event(OUTBOX_CHANGED_EVENT));
  return synced;
}

let initialized = false;

/**
 * Wire the event triggers. Called once from the app shell (idempotent).
 * Event-driven only: 'online' + one attempt on boot. No timers.
 */
export function initVpsSync(deps: VpsSyncDeps): void {
  // Deps are recorded even in non-window (node test) environments — replay
  // must work wherever the outbox does. The event listeners stay browser-only.
  syncDeps = deps;
  if (initialized || typeof window === 'undefined') return;
  initialized = true;
  window.addEventListener('online', () => {
    void replayOutbox();
  });
}
