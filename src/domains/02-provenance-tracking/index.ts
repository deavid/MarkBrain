import { ProvenanceRecord } from './types';

export interface IProvenanceTrackingDomain {
  linkArtifactToChapter(artifactId: string, chapterId: string, turnRange?: [number, number]): void;
  recordMutation(artifactId: string, chapterId: string): void;
  getOriginsForArtifact(artifactId: string): ProvenanceRecord | null;
  getArtifactsBirthedByChapter(chapterId: string): string[];
}

export class ProvenanceTrackingDomain implements IProvenanceTrackingDomain {
  private records: Map<string, ProvenanceRecord> = new Map();

  linkArtifactToChapter(artifactId: string, chapterId: string, turnRange?: [number, number]): void {
    const existing = this.records.get(artifactId);
    if (existing) {
      existing.mutationChapterIds.push(chapterId);
    } else {
      this.records.set(artifactId, {
        artifactId,
        originChapterId: chapterId,
        turnRange,
        mutationChapterIds: [],
      });
    }
  }

  recordMutation(artifactId: string, chapterId: string): void {
    const rec = this.records.get(artifactId);
    if (rec && !rec.mutationChapterIds.includes(chapterId)) {
      rec.mutationChapterIds.push(chapterId);
    }
  }

  getOriginsForArtifact(artifactId: string): ProvenanceRecord | null {
    return this.records.get(artifactId) || null;
  }

  getArtifactsBirthedByChapter(chapterId: string): string[] {
    const result: string[] = [];
    for (const rec of this.records.values()) {
      if (rec.originChapterId === chapterId) result.push(rec.artifactId);
    }
    return result;
  }
}
