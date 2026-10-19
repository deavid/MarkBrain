import { UniversalArtifactDocument, ArtifactLayers, ArtifactDocumentEvent } from './types';
import type { Granularity } from '../granularity';

export interface IArtifactDocumentDomain {
  // Queries
  getArtifact(id: string): UniversalArtifactDocument | null;
  listArtifacts(): UniversalArtifactDocument[];
  /** The artifact's text cut at `granularity` (title+description+summary+body, cut). */
  getContentAtGranularity(id: string, granularity: Granularity): string;

  // Commands
  upsertArtifact(doc: Partial<UniversalArtifactDocument> & { id: string; title: string }): UniversalArtifactDocument;
  updateLayers(id: string, layers: Partial<ArtifactLayers>): void;
  deleteArtifact(id: string): void;
  loadArtifacts(docs: UniversalArtifactDocument[]): void;

  // Subscriptions
  subscribe(callback: (event: ArtifactDocumentEvent) => void): () => void;
}
