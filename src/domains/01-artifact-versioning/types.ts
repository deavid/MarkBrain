export interface ArtifactRevision {
  version: number;
  timestamp: number;
  changeSummary: string;
  previousContent?: string;
  content: string;
}

export type VersioningEvent =
  | { type: 'revisionRecorded'; artifactId: string; revision: ArtifactRevision }
  | { type: 'revisionRestored'; artifactId: string; restoredVersion: number };
