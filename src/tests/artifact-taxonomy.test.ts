/**
 * BUG-006 §2: one Category concept with six canonical, self-describing
 * options. Legacy values ('specification', 'general') map into the canon
 * instead of lingering as opaque strings.
 */
import { describe, it, expect } from 'vitest';
import {
  ARTIFACT_CATEGORIES,
  normalizeCategory,
  categoryToType,
  normalizeSlug,
  uniqueSlug,
  slugTaken,
} from '../utils/artifactTaxonomy';

describe('ARTIFACT_CATEGORIES', () => {
  it('has exactly the six canonical values, each with a label and a plain-language description', () => {
    expect(ARTIFACT_CATEGORIES.map((c) => c.value)).toEqual([
      'note',
      'document',
      'spec',
      'reference',
      'plan',
      'chapter',
    ]);
    for (const c of ARTIFACT_CATEGORIES) {
      expect(c.label.length).toBeGreaterThan(0);
      expect(c.description.length).toBeGreaterThan(0);
    }
  });
});

describe('normalizeCategory — legacy values fold into the canon', () => {
  it('maps specification → spec and general → note', () => {
    expect(normalizeCategory('specification')).toBe('spec');
    expect(normalizeCategory('general')).toBe('note');
  });

  it('keeps canonical values and falls back to note for junk', () => {
    expect(normalizeCategory('plan')).toBe('plan');
    expect(normalizeCategory('')).toBe('note');
    expect(normalizeCategory(undefined)).toBe('note');
    expect(normalizeCategory('something-made-up')).toBe('note');
  });
});

describe('categoryToType — type and category stay synchronized', () => {
  it('chapter stays chapter; everything else is a document', () => {
    expect(categoryToType('chapter')).toBe('chapter');
    expect(categoryToType('spec')).toBe('document');
    expect(categoryToType('note')).toBe('document');
  });
});

describe('slug utilities (BUG-006 §1)', () => {
  it('normalizeSlug lowercases and collapses to a-z0-9-', () => {
    expect(normalizeSlug('Night Vision — Acoustic Synesthesia!')).toBe(
      'night-vision-acoustic-synesthesia'
    );
    expect(normalizeSlug('  already-fine  ')).toBe('already-fine');
  });

  it('uniqueSlug suffixes -001, -002 on collision', () => {
    const taken = new Set(['night-vision', 'night-vision-001']);
    expect(uniqueSlug('night-vision', taken)).toBe('night-vision-002');
    expect(uniqueSlug('fresh-slug', taken)).toBe('fresh-slug');
  });

  it('slugTaken checks across a workspace, excluding the artifact itself', () => {
    const arts = [
      { id: 'a', code: 'alpha' },
      { id: 'b', code: 'beta' },
    ];
    expect(slugTaken('alpha', arts, 'a')).toBe(false);
    expect(slugTaken('alpha', arts, 'b')).toBe(true);
    expect(slugTaken('gamma', arts, null)).toBe(false);
  });
});
