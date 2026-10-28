/**
 * vpsStore — Connected VPS Workspace ProjectStore (design-docs/21D §4).
 *
 * Source of truth is the VPS (`/api/projects/*` with the session Bearer);
 * the isolated `markbrain-vps:<origin>:<email>` IndexedDB namespace (same
 * `getActiveIdbName()` as localBackend) is the fast mirror + offline cache.
 *
 * - list(): server first, mirror refreshed; network failure falls back to the
 *   mirror so a plane/subway session still opens the workspace.
 * - save/create/delete/replaceAll: write BOTH the mirror and the server.
 *   Server failure rejects (persistWorker surfaces the critical notice) —
 *   the mirror still holds the local edit so nothing is silently lost.
 */
import { logger } from '../../utils/logger';
import { apiFetch } from '../../gateway/api';
import { isOfflineReplica } from '../../services/workspaceSession';
import {
  localListProjects,  localLoadProject,
  localPutProject,
  localReplaceAll,
  localDeleteProject,
} from '../localBackend';
import * as offlineOutbox from '../offlineOutbox';
import type { ProjectStore, ProjectSnapshot } from './projectStore';

async function mirrorAll(projects: ProjectSnapshot[]): Promise<void> {
  await localReplaceAll(projects);
}

  /** Mirror snapshot revision type: body.project carries `revision` from the server. */
  type MirrorWithRevision = ProjectSnapshot & { revision?: number };

  /**
   * A failure with no HTTP response at all (fetch throws TypeError) is the
   * offline signature. HTTP failures (401/500/quota) are NOT offline — those
   * keep the loud critical-notice path.
   */
  function isNetworkFailure(err: unknown): boolean {
    return err instanceof TypeError || (err as { name?: string })?.name === 'TypeError';
  }

  /** Preserve the mirror's last-seen server revision across local writes. */
  function withRevision(snapshot: ProjectSnapshot, revision: number | null): MirrorWithRevision {
    return revision == null ? { ...snapshot } : ({ ...snapshot, revision } as MirrorWithRevision);
  }

  export const vpsStore: ProjectStore = {
  async load(projectId: string): Promise<ProjectSnapshot | null> {
    // Offline replica (Package 3 §3.6): the mirror is the only source — zero
    // network calls, confirmed absence reads as null straight from the mirror.
    if (isOfflineReplica()) return localLoadProject(projectId);
    try {
      const res = await apiFetch(`/api/projects/${encodeURIComponent(projectId)}`);
      if (res.status === 404) return null; // confirmed absence (port contract)
      if (!res.ok) throw new Error(`Project load failed: HTTP ${res.status}`);
      const body = (await res.json()) as { project: ProjectSnapshot & { revision: number } };
      await localPutProject(body.project); // refresh mirror (incl. revision)
      const { revision: _revision, ...snapshot } = body.project;
      void _revision;
      return snapshot as ProjectSnapshot;
    } catch (err) {
      // Network/offline → mirror fallback keeps the workspace viewable.
      logger.warn('VpsStore', `Server load failed for ${projectId} — reading mirror`, err);
      return localLoadProject(projectId);
    }
  },

  async list(): Promise<ProjectSnapshot[]> {
    // Offline replica: the mirror list only (Package 3 §3.6).
    if (isOfflineReplica()) return localListProjects();
    try {
      const res = await apiFetch('/api/projects');
      if (!res.ok) throw new Error(`Project list failed: HTTP ${res.status}`);
      const body = (await res.json()) as { projects: Array<ProjectSnapshot & { revision: number }> };
      const projects = body.projects.map((p) => {
        const { revision: _r, ...snap } = p;
        void _r;
        return snap as ProjectSnapshot;
      });
      await mirrorAll(projects);
      return projects;
    } catch (err) {
      logger.warn('VpsStore', 'Server list failed — reading IndexedDB mirror', err);
      return localListProjects();
    }
  },

  async save(snapshot: ProjectSnapshot): Promise<void> {
    // Offline replica: mirror only — no server write, no outbox entry (the
    // replica was opened from stale data; replaying those edits would clobber
    // server-side changes made since the mirror was last synced).
    if (isOfflineReplica()) {
      await localPutProject(snapshot);
      logger.warn('VpsStore', `offline replica: ${snapshot.projectId} saved to the local mirror only`);
      return;
    }
    // Capture the mirror's last-seen server revision BEFORE the local write
    // replaces the record — it is the baseRevision the outbox replays against.
    const existing = (await localLoadProject(snapshot.projectId)) as MirrorWithRevision | null;
    const baseRevision = typeof existing?.revision === 'number' ? existing.revision : null;
    await localPutProject(withRevision(snapshot, baseRevision)); // mirror first: local edit never lost
    try {
      const res = await apiFetch(`/api/projects/${encodeURIComponent(snapshot.projectId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(snapshot),
      });
      if (res.status === 404) {
        // Project not on the server yet (created offline) → create then save.
        const create = await apiFetch('/api/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ project: snapshot }),
        });
        if (!create.ok) throw new Error(`Project create failed: HTTP ${create.status}`);
        offlineOutbox.clearDirty(snapshot.projectId);
        return;
      }
      if (!res.ok) throw new Error(`Project save failed: HTTP ${res.status}`);
      offlineOutbox.clearDirty(snapshot.projectId); // server confirmed → outbox entry gone
    } catch (err) {
      if (!isNetworkFailure(err)) throw err;
      // Offline: the edit lives safely in the mirror. Queue what changed and
      // resolve — the save DID land somewhere durable. vpsSync replays it on
      // reconnect; the sidebar shows the unsynced badge meanwhile.
      offlineOutbox.markDirty(
        snapshot.projectId,
        existing ?? null,
        snapshot,
        baseRevision
      );
      logger.warn('VpsStore', `offline: ${snapshot.projectId} queued for replay (baseRevision=${baseRevision})`);
    }
  },

  async create(snapshot: ProjectSnapshot): Promise<void> {
    // Offline replica: mirror only (same reasoning as save()).
    if (isOfflineReplica()) {
      await localPutProject(snapshot);
      logger.warn('VpsStore', `offline replica: created ${snapshot.projectId} in the local mirror only`);
      return;
    }
    await localPutProject(snapshot);
    try {
      const res = await apiFetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project: snapshot }),
      });
      if (!res.ok && res.status !== 409) throw new Error(`Project create failed: HTTP ${res.status}`);
      offlineOutbox.clearDirty(snapshot.projectId);
    } catch (err) {
      if (!isNetworkFailure(err)) throw err;
      // Created offline: the mirror holds it; replay will POST it (404→create path).
      offlineOutbox.markDirty(snapshot.projectId, null, snapshot, null);
      logger.warn('VpsStore', `offline: created ${snapshot.projectId} in mirror, queued for replay`);
    }
  },

  async delete(projectId: string): Promise<void> {
    // Offline replica: project deletion mirrors the online-only rule —
    // refusing keeps the mirror a faithful (if stale) replica.
    if (isOfflineReplica()) {
      throw new Error('Deleting a project needs a connection. Archive it instead, or delete when back online.');
    }
    // Project deletion is ONLINE-ONLY (2026-10-26 decision): offline it is
    // ambiguous against server-side edits, and there is no tombstone story
    // worth building. Anyone needing to remove something offline archives it.
    // (A connection dropping mid-delete is caught below: the mirror copy is
    // restored so the project is never half-deleted.)
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new Error('Deleting a project needs a connection. Archive it instead, or delete when back online.');
    }
    const doomed = await localLoadProject(projectId); // keep a copy in case the server write fails
    await localDeleteProject(projectId);
    try {
      const res = await apiFetch(`/api/projects/${encodeURIComponent(projectId)}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 404) throw new Error(`Project delete failed: HTTP ${res.status}`);
      offlineOutbox.clearDirty(projectId); // server-confirmed deletion → drop any stale queue entry
    } catch (err) {
      if (isNetworkFailure(err) && doomed) {
        // Connection dropped mid-delete: put the mirror back so the project
        // is not half-deleted (gone locally, alive on the server).
        await localPutProject(doomed);
      }
      throw err;
    }
  },

  async replaceAll(projects: ProjectSnapshot[]): Promise<void> {
    // Offline replica: mirror only — a plaintext import must work offline.
    if (isOfflineReplica()) {
      await mirrorAll(projects);
      return;
    }
    await mirrorAll(projects);
    const res = await apiFetch('/api/projects/replace-all', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projects }),
    });
    if (!res.ok) throw new Error(`replaceAll failed: HTTP ${res.status}`);
  },
};
