/** IndexedDB implementation of ProjectStore (delegates to localBackend.ts). */
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
