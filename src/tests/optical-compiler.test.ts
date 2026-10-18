/**
 * Optical compiler provenance suite.
 *
 * The UI labels "manual pin" vs "forced" vs "ancestor" vs "auto depth-of-field"
 * directly from the compiler's `reason` field — if reasons drift, users can no
 * longer tell whether an artifact was pinned by hand or pulled in automatically.
 */
import { describe, it, expect } from 'vitest';
import { OpticalCompilerDomain } from '../domains/03-optical-compiler';

function makeArtifact(id: string) {
  return {
    id,
    title: `Artifact ${id}`,
    current: {
      t0_label: `Artifact ${id}`,
      t1_abstract: `abstract ${id}`,
      t2_summary: `summary ${id}`,
      t3_body: `body ${id}`,
    },
  } as any;
}

function compile(opts: {
  artifacts: string[];
  distances: Record<string, number>;
  focalIds?: string[];
  overrides?: Record<string, 0 | 1 | 2 | 3>;
  ancestorsOf?: Record<string, string[]>;
}) {
  const graph = {
    computeDistancesFromFocal: () => opts.distances,
    getAncestors: (id: string) => opts.ancestorsOf?.[id] ?? [],
  } as any;
  const artifacts = { listArtifacts: () => opts.artifacts.map(makeArtifact) } as any;
  const segmentation = { getActiveChapter: () => null, listChapters: () => [] } as any;
  const timeline = { getTurnSlice: () => [] } as any;
  const domain = new OpticalCompilerDomain(graph, artifacts, segmentation, timeline);
  return domain.compile({
    focalIds: opts.focalIds ?? [],
    opticalMode: 'autofocus',
    tierOverrides: opts.overrides,
  });
}

describe('Optical compiler tier provenance', () => {
  it('labels explicitly pinned artifacts as manual pin at Tier 3', () => {
    const out = compile({
      artifacts: ['a', 'b'],
      distances: { a: 0, b: 1 },
      focalIds: ['a'],
    });
    expect(out.nodeTiers['a']).toMatchObject({ tier: 3, distance: 0, reason: 'pin' });
    expect(out.nodeTiers['b']).toMatchObject({ tier: 2, reason: 'radius' });
  });

  it('labels the default focal fallback distinctly from a pin', () => {
    const out = compile({
      artifacts: ['a', 'b'],
      distances: { a: 0, b: 4 },
      focalIds: [], // nothing pinned, no active chapter → first artifact is fallback focal
    });
    expect(out.nodeTiers['a']).toMatchObject({ tier: 3, reason: 'fallback' });
    expect(out.nodeTiers['b']).toMatchObject({ tier: 'culled', reason: 'culled' });
  });

  it('labels manual overrides as forced, even far outside the radius', () => {
    const out = compile({
      artifacts: ['a', 'c'],
      distances: { a: 0, c: 9 },
      focalIds: ['a'],
      overrides: { c: 2 },
    });
    expect(out.nodeTiers['c']).toMatchObject({ tier: 2, distance: 9, reason: 'override' });
  });

  it('labels distance-based tiers as automatic radius', () => {
    const out = compile({
      artifacts: ['a', 'b', 'c', 'd'],
      distances: { a: 0, b: 1, c: 3, d: 4 },
      focalIds: ['a'],
    });
    expect(out.nodeTiers['b']).toMatchObject({ tier: 2, reason: 'radius' });
    expect(out.nodeTiers['c']).toMatchObject({ tier: 0, reason: 'radius' });
    expect(out.nodeTiers['d']).toMatchObject({ tier: 'culled', reason: 'culled' });
  });

  it('labels ancestor-backbone rescues as ancestor, not radius', () => {
    const out = compile({
      artifacts: ['f', 'x'],
      distances: { f: 0, x: 4 }, // outside radius on distance alone
      focalIds: ['f'],
      ancestorsOf: { f: ['x'] }, // …but x is an ancestor of the focal point
    });
    expect(out.nodeTiers['x']).toMatchObject({ tier: 1, distance: 4, reason: 'ancestor' });
  });

  it('keeps override precedence over pin and ancestor', () => {
    const out = compile({
      artifacts: ['f', 'x'],
      distances: { f: 0, x: 4 },
      focalIds: ['f', 'x'], // x is pinned AND an ancestor
      overrides: { x: 0 }, // …and force-overridden
      ancestorsOf: { f: ['x'] },
    });
    expect(out.nodeTiers['x']).toMatchObject({ tier: 0, reason: 'override' });
    expect(out.nodeTiers['f']).toMatchObject({ tier: 3, reason: 'pin' });
  });
});