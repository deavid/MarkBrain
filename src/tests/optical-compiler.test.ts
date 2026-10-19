/**
 * Optical compiler provenance suite.
 *
 * The UI labels "manual pin" vs "forced" vs "ancestor" vs "auto depth-of-field"
 * directly from the compiler's `reason` field — if reasons drift, users can no
 * longer tell whether an artifact was pinned by hand or pulled in automatically.
 */
import { describe, it, expect } from 'vitest';
import { OpticalCompilerDomain } from '../domains/03-optical-compiler';
import { estimateTokens } from '../utils/estimateTokens';

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

describe('Optical compiler chapterBreakdown telemetry', () => {
  // Two chapters so the full/summary rule is exercised both ways: the LAST
  // chapter is always ongoing (isChapterOngoing = active OR last), so c1
  // (completed, not last) compresses to summary while c2 compiles full.
  function compileWithChapters() {
    const chapters = [
      {
        id: 'c1',
        workspaceId: 'w',
        title: 'First Chapter',
        summary: 'C1 summary.',
        status: 'completed',
        startIndex: 0,
        endIndex: 2,
        createdAt: 1,
      },
      {
        id: 'c2',
        workspaceId: 'w',
        title: 'Second Chapter',
        summary: 'C2 summary.',
        status: 'active',
        startIndex: 2,
        createdAt: 1,
      },
    ] as any[];
    const turns = [
      { id: 't1', role: 'user', content: 'hello there', timestamp: 1 },
      { id: 't2', role: 'assistant', content: 'hi back', timestamp: 2 },
      { id: 't3', role: 'user', content: 'second chapter turn', timestamp: 3 },
    ] as any[];
    const graph = {
      computeDistancesFromFocal: () => ({ a: 0 }),
      getAncestors: () => [],
    } as any;
    const artifacts = { listArtifacts: () => [makeArtifact('a')] } as any;
    const segmentation = { getActiveChapter: () => null, listChapters: () => [] } as any;
    const timeline = { getTurnSlice: () => [] } as any;
    const domain = new OpticalCompilerDomain(graph, artifacts, segmentation, timeline);
    const out = domain.compile({
      focalIds: ['a'],
      opticalMode: 'autofocus',
      historyChapters: chapters,
      historyTurns: turns,
    });
    return { out, chapters, turns };
  }

  it('emits one entry per included chapter, mode matching the full/summary rule, tokens = estimate of the assembled text', () => {
    const { out } = compileWithChapters();
    const entries = out.telemetry.chapterBreakdown;
    expect(entries.map((e) => e.chapterId)).toEqual(['c1', 'c2']);
    expect(entries.map((e) => e.mode)).toEqual(['summary', 'full']);
    expect(entries.map((e) => e.title)).toEqual(['First Chapter', 'Second Chapter']);

    // Entry tokens are the estimate of the EXACT xml the compiler assembled —
    // closed c1: summary block; ongoing c2: windowed verbatim turns (start 2 → t3 only).
    const c1Xml = `  <chapter id="c1" tier="2" status="completed">\n    <title>First Chapter</title>\n    <summary>\nC1 summary.\n    </summary>\n  </chapter>`;
    const c2Xml = `  <chapter id="c2" tier="3" status="active">\n    <title>Second Chapter</title>\n    <turns>\n      <turn role="user">\nsecond chapter turn\n      </turn>\n    </turns>\n  </chapter>`;
    expect(entries[0].tokens).toBe(estimateTokens(c1Xml));
    expect(entries[1].tokens).toBe(estimateTokens(c2Xml));
  });

  it('sums within the documented rounding tolerance of tokenBreakdown.historyTokens', () => {
    const { out } = compileWithChapters();
    const entries = out.telemetry.chapterBreakdown;
    const sum = entries.reduce((n, e) => n + e.tokens, 0);
    // Tolerance documented on ContextTelemetry.chapterBreakdown: ceil-per-chapter
    // vs a potential ceil-of-whole drifts by <1 token per chapter.
    expect(Math.abs(sum - out.telemetry.tokenBreakdown.historyTokens)).toBeLessThanOrEqual(entries.length);
    expect(sum).toBe(out.telemetry.tokenBreakdown.historyTokens); // exact today: both ceil per chapter
  });

  it('carries a reason on every nodeTiers entry the mirror chips read, and complete chapter entries', () => {
    const { out } = compileWithChapters();
    const reasons = Object.values(out.nodeTiers).map((t) => t.reason);
    expect(reasons.length).toBeGreaterThan(0);
    reasons.forEach((r) =>
      expect(['pin', 'fallback', 'override', 'ancestor', 'radius', 'culled']).toContain(r)
    );
    out.telemetry.chapterBreakdown.forEach((e) => {
      expect(e).toMatchObject({ chapterId: expect.any(String), title: expect.any(String) });
      expect(['full', 'summary']).toContain(e.mode);
      expect(e.tokens).toBeGreaterThan(0);
    });
  });
});
describe('Optical compiler noteBreakdown telemetry', () => {
  // a = focal (Tier 3), b = distance 1 (Tier 2), c = distance 4 (culled).
  function compileWithNotes() {
    const graph = {
      computeDistancesFromFocal: () => ({ a: 0, b: 1, c: 4 }),
      getAncestors: () => [],
    } as any;
    const artifacts = { listArtifacts: () => ['a', 'b', 'c'].map(makeArtifact) } as any;
    const segmentation = { getActiveChapter: () => null, listChapters: () => [] } as any;
    const timeline = { getTurnSlice: () => [] } as any;
    const domain = new OpticalCompilerDomain(graph, artifacts, segmentation, timeline);
    return domain.compile({ focalIds: ['a'], opticalMode: 'autofocus' });
  }

  it('emits one entry per included note, in substrate order, tokens = estimate of the assembled XML', () => {
    const out = compileWithNotes();
    const entries = out.telemetry.noteBreakdown;
    // culled c excluded
    expect(entries.map((e) => e.artifactId)).toEqual(['a', 'b']);
    expect(entries.map((e) => e.tier)).toEqual([3, 2]);
    expect(entries.map((e) => e.title)).toEqual(['Artifact a', 'Artifact b']);

    // Entry tokens are the estimate of the EXACT xml the compiler assembled.
    const aXml = `  <artifact id="a" type="document" tier="3" focus="true">\n    <title>Artifact a</title>\n    <content>\nbody a\n    </content>\n  </artifact>`;
    const bXml = `  <artifact id="b" type="document" tier="2" distance="1">\n    <title>Artifact b</title>\n    <summary>\nsummary b\n    </summary>\n  </artifact>`;
    expect(entries[0].tokens).toBe(estimateTokens(aXml));
    expect(entries[1].tokens).toBe(estimateTokens(bXml));
  });

  it('sums within the documented rounding tolerance of tokenBreakdown.substrateTokens', () => {
    const out = compileWithNotes();
    const entries = out.telemetry.noteBreakdown;
    const sum = entries.reduce((n, e) => n + e.tokens, 0);
    // Tolerance documented on ContextTelemetry.noteBreakdown: ceil-per-note
    // vs a potential ceil-of-whole drifts by <1 token per note.
    expect(Math.abs(sum - out.telemetry.tokenBreakdown.substrateTokens)).toBeLessThanOrEqual(entries.length);
    expect(sum).toBe(out.telemetry.tokenBreakdown.substrateTokens); // exact today: both ceil per note
  });

  it('carries tier and title on every note entry the mirror rows read', () => {
    const out = compileWithNotes();
    expect(out.telemetry.noteBreakdown.length).toBeGreaterThan(0);
    out.telemetry.noteBreakdown.forEach((e) => {
      expect(e).toMatchObject({ artifactId: expect.any(String), title: expect.any(String) });
      expect([0, 1, 2, 3]).toContain(e.tier);
      expect(e.tokens).toBeGreaterThan(0);
    });
  });
});
