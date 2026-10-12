import React, { createContext, useContext, useMemo, useState, useEffect } from 'react';
import { WorkspaceDomain, IWorkspaceDomain } from './00-workspace';
import { DialogueTimelineDomain, IDialogueTimelineDomain } from './01-dialogue-timeline';
import { ArtifactDocumentDomain, IArtifactDocumentDomain } from './01-artifact-document';
import { ArtifactVersioningDomain, IArtifactVersioningDomain } from './01-artifact-versioning';
import { TopologicalGraphDomain, ITopologicalGraphDomain } from './02-topological-graph';
import { ChapterSegmentationDomain, IChapterSegmentationDomain } from './02-chapter-segmentation';
import { ProvenanceTrackingDomain, IProvenanceTrackingDomain } from './02-provenance-tracking';
import { RecursiveGroupingDomain, IRecursiveGroupingDomain } from './02-recursive-grouping';
import { StreamProtocolDomain, IStreamProtocolDomain } from './03-stream-protocol';
import { ChapterRecalibrationDomain, IChapterRecalibrationDomain } from './03-chapter-recalibration';
import { OpticalCompilerDomain, IOpticalCompilerDomain } from './03-optical-compiler';
import { INITIAL_PROJECTS } from '../data/initialData';

export interface DomainContextValue {
  workspace: IWorkspaceDomain;
  timeline: IDialogueTimelineDomain;
  artifacts: IArtifactDocumentDomain;
  versioning: IArtifactVersioningDomain;
  graph: ITopologicalGraphDomain;
  segmentation: IChapterSegmentationDomain;
  provenance: IProvenanceTrackingDomain;
  grouping: IRecursiveGroupingDomain;
  stream: IStreamProtocolDomain;
  recalibration: IChapterRecalibrationDomain;
  compiler: IOpticalCompilerDomain;
}

const DomainContext = createContext<DomainContextValue | null>(null);

export const DomainProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const workspace = useMemo(() => new WorkspaceDomain(), []);
  const activeProjectId = workspace.getActiveProjectId();

  // Find initial project seed data
  const seedProject = useMemo(() => {
    return INITIAL_PROJECTS.find((p) => p.id === activeProjectId) || INITIAL_PROJECTS[0];
  }, [activeProjectId]);

  // Seed turns from chapters
  const initialTurns = useMemo(() => {
    if (!seedProject) return [];
    const turns: any[] = [];
    seedProject.chapters.forEach((c) => {
      c.messages.forEach((m) => {
        turns.push({
          id: m.id,
          role: m.role,
          content: m.content,
          timestamp: new Date(m.timestamp).getTime(),
          extractedArtifacts: m.extractedArtifacts,
        });
      });
    });
    return turns;
  }, [seedProject]);

  // Seed chapters
  const initialChapters = useMemo(() => {
    if (!seedProject) return [];
    let turnCursor = 0;
    return seedProject.chapters.map((c) => {
      const startIndex = turnCursor;
      turnCursor += c.messages.length;
      return {
        id: c.id,
        workspaceId: activeProjectId,
        title: c.title,
        summary: c.summary,
        keyPoints: c.keyPoints,
        status: c.status,
        startIndex,
        endIndex: c.status === 'completed' ? turnCursor : undefined,
        createdAt: new Date(c.createdAt).getTime(),
      };
    });
  }, [seedProject, activeProjectId]);

  // Seed artifacts
  const initialArtifacts = useMemo(() => {
    if (!seedProject) return [];
    return seedProject.artifacts.map((a) => ({
      id: a.id,
      workspaceId: activeProjectId,
      code: a.code || a.id,
      title: a.title || 'Untitled',
      type: (a.type as any) || 'document',
      category: a.category || 'system-spec',
      isHighConcept: Boolean(a.isHighConcept),
      color: a.color,
      current: a.current || {
        t0_label: a.title || 'Untitled',
        t1_abstract: a.description || '',
        t2_summary: a.summary || '',
        t3_body: a.content || '',
      },
      tags: a.tags || [],
      createdAt: typeof a.createdAt === 'string' ? new Date(a.createdAt).getTime() : Date.now(),
      updatedAt: typeof a.updatedAt === 'string' ? new Date(a.updatedAt).getTime() : Date.now(),
    }));
  }, [seedProject, activeProjectId]);

  // Seed edges
  const initialEdges = useMemo(() => {
    if (!seedProject) return [];
    return seedProject.edges.map((e) => ({
      id: e.id,
      sourceId: e.sourceNodeId ? e.sourceNodeId.replace(/^node-/, '') : (e.source || ''),
      targetId: e.targetNodeId ? e.targetNodeId.replace(/^node-/, '') : (e.target || ''),
      kind: 'relates_to' as const,
      weight: e.strength || 1.0,
    }));
  }, [seedProject]);

  const timeline = useMemo(() => new DialogueTimelineDomain(activeProjectId, initialTurns), [activeProjectId, initialTurns]);
  const artifacts = useMemo(() => new ArtifactDocumentDomain(activeProjectId, initialArtifacts as any), [activeProjectId, initialArtifacts]);
  const versioning = useMemo(() => new ArtifactVersioningDomain(), []);
  const graph = useMemo(() => new TopologicalGraphDomain(initialEdges as any), [initialEdges]);
  const segmentation = useMemo(() => new ChapterSegmentationDomain(activeProjectId, initialChapters as any), [activeProjectId, initialChapters]);
  const provenance = useMemo(() => new ProvenanceTrackingDomain(), []);
  const grouping = useMemo(() => new RecursiveGroupingDomain(), []);
  const stream = useMemo(() => new StreamProtocolDomain(), []);
  const recalibration = useMemo(
    () => new ChapterRecalibrationDomain(segmentation, timeline),
    [segmentation, timeline]
  );
  const compiler = useMemo(
    () => new OpticalCompilerDomain(graph, artifacts, segmentation, timeline),
    [graph, artifacts, segmentation, timeline]
  );

  const value = useMemo(
    () => ({
      workspace,
      timeline,
      artifacts,
      versioning,
      graph,
      segmentation,
      provenance,
      grouping,
      stream,
      recalibration,
      compiler,
    }),
    [
      workspace,
      timeline,
      artifacts,
      versioning,
      graph,
      segmentation,
      provenance,
      grouping,
      stream,
      recalibration,
      compiler,
    ]
  );

  return <DomainContext.Provider value={value}>{children}</DomainContext.Provider>;
};

export function useDomains(): DomainContextValue {
  const ctx = useContext(DomainContext);
  if (!ctx) throw new Error('useDomains must be used within a DomainProvider');
  return ctx;
}