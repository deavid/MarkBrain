import { IArtifactVersioningDomain, RevisionSnapshotInput } from './interface';
import { ArtifactRevision, VersioningEvent } from './types';
import type { ArtifactLayers } from '../01-artifact-document/types';

/** A revision list that is safe to merge: deduped by version, ordered ascending. */
function mergeList(existing: ArtifactRevision[], incoming: ArtifactRevision[]): ArtifactRevision[] {
  const byVersion = new Map<number, ArtifactRevision>();
  for (const r of existing) byVersion.set(r.version, r);
  for (const r of incoming) byVersion.set(r.version, r);
  return [...byVersion.values()].sort((a, b) => a.version - b.version);
}

export class ArtifactVersioningDomain implements IArtifactVersioningDomain {
  private history: Map<string, ArtifactRevision[]> = new Map();
  private listeners: Set<(event: VersioningEvent) => void> = new Set();

  getHistory(artifactId: string): ArtifactRevision[] {
    return [...(this.history.get(artifactId) || [])];
  }

  getAllRevisions(): Record<string, ArtifactRevision[]> {
    const out: Record<string, ArtifactRevision[]> = {};
    for (const [id, list] of this.history) out[id] = [...list];
    return out;
  }

  getLatestVersion(artifactId: string): number {
    const list = this.history.get(artifactId);
    return list && list.length > 0 ? list[list.length - 1].version : 0;
  }

  getRevision(artifactId: string, version: number): ArtifactRevision | null {
    const list = this.history.get(artifactId) || [];
    return list.find((r) => r.version === version) || null;
  }

  recordSnapshot(artifactId: string, input: RevisionSnapshotInput): ArtifactRevision {
    if (!this.history.has(artifactId)) {
      this.history.set(artifactId, []);
    }
    const list = this.history.get(artifactId)!;
    const revision: ArtifactRevision = {
      version: this.nextVersion(list),
      timestamp: Date.now(),
      actor: input.actor,
      changeSummary: input.changeSummary,
      ...(input.provenance ? { provenance: input.provenance } : {}),
      title: input.title,
      layers: {
        subtitle: input.layers.subtitle ?? '',
        description: input.layers.description ?? '',
        summary: input.layers.summary ?? '',
        body: input.layers.body ?? '',
      },
    };
    list.push(revision);
    this.emit({ type: 'revisionRecorded', artifactId, revision });
    return revision;
  }

  recordRevision(artifactId: string, content: string, changeSummary: string): ArtifactRevision {
    // Legacy shape: body-only snapshot with the old {content, previousContent}
    // fields, so pre-existing snapshots and callers keep round-tripping.
    if (!this.history.has(artifactId)) {
      this.history.set(artifactId, []);
    }
    const list = this.history.get(artifactId)!;
    const prev = list.length > 0 ? list[list.length - 1].content : undefined;
    const revision: ArtifactRevision = {
      version: this.nextVersion(list),
      timestamp: Date.now(),
      actor: 'user',
      changeSummary,
      title: '',
      layers: { subtitle: '', description: '', summary: '', body: content },
      content,
      ...(prev !== undefined ? { previousContent: prev } : {}),
    };
    list.push(revision);
    this.emit({ type: 'revisionRecorded', artifactId, revision });
    return revision;
  }

  loadHistory(revisions: Record<string, ArtifactRevision[]>): void {
    // Merge, never wipe: an artifact whose incoming list is empty or missing
    // keeps whatever history this session already holds.
    for (const [artifactId, list] of Object.entries(revisions)) {
      if (!list || list.length === 0) continue;
      const existing = this.history.get(artifactId) || [];
      this.history.set(artifactId, mergeList(existing, list));
    }
  }

  purgeArtifact(artifactId: string): void {
    this.history.delete(artifactId);
  }

  rollback(
    artifactId: string,
    targetVersion: number,
    current?: { title: string; layers: ArtifactLayers }
  ): ArtifactRevision {
    const list = this.history.get(artifactId) || [];
    const target = list.find((r) => r.version === targetVersion);
    if (!target) {
      throw new Error(`Revision ${targetVersion} not found for artifact ${artifactId}`);
    }
    // Append-only invariant: the revert first snapshots the state being
    // discarded (undoable), then the caller restores the target's full state.
    this.recordSnapshot(artifactId, {
      actor: 'user',
      changeSummary: `Revert to v${targetVersion}`,
      title: current?.title ?? target.title,
      layers: current?.layers ?? target.layers,
    });
    this.emit({ type: 'revisionRestored', artifactId, restoredVersion: targetVersion });
    return target;
  }

  subscribe(callback: (event: VersioningEvent) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /** Version numbers never reset, even after a legacy/loaded mix. */
  private nextVersion(list: ArtifactRevision[]): number {
    return list.length > 0 ? list[list.length - 1].version + 1 : 1;
  }

  private emit(event: VersioningEvent) {
    this.listeners.forEach((l) => l(event));
  }
}
