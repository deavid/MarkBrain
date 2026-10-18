import { Artifact } from '../types';

// Multi-import plan — Phase 4: batch placement & relations.
// Precedence (locked in the plan): manual row override > frontmatter parent
// (declared intent) > batch rule (default). Tags union; bulk relationship
// appended idempotently. Pure function — unit-tested, applied at row-land.

export interface BatchRules {
  /** Batch default parent slug — only used when the artifact has none. */
  parent: string;
  /** Appended (union) to every landed artifact's tags. */
  tags: string[];
  /** Bulk relationship type ('' = none), e.g. 'cites'. */
  relType: string;
  /** Bulk relationship target artifact id ('' = none). */
  relTargetId: string;
}

export const EMPTY_BATCH_RULES: BatchRules = {
  parent: '',
  tags: [],
  relType: '',
  relTargetId: '',
};

const slugTag = (t: string) => t.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');

export function parseTagList(raw: string): string[] {
  return Array.from(
    new Set(
      raw
        .split(',')
        .map(slugTag)
        .filter(Boolean)
    )
  );
}

export function applyImportRules(
  art: Artifact,
  rules: BatchRules,
  rowOverride?: string
): Artifact {
  const graph = { ...(art.graph || {}) };

  // Parent: override (explicit user intent on this row) > existing/frontmatter
  // parent (declared intent) > batch default.
  const override = (rowOverride || '').trim();
  const batchParent = (rules.parent || '').trim();
  const parent = override || graph.parent || batchParent;
  if (parent) graph.parent = parent;
  else delete graph.parent;

  // Tags: union with batch tags (dedup, stable-ish order: own first).
  let tags = art.tags || [];
  if (rules.tags.length > 0) {
    tags = Array.from(new Set([...tags, ...rules.tags]));
  }

  // Bulk relationship: append once (idempotent on target+type).
  if (rules.relType && rules.relTargetId) {
    const rels = [...(graph.relationships || [])];
    if (!rels.some((r) => r.target === rules.relTargetId && r.type === rules.relType)) {
      rels.push({
        target: rules.relTargetId,
        type: rules.relType,
        note: 'Batch import rule',
      });
    }
    graph.relationships = rels;
  }

  return { ...art, graph, tags };
}