/** Anticorruption port between `persistenceService` and the storage backends (`localStore`, later `vpsStore`). */
import type { Turn } from '../../domains/01-dialogue-timeline/types';
import type { ChapterPartition } from '../../domains/02-chapter-segmentation/types';
import type { UniversalArtifactDocument } from '../../domains/01-artifact-document/types';
import type { SemanticEdge } from '../../domains/02-topological-graph/types';
import type { ChatCapabilities, ChatThread, ThreadFolder } from '../../domains/06-chat-threads/types';
import type { ArtifactRevision } from '../../domains/01-artifact-versioning/types';

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
  /**
   * Written by builds where nothing but the user moves a chapter's cut. Its
   * absence marks a legacy snapshot, whose chapters were auto-sealed to
   * `summary` on close — hydrate.ts resets those to Full exactly once.
   */
  granularityLaw?: 'user-only';
  /** Artifact revision history, keyed by artifact id. */
  revisions?: Record<string, ArtifactRevision[]>;
  /** Project-default chat capabilities (Package 2 §2.2); optional for backward compat. */
  capabilities?: Partial<ChatCapabilities>;
}

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
