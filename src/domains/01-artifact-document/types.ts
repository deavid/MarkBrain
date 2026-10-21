/** Cumulative document layers (`title` is on the parent document; `description → summary → body` are read together). */
export type ArtifactLifecycle = 'active' | 'archived';

export interface ArtifactLayers {
  description: string;
  summary: string;
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
