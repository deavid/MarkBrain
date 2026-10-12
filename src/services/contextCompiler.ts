// ============================================================================
// THE OPTICAL CONTEXT COMPILER (CONTEXT_COMPILER.md)
// Deterministic client-side depth-of-field assembly for LLM working memory.
// ============================================================================

import {
  WorkspaceState,
  Artifact,
  ChapterArtifact,
  ResolutionTier,
  ContextTelemetry,
  OpticalMode,
  Project,
  Turn,
  ArtifactRelation,
} from '../types';

export interface CompiledContextResult {
  compiledPrompt: string;
  systemInstruction: string;
  telemetry: ContextTelemetry;
  nodeTiers: Record<string, { tier: ResolutionTier | 'culled'; distance: number }>;
}

/**
 * Bridges a Project state into the Universal WorkspaceState representation
 * seamlessly linking Graph edges to Artifact relations.
 */
export function projectToWorkspaceState(
  project: Project,
  opticalMode: OpticalMode = 'autofocus',
  focalIds: string[] = []
): WorkspaceState {
  const artifactsRecord: Record<string, Artifact | ChapterArtifact> = {};
  const tierOverrides: Record<string, ResolutionTier> = {};

  // Build node -> artifact mapping
  const nodeToArtId = new Map<string, string>();
  for (const node of project.nodes || []) {
    if (node.artifactId) {
      nodeToArtId.set(node.id, node.artifactId);
    }
  }

  // Build artifact -> relations from edges
  const artRelations = new Map<string, Array<{ target_artifact_id: string; kind: any }>>();
  for (const edge of project.edges || []) {
    const sId = edge.sourceNodeId || edge.source;
    const tId = edge.targetNodeId || edge.target;
    if (sId && tId) {
      const srcArtId = nodeToArtId.get(sId) || sId;
      const tgtArtId = nodeToArtId.get(tId) || tId;
      if (!artRelations.has(srcArtId)) artRelations.set(srcArtId, []);
      artRelations.get(srcArtId)!.push({
        target_artifact_id: tgtArtId,
        kind: 'relates_to',
      });
      // Also register reciprocal link so BFS can traverse both ways
      if (!artRelations.has(tgtArtId)) artRelations.set(tgtArtId, []);
      artRelations.get(tgtArtId)!.push({
        target_artifact_id: srcArtId,
        kind: 'relates_to',
      });
    }
  }

  // 1. Process document artifacts
  for (const art of project.artifacts || []) {
    const title = art.title || art.id;
    const desc = art.description || art.abstract || 'Architectural concept.';
    const summ = art.summary || desc;
    const body = art.content || `# ${title}\n\n${desc}`;

    const existingRels = art.relations || [];
    const fromEdges = artRelations.get(art.id) || [];
    const combinedRels = [...existingRels];
    for (const rel of fromEdges) {
      if (!combinedRels.some((r) => r.target_artifact_id === rel.target_artifact_id)) {
        combinedRels.push(rel);
      }
    }

    const doc: Artifact = {
      ...art,
      id: art.id,
      workspace_id: project.id,
      type: 'document',
      created_at: art.createdAt ? new Date(art.createdAt).getTime() : Date.now(),
      updated_at: art.updatedAt ? new Date(art.updatedAt).getTime() : Date.now(),
      current: art.current || {
        t0_label: title,
        t1_abstract: desc,
        t2_summary: summ,
        t3_body: body,
      },
      revisions: art.revisions || [],
      relations: combinedRels,
      provenance: art.provenance || {
        origin_chapter_id: project.currentChapterId || 'chap-init',
        mutation_chapter_ids: [],
      },
    };

    // If manual resolution was set on artifact (from slider / override):
    if (art.resolution) {
      if (art.resolution === 'full') tierOverrides[art.id] = 3;
      else if (art.resolution === 'summary') tierOverrides[art.id] = 2;
      else if (art.resolution === 'description') tierOverrides[art.id] = 1;
      else if (art.resolution === 'title') tierOverrides[art.id] = 0;
    }

    artifactsRecord[art.id] = doc;
  }

  // 2. Process chapter artifacts
  for (const chap of project.chapters || []) {
    const turns: Turn[] = (chap.messages || []).map((m) => ({
      id: m.id,
      role: m.role as 'user' | 'assistant',
      timestamp: new Date(m.timestamp).getTime() || Date.now(),
      content: m.content,
    }));

    const chapDoc: ChapterArtifact = {
      id: chap.id,
      workspace_id: project.id,
      type: 'chapter',
      status: chap.status === 'completed' ? 'closed' : 'active',
      created_at: chap.createdAt ? new Date(chap.createdAt).getTime() : Date.now(),
      updated_at: Date.now(),
      turns,
      current: {
        t0_label: chap.title,
        t1_abstract: chap.summary || `Discussion regarding ${chap.title}`,
        t2_summary:
          chap.summary ||
          (chap.keyPoints && chap.keyPoints.length > 0
            ? chap.keyPoints.map((k) => `- ${k}`).join('\n')
            : 'Key conversational invariants.'),
        t3_body: turns.map((t) => `**${t.role.toUpperCase()}**: ${t.content}`).join('\n\n'),
      },
      revisions: [],
      relations: [],
      provenance: {
        origin_chapter_id: chap.id,
        mutation_chapter_ids: [],
      },
    };

    if (chap.compressionMode === 'summary') {
      tierOverrides[chap.id] = 2;
    }

    artifactsRecord[chap.id] = chapDoc;
  }

  const activeChapId =
    project.currentChapterId ||
    project.chapters[project.chapters.length - 1]?.id ||
    'chap-default';

  return {
    workspace_id: project.id,
    name: project.name,
    description: project.description,
    color: project.color,
    created_at: Date.now(),
    updated_at: Date.now(),
    active_chapter_id: activeChapId,
    focal_artifact_ids: focalIds.length > 0 ? focalIds : [activeChapId],
    optical_mode: opticalMode,
    artifacts: artifactsRecord,
    tier_overrides: tierOverrides,
  };
}

