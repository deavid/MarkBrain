/**
 * Phase 4 batch-rules tests — placement/relation precedence at row-land.
 */
import { describe, it, expect } from 'vitest';
import { applyImportRules, parseTagList, EMPTY_BATCH_RULES, BatchRules } from '../utils/importRules';
import type { Artifact } from '../types';

const art = (over: Partial<Artifact> = {}): Artifact =>
  ({
    id: 'a1',
    title: 'T',
    tags: ['own'],
    graph: {},
    current: { t0_label: 'T', t1_abstract: '', t2_summary: '', t3_body: 'body' },
    ...over,
  }) as unknown as Artifact;

const rules = (over: Partial<BatchRules> = {}): BatchRules => ({ ...EMPTY_BATCH_RULES, ...over });

describe('applyImportRules', () => {
  it('batch parent applies when artifact has none', () => {
    const out = applyImportRules(art(), rules({ parent: 'batch-parent' }));
    expect(out.graph?.parent).toBe('batch-parent');
  });

  it('frontmatter parent beats batch parent (declared intent wins)', () => {
    const withFm = art({ graph: { parent: 'frontmatter-parent' } } as Partial<Artifact>);
    const out = applyImportRules(withFm, rules({ parent: 'batch-parent' }));
    expect(out.graph?.parent).toBe('frontmatter-parent');
  });

  it('row override beats both (manual intent wins)', () => {
    const withFm = art({ graph: { parent: 'frontmatter-parent' } } as Partial<Artifact>);
    const out = applyImportRules(withFm, rules({ parent: 'batch-parent' }), '  row-ov ');
    expect(out.graph?.parent).toBe('row-ov');
  });

  it('batch tags union with own tags, deduped', () => {
    const out = applyImportRules(art(), rules({ tags: ['own', 'batch-tag'] }));
    expect(out.tags).toEqual(['own', 'batch-tag']);
  });

  it('bulk relationship appended once (idempotent)', () => {
    const r = rules({ relType: 'cites', relTargetId: 'target-1' });
    const once = applyImportRules(art(), r);
    expect(once.graph?.relationships).toEqual([
      { target: 'target-1', type: 'cites', note: 'Batch import rule' },
    ]);
    const twice = applyImportRules(once, r);
    expect(twice.graph?.relationships).toHaveLength(1);
  });

  it('no rules → placement untouched', () => {
    const out = applyImportRules(art(), rules());
    expect(out.graph?.parent).toBeUndefined();
    expect(out.tags).toEqual(['own']);
    expect(out.graph?.relationships).toBeUndefined();
  });

  it('parseTagList cleans and dedupes', () => {
    expect(parseTagList('Alpha, beta!, alpha,  ')).toEqual(['alpha', 'beta']);
  });
});