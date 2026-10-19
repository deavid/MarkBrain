/**
 * localStore — ProjectStore implementation over IndexedDB (localBackend.ts).
 *
 * Identity: none. The whole local store is "the user's tree". Success logs
 * carry the same messages persistenceService used to emit, so nothing above
 * the port can tell which implementation it talked to.
 */
import { logger } from '../../utils/logger';
import {
  localListProjects,
  localLoadProject,
  localPutProject,
  localReplaceAll,
  localDeleteProject,
} from '../localBackend';
import type { ProjectStore, ProjectSnapshot } from './projectStore';

export const localStore: ProjectStore = {
  async load(projectId: string): Promise<ProjectSnapshot | null> {
    // Already failure≠absence: localLoadProject rejects on IDB open/get
    // errors and resolves null only when the record is genuinely missing.
    return localLoadProject(projectId);
  },

  async list(): Promise<ProjectSnapshot[]> {
    const list = await localListProjects();
    logger.info('Persistence', `Listed ${list.length} local IndexedDB projects`);
    return list;
  },

  async save(snapshot: ProjectSnapshot): Promise<void> {
    await localPutProject(snapshot);
    logger.info('Persistence', `Saved project snapshot to IndexedDB`, {
      projectId: snapshot.projectId,
    });
  },

  async create(snapshot: ProjectSnapshot): Promise<void> {
    await localPutProject(snapshot);
    logger.info('Persistence', `Created new local project "${snapshot.name}" (${snapshot.projectId})`);
    // meta included in the stored record — WorkspaceDomain maps snap.name → display
  },

  async delete(projectId: string): Promise<void> {
    await localDeleteProject(projectId);
    logger.info('Persistence', `Deleted project ${projectId} from IndexedDB`);
  },

  async replaceAll(projects: ProjectSnapshot[]): Promise<void> {
    await localReplaceAll(projects);
    logger.info('Persistence', `Imported ${projects.length} project(s) into IndexedDB (full replace)`);
  },
};
