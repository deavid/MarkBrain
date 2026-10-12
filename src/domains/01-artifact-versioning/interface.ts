import { ArtifactRevision, VersioningEvent } from './types';

export interface IArtifactVersioningDomain {
  // Queries
  getHistory(artifactId: string): ArtifactRevision[];
  getLatestVersion(artifactId: string): number;
  getRevision(artifactId: string, version: number): ArtifactRevision | null;

  // Commands
  recordRevision(artifactId: string, content: string, changeSummary: string): ArtifactRevision;
  rollback(artifactId: string, targetVersion: number): ArtifactRevision;

  // Subscriptions
  subscribe(callback: (event: VersioningEvent) => void): () => void;
}
