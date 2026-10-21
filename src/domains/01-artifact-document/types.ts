/** Cumulative document layers (`title` is on the parent document; `description → summary → body` are read together). */
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
}

export type ArtifactDocumentEvent =
  | { type: 'artifactCreated'; artifact: UniversalArtifactDocument }
  | { type: 'artifactUpdated'; artifact: UniversalArtifactDocument }
  | { type: 'artifactsLoaded'; artifacts: UniversalArtifactDocument[] }
  | { type: 'artifactDeleted'; artifactId: string };
