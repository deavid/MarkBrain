import { ArtifactRevision, VersioningEvent } from './types';

export interface IArtifactVersioningDomain {
  getHistory(artifactId: string): ArtifactRevision[];
  getLatestVersion(artifactId: string): number;
  getRevision(artifactId: string, version: number): ArtifactRevision | null;

  recordRevision(artifactId: string, content: string, changeSummary: string): ArtifactRevision;
  /** Drops an artifact's whole history — permanent deletion only; archiving keeps it. */
  purgeArtifact(artifactId: string): void;
  rollback(artifactId: string, targetVersion: number): ArtifactRevision;

  subscribe(callback: (event: VersioningEvent) => void): () => void;
}
