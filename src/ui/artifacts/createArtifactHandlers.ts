import type { DomainContextValue } from '../../domains/DomainRegistry';
import type { Artifact, ResolutionTier, AbstractionLevel } from '../../types';
import { serializeArtifactToYamlDoc } from '../../utils/yamlArtifactParser';
import { detectImportFlag, flagRelationship, ImportFlag } from '../../utils/importDetect';
import { logger } from '../../utils/logger';

type WorkspaceContainer = NonNullable<ReturnType<DomainContextValue['workspace']['getProject']>>;

export interface ArtifactHandlerParams {
  artifactsDomain: DomainContextValue['artifacts'];
  versioning: DomainContextValue['versioning'];
  workspace: DomainContextValue['workspace'];
  activeProjectId: string;
  currentContainer: WorkspaceContainer | null | undefined;
  triggerReRender: () => void;
  selectedArtifactId: string | null;
  setSelectedArtifactId: (id: string | null) => void;
  triageFocusId: string | null;
  setTriageFocusId: (id: string | null) => void;
}

// Artifact CRUD, pin/tier overrides, import landing, and Phase-3 triage.
// Moved verbatim from App.tsx — same handler names/signatures the children bind.
export function createArtifactHandlers(params: ArtifactHandlerParams) {
  const {
    artifactsDomain,
    versioning,
    workspace,
    activeProjectId,
    currentContainer,
    triggerReRender,
    selectedArtifactId,
    setSelectedArtifactId,
    triageFocusId,
    setTriageFocusId,
  } = params;

  // Pinned Focal Artifacts & Tier Overrides
  const focalArtifactIds = currentContainer?.focalArtifactIds || [];
  const manualTierOverrides = currentContainer?.tierOverrides || {};

  const handleToggleFocusArtifact = (artId: string) => {
    if (!currentContainer) return;
    const prev = currentContainer.focalArtifactIds || [];
    const next = prev.includes(artId) ? prev.filter((id: string) => id !== artId) : [...prev, artId];
    workspace.saveContainer({
      ...currentContainer,
      focalArtifactIds: next,
    });
    triggerReRender();
  };

  const handleChangeTierOverride = (artId: string, tier: ResolutionTier | null) => {
    if (!currentContainer) return;
    const nextOverrides = { ...currentContainer.tierOverrides };
    if (tier === null) {
      delete nextOverrides[artId];
    } else {
      nextOverrides[artId] = tier;
    }
    workspace.saveContainer({
      ...currentContainer,
      tierOverrides: nextOverrides,
    });
    triggerReRender();
  };

  // Update Artifact Resolution
  const handleUpdateArtifactResolution = (
    artifactId: string,
    resolution: AbstractionLevel
  ) => {
    const art = artifactsDomain.getArtifact(artifactId);
    if (art) {
      artifactsDomain.upsertArtifact({
        ...art,
        id: art.id,
        title: art.title,
        resolution,
      });
    }
  };

  const handleUpdateAllArtifactsResolution = (resolution: AbstractionLevel) => {
    const all = artifactsDomain.listArtifacts();
    all.forEach((art) => {
      artifactsDomain.upsertArtifact({
        ...art,
        id: art.id,
        title: art.title,
        resolution,
      });
    });
  };

  // Update Artifact Content (auto-records version history in domain)
  const handleUpdateArtifactContent = (artifactId: string, newContent: string) => {
    const art = artifactsDomain.getArtifact(artifactId);
    if (art) {
      versioning.recordRevision(art.id, newContent, 'Direct manual specification edit');
      artifactsDomain.updateTiers(art.id, { t3_body: newContent });
    }
  };

  // Add New Artifact
  const handleAddArtifact = (newArt: Artifact) => {
    // Idempotent by title (review P1 #7): extracted notes are already
    // auto-upserted via onArtifact with a different id — "Save as Artifact"
    // must update that record, not create a second copy.
    const title = (newArt.title || newArt.current?.t0_label || '').trim();
    const existing = !title
      ? undefined
      : artifactsDomain
        .listArtifacts()
        .find(
          (a) =>
            (a.title || a.current?.t0_label || '').trim() === title
        );
    artifactsDomain.upsertArtifact({
      id: existing?.id ?? newArt.id,
      title: newArt.title || newArt.current?.t0_label || 'Untitled',
      workspaceId: activeProjectId,
      code: newArt.code || newArt.id,
      type: newArt.type === 'chapter' ? 'chapter' : 'document',
      category: newArt.category || 'note',
      isHighConcept: Boolean(newArt.isHighConcept),
      color: newArt.color,
      current: newArt.current || {
        t0_label: newArt.title || 'Untitled',
        t1_abstract: '',
        t2_summary: '',
        t3_body: '',
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
      resolution: newArt.resolution,
    });
    setSelectedArtifactId(existing?.id ?? newArt.id);
  };

  // Import-session land (multi-import plan): ALWAYS a separate artifact.
  // Unlike handleAddArtifact (title-idempotent for the chat flow), a colliding
  // frontmatter `id` must never silently overwrite an existing record — mint a
  // fresh id instead. Phase 2: when the body/code/title matches something
  // already imported, auto-attach a revision-of/duplicate-of relationship (the
  // flag) — never merge or block here; triage is post-import. Returns the final
  // id + flag so the session row can reference and display them.
  const handleImportArtifact = (newArt: Artifact): { id: string; flag: ImportFlag | null } => {
    let id = newArt.id;
    if (artifactsDomain.getArtifact(id)) {
      id = `art-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    }
    const flag = detectImportFlag(
      {
        title: newArt.title || newArt.current?.t0_label || '',
        code: newArt.code,
        body: newArt.current?.t3_body || '',
      },
      artifactsDomain.listArtifacts().map((a) => ({
        id: a.id,
        title: a.title || a.current?.t0_label || '',
        code: a.code,
        body: a.current?.t3_body || '',
      }))
    );
    artifactsDomain.upsertArtifact({
      id,
      title: newArt.title || newArt.current?.t0_label || 'Untitled',
      workspaceId: activeProjectId,
      code: newArt.code || id,
      type: newArt.type === 'chapter' ? 'chapter' : 'document',
      category: newArt.category || 'note',
      isHighConcept: Boolean(newArt.isHighConcept),
      color: newArt.color,
      current: newArt.current || {
        t0_label: newArt.title || 'Untitled',
        t1_abstract: '',
        t2_summary: '',
        t3_body: '',
      },
      tags: newArt.tags || [],
      createdAt: newArt.createdAt ?? Date.now(),
      updatedAt: newArt.updatedAt ?? Date.now(),
      // Number-only coordinates — `{x: undefined}` poisons Firestore saves
      // (same guard as handleAddArtifact; see utils/storageSanitize.ts).
      // Relationships: carry incoming edges + append the Phase-2 flag edge.
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
      resolution: newArt.resolution,
    });
    return { id, flag };
  };


  // ---- Phase 3: post-import triage (work AFTER the fact, never during) ----
  // Graph-only upsert that preserves everything else (incl. regenerating the
  // cached yamlDocument snapshot when the artifact had one).
  const upsertGraphOf = (art: Artifact, graph: NonNullable<Artifact['graph']>) => {
    const next: Artifact = { ...art, graph };
    artifactsDomain.upsertArtifact({
      ...next,
      ...(art.yamlDocument !== undefined ? { yamlDocument: serializeArtifactToYamlDoc(next) } : {}),
    });
  };

  // Dangling-edge + focus scrub for any artifact id leaving the workspace.
  const scrubReferencesTo = (deletedId: string) => {
    artifactsDomain.listArtifacts().forEach((a) => {
      const rels = a.graph?.relationships;
      if (!rels || !rels.some((r) => r.target === deletedId)) return;
      upsertGraphOf(a, {
        ...(a.graph || {}),
        relationships: rels.filter((r) => r.target !== deletedId),
      });
    });
    // One saveContainer for BOTH focal + tier scrub — two sync calls would
    // race on the same stale currentContainer snapshot.
    if (
      currentContainer &&
      ((currentContainer.focalArtifactIds || []).includes(deletedId) ||
        (currentContainer.tierOverrides && deletedId in currentContainer.tierOverrides))
    ) {
      const nextContainer = { ...currentContainer };
      if ((nextContainer.focalArtifactIds || []).includes(deletedId)) {
        nextContainer.focalArtifactIds = (nextContainer.focalArtifactIds || []).filter(
          (i: string) => i !== deletedId
        );
      }
      if (nextContainer.tierOverrides && deletedId in nextContainer.tierOverrides) {
        const overrides = { ...nextContainer.tierOverrides };
        delete overrides[deletedId];
        nextContainer.tierOverrides = overrides;
      }
      workspace.saveContainer(nextContainer);
    }
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
    const oldBody = oldArt.current?.t3_body || '';
    const newBody = newArt.current?.t3_body || '';

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
      resolution: newArt.resolution || oldArt.resolution,
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

    // 4) Carrier removal + dangling-edge/focus scrub.
    artifactsDomain.deleteArtifact(newId);
    scrubReferencesTo(newId);
    logger.action(
      'App',
      `Triage: overwrote "${oldArt.title}" (${oldId}) with "${newArt.title}" (${newId}) — carrier removed, rollback available`
    );
  };

  const handleTriageDelete = (artifactId: string) => {
    const art = artifactsDomain.getArtifact(artifactId);
    artifactsDomain.deleteArtifact(artifactId);
    scrubReferencesTo(artifactId);
    logger.action('App', `Triage: deleted ${art?.title || artifactId}`);
  };

  return {
    handleToggleFocusArtifact,
    handleChangeTierOverride,
    handleUpdateArtifactResolution,
    handleUpdateAllArtifactsResolution,
    handleUpdateArtifactContent,
    handleAddArtifact,
    handleImportArtifact,
    handleTriageKeepBoth,
    handleTriageOverwrite,
    handleTriageDelete,
  };
}
