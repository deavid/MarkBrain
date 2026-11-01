/** Anticorruption port between `persistenceService` and the storage backends (`localStore`, later `vpsStore`). */
import type { ProjectSnapshot } from '../../../shared/types/projectSnapshot';
import type { Turn } from '../../../shared/types/timeline';
export type { ProjectSnapshot } from '../../../shared/types/projectSnapshot';
export type { Turn } from '../../../shared/types/timeline';

/**
 * Backend contract:
 * - `load`: returns `null` ONLY when confirmed absent; throws on network/IDB errors so callers never hydrate empty over real data.
 * - `list`: returns `[]` when unauthenticated or unreadable (never throws).
 * - `save`: full snapshot upsert (IndexedDB replaces the record; 21D's vpsStore merges atomically per entity).
 * - `replaceAll`: local clears + writes atomically.
 */
export interface ProjectStore {
  load(projectId: string): Promise<ProjectSnapshot | null>;
  list(): Promise<ProjectSnapshot[]>;
  save(snapshot: ProjectSnapshot): Promise<void>;
  create(snapshot: ProjectSnapshot): Promise<void>;
  delete(projectId: string): Promise<void>;
  replaceAll(projects: ProjectSnapshot[]): Promise<void>;
}
