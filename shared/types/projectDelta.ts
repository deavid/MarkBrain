/**
 * ProjectDeltaResponse — the server's incremental sync payload (21E).
 *
 * Lives in shared/ so the server repo (server/db/projectRepo.ts) that produces
 * it and the client hook (src/application/useVpsDeltaSync.ts) that merges it
 * share one contract without the client importing anything from server/.
 */
import type { Turn } from './timeline';
import type { ChapterPartition } from './chapters';
import type { UniversalArtifactDocument } from './artifact';
import type { SemanticEdge } from './graph';
import type { ArtifactRevision } from './artifactRevision';
import type { ChatThread, ThreadFolder } from './threads';

export interface ProjectDeltaResponse {
  projectId: string;
  revision: number;
  projectMeta?: {
    name: string;
    codeName: string;
    description: string;
    color: string;
    activeThreadId?: string;
    updatedAt: number;
  };
  threads: ChatThread[];
  folders: ThreadFolder[];
  turns: Turn[];
  chapters: ChapterPartition[];
  artifacts: UniversalArtifactDocument[];
  edges: SemanticEdge[];
  /** Artifact revision rows newer than the cursor, keyed by artifact id. */
  revisions?: Record<string, ArtifactRevision[]>;
  tombstones: Array<{ entityType: string; entityId: string }>;
  activeJobs: unknown[]; // populated in Phase 5 (21E)
}
