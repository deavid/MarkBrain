// ============================================================================
// UI-only type bridge (the legacy shared types are DEAD — see
// design-docs/08_UNIFIED_DATA_MODEL.md). This module survives as:
//   1. re-exports of domain types (the one truth), and
//   2. genuinely UI-only shapes (model picker, tier labels, pastels).
// Every surviving export must have real importers — no zombies.
// ============================================================================
import type { UniversalArtifactDocument } from '../domains/01-artifact-document/types';

// ── Domain re-exports (single source of truth lives in the domains) ─────────
export type { Granularity, ArtifactLayer } from '../domains/granularity';
export type { Turn, TurnMeta, ExtractedArtifact } from '../domains/01-dialogue-timeline/types';
export type { ChapterPartition } from '../domains/02-chapter-segmentation/types';
export type {
  ChapterTurns,
} from '../domains/02-chapter-segmentation/selectors';
export type { SemanticEdge, RelationKind } from '../domains/02-topological-graph/types';

/** Universal Artifact Primitive — the artifact DOCUMENT model lives in the domain layer. */
export type Artifact = UniversalArtifactDocument;

// ── UI-only shapes ──────────────────────────────────────────────────────────

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
/** The artifact's `graph` field shape (import/UI parsing only). */
export type ArtifactGraphData = NonNullable<UniversalArtifactDocument['graph']>;

export const MELLOW_DARK_PASTELS = [
  '#4a3f6b', // Mellow dark lavender/purple
  '#2d5a6c', // Mellow dark slate teal
  '#3d6350', // Mellow dark sage/forest
  '#6e4c38', // Mellow dark warm cedar
  '#594263', // Mellow dark plum/mauve
  '#2f5266', // Mellow dark oceanic steel
  '#634b52', // Mellow dark dusky rose
  '#425e70', // Mellow dark indigo slate
  '#545938', // Mellow dark olive brass
  '#3a5959', // Mellow dark eucalyptus
  '#5f4359', // Mellow dark amethyst
  '#4d5366', // Mellow dark dusk navy
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
