/** Domain type re-exports and UI-only shapes (model picker, export tiers). */
import type { UniversalArtifactDocument } from '../domains/01-artifact-document/types';

/**
 * The user identity every downstream component sees. Firebase is gone
 * (design-docs/19); Phase 3 replaces `signIn` with the VPS account login.
 * Until then the app boots into the Local Workspace pseudo-user.
 */
export interface WorkspaceUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL?: string | null;
  isOwner?: boolean;
  mode?: 'local' | 'vps';
}

export type { Granularity, ArtifactLayer } from '../domains/granularity';
export type { Turn, TurnMeta, ExtractedArtifact } from '../domains/01-dialogue-timeline/types';
export type { ChapterPartition } from '../domains/02-chapter-segmentation/types';
export type {
  ChapterTurns,
} from '../domains/02-chapter-segmentation/selectors';
export type { SemanticEdge, RelationKind } from '../domains/02-topological-graph/types';

export type Artifact = UniversalArtifactDocument;

export interface ModelOption {
  id: string;
  name: string;
  badge: string;
  powerRating: number;
  latency: string;
  contextWindow: string;
  description: string;
  costMultiplier?: number;
}

export type ArtifactType = 'document' | 'chapter' | (string & {});
export type ArtifactCategory = string;
export type ArtifactGraphData = NonNullable<UniversalArtifactDocument['graph']>;
