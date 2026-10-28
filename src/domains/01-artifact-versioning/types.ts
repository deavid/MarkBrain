import type { ArtifactLayers } from '../01-artifact-document/types';

/** Who made the change the revision snapshots. */
export type RevisionActor = 'user' | 'ai';

/** Chat/turn provenance for AI updates — lets History link back to the conversation. */
export interface RevisionProvenance {
  threadId?: string;
  turnId?: string;
  turnIndex?: number | null;
}

/**
 * A full snapshot of an artifact at a point in time — title AND all four layers
 * together, never a body-only diff. Reverting must restore everything as one
 * document, so every revision carries the whole state.
 */
export interface ArtifactRevision {
  version: number;
  timestamp: number;
  actor: RevisionActor;
  changeSummary: string;
  provenance?: RevisionProvenance;
  title: string;
  layers: ArtifactLayers;
  /** @deprecated Old RAM revisions carried {content, previousContent}. Kept optional for legacy reads only. */
  content?: string;
  previousContent?: string;
}

export type VersioningEvent =
  | { type: 'revisionRecorded'; artifactId: string; revision: ArtifactRevision }
  | { type: 'revisionRestored'; artifactId: string; restoredVersion: number };
