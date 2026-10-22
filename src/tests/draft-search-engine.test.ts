/**
 * Draft-proximity scoring — the behaviours the plan pins behaviourally.
 *
 * The retrieval testbed exists so four signals can be compared on real
 * documents; if the scoring core drifts, every comparison in the UI becomes a
 * lie. These tests assert the calibration contract (a lone common word stays
 * below the 0.55 default, two rare words in one passage clear it), flag
 * isolation, cosine ranking, clause splitting, and the badge's exclusion
 * rules — not exact floats, except where the law states them (LAW 6 unit
 * length, section cap).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { UniversalArtifactDocument } from '../domains/01-artifact-document/types';
import {
  splitArtifactIntoSections,
  computeArtifactContentHash,
  clearSectionChunkerCache,
  DEFAULT_MAX_SECTION_CHARS,
} from '../utils/sectionChunker';
import {
  scoreArtifactsAgainstDraft,
  countMissingMatches,
  l2Normalize,
  type ArtifactMatchResult,
} from '../domains/search/draftSearchEngine';
import { DEFAULT_SEARCH_CONFIG } from '../domains/search/searchConfig';
import type { SearchTestbedConfig } from '../domains/search/searchConfig';
import type { ArtifactSearchIndexRecord, GeneratedQaPair } from '../services/searchIndexStore';

/* ------------------------------------------------------------------ fixtures */

let uid = 0;

function makeArt(
  title: string,
  body: string,
  extra: Partial<UniversalArtifactDocument> = {}
): UniversalArtifactDocument {
  uid += 1;
  return {
    id: `art-${uid}`,
    workspaceId: 'ws',
    code: `code-${uid}`,
    title,
    type: 'document',
    category: 'note',
    isHighConcept: false,
    current: { description: '', summary: '', body },
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    ...extra,
  };
}

/** Common-word filler: keeps idf for rare terms high without leaking them. */
const FILLER =
  'The workshop notes describe pacing, rooms, triggers, and craft in plain prose. ' +
  'Designers iterate on beats, doors, light, and sound until the rhythm holds. ';

function bigBody(withRare: boolean): string {
  const blocks: string[] = ['# Field Manual'];
  for (let i = 0; i < 14; i++) {
    blocks.push(`## Section ${i}`);
    blocks.push(FILLER + FILLER.slice(0, 400));
    if (withRare && i === 7) {
      blocks.push(
        'A glimmering kestrel perches on the gantry while the glimmering plumage ' +
          'catches the worklight — only this section mentions the kestrel at all.'
      );
    }
    if (withRare && i === 11) {
      blocks.push(
        'Operators record the workshop shift handover here, next to the gauges. ' +
          'Explaining meniscus tilework again, for the third time this quarter.'
      );
    }
  }
  return blocks.join('\n\n');
}

function only(partial: Partial<SearchTestbedConfig>): SearchTestbedConfig {
  return {
    ftsSections: false,
    ftsQa: false,
    vecSections: false,
    vecQa: false,
    splitClauses: true,
    threshold: DEFAULT_SEARCH_CONFIG.threshold,
    ...partial,
  };
}

interface RunOpts {
  draft: string;
  artifacts: UniversalArtifactDocument[];
  indexMap?: Map<string, ArtifactSearchIndexRecord>;
  attached?: string[];
  config?: Partial<SearchTestbedConfig>;
  clauseVectors?: Float32Array[] | null;
}

function run(opts: RunOpts): ArtifactMatchResult[] {
  return scoreArtifactsAgainstDraft({
    draftText: opts.draft,
    clauseVectors: opts.clauseVectors ?? null,
    artifacts: opts.artifacts,
    indexMap: opts.indexMap ?? new Map(),
    attachedArtifactIds: new Set(opts.attached ?? []),
    config: only(opts.config ?? {}),
  });
}

