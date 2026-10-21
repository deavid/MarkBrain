/**
 * Cumulative document layers. `title` lives on the parent document; these are
 * read together in order, each continuing where the previous one stopped.
 */
export type ArtifactLifecycle = 'active' | 'archived';

export interface ArtifactLayers {
  /**
   * The index-card hook, shown next to the title in every row and sent with it
   * at the `title` cut (~40 tokens). A bare 4-word title tells a reader nothing,
   * and 40 tokens is free, so the two always travel as `title — subtitle`.
   */
  subtitle?: string;
  /** The executive overview: core thesis, pillars, conclusions (~200 tokens). */
  description: string;
  /** The substantive digest: every section, rule, number, rejection (~800-1500). */
  summary: string;
  /** The verbatim source document. Spliced, never generated. */
  body: string;
}

export interface UniversalArtifactDocument {
  id: string;
  workspaceId: string;
  code: string;
  title: string;
  type: 'document' | 'chapter';
  category: string;
  isHighConcept: boolean;
  color?: string;
  current: ArtifactLayers;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  graph?: {
    x?: number;
    y?: number;
    is_high_concept?: boolean;
    parent?: string;
    children?: string[];
    relationships?: Array<{ target: string; type: string; note?: string }>;
    [key: string]: any;
  };
  yamlDocument?: string;
  /**
   * Parking state; `undefined` = active (legacy snapshots). Archived is the ONLY
   * state from which permanent deletion is allowed — and it changes nothing the
   * LLM sees, only what the cleanup tool will let you destroy.
   */
  lifecycle?: ArtifactLifecycle;
}

/** Legacy snapshots carry no lifecycle — active is the default, never a missing state. */
export function isArtifactArchived(art: Pick<UniversalArtifactDocument, 'lifecycle'>): boolean {
  return art.lifecycle === 'archived';
}

export type ArtifactDocumentEvent =
  | { type: 'artifactCreated'; artifact: UniversalArtifactDocument }
  | { type: 'artifactUpdated'; artifact: UniversalArtifactDocument }
  | { type: 'artifactsLoaded'; artifacts: UniversalArtifactDocument[] }
  | { type: 'artifactDeleted'; artifactId: string };
