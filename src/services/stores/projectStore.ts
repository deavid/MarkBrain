/** Anticorruption port between `persistenceService` and the two storage backends (`firestoreStore`, `localStore`). */
import type { Turn } from '../../domains/01-dialogue-timeline/types';
import type { ChapterPartition } from '../../domains/02-chapter-segmentation/types';
import type { UniversalArtifactDocument } from '../../domains/01-artifact-document/types';
import type { SemanticEdge } from '../../domains/02-topological-graph/types';
import type { ChatThread, ThreadFolder } from '../../domains/06-chat-threads/types';

export interface ProjectSnapshot {
  projectId: string;
  turns: Turn[];
  chapters: ChapterPartition[];
  artifacts: UniversalArtifactDocument[];
  edges: SemanticEdge[];
  updatedAt: number;
  // Optional on load (the registry backfills legacy snapshots); always written on save.
  threads?: ChatThread[];
  folders?: ThreadFolder[];
  activeThreadId?: string;
  name?: string;
  codeName?: string;
  description?: string;
  color?: string;
}

/**
 * Backend contract:
 * - `load`: returns `null` ONLY when confirmed absent; throws on network/auth/IDB errors so callers never hydrate empty over real data.
 * - `list`: returns `[]` when unauthenticated or unreadable (never throws).
 * - `save`: full snapshot upsert (Firestore merges; IndexedDB replaces the record).
 * - `replaceAll`: local clears + writes atomically; Firestore merges upserts without deleting remote docs absent from the export.
 */
export interface ProjectStore {
  load(projectId: string): Promise<ProjectSnapshot | null>;
  list(): Promise<ProjectSnapshot[]>;
  save(snapshot: ProjectSnapshot): Promise<void>;
  create(snapshot: ProjectSnapshot): Promise<void>;
  delete(projectId: string): Promise<void>;
  replaceAll(projects: ProjectSnapshot[]): Promise<void>;
}