function makeRecord(
  art: UniversalArtifactDocument,
  over: Partial<ArtifactSearchIndexRecord> = {}
): ArtifactSearchIndexRecord {
  return {
    key: `proj::${art.id}`,
    projectId: 'proj',
    artifactId: art.id,
    contentHash: computeArtifactContentHash(art),
    updatedAt: Date.now(),
    qaPairs: [],
    sectionIds: [],
    sectionHeadings: [],
    sectionSnippets: [],
    sectionVectors: [],
    qaVectors: [],
    ...over,
  };
}

/** Unit vector with 1.0 at each index in `hot`. */
function unit(hot: number[], dim = 8): Float32Array {
  const v = new Array<number>(dim).fill(0);
  for (const i of hot) v[i] = 1;
  return new Float32Array(l2Normalize(v));
}

beforeEach(() => {
  clearSectionChunkerCache();
});

/* ------------------------------------------------------------------ chunker */

describe('splitArtifactIntoSections', () => {
  it('keeps every section under the cap on a ~60 KiB multi-heading document', () => {
    const bodyParts: string[] = ['# Field Manual'];
    const para =
      'The workshop notes describe pacing, rooms, triggers, and craft in plain prose. '.repeat(18);
    for (let i = 0; i < 36; i++) {
      bodyParts.push(`## Chapter ${i}`);
      bodyParts.push(para);
      if (i % 6 === 0) {
        bodyParts.push(`### Deep Dive ${i}`);
        bodyParts.push(para.slice(0, 900));
      }
    }
    bodyParts.push('## Overflow');
    bodyParts.push('x'.repeat(4000)); // one paragraph, no \n\n — force part-split
    const body = bodyParts.join('\n\n');
    expect(body.length).toBeGreaterThan(55000);

    const sections = splitArtifactIntoSections(
      makeArt('Field Manual', body),
      DEFAULT_MAX_SECTION_CHARS
    );

    expect(sections.length).toBeGreaterThan(20);
    expect(sections[0].id).toBe('sec-meta');
    for (const s of sections) {
      expect(s.text.length).toBeLessThanOrEqual(DEFAULT_MAX_SECTION_CHARS);
      expect(s.id).toBeTruthy();
      expect(s.heading).toBeTruthy();
    }
    // Headings survive as breadcrumbs, not swallowed into anonymous blobs.
    expect(sections.some((s) => s.heading.includes('Chapter 7'))).toBe(true);
    expect(sections.some((s) => s.heading.includes('Deep Dive 0'))).toBe(true);
    // Oversized blocks are sub-split with the (part N) suffix.
    expect(sections.some((s) => s.heading.includes('(part 2)'))).toBe(true);
  });
});

/* ------------------------------------------------------------------ LAW 6 */

describe('l2Normalize', () => {
  it('makes an unnormalized 768-dim vector unit length', () => {
    const raw = Array.from({ length: 768 }, (_, i) => i + 1);
    const norm = l2Normalize(raw);
    expect(norm).toHaveLength(768);
    const len = Math.sqrt(norm.reduce((acc, x) => acc + x * x, 0));
    expect(len).toBeCloseTo(1.0, 5);
  });

  it('leaves the zero vector alone instead of dividing by zero', () => {
    const zeros = l2Normalize(new Array<number>(768).fill(0));
    expect(zeros.every((x) => x === 0)).toBe(true);
  });
});

/* ------------------------------------------------------------------ FTS: sections */

describe('scoreArtifactsAgainstDraft — ftsSections', () => {
  it('finds a fact buried mid-document', () => {
    const art = makeArt('Field Manual', bigBody(true));
    const results = run({
      draft: 'glimmering kestrel',
      artifacts: [art],
      config: { ftsSections: true },
    });
    expect(results).toHaveLength(1);
    const r = results[0];
    expect(r.winningMethod).toBe('ftsSections');
    expect(r.aboveThreshold).toBe(true);
    expect(r.matchedSectionHeading).toBeTruthy();
  });

  it('keeps a lone common word below the default threshold', () => {
    const art = makeArt('Field Manual', bigBody(true));
    const results = run({
      draft: 'workshop',
      artifacts: [art],
      config: { ftsSections: true },
    });
    expect(results).toHaveLength(1);
    // Calibration pin from the plan: one common word ≈ 0.10, never 0.55+.
    expect(results[0].bestScore).toBeLessThan(DEFAULT_SEARCH_CONFIG.threshold);
    expect(results[0].aboveThreshold).toBe(false);
  });

  it('puts two rare words in one passage above the default threshold', () => {
    const art = makeArt('Field Manual', bigBody(true));
    const results = run({
      draft: 'glimmering kestrel',
      artifacts: [art],
      config: { ftsSections: true },
    });
    // Plan's window: 0.57–0.84 for a two-rare-term hit in a sectioned doc.
    expect(results[0].bestScore).toBeGreaterThanOrEqual(0.55);
    expect(results[0].bestScore).toBeLessThanOrEqual(0.84);
  });
});

