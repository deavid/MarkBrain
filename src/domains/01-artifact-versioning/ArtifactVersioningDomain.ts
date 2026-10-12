import { IArtifactVersioningDomain } from './interface';
import { ArtifactRevision, VersioningEvent } from './types';

export class ArtifactVersioningDomain implements IArtifactVersioningDomain {
  private history: Map<string, ArtifactRevision[]> = new Map();
  private listeners: Set<(event: VersioningEvent) => void> = new Set();

  getHistory(artifactId: string): ArtifactRevision[] {
    return [...(this.history.get(artifactId) || [])];
  }

  getLatestVersion(artifactId: string): number {
    const list = this.history.get(artifactId);
    return list && list.length > 0 ? list[list.length - 1].version : 0;
  }

  getRevision(artifactId: string, version: number): ArtifactRevision | null {
    const list = this.history.get(artifactId) || [];
    return list.find((r) => r.version === version) || null;
  }

  recordRevision(artifactId: string, content: string, changeSummary: string): ArtifactRevision {
    if (!this.history.has(artifactId)) {
      this.history.set(artifactId, []);
    }
    const list = this.history.get(artifactId)!;
    const prev = list.length > 0 ? list[list.length - 1].content : undefined;
    const revision: ArtifactRevision = {
      version: list.length + 1,
      timestamp: Date.now(),
      changeSummary,
      previousContent: prev,
      content,
    };
    list.push(revision);
    this.emit({ type: 'revisionRecorded', artifactId, revision });
    return revision;
  }

  rollback(artifactId: string, targetVersion: number): ArtifactRevision {
    const list = this.history.get(artifactId) || [];
    const target = list.find((r) => r.version === targetVersion);
    if (!target) {
      throw new Error(`Revision ${targetVersion} not found for artifact ${artifactId}`);
    }
    // Append-only invariant: rollback creates a NEW revision matching target content
    const restored = this.recordRevision(
      artifactId,
      target.content,
      `Non-destructive rollback to version ${targetVersion}`
    );
    this.emit({ type: 'revisionRestored', artifactId, restoredVersion: targetVersion });
    return restored;
  }

  subscribe(callback: (event: VersioningEvent) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  private emit(event: VersioningEvent) {
    this.listeners.forEach((l) => l(event));
  }
}