// Token approximation: ~4 characters per token
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.trim().length / 4);
}

/**
 * Traverses the workspace graph using BFS to compute the shortest topological hop distance
 * from any of the focal targets to every node in the workspace.
 */
export function computeGraphDistances(
  workspace: WorkspaceState,
  focalIds: string[]
): Record<string, number> {
  const distances: Record<string, number> = {};
  const allArtifacts = Object.values(workspace.artifacts);

  // Initialize all to unreachable (infinity)
  for (const art of allArtifacts) {
    distances[art.id] = Infinity;
  }

  if (focalIds.length === 0) {
    if (workspace.active_chapter_id && workspace.artifacts[workspace.active_chapter_id]) {
      focalIds = [workspace.active_chapter_id];
    } else if (allArtifacts.length > 0) {
      focalIds = [allArtifacts[0].id];
    }
  }

  const queue: Array<{ id: string; dist: number }> = [];
  const visited = new Set<string>();

  for (const fid of focalIds) {
    if (workspace.artifacts[fid]) {
      distances[fid] = 0;
      queue.push({ id: fid, dist: 0 });
      visited.add(fid);
    }
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentArt = workspace.artifacts[current.id];
    if (!currentArt) continue;

    // Outgoing relations
    const neighbors = new Set<string>();
    if (currentArt.relations) {
      for (const rel of currentArt.relations) {
        if (workspace.artifacts[rel.target_artifact_id]) {
          neighbors.add(rel.target_artifact_id);
        }
      }
    }

    // Incoming relations
    for (const other of allArtifacts) {
      if (other.relations) {
        for (const rel of other.relations) {
          if (rel.target_artifact_id === current.id) {
            neighbors.add(other.id);
          }
        }
      }
    }

    for (const nId of neighbors) {
      const nextDist = current.dist + 1;
      if (nextDist < distances[nId]) {
        distances[nId] = nextDist;
      }
      if (!visited.has(nId)) {
        visited.add(nId);
        queue.push({ id: nId, dist: nextDist });
      }
    }
  }

  return distances;
}

/**
 * Checks if candidate is an ancestor (`parent_of` path leading up to root concepts)
 * of any of the focal nodes.
 */
