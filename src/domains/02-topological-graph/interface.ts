import { SemanticEdge, RelationKind, GraphEvent } from './types';

export interface ITopologicalGraphDomain {
  // Queries
  getHopDistance(sourceId: string, targetId: string): number;
  computeDistancesFromFocal(focalIds: string[], allNodeIds: string[]): Record<string, number>;
  getNeighbors(nodeId: string): string[];
  getAncestors(nodeId: string): string[];
  listEdges(): SemanticEdge[];

  // Commands
  addEdge(sourceId: string, targetId: string, kind: RelationKind, weight?: number): SemanticEdge;
  removeEdge(edgeId: string): void;
  loadEdges(edges: SemanticEdge[]): void;

  // Subscriptions
  subscribe(callback: (event: GraphEvent) => void): () => void;
}
