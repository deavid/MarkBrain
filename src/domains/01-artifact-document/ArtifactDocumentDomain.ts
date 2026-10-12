import { IArtifactDocumentDomain } from './interface';
import { UniversalArtifactDocument, ArtifactDocumentEvent, ResolutionTier } from './types';

export class ArtifactDocumentDomain implements IArtifactDocumentDomain {
  private artifacts: Map<string, UniversalArtifactDocument> = new Map();
  private listeners: Set<(event: ArtifactDocumentEvent) => void> = new Set();
  private workspaceId: string;

  constructor(workspaceId: string, initialArtifacts: UniversalArtifactDocument[] = []) {
    this.workspaceId = workspaceId;
    initialArtifacts.forEach((a) => this.artifacts.set(a.id, a));
  }

  getArtifact(id: string): UniversalArtifactDocument | null {
    return this.artifacts.get(id) || null;
  }

  listArtifacts(): UniversalArtifactDocument[] {
    return Array.from(this.artifacts.values());
  }

  getTierContent(id: string, tier: ResolutionTier): string {
    const art = this.artifacts.get(id);
    if (!art) return '';
    switch (tier) {
      case 3:
        return art.current.t3_body || art.current.t2_summary || art.current.t1_abstract;
      case 2:
        return art.current.t2_summary || art.current.t1_abstract;
      case 1:
        return art.current.t1_abstract || art.current.t0_label;
      case 0:
        return art.current.t0_label;
      default:
        return '';
    }
  }

  upsertArtifact(
    doc: Partial<UniversalArtifactDocument> & { id: string; title: string }
  ): UniversalArtifactDocument {
    const existing = this.artifacts.get(doc.id);
    const now = Date.now();

    const t0 = doc.current?.t0_label || doc.title;
    const t1 = doc.current?.t1_abstract || doc.title;
    const t2 = doc.current?.t2_summary || t1;
    const t3 = doc.current?.t3_body || `# ${doc.title}\n\n${t1}`;

    const merged: UniversalArtifactDocument = {
      id: doc.id,
      workspaceId: doc.workspaceId || this.workspaceId,
      code: doc.code || doc.title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      title: doc.title,
      type: doc.type || 'document',
      category: doc.category || 'system-spec',
      isHighConcept: Boolean(doc.isHighConcept),
      color: doc.color || existing?.color || '#5d87b8',
      current: {
        t0_label: t0,
        t1_abstract: t1,
        t2_summary: t2,
        t3_body: t3,
      },
      tags: doc.tags || existing?.tags || ['synthesized'],
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };

    this.artifacts.set(doc.id, merged);
    this.emit({
      type: existing ? 'artifactUpdated' : 'artifactCreated',
      artifact: merged,
    });
    return merged;
  }

  updateTiers(id: string, tiers: Partial<UniversalArtifactDocument['current']>): void {
    const art = this.artifacts.get(id);
    if (!art) return;
    art.current = { ...art.current, ...tiers };
    art.updatedAt = Date.now();
    this.emit({ type: 'artifactUpdated', artifact: art });
  }

  deleteArtifact(id: string): void {
    if (this.artifacts.delete(id)) {
      this.emit({ type: 'artifactDeleted', artifactId: id });
    }
  }

  loadArtifacts(docs: UniversalArtifactDocument[]): void {
    docs.forEach((d) => this.artifacts.set(d.id, d));
  }

  subscribe(callback: (event: ArtifactDocumentEvent) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  private emit(event: ArtifactDocumentEvent) {
    this.listeners.forEach((l) => l(event));
  }
}
