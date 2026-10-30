/**
 * ProjectSnapshot — the wire/storage shape a whole project travels in.
 *
 * Split out of `src/services/stores/projectStore.ts` so the server
 * (server/db/projectRepo.ts, server/routes/projects.ts) and the client
 * persistence port share ONE definition. The `ProjectStore` port itself stays
 * client-side in `src/services/stores/projectStore.ts`.
 */
import type { Turn } from './timeline';
import type { ChapterPartition } from './chapters';
import type { UniversalArtifactDocument } from './artifact';
import type { SemanticEdge } from './graph';
import type { ChatCapabilities, ChatThread, ThreadFolder } from './threads';
import type { ArtifactRevision } from './artifactRevision';

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
