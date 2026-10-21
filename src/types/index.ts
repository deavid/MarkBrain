/** Domain type re-exports and UI-only shapes (model picker, export tiers, chapter pastels). */
import type { UniversalArtifactDocument } from '../domains/01-artifact-document/types';

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

export const MELLOW_DARK_PASTELS = [
  '#4a3f6b',
  '#2d5a6c',
  '#3d6350',
  '#6e4c38',
  '#594263',
  '#2f5266',
  '#634b52',
  '#425e70',
  '#545938',
  '#3a5959',
  '#5f4359',
  '#4d5366',
];

export function getMellowPastelColor(seed: string | number): string {
  if (typeof seed === 'number') {
    return MELLOW_DARK_PASTELS[Math.abs(seed) % MELLOW_DARK_PASTELS.length];
  }
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  return MELLOW_DARK_PASTELS[Math.abs(hash) % MELLOW_DARK_PASTELS.length];
}
