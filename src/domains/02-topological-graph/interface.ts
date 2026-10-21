import { SemanticEdge, RelationKind, GraphEvent } from './types';

export interface ITopologicalGraphDomain {
  getHopDistance(sourceId: string, targetId: string): number;
  getNeighbors(nodeId: string): string[];
  getAncestors(nodeId: string): string[];
  listEdges(): SemanticEdge[];

  addEdge(sourceId: string, targetId: string, kind: RelationKind, weight?: number): SemanticEdge;
  removeEdge(edgeId: string): void;
  /** Every edge incident to the node — a deleted artifact must not leave half-edges behind. */
  removeNode(nodeId: string): void;
  loadEdges(edges: SemanticEdge[]): void;

  subscribe(callback: (event: GraphEvent) => void): () => void;
}
