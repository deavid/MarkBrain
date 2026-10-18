export type ResolutionTier = 0 | 1 | 2 | 3;

export interface MultiResolutionTiers {
  t0_label: string;
  t1_abstract: string;
  t2_summary: string;
  t3_body: string;
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
  current: MultiResolutionTiers;
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
  resolution?: any;
  yamlDocument?: string;
}

export type ArtifactDocumentEvent =
  | { type: 'artifactCreated'; artifact: UniversalArtifactDocument }
  | { type: 'artifactUpdated'; artifact: UniversalArtifactDocument }
  | { type: 'artifactsLoaded'; artifacts: UniversalArtifactDocument[] }
  | { type: 'artifactDeleted'; artifactId: string };
