import type { DomainContextValue } from '../../domains/DomainRegistry';
import type { Artifact } from '../../types';
import type { Granularity } from '../../domains/granularity';
import { serializeArtifactToYamlDoc } from '../../utils/yamlArtifactParser';
import { detectImportFlag, flagRelationship, ImportFlag } from '../../utils/importDetect';
import { purgeArtifact } from './purgeArtifact';
import { queueServerMutation } from '../../application/serverMutationQueue';
import { logger } from '../../utils/logger';

type WorkspaceContainer = NonNullable<ReturnType<DomainContextValue['workspace']['getProject']>>;

export interface ArtifactHandlerParams {
  artifactsDomain: DomainContextValue['artifacts'];
  versioning: DomainContextValue['versioning'];
  graph: DomainContextValue['graph'];
  workspace: DomainContextValue['workspace'];
  threadRegistry: DomainContextValue['threadRegistry'];
  activeThreadId: string;
  activeProjectId: string;
  currentContainer: WorkspaceContainer | null | undefined;
  triggerReRender: () => void;
  selectedArtifactId: string | null;
  setSelectedArtifactId: (id: string | null) => void;
  triageFocusId: string | null;
  setTriageFocusId: (id: string | null) => void;
}

// Artifact CRUD, chat attachment handlers, import landing, and post-import triage.
export function createArtifactHandlers(params: ArtifactHandlerParams) {
  const {
    artifactsDomain,
    versioning,
    graph,
    workspace,
    threadRegistry,
    activeThreadId,
    activeProjectId,
    currentContainer,
    triggerReRender,
    selectedArtifactId,
    setSelectedArtifactId,
    triageFocusId,
    setTriageFocusId,
  } = params;

  /** The dot verb: not in chat → stage; staged → unstage; committed → cycle the cut.
   *  Staging is free and reversible; Send is what welds. */
  const handleToggleAttachment = (artifactId: string) => {
    const before = threadRegistry
      .getAttachments(activeThreadId)
      .find((a) => a.artifactId === artifactId);
    threadRegistry.toggleStageOrCycleAttachment(activeThreadId, artifactId);
    const after = threadRegistry
      .getAttachments(activeThreadId)
      .find((a) => a.artifactId === artifactId);
    logger.action(
      'App',
      `Attachment dot: ${artifactId} ${before ? before.granularity + (before.turnIndex === null ? ' (staged)' : '') : 'none'} → ${after ? after.granularity + (after.turnIndex === null ? ' (staged)' : '') : 'none'}`
    );
    triggerReRender();
  };

  /** Stage for the next message (from the detail modal / "Save as Artifact"). */
  const handleAttachArtifact = (artifactId: string) => {
    const added = threadRegistry.stageArtifact(activeThreadId, artifactId, 'full');
    if (!added) {
      logger.warn('App', `Stage: ${artifactId} not staged (unknown thread or artifact)`);
      return;
    }
    logger.action('App', `Staged artifact ${artifactId} for the next send in chat ${activeThreadId}`);
    triggerReRender();
  };

  const handleUnstageAttachment = (artifactId: string) => {
    const removed = threadRegistry.unstageArtifact(activeThreadId, artifactId);
    logger.action('App', `Unstage ${artifactId}: ${removed ? 'removed' : 'no-op (already sent)'}`);
    triggerReRender();
  };

  const handleSetAttachmentGranularity = (artifactId: string, granularity: Granularity) => {
    threadRegistry.setAttachmentGranularity(activeThreadId, artifactId, granularity);
    logger.action('App', `Attachment granularity: ${artifactId} → ${granularity}`);
    triggerReRender();
  };

  /**
   * Attach-on-save: an artifact the user saves from a turn belongs to the chat
   * it was born in, otherwise the model loses it the moment the turn stops
   * being verbatim. (Extraction already commits it to the assistant turn;
   * this is the idempotent belt-and-braces path.)
   */
  const attachArtifactToActiveChat = (artifactId: string) => {
    threadRegistry.stageArtifact(activeThreadId, artifactId, 'full');
    triggerReRender();
  };

  const handleUpdateArtifactContent = (artifactId: string, newContent: string) => {
    const art = artifactsDomain.getArtifact(artifactId);
    if (art) {
      versioning.recordRevision(art.id, newContent, 'Direct manual specification edit');
      artifactsDomain.updateLayers(art.id, { body: newContent });
    }
  };

  const handleAddArtifact = (newArt: Artifact) => {
    // Idempotent by title: extracted notes are already auto-upserted with a
    // different id — "Save as Artifact" must update that record, not duplicate it.
    const title = (newArt.title || '').trim();
    const existing = !title
      ? undefined
      : artifactsDomain.listArtifacts().find((a) => (a.title || '').trim() === title);
    artifactsDomain.upsertArtifact({
      id: existing?.id ?? newArt.id,
      title: newArt.title || 'Untitled',
      workspaceId: activeProjectId,
      code: newArt.code || newArt.id,
      type: newArt.type === 'chapter' ? 'chapter' : 'document',
      category: newArt.category || 'note',
      isHighConcept: Boolean(newArt.isHighConcept),
      color: newArt.color,
      current: newArt.current || {
        description: '',
        summary: '',
        body: '',
      },
      tags: newArt.tags || [],
      createdAt: existing?.createdAt ?? newArt.createdAt ?? Date.now(),
      updatedAt: newArt.updatedAt ?? Date.now(),
      // Only copy coordinates when they are real numbers: imported artifacts
      // carry graph metadata without x/y, and `{x: undefined}` poisons
      // Firestore saves (see utils/storageSanitize.ts for the boundary guard).
      graph: (() => {
        const g: { x?: number; y?: number; is_high_concept?: boolean } = {
          is_high_concept: Boolean(newArt.isHighConcept),
        };
        if (typeof newArt.graph?.x === 'number') g.x = newArt.graph.x;
        if (typeof newArt.graph?.y === 'number') g.y = newArt.graph.y;
        return g;
      })(),
    });
    setSelectedArtifactId(existing?.id ?? newArt.id);
  };

  // Import land is ALWAYS a separate artifact: unlike handleAddArtifact
  // (title-idempotent for the chat flow), a colliding frontmatter `id` must never
  // silently overwrite an existing record — mint a fresh id instead. A matching
  // body/code/title auto-attaches a revision-of/duplicate-of flag; triage happens
  // post-import. Returns the final id + flag for the session row.
  const handleImportArtifact = (newArt: Artifact): { id: string; flag: ImportFlag | null } => {
    let id = newArt.id;
    if (artifactsDomain.getArtifact(id)) {
      id = `art-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    }
    const flag = detectImportFlag(
      {
        title: newArt.title,
        code: newArt.code,
        body: newArt.current?.body || '',
      },
      artifactsDomain.listArtifacts().map((a) => ({
        id: a.id,
        title: a.title,
        code: a.code,
        body: a.current?.body || '',
      }))
    );
    artifactsDomain.upsertArtifact({
      id,
      title: newArt.title || 'Untitled',
      workspaceId: activeProjectId,
      code: newArt.code || id,
      type: newArt.type === 'chapter' ? 'chapter' : 'document',
      category: newArt.category || 'note',
      isHighConcept: Boolean(newArt.isHighConcept),
      color: newArt.color,
      current: newArt.current || {
        description: '',
        summary: '',
        body: '',
      },
      tags: newArt.tags || [],
      createdAt: newArt.createdAt ?? Date.now(),
      updatedAt: newArt.updatedAt ?? Date.now(),
      // Number-only coordinates — `{x: undefined}` poisons Firestore saves
      // (same guard as handleAddArtifact; see utils/storageSanitize.ts).
      // Relationships: carry incoming edges + append the flag edge.
      graph: (() => {
        const relationships = [...(newArt.graph?.relationships || [])];
        if (flag) relationships.push(flagRelationship(flag));
        const g: {
          x?: number;
          y?: number;
          is_high_concept?: boolean;
          relationships?: Array<{ target: string; type: string; note?: string }>;
        } = {
          is_high_concept: Boolean(newArt.isHighConcept),
        };
        if (typeof newArt.graph?.x === 'number') g.x = newArt.graph.x;
        if (typeof newArt.graph?.y === 'number') g.y = newArt.graph.y;
        if (relationships.length > 0) g.relationships = relationships;
        return g;
      })(),
    });
    return { id, flag };
  };

  // Graph-only upsert that preserves everything else (incl. regenerating the
  // cached yamlDocument snapshot when the artifact had one).
  const upsertGraphOf = (art: Artifact, graph: NonNullable<Artifact['graph']>) => {
    const next: Artifact = { ...art, graph };
    artifactsDomain.upsertArtifact({
      ...next,
      ...(art.yamlDocument !== undefined ? { yamlDocument: serializeArtifactToYamlDoc(next) } : {}),
    });
  };

  // Focus scrub on top of the shared cascade — every deletion path leaves the
  // workspace the same way (edges, attachments, history, the artifact itself).
  const scrubReferencesTo = (deletedId: string) => {
    purgeArtifact({ artifactsDomain, versioning, graph, threadRegistry }, deletedId);
    if (selectedArtifactId === deletedId) setSelectedArtifactId(null);
    if (triageFocusId === deletedId) setTriageFocusId(null);
  };

  const handleTriageKeepBoth = (newId: string, oldId: string) => {
    const art = artifactsDomain.getArtifact(newId);
    if (!art) return;
    const rels = (art.graph?.relationships || []).filter(
      (r) => !(r.target === oldId && (r.type === 'revision-of' || r.type === 'duplicate-of'))
    );
    upsertGraphOf(art, { ...(art.graph || {}), relationships: rels });
    logger.action('App', `Triage: keep both — dismissed import flag ${newId} → ${oldId}`);
  };

  const handleTriageOverwrite = (newId: string, oldId: string) => {
    const oldArt = artifactsDomain.getArtifact(oldId);
    const newArt = artifactsDomain.getArtifact(newId);
    if (!oldArt || !newArt || oldId === newId) return;
    const oldBody = oldArt.current?.body || '';
    const newBody = newArt.current?.body || '';

    // 1) Snapshot pre-overwrite state (rollback target; content == state at record time).
    versioning.recordRevision(oldId, oldBody, 'Pre-overwrite snapshot (import triage)');

    // 2) Adopt new content/meta onto the OLD id — old keeps identity + coordinates.
    const graph: NonNullable<Artifact['graph']> = {
      is_high_concept: Boolean(newArt.isHighConcept),
    };
    if (typeof oldArt.graph?.x === 'number') graph.x = oldArt.graph.x;
    if (typeof oldArt.graph?.y === 'number') graph.y = oldArt.graph.y;
    const parent = newArt.graph?.parent || oldArt.graph?.parent;
    if (parent) graph.parent = parent;
    const rels = [
      ...(oldArt.graph?.relationships || []).filter((r) => r.target !== newId),
      // Incoming (non-flag) edges travel with the content; flag edges never
      // transfer — a carrier→old edge would become old→old, carrier→third
      // would misattribute the flag to the old artifact.
      ...(newArt.graph?.relationships || []).filter(
        (r) => r.type !== 'revision-of' && r.type !== 'duplicate-of'
      ),
    ];
    if (rels.length > 0) graph.relationships = rels;

    const merged: Artifact = {
      ...oldArt,
      title: newArt.title,
      code: newArt.code || oldArt.code,
      type: newArt.type,
      category: newArt.category,
      isHighConcept: Boolean(newArt.isHighConcept),
      tags: newArt.tags,
      current: newArt.current,
      graph,
      updatedAt: Date.now(),
    };
    artifactsDomain.upsertArtifact({
      ...merged,
      yamlDocument: serializeArtifactToYamlDoc(merged),
    });

    // 3) Post state recorded so history's latest matches reality; rollback to
    //    the pre-overwrite entry restores the old body.
    versioning.recordRevision(oldId, newBody, `Overwritten by import triage from "${newArt.title}"`);

    artifactsDomain.deleteArtifact(newId);
    queueServerMutation(activeProjectId, { op: 'deleteArtifact', artifactId: newId });
    scrubReferencesTo(newId);
    logger.action(
      'App',
      `Triage: overwrote "${oldArt.title}" (${oldId}) with "${newArt.title}" (${newId}) — carrier removed, rollback available`
    );
  };

  const handleTriageDelete = (artifactId: string) => {
    const art = artifactsDomain.getArtifact(artifactId);
    queueServerMutation(activeProjectId, { op: 'deleteArtifact', artifactId });
    artifactsDomain.deleteArtifact(artifactId);
    scrubReferencesTo(artifactId);
    logger.action('App', `Triage: deleted ${art?.title || artifactId}`);
  };

  return {
    handleAttachArtifact,
    handleUnstageAttachment,
    handleToggleAttachment,
    handleSetAttachmentGranularity,
    attachArtifactToActiveChat,
    handleUpdateArtifactContent,
    handleAddArtifact,
    handleImportArtifact,
    handleTriageKeepBoth,
    handleTriageOverwrite,
    handleTriageDelete,
  };
}
