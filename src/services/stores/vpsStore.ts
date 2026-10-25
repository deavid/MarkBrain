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
import {
  localListProjects,
  localLoadProject,
  localPutProject,
  localReplaceAll,
  localDeleteProject,
} from '../localBackend';
import type { ProjectStore, ProjectSnapshot } from './projectStore';

async function mirrorAll(projects: ProjectSnapshot[]): Promise<void> {
  await localReplaceAll(projects);
}

export const vpsStore: ProjectStore = {
  async load(projectId: string): Promise<ProjectSnapshot | null> {
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
    await localPutProject(snapshot); // mirror first: local edit never lost
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
      return;
    }
    if (!res.ok) throw new Error(`Project save failed: HTTP ${res.status}`);
  },

  async create(snapshot: ProjectSnapshot): Promise<void> {
    await localPutProject(snapshot);
    const res = await apiFetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project: snapshot }),
    });
    if (!res.ok && res.status !== 409) throw new Error(`Project create failed: HTTP ${res.status}`);
  },

  async delete(projectId: string): Promise<void> {
    await localDeleteProject(projectId);
    const res = await apiFetch(`/api/projects/${encodeURIComponent(projectId)}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) throw new Error(`Project delete failed: HTTP ${res.status}`);
  },

  async replaceAll(projects: ProjectSnapshot[]): Promise<void> {
    await mirrorAll(projects);
    const res = await apiFetch('/api/projects/replace-all', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projects }),
    });
    if (!res.ok) throw new Error(`replaceAll failed: HTTP ${res.status}`);
  },
};
