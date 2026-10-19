import { useMemo } from 'react';
import type { DomainContextValue } from '../../domains/DomainRegistry';
import type {
  Project,
  Artifact,
  GraphNode,
  GraphEdge,
  Chapter,
  ChatMessage,
  ModelOption,
} from '../../types';
import { logger } from '../../utils/logger';

type WorkspaceContainer = NonNullable<ReturnType<DomainContextValue['workspace']['getProject']>>;

export interface ProjectProjectionParams {
  workspace: DomainContextValue['workspace'];
  artifactsDomain: DomainContextValue['artifacts'];
  segmentation: DomainContextValue['segmentation'];
  timeline: DomainContextValue['timeline'];
  graph: DomainContextValue['graph'];
  activeProjectId: string;
  currentContainer: WorkspaceContainer | null | undefined;
  selectedModel: ModelOption;
  tick: number;
}

// Project list + active Project model snapshots for the child UI.
// Moved verbatim from App.tsx — same memo bodies, same dep arrays.
export function useProjectProjection(params: ProjectProjectionParams) {
  const {
    workspace,
    artifactsDomain,
    segmentation,
    timeline,
    graph,
    activeProjectId,
    currentContainer,
    selectedModel,
    tick,
  } = params;

  // Construct view projection of Projects list for UI components
  const domainProjectsList = useMemo(() => {
    return workspace.listProjects().map((meta) => {
      const container = workspace.getProject(meta.id);
      return {
        id: meta.id,
        name: meta.name,
        codeName: meta.codeName,
        description: meta.description,
        color: meta.color,
        icon: 'Layers',
        currentChapterId: container?.activeChapterId || '',
        chapters: [],
        artifacts: [],
        nodes: [],
        edges: [],
      } as Project;
    });
  }, [workspace, tick]);

  // Construct active Project model snapshot for child UI components
  const activeProject: Project = useMemo(() => {
    const meta = currentContainer?.metadata;
    const domainArtifacts = artifactsDomain.listArtifacts();
    const domainChapters = segmentation.listChapters();
    const domainEdges = graph.listEdges();

    const chapters: Chapter[] = domainChapters.map((c, cIdx) => {
      // Ensure active/ongoing or last chapter captures all latest appended turns
      const isLastChapter = cIdx === domainChapters.length - 1;
      const isOngoing = c.status === 'active' || isLastChapter;
      const sliceEnd = isOngoing ? undefined : c.endIndex;
      const turns = timeline.getTurnSlice(c.startIndex, sliceEnd);
      const messages: ChatMessage[] = turns.map((t) => ({
        id: t.id,
        chapterId: c.id,
        role: t.role,
        content: t.content,
        timestamp: new Date(t.timestamp).toISOString(),
        extractedArtifacts: t.extractedArtifacts,
        meta: t.meta
          ? {
              model: t.meta.model || selectedModel.name,
              inputTokens: t.meta.promptTokens ?? t.meta.inputTokens ?? 0,
              outputTokens: t.meta.candidatesTokens ?? t.meta.outputTokens ?? 0,
              totalTokens: t.meta.totalTokens ?? 0,
              latencyMs: t.meta.durationMs ?? t.meta.latencyMs,
              interrupted: Boolean(t.meta.interrupted || t.meta.streamState === 'interrupted'),
              isStreaming: t.meta.isStreaming,
              streamState: t.meta.streamState,
              ...(t.meta as any),
            }
          : undefined,
      }));

      return {
        id: c.id,
        projectId: activeProjectId,
        title: c.title,
        summary: c.summary,
        keyPoints: [],
        isSummarized: Boolean(c.summary),
        compressionMode: 'full',
        status: c.status,
        createdAt: new Date().toISOString(),
        messages,
      };
    });

    const artifacts: Artifact[] = domainArtifacts;

    const nodes: GraphNode[] = domainArtifacts.map((art, idx) => ({
      id: `node-${art.id}`,
      artifactId: art.id,
      projectId: activeProjectId,
      title: art.title || art.current?.t0_label || 'Untitled',
      type: art.type,
      isHighConcept: art.isHighConcept,
      x: art.graph?.x ?? 300 + (idx % 5) * 180,
      y: art.graph?.y ?? 200 + Math.floor(idx / 5) * 120,
      status: 'active',
      tags: art.tags,
    }));

    const edges: GraphEdge[] = domainEdges.map((e) => ({
      id: e.id,
      sourceProjectId: activeProjectId,
      targetProjectId: activeProjectId,
      sourceNodeId: `node-${e.sourceId}`,
      targetNodeId: `node-${e.targetId}`,
      label: e.kind,
      type: 'dependency',
      strength: e.weight ?? 0.8,
    }));

    // Ensure chat interface is never hidden due to empty chapters array
    let finalChapters: Chapter[] = chapters;
    if (finalChapters.length === 0) {
      logger.info('App', 'No chapters registered in domain; synthesizing Genesis chapter to guarantee chat interface visibility');
      const allTurns = timeline.getTurnSlice(0, undefined);
      finalChapters = [
        {
          id: 'chap-genesis',
          projectId: activeProjectId,
          title: 'Genesis Chapter',
          summary: '',
          keyPoints: [],
          isSummarized: false,
          compressionMode: 'full',
          status: 'active',
          createdAt: new Date().toISOString(),
          messages: allTurns.map((t) => ({
            id: t.id,
            chapterId: 'chap-genesis',
            role: t.role,
            content: t.content,
            timestamp: new Date(t.timestamp).toISOString(),
            extractedArtifacts: t.extractedArtifacts,
            meta: t.meta
              ? {
                  model: t.meta.model || selectedModel.name,
                  inputTokens: t.meta.promptTokens ?? t.meta.inputTokens ?? 0,
                  outputTokens: t.meta.candidatesTokens ?? t.meta.outputTokens ?? 0,
                  totalTokens: t.meta.totalTokens ?? 0,
                  latencyMs: t.meta.durationMs ?? t.meta.latencyMs,
                  interrupted: Boolean(t.meta.interrupted || t.meta.streamState === 'interrupted'),
                  isStreaming: t.meta.isStreaming,
                  streamState: t.meta.streamState,
                  ...(t.meta as any),
                }
              : undefined,
          })),
        },
      ];
    }

    const fallbackId = activeProjectId || currentContainer?.metadata?.id || 'default-workspace';
    return {
      id: fallbackId,
      name: meta?.name || 'Untitled Project',
      codeName: meta?.codeName || 'IDEAS',
      description: meta?.description || 'A space for thinking out loud.',
      color: meta?.color || '#3b82f6',
      icon: 'Layers',
      currentChapterId: currentContainer?.activeChapterId || finalChapters[0]?.id || 'chap-genesis',
      chapters: finalChapters,
      artifacts,
      nodes,
      edges,
      lastActivity: new Date().toISOString(),
    };
  }, [
    activeProjectId,
    currentContainer,
    artifactsDomain,
    segmentation,
    timeline,
    graph,
    tick,
  ]);

  return { domainProjectsList, activeProject };
}
