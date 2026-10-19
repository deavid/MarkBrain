import { ITopologicalGraphDomain } from './interface';
import { SemanticEdge, RelationKind, GraphEvent } from './types';
import { logger } from '../../utils/logger';

export class TopologicalGraphDomain implements ITopologicalGraphDomain {
  private edges: Map<string, SemanticEdge> = new Map();
  private listeners: Set<(event: GraphEvent) => void> = new Set();

  constructor(initialEdges: SemanticEdge[] = []) {
    initialEdges.forEach((e) => this.edges.set(e.id, e));
  }

  listEdges(): SemanticEdge[] {
    return Array.from(this.edges.values());
  }

  addEdge(sourceId: string, targetId: string, kind: RelationKind, weight = 1): SemanticEdge {
    // Avoid duplicates
    for (const edge of this.edges.values()) {
      if (edge.sourceId === sourceId && edge.targetId === targetId && edge.kind === kind) {
        return edge;
      }
    }

    const edge: SemanticEdge = {
      id: `edge-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      sourceId,
      targetId,
      kind,
      weight,
    };
    this.edges.set(edge.id, edge);
    this.emit({ type: 'edgeAdded', edge });
    return edge;
  }

  removeEdge(edgeId: string): void {
    if (this.edges.delete(edgeId)) {
      this.emit({ type: 'edgeRemoved', edgeId });
    }
  }

  loadEdges(edges: SemanticEdge[]): void {
    this.edges.clear();
    edges.forEach((e) => this.edges.set(e.id, e));
    logger.info('Graph', `Loaded ${this.edges.size} edges`);
    this.emit({ type: 'edgesLoaded', edges: Array.from(this.edges.values()) });
  }

  getNeighbors(nodeId: string): string[] {
    const neighbors = new Set<string>();
    for (const edge of this.edges.values()) {
      if (edge.sourceId === nodeId) neighbors.add(edge.targetId);
      if (edge.targetId === nodeId) neighbors.add(edge.sourceId);
    }
    return Array.from(neighbors);
  }

  getHopDistance(sourceId: string, targetId: string): number {
    if (sourceId === targetId) return 0;
    const queue: Array<{ id: string; dist: number }> = [{ id: sourceId, dist: 0 }];
    const visited = new Set<string>([sourceId]);

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.id === targetId) return current.dist;

      for (const n of this.getNeighbors(current.id)) {
        if (!visited.has(n)) {
          visited.add(n);
          queue.push({ id: n, dist: current.dist + 1 });
        }
      }
    }
    return Infinity;
  }

  getAncestors(nodeId: string): string[] {
    const ancestors = new Set<string>();
    const queue = [nodeId];
    const visited = new Set<string>([nodeId]);

    while (queue.length > 0) {
      const curr = queue.shift()!;
      for (const edge of this.edges.values()) {
        if (edge.targetId === curr && ['parent_of', 'born_from'].includes(edge.kind)) {
          if (!visited.has(edge.sourceId)) {
            visited.add(edge.sourceId);
            ancestors.add(edge.sourceId);
            queue.push(edge.sourceId);
          }
        }
      }
    }
    return Array.from(ancestors);
  }

  subscribe(callback: (event: GraphEvent) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  private emit(event: GraphEvent) {
    this.listeners.forEach((l) => l(event));
  }
}
