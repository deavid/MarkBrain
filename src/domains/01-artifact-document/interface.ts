import { UniversalArtifactDocument, ArtifactLayers, ArtifactDocumentEvent } from './types';
import type { Granularity } from '../granularity';

export interface IArtifactDocumentDomain {
  getArtifact(id: string): UniversalArtifactDocument | null;
  listArtifacts(): UniversalArtifactDocument[];
  getContentAtGranularity(id: string, granularity: Granularity): string;

  upsertArtifact(doc: Partial<UniversalArtifactDocument> & { id: string; title: string }): UniversalArtifactDocument;
  updateLayers(id: string, layers: Partial<ArtifactLayers>): void;
  deleteArtifact(id: string): void;
  loadArtifacts(docs: UniversalArtifactDocument[]): void;

  subscribe(callback: (event: ArtifactDocumentEvent) => void): () => void;
}