function isAncestorOfFocal(
  candidateId: string,
  focalIds: string[],
  workspace: WorkspaceState
): boolean {
  for (const fId of focalIds) {
    let curr: Artifact | ChapterArtifact | undefined = workspace.artifacts[fId];
    const visited = new Set<string>();
    while (curr && !visited.has(curr.id)) {
      visited.add(curr.id);
      const parentRel: ArtifactRelation | undefined = curr.relations?.find((r) => r.kind === 'child_of');
      if (parentRel) {
        if (parentRel.target_artifact_id === candidateId) return true;
        curr = workspace.artifacts[parentRel.target_artifact_id];
      } else {
        // Also check if any node has parent_of pointing to curr
        const parentNode = Object.values(workspace.artifacts).find((a) =>
          a.relations?.some((r) => r.kind === 'parent_of' && r.target_artifact_id === curr?.id)
        );
        if (parentNode) {
          if (parentNode.id === candidateId) return true;
          curr = parentNode;
        } else {
          break;
        }
      }
    }
  }
  return false;
}

/**
 * Main Optical Context Compiler
 * Runs deterministically before every API call.
 */
export function compileOpticalContext(
  workspace: WorkspaceState,
  budgetCeiling: number = 32000
): CompiledContextResult {
  const mode = workspace.optical_mode || 'autofocus';

  // 1. Identify Focal Target(s)
  let focalIds: string[] = [];
  if (mode === 'autofocus') {
    focalIds = [workspace.active_chapter_id];
  } else if (mode === 'manual') {
    focalIds =
      workspace.focal_artifact_ids.length > 0
        ? workspace.focal_artifact_ids
        : [workspace.active_chapter_id];
  } else if (mode === 'myopia') {
    // In myopia mode, we intentionally defocus: active chapter remains the anchor,
    // but the depth of field aggressively compresses everything to Tier 1 / Tier 0.
    focalIds = [workspace.active_chapter_id];
  }

  // 2. Compute Topological Distances
  const distances = computeGraphDistances(workspace, focalIds);

  // 3. Assign Raw Optical Tiers
  const nodeTiers: Record<string, { tier: ResolutionTier | 'culled'; distance: number }> = {};
  const allArtifacts = Object.values(workspace.artifacts);

  // Find previous chapter for recency bias
  const chapterList = allArtifacts
    .filter((a): a is ChapterArtifact => a.type === 'chapter')
    .sort((a, b) => a.created_at - b.created_at);
  const activeChapterIndex = chapterList.findIndex((c) => c.id === workspace.active_chapter_id);
  const previousChapter = activeChapterIndex > 0 ? chapterList[activeChapterIndex - 1] : null;

  for (const art of allArtifacts) {
    const dist = distances[art.id] ?? Infinity;

    // Check manual override
    if (workspace.tier_overrides && workspace.tier_overrides[art.id] !== undefined) {
      nodeTiers[art.id] = { tier: workspace.tier_overrides[art.id], distance: dist };
      continue;
    }

    if (mode === 'myopia') {
      // Myopia mode: globally clamps background nodes to max Tier 1 or Tier 0,
      // and dialogue history to Tier 2 (Summary)
      if (focalIds.includes(art.id)) {
        nodeTiers[art.id] = { tier: 2, distance: 0 };
      } else if (dist <= 2) {
        nodeTiers[art.id] = { tier: 1, distance: dist };
      } else if (dist === 3) {
        nodeTiers[art.id] = { tier: 0, distance: dist };
      } else {
        nodeTiers[art.id] = { tier: 'culled', distance: dist };
      }
      continue;
    }

    // Standard Optics:
    if (focalIds.includes(art.id)) {
      nodeTiers[art.id] = { tier: 3, distance: 0 };
    } else if (dist === 1) {
      nodeTiers[art.id] = { tier: 2, distance: 1 };
    } else if (dist === 2) {
      nodeTiers[art.id] = { tier: 1, distance: 2 };
    } else if (dist === 3) {
      nodeTiers[art.id] = { tier: 0, distance: 3 };
    } else {
      nodeTiers[art.id] = { tier: 'culled', distance: dist };
    }

    // Ancestor Backbone Rule:
    if (isAncestorOfFocal(art.id, focalIds, workspace)) {
      const currentTier = nodeTiers[art.id].tier;
      if (currentTier === 'culled' || currentTier === 0) {
        nodeTiers[art.id] = { tier: 1, distance: dist };
      }
    }

    // Temporal Recency Bias:
    if (previousChapter && art.id === previousChapter.id) {
      const currentTier = nodeTiers[art.id].tier;
      if (currentTier === 'culled' || currentTier < 2) {
        nodeTiers[art.id] = { tier: 2, distance: dist };
      }
    }
  }

  // Helper to get formatted XML block for an artifact at a given tier
  function formatArtifactXml(
    art: Artifact | ChapterArtifact,
    tier: ResolutionTier,
    dist: number,
    isFocal: boolean
  ): string {
    const isChap = art.type === 'chapter';
    const tag = isChap ? 'chapter' : 'artifact';
    const cur = art.current || {
      t0_label: art.title || art.id,
      t1_abstract: art.description || '',
      t2_summary: art.summary || '',
      t3_body: art.content || '',
    };

    if (tier === 3) {
      if (isChap) {
        const chap = art as ChapterArtifact;
        const turnsXml = (chap.turns || [])
          .map((t) => `      <turn role="${t.role}">\n${t.content}\n      </turn>`)
          .join('\n');
        return `  <chapter id="${chap.id}" tier="3" status="${chap.status}" ${isFocal ? 'focus="true"' : ''}>
    <title>${cur.t0_label}</title>
    <turns>
${turnsXml}
    </turns>
  </chapter>`;
      } else {
        return `  <artifact id="${art.id}" type="document" tier="3" ${isFocal ? 'focus="true"' : ''}>
    <title>${cur.t0_label}</title>
    <content>
${cur.t3_body || cur.t2_summary}
    </content>
  </artifact>`;
      }
    }

    if (tier === 2) {
      return `  <${tag} id="${art.id}" type="${art.type}" tier="2" distance="${dist}">
    <title>${cur.t0_label}</title>
    <summary>
${cur.t2_summary || cur.t1_abstract}
    </summary>
  </${tag}>`;
    }

    if (tier === 1) {
      return `  <${tag} id="${art.id}" type="${art.type}" tier="1" distance="${dist}">
    <title>${cur.t0_label}</title>
    <abstract>${cur.t1_abstract || cur.t0_label}</abstract>
  </${tag}>`;
    }

    // Tier 0
    const tagsAttr = art.tags && art.tags.length > 0 ? ` tags="${art.tags.join(', ')}"` : '';
    return `  <${tag} id="${art.id}" type="${art.type}" tier="0" distance="${dist}" title="${cur.t0_label}"${tagsAttr} />`;
  }

  // 4. Assemble and Calculate Token Footprint
  const systemInstruction = `You are the Optical Sparring Partner and Systems Architect.
Ground your thinking directly in the provided Knowledge Graph context.
Maintain clean separation between high-level architectural constraints and implementation detail.
The context provided to you has been compiled according to an Optical Depth-of-Field model:
- Tier 3: Sharp focus (verbatim text).
- Tier 2: Mid sharpness (structured summaries and key invariants).
- Tier 1: Low sharpness (abstract / conceptual essence).
- Tier 0: Peripheral label / tag.

When you formulate or update architectural invariants, schemas, or topic migrations, emit standard structured XML tags:
- To declare a topic shift / new chapter boundary:
  <topic_shift title="New Chapter Title" abstract="1-sentence essence" summary="Key invariant bullets" />
- To create or revise a document artifact:
  <artifact_upsert id="unique_id" title="Artifact Title" type="document">
    <abstract>1-2 sentence essence</abstract>
    <summary>3-5 key bullet points</summary>
    <content>Full markdown body</content>
  </artifact_upsert>
- To establish a graph relationship:
  <link source="id1" target="id2" kind="relates_to|refines|parent_of|child_of|born_from" />`;

  // Separate Substrate (documents) and Conversation History (chapters)
  const substrateNodes = allArtifacts.filter((a) => a.type !== 'chapter');
  const historyNodes = allArtifacts.filter((a): a is ChapterArtifact => a.type === 'chapter');

  function renderPayload(): {
    substrateXml: string;
    historyXml: string;
    totalTokens: number;
    substrateTokens: number;
    historyTokens: number;
    systemTokens: number;
  } {
    const subXml = substrateNodes
      .filter((a) => nodeTiers[a.id]?.tier !== 'culled')
      .map((a) =>
        formatArtifactXml(
          a,
          nodeTiers[a.id].tier as ResolutionTier,
          nodeTiers[a.id].distance,
          focalIds.includes(a.id)
        )
      )
      .join('\n\n');

    const histXml = historyNodes
      .filter((a) => nodeTiers[a.id]?.tier !== 'culled')
      .sort((a, b) => a.created_at - b.created_at)
      .map((a) =>
        formatArtifactXml(
          a,
          nodeTiers[a.id].tier as ResolutionTier,
          nodeTiers[a.id].distance,
          focalIds.includes(a.id)
        )
      )
      .join('\n\n');

    const systemTokens = estimateTokens(systemInstruction);
    const substrateTokens = estimateTokens(subXml);
    const historyTokens = estimateTokens(histXml);
    const totalTokens = systemTokens + substrateTokens + historyTokens;

    return {
      substrateXml: subXml,
      historyXml: histXml,
      totalTokens,
      substrateTokens,
      historyTokens,
      systemTokens,
    };
  }

  let rendered = renderPayload();

  // Dynamic Blurring if projected tokens exceed budget
  if (rendered.totalTokens > budgetCeiling) {
    // Step A: Cull Tier 0 nodes with distance >= 3
    for (const art of allArtifacts) {
      if (nodeTiers[art.id]?.tier === 0 && nodeTiers[art.id]?.distance >= 3) {
        nodeTiers[art.id].tier = 'culled';
      }
    }
    rendered = renderPayload();

    // Step B: Degrade Tier 1 to Tier 0 if still over budget
    if (rendered.totalTokens > budgetCeiling) {
      for (const art of allArtifacts) {
        if (nodeTiers[art.id]?.tier === 1 && !focalIds.includes(art.id)) {
          nodeTiers[art.id].tier = 0;
        }
      }
      rendered = renderPayload();
    }

    // Step C: Degrade Tier 2 to Tier 1 if still over budget
    if (rendered.totalTokens > budgetCeiling) {
      for (const art of allArtifacts) {
        if (nodeTiers[art.id]?.tier === 2 && !focalIds.includes(art.id)) {
          nodeTiers[art.id].tier = 1;
        }
      }
      rendered = renderPayload();
    }
  }

  // Assembled final prompt payload according to CONTEXT_COMPILER.md
  const compiledPrompt = `<knowledge_graph_substrate>
${rendered.substrateXml || '  <!-- No background artifacts in frame -->'}
</knowledge_graph_substrate>

<conversation_history>
${rendered.historyXml || '  <!-- Conversation starting -->'}
</conversation_history>`;

  // Calculate Node Tier Distribution for telemetry HUD
  let tier_3_count = 0;
  let tier_2_count = 0;
  let tier_1_count = 0;
  let tier_0_count = 0;
  let culled_count = 0;

  for (const info of Object.values(nodeTiers)) {
    if (info.tier === 3) tier_3_count++;
    else if (info.tier === 2) tier_2_count++;
    else if (info.tier === 1) tier_1_count++;
    else if (info.tier === 0) tier_0_count++;
    else if (info.tier === 'culled') culled_count++;
  }

  const telemetry: ContextTelemetry = {
    focal_artifact_ids: focalIds,
    optical_mode: mode,
    token_breakdown: {
      system_tokens: rendered.systemTokens,
      substrate_tokens: rendered.substrateTokens,
      history_tokens: rendered.historyTokens,
      total_tokens: rendered.totalTokens,
      budget_ceiling: budgetCeiling,
    },
    node_distribution: {
      tier_3_count,
      tier_2_count,
      tier_1_count,
      tier_0_count,
      culled_count,
    },
  };

  return {
    compiledPrompt,
    systemInstruction,
    telemetry,
    nodeTiers,
  };
}
