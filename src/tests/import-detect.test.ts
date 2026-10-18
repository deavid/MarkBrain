/**
 * Phase 2 detection tests — multi-import plan (design-docs/07).
 * Three tiers + skip-self + flagged-relationship helper.
 */
import { describe, it, expect } from 'vitest';
import { contentHash, normalizedBody } from '../utils/contentHash';
import { detectImportFlag, isFlaggedArtifact, flagRelationship } from '../utils/importDetect';
import type { Artifact } from '../types';

describe('contentHash', () => {
  it('collapses whitespace so re-saved bodies still match', () => {
    expect(contentHash('hello   world\n\n')).toBe(contentHash('hello world'));
  });

  it('distinguishes different bodies', () => {
    expect(contentHash('alpha body')).not.toBe(contentHash('beta body'));
  });

  it('normalizedBody trims and collapses', () => {
    expect(normalizedBody('  a \n b\t c  ')).toBe('a b c');
  });
});

describe('detectImportFlag — three tiers', () => {
  const existing = [
    { id: 'art-1', title: 'Thesis Intro', code: 'thesis-intro', body: 'Original body text' },
    { id: 'art-2', title: 'Side Notes', code: 'side-notes', body: 'Something else entirely' },
  ];

  it('tier 1: identical content → duplicate-of, beats a title clash', () => {
    const flag = detectImportFlag(
      { title: 'Totally Different Title', code: 'other-code', body: 'Original body text' },
      existing
    );
    expect(flag).toMatchObject({ type: 'duplicate-of', targetId: 'art-1', reason: 'identical content' });
  });

  it('tier 2: same code, different body → revision-of', () => {
    const flag = detectImportFlag(
      { title: 'Rewritten', code: 'THESIS-INTRO', body: 'A rewritten body' },
      existing
    );
    expect(flag).toMatchObject({ type: 'revision-of', targetId: 'art-1', reason: 'same code' });
  });

  it('tier 3: same title, case-insensitive, no code → revision-of', () => {
    const flag = detectImportFlag(
      { title: '  side notes ', body: 'Fresh body' },
      existing
    );
    expect(flag).toMatchObject({ type: 'revision-of', targetId: 'art-2', reason: 'same title' });
  });

  it('no match → null', () => {
    expect(
      detectImportFlag({ title: 'Brand New', code: 'brand-new', body: 'Never seen' }, existing)
    ).toBeNull();
  });

  it('skipId never matches the incoming artifact itself', () => {
    expect(
      detectImportFlag(
        { title: 'Thesis Intro', code: 'thesis-intro', body: 'Original body text' },
        existing,
        'art-1'
      )
    ).toBeNull();
  });

  it('empty title and code cannot tier-match (no accidental "" collisions)', () => {
    expect(detectImportFlag({ title: '', body: 'New' }, [
      { id: 'x', title: '', code: undefined, body: 'Different' },
    ])).toBeNull();
  });
});

describe('flag relationship helpers', () => {
  const art = (rels?: Array<{ target: string; type: string }>): Artifact =>
    ({
      id: 'a1',
      title: 'T',
      graph: rels ? { relationships: rels } : undefined,
    }) as unknown as Artifact;

  it('isFlaggedArtifact detects only import flag types', () => {
    expect(isFlaggedArtifact(art())).toBe(false);
    expect(isFlaggedArtifact(art([{ target: 't', type: 'cites' }]))).toBe(false);
    expect(isFlaggedArtifact(art([{ target: 't', type: 'revision-of' }]))).toBe(true);
    expect(isFlaggedArtifact(art([{ target: 't', type: 'duplicate-of' }]))).toBe(true);
  });

  it('flagRelationship carries target, type, dated note with reason', () => {
    const rel = flagRelationship({
      type: 'revision-of',
      targetId: 'old-1',
      targetTitle: 'Old',
      reason: 'same title',
    });
    expect(rel.target).toBe('old-1');
    expect(rel.type).toBe('revision-of');
    expect(rel.note).toMatch(/Auto-flagged on import \d{4}-\d{2}-\d{2} \(same title\)/);
  });
});