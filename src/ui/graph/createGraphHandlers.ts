import type { DomainContextValue } from '../../domains/DomainRegistry';
import type { RelationKind } from '../../types';

export interface GraphHandlerParams {
  artifactsDomain: DomainContextValue['artifacts'];
  graph: DomainContextValue['graph'];
}

// Graph node/edge handlers. Ids arrive as ARTIFACT ids — the view-local
// `node-` prefix convention lives inside SpatialGraph (it never leaks here),
// and the edge kind is already a valid open-vocabulary RelationKind (D5).
export function createGraphHandlers(params: GraphHandlerParams) {
  const { artifactsDomain, graph } = params;

  // Node position handlers
  const handleUpdateNodePosition = (artifactId: string, x: number, y: number) => {
    const art = artifactsDomain.getArtifact(artifactId);
    if (art) {
      artifactsDomain.upsertArtifact({
        ...art,
        id: art.id,
        title: art.title || art.title || 'Untitled',
        graph: {
          ...art.graph,
          x,
          y,
        },
      });
    }
  };

  const handleBatchUpdateNodePositions = (
    updates: Array<{ artifactId: string; x: number; y: number }>
  ) => {
    updates.forEach((u) => {
      handleUpdateNodePosition(u.artifactId, u.x, u.y);
    });
  };

  // Add Edge — kind is open-vocabulary (KNOWN_RELATION_KINDS is the suggested
  // set), so whatever SpatialGraph authors is stored verbatim.
  const handleAddEdge = (sourceId: string, targetId: string, kind: RelationKind, weight?: number) => {
    if (sourceId && targetId) {
      graph.addEdge(sourceId, targetId, kind, weight ?? 1.0);
    }
  };

  return { handleUpdateNodePosition, handleBatchUpdateNodePositions, handleAddEdge };
}
