import { IArtifactDocumentDomain } from './interface';
import {
  UniversalArtifactDocument,
  ArtifactLayers,
  ArtifactDocumentEvent,
  ArtifactLifecycle,
} from './types';
import { Granularity, cutIncludes } from '../granularity';

/**
 * Stale-layer guard: after a manual body edit the description/summary layers no
 * longer match the body. Serving them would hand the model a confident lie, so
 * at `full` they are omitted (title + body only), and at the shorter cuts the
 * text carries an explicit out-of-date notice instead of pretending they're true.
 */
export const STALE_LAYERS_NOTICE = '[Layers out of date — read full note for current content]';

/** Cumulative plain-text cut (`title ⊂ description ⊂ summary ⊂ body`). Missing layers are omitted, never synthesized. */
export function getArtifactCut(
  art: Pick<UniversalArtifactDocument, 'title' | 'current' | 'layersStaleAt'>,
  granularity: Granularity
): { title: string; description?: string; summary?: string; body?: string; layersStale?: boolean } {
  const subtitle = (art.current?.subtitle || '').trim();
  const stale = typeof art.layersStaleAt === 'number';
  const cut: { title: string; description?: string; summary?: string; body?: string; layersStale?: boolean } = {
    // The title cut is title + subtitle: the hook is what makes a 4-word name
    // mean something to a reader (or a model) who has never opened the note.
    title: subtitle ? `${art.title || ''} — ${subtitle}` : art.title || '',
  };
  if (stale) cut.layersStale = true;
  if (cutIncludes(granularity, 'description')) {
    const description = art.current?.description || '';
    // Stale at `full`: the body is included, so the lying layers are dropped.
    if (description && !(stale && granularity === 'full')) cut.description = description;
  }
  if (cutIncludes(granularity, 'summary')) {
    const summary = art.current?.summary || '';
    if (summary && !(stale && granularity === 'full')) cut.summary = summary;
  }
  if (cutIncludes(granularity, 'body')) {
    const body = art.current?.body || '';
    if (body) cut.body = body;
  }
  return cut;
}

export function artifactCutText(
  art: Pick<UniversalArtifactDocument, 'title' | 'current' | 'layersStaleAt'>,
  granularity: Granularity
): string {
  const cut = getArtifactCut(art, granularity);
  const parts = [cut.title, cut.description, cut.summary, cut.body].filter(
    (part): part is string => Boolean(part)
  );
  const text = parts.join('\n\n');
  // Stale at the shorter cuts: the layers still travel (the model may want the
  // gist) but labelled honestly, so it knows to read the body for the truth.
  if (cut.layersStale && (granularity === 'description' || granularity === 'summary')) {
    return `${text}\n\n${STALE_LAYERS_NOTICE}`;
  }
  return text;
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

    const subtitle = doc.current?.subtitle ?? existing?.current?.subtitle ?? '';
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
      current: { subtitle, description, summary, body },
      tags: doc.tags || existing?.tags || ['note'],
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      // Same omit-when-absent rule as graph/yamlDocument: an upsert must never
      // wipe the parked flag (every content or graph edit re-enters here).
      ...(doc.lifecycle !== undefined
        ? { lifecycle: doc.lifecycle }
        : existing?.lifecycle !== undefined
          ? { lifecycle: existing.lifecycle }
          : {}),
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
      // Stale-layer flag: an upsert may set it, CLEAR it (AI rewrites every
      // layer — `{ layersStaleAt: undefined }` present-but-undefined clears),
      // or leave it alone (key absent → keep the existing value).
      ...(doc.layersStaleAt !== undefined
        ? { layersStaleAt: doc.layersStaleAt }
        : 'layersStaleAt' in doc
          ? {}
          : existing?.layersStaleAt !== undefined
            ? { layersStaleAt: existing.layersStaleAt }
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

  setArtifactLifecycle(id: string, lifecycle: ArtifactLifecycle): void {
    const art = this.artifacts.get(id);
    if (!art || (art.lifecycle ?? 'active') === lifecycle) return;
    const next: UniversalArtifactDocument = { ...art, lifecycle, updatedAt: Date.now() };
    this.artifacts.set(id, next);
    this.emit({ type: 'artifactUpdated', artifact: next });
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
