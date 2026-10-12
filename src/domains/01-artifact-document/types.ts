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
}

export type ArtifactDocumentEvent =
  | { type: 'artifactCreated'; artifact: UniversalArtifactDocument }
  | { type: 'artifactUpdated'; artifact: UniversalArtifactDocument }
  | { type: 'artifactDeleted'; artifactId: string };
