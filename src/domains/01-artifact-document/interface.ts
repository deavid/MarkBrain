import { UniversalArtifactDocument, ArtifactDocumentEvent, ResolutionTier } from './types';

export interface IArtifactDocumentDomain {
  // Queries
  getArtifact(id: string): UniversalArtifactDocument | null;
  listArtifacts(): UniversalArtifactDocument[];
  getTierContent(id: string, tier: ResolutionTier): string;

  // Commands
  upsertArtifact(doc: Partial<UniversalArtifactDocument> & { id: string; title: string }): UniversalArtifactDocument;
  updateTiers(id: string, tiers: Partial<UniversalArtifactDocument['current']>): void;
  deleteArtifact(id: string): void;
  loadArtifacts(docs: UniversalArtifactDocument[]): void;

  // Subscriptions
  subscribe(callback: (event: ArtifactDocumentEvent) => void): () => void;
}
