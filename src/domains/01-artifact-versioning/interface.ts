import { ArtifactRevision, RevisionActor, RevisionProvenance, VersioningEvent } from './types';
import type { ArtifactLayers } from '../01-artifact-document/types';

export interface RevisionSnapshotInput {
  actor: RevisionActor;
  changeSummary: string;
  provenance?: RevisionProvenance;
  title: string;
  layers: ArtifactLayers;
}

export interface IArtifactVersioningDomain {
  getHistory(artifactId: string): ArtifactRevision[];
  /** All revisions, keyed by artifact id — the persistence payload shape. */
  getAllRevisions(): Record<string, ArtifactRevision[]>;
  getLatestVersion(artifactId: string): number;
  getRevision(artifactId: string, version: number): ArtifactRevision | null;

  /** Full-snapshot revision (current path). Snapshots the state you pass in. */
  recordSnapshot(artifactId: string, input: RevisionSnapshotInput): ArtifactRevision;
  /**
   * Legacy RAM path: records a body-only revision ({ body: content } with empty
   * sibling layers). Kept so old callers and old snapshots keep working.
   */
  recordRevision(artifactId: string, content: string, changeSummary: string): ArtifactRevision;
  /** Merge revisions loaded from a snapshot; never drops existing history. */
  loadHistory(revisions: Record<string, ArtifactRevision[]>): void;
  /** Drops an artifact's whole history — permanent deletion only; archiving keeps it. */
  purgeArtifact(artifactId: string): void;
  /**
   * Append-only revert: records a NEW revision snapshot of the state being
   * discarded (so the revert itself is undoable), then returns the target
   * revision so the caller can restore title + layers onto the artifact.
   * `current` is the artifact's live state; when absent the target's own
   * state is re-snapshotted (legacy shape).
   */
  rollback(
    artifactId: string,
    targetVersion: number,
    current?: { title: string; layers: ArtifactLayers }
  ): ArtifactRevision;

  subscribe(callback: (event: VersioningEvent) => void): () => void;
}
