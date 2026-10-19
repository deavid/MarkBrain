import { IArtifactDocumentDomain } from './interface';
import { UniversalArtifactDocument, ArtifactLayers, ArtifactDocumentEvent } from './types';
import { Granularity, cutIncludes } from '../granularity';

/**
 * THE artifact cut — one implementation, shared by the compiler, the token
 * estimator and every preview. Missing layers are simply absent (never
 * synthesized here; writers are responsible for filling them).
 */
export function getArtifactCut(
  art: Pick<UniversalArtifactDocument, 'title' | 'current'>,
  granularity: Granularity
): { title: string; description?: string; summary?: string; body?: string } {
  const cut: { title: string; description?: string; summary?: string; body?: string } = {
    title: art.title || '',
  };
  if (cutIncludes(granularity, 'description')) {
    const description = art.current?.description || '';
    if (description) cut.description = description;
  }
  if (cutIncludes(granularity, 'summary')) {
    const summary = art.current?.summary || '';
    if (summary) cut.summary = summary;
  }
  if (cutIncludes(granularity, 'body')) {
    const body = art.current?.body || '';
    if (body) cut.body = body;
  }
  return cut;
}

/** The cut as one plain-text block (previews, copy, token math). */
export function artifactCutText(
  art: Pick<UniversalArtifactDocument, 'title' | 'current'>,
  granularity: Granularity
): string {
  const cut = getArtifactCut(art, granularity);
  return [cut.title, cut.description, cut.summary, cut.body]
    .filter((part): part is string => Boolean(part))
    .join('\n\n');
}

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

  getContentAtGranularity(id: string, granularity: Granularity): string {
    const art = this.artifacts.get(id);
    return art ? artifactCutText(art, granularity) : '';
  }

  upsertArtifact(
    doc: Partial<UniversalArtifactDocument> & { id: string; title: string }
  ): UniversalArtifactDocument {
    const existing = this.artifacts.get(doc.id);
    const now = Date.now();

    const description = doc.current?.description ?? existing?.current?.description ?? '';
    const summary = doc.current?.summary ?? existing?.current?.summary ?? '';
    const body = doc.current?.body ?? existing?.current?.body ?? '';

    const merged: UniversalArtifactDocument = {
      id: doc.id,
      workspaceId: doc.workspaceId || this.workspaceId,
      code: doc.code || doc.title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      title: doc.title,
      type: doc.type || 'document',
      category: doc.category || 'note',
      isHighConcept: Boolean(doc.isHighConcept),
      color: doc.color || existing?.color || '#5d87b8',
      current: { description, summary, body },
      tags: doc.tags || existing?.tags || ['note'],
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      // Preserve optional fields: prefer the update, else the existing value —
      // but OMIT the key entirely when neither exists. Materializing
      // `graph: undefined` poisons Firestore saves (the SDK rejects undefined
      // field values), which made every snapshot fail after a fresh import.
      ...(doc.graph !== undefined
        ? { graph: doc.graph }
        : existing?.graph !== undefined
          ? { graph: existing.graph }
          : {}),
      ...(doc.yamlDocument !== undefined
        ? { yamlDocument: doc.yamlDocument }
        : existing?.yamlDocument !== undefined
          ? { yamlDocument: existing.yamlDocument }
          : {}),
    };

    this.artifacts.set(doc.id, merged);
    this.emit({
      type: existing ? 'artifactUpdated' : 'artifactCreated',
      artifact: merged,
    });
    return merged;
  }

  updateLayers(id: string, layers: Partial<ArtifactLayers>): void {
    const art = this.artifacts.get(id);
    if (!art) return;
    art.current = { ...art.current, ...layers };
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
    this.emit({ type: 'artifactsLoaded', artifacts: Array.from(this.artifacts.values()) });
  }

  subscribe(callback: (event: ArtifactDocumentEvent) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  private emit(event: ArtifactDocumentEvent) {
    this.listeners.forEach((l) => l(event));
  }
}