/* ------------------------------------------------------------------ FTS: Q&A */

describe('scoreArtifactsAgainstDraft — ftsQa', () => {
  it('matches through a generated question when the body words differ', () => {
    const body =
      '## Operations\n\nThe dome pressure climbs during warmup; operators watch the ' +
      'gauges and wait for the relief cycle to begin. Nobody says the forbidden words.';
    const art = makeArt('Plant Notes', body);

    // 10 pairs so within-index idf is realistic (a single pair can never clear
    // the threshold — df == docCount for every present term).
    const qaPairs: GeneratedQaPair[] = [];
    for (let i = 0; i < 9; i++) {
      qaPairs.push({
        id: `qa-filler-${i}`,
        sectionHeading: `Misc ${i}`,
        question: `Which schedule item alpha${i} owns the pallet flow?`,
        answer: `Pallet flow ${i} is owned by the night shift.`,
        keywords: [`pallet${i}`, `flow${i}`],
      });
    }
    qaPairs.push({
      id: 'qa-9',
      sectionHeading: 'Operations',
      question: 'When does the reactor vent steam?',
      answer: 'The reactor vents steam automatically once dome pressure crosses 3 bar.',
      keywords: ['reactor', 'vent', 'steam'],
    });

    const record = makeRecord(art, { qaPairs });
    const indexMap = new Map([[art.id, record]]);
    const results = run({
      draft: 'when does the reactor vent',
      artifacts: [art],
      indexMap,
      config: { ftsQa: true },
    });

    expect(results).toHaveLength(1);
    const r = results[0];
    expect(r.winningMethod).toBe('ftsQa');
    expect(r.aboveThreshold).toBe(true);
    expect(r.matchedQa?.question).toContain('reactor');
    expect(r.indexStatus).toBe('ready');
  });

  it('scores nothing when the note has no Q&A record', () => {
    const art = makeArt('Bare', '## Nothing\n\nNo index here.');
    const results = run({
      draft: 'reactor vent',
      artifacts: [art],
      config: { ftsQa: true },
    });
    expect(results).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ vectors */

describe('scoreArtifactsAgainstDraft — vecSections / vecQa', () => {
  it('ranks by cosine over section vectors', () => {
    const artA = makeArt('Doc A', '## One\n\nAlpha text.');
    const artB = makeArt('Doc B', '## Two\n\nBeta text.');
    const hot = unit([0]); // query points at axis 0
    const map = new Map<string, ArtifactSearchIndexRecord>([
      [
        artA.id,
        makeRecord(artA, {
          sectionVectors: [unit([0, 1])], // 45° off → cos ≈ 0.707
          sectionHeadings: ['One'],
          sectionSnippets: ['Alpha text.'],
        }),
      ],
      [
        artB.id,
        makeRecord(artB, {
          sectionVectors: [unit([0])], // aligned → cos = 1
          sectionHeadings: ['Two'],
          sectionSnippets: ['Beta text.'],
        }),
      ],
    ]);

    const results = run({
      draft: 'anything at all',
      artifacts: [artA, artB],
      indexMap: map,
      config: { vecSections: true, splitClauses: false },
      clauseVectors: [hot],
    });

    expect(results).toHaveLength(2);
    expect(results[0].artifactId).toBe(artB.id);
    expect(results[0].bestScore).toBeCloseTo(1.0, 5);
    expect(results[0].winningMethod).toBe('vecSections');
    expect(results[0].methodScores.ftsSections).toBeUndefined();
    // X-Ray must name the section that actually won.
    expect(results[0].matchedSectionHeading).toBe('Two');
    expect(results[1].bestScore).toBeCloseTo(Math.SQRT1_2, 3);
  });

  it('ranks by cosine over Q&A vectors and surfaces the winning pair', () => {
    const artA = makeArt('Doc A', '## One\n\nAlpha text.');
    const artB = makeArt('Doc B', '## Two\n\nBeta text.');
    const qaFor = (id: string, q: string): GeneratedQaPair => ({
      id: `${id}-qa-0`,
      sectionHeading: 'Ops',
      question: q,
      answer: 'Answer text.',
      keywords: [],
    });
    const map = new Map<string, ArtifactSearchIndexRecord>([
      [
        artA.id,
        makeRecord(artA, {
          qaPairs: [qaFor(artA.id, 'What does A ask?')],
          qaVectors: [unit([0, 1])],
        }),
      ],
      [
        artB.id,
        makeRecord(artB, {
          qaPairs: [qaFor(artB.id, 'What does B ask?')],
          qaVectors: [unit([0])],
        }),
      ],
    ]);

    const results = run({
      draft: 'anything at all',
      artifacts: [artA, artB],
      indexMap: map,
      config: { vecQa: true, splitClauses: false },
      clauseVectors: [unit([0])],
    });

    expect(results[0].artifactId).toBe(artB.id);
    expect(results[0].winningMethod).toBe('vecQa');
    expect(results[0].methodScores.vecQa).toBeCloseTo(1.0, 5);
    expect(results[0].matchedQa?.question).toContain('B ask');
  });
});

/* ------------------------------------------------------------------ clauses */

describe('splitClauses', () => {
  it('stops a 3-topic draft from diluting a single-topic hit', () => {
    const art = makeArt('Field Manual', bigBody(true));
    const draft =
      'Explaining meniscus tilework again. The quarterly budget numbers and ' +
      'headcount forecasts. How rockets land safely on legs.';

    const split = run({
      draft,
      artifacts: [art],
      config: { ftsSections: true, splitClauses: true },
    });
    const whole = run({
      draft,
      artifacts: [art],
      config: { ftsSections: true, splitClauses: false },
    });

    expect(split).toHaveLength(1);
    expect(whole).toHaveLength(1);
    // Clause isolation: the meniscus clause clears 0.55 …
    expect(split[0].aboveThreshold).toBe(true);
    // … while the undiluted blob, whose other topics aren't in this note, does not.
    expect(whole[0].aboveThreshold).toBe(false);
    expect(split[0].bestScore).toBeGreaterThan(whole[0].bestScore);
  });
});

/* ------------------------------------------------------------------ badge rules */

describe('countMissingMatches', () => {
  it('excludes attached results and never sees archived ones', () => {
    const keep = makeArt('Keep', bigBody(true));
    const twin = makeArt('Twin', bigBody(true));
    const parked = makeArt('Parked', bigBody(true), { lifecycle: 'archived' });

    const results = run({
      draft: 'glimmering kestrel',
      artifacts: [keep, twin, parked],
      attached: [twin.id],
      config: { ftsSections: true },
    });

    // Archived is dropped by the engine itself — not a zero-score row.
    expect(results.map((r) => r.artifactId).sort()).toEqual([keep.id, twin.id].sort());
    expect(results.every((r) => r.aboveThreshold)).toBe(true);
    // Twin is attached (staged OR committed both count); only keep is badge-worthy.
    expect(countMissingMatches(results)).toBe(1);
    const twinResult = results.find((r) => r.artifactId === twin.id);
    expect(twinResult?.isAlreadyAttached).toBe(true);
    const keepResult = results.find((r) => r.artifactId === keep.id);
    expect(keepResult?.isAlreadyAttached).toBe(false);
  });
});
