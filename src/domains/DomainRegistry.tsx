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
import { OpticalCompilerDomain, IOpticalCompilerDomain, CompiledOpticalPayload } from './03-optical-compiler';

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

  const timeline = useMemo(() => new DialogueTimelineDomain(activeProjectId), [activeProjectId]);
  const artifacts = useMemo(() => new ArtifactDocumentDomain(activeProjectId), [activeProjectId]);
  const versioning = useMemo(() => new ArtifactVersioningDomain(), []);
  const graph = useMemo(() => new TopologicalGraphDomain(), []);
  const segmentation = useMemo(() => new ChapterSegmentationDomain(activeProjectId), [activeProjectId]);
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
