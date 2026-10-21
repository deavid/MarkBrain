import { Artifact } from '../types';

// Batch placement & relations, applied at row-land. Precedence: manual row
// override > frontmatter parent > batch default. Tags union; bulk relationship
// appended idempotently.

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

  const override = (rowOverride || '').trim();
  const batchParent = (rules.parent || '').trim();
  const parent = override || graph.parent || batchParent;
  if (parent) graph.parent = parent;
  else delete graph.parent;

  let tags = art.tags || [];
  if (rules.tags.length > 0) {
    tags = Array.from(new Set([...tags, ...rules.tags]));
  }

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