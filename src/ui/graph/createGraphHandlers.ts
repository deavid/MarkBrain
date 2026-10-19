import type { DomainContextValue } from '../../domains/DomainRegistry';
import type { GraphEdge } from '../../types';

export interface GraphHandlerParams {
  artifactsDomain: DomainContextValue['artifacts'];
  graph: DomainContextValue['graph'];
}

// Graph node/edge handlers — moved verbatim from App.tsx.
export function createGraphHandlers(params: GraphHandlerParams) {
  const { artifactsDomain, graph } = params;

  // Node position handlers
  const handleUpdateNodePosition = (nodeId: string, x: number, y: number) => {
    const artId = nodeId.replace(/^node-/, '');
    const art = artifactsDomain.getArtifact(artId);
    if (art) {
      artifactsDomain.upsertArtifact({
        ...art,
        id: art.id,
        title: art.title || art.current?.t0_label || 'Untitled',
        graph: {
          ...art.graph,
          x,
          y,
        },
      });
    }
  };

  const handleBatchUpdateNodePositions = (
    updates: Array<{ nodeId: string; x: number; y: number }>
  ) => {
    updates.forEach((u) => {
      handleUpdateNodePosition(u.nodeId, u.x, u.y);
    });
  };

  // Add Edge
  const handleAddEdge = (edge: GraphEdge) => {
    const sArtId = edge.sourceNodeId ? edge.sourceNodeId.replace(/^node-/, '') : '';
    const tArtId = edge.targetNodeId ? edge.targetNodeId.replace(/^node-/, '') : '';

    if (sArtId && tArtId) {
      graph.addEdge(sArtId, tArtId, (edge.label as any) || 'relates_to', edge.strength || 1.0);
    }
  };

  return { handleUpdateNodePosition, handleBatchUpdateNodePositions, handleAddEdge };
}
