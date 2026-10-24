/**
 * The "stuck on Indexing 16/16 after it already completed" bug.
 *
 * `Promise.all` rejects the instant one step fails, but its SIBLING keeps
 * running — and when that sibling finally settles it calls the progress
 * callback. The run has already reported complete and cleared the line, so the
 * late callback repaints it with nothing left to ever clear it again.
 *
 * Three guards stop that: mapLimit stops launching, `report` goes inert once
 * the document has returned, and App's `live` flag goes false when the run
 * settles. This file pins the one that is testable at the unit level.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

const qaMock = vi.fn();
const embedMock = vi.fn();
vi.mock('../gateway/api', () => ({
  generateArtifactQa: (...a: unknown[]) => qaMock(...a),
  embedTexts: (...a: unknown[]) => embedMock(...a),
}));

import { indexSingleArtifact } from '../application/artifactIndexer';
import { computeArtifactContentHash } from '../utils/sectionChunker';
import type { UniversalArtifactDocument } from '../domains/01-artifact-document/types';

const art = {
  id: 'a1',
  workspaceId: 'p',
  code: 'note',
  title: 'A Note',
  type: 'document',
  category: 'note',
  isHighConcept: false,
  current: {
    subtitle: 'sub',
    description: 'desc',
    summary: 'sum',
    body: '## Heading\n\nSome body text that will be split into sections.',
  },
  tags: [],
  createdAt: 0,
  updatedAt: 0,
} as unknown as UniversalArtifactDocument;

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

describe('a straggler cannot repaint the progress line', () => {
  beforeEach(() => {
    qaMock.mockReset();
    embedMock.mockReset();
  });

  it('never reports again once the document has settled — success or failure', async () => {
    // The contract the UI depends on: when this promise settles, the progress
    // line is finished with this document. Anything still in flight must not be
    // able to repaint it, because the caller has already moved on (or cleared
    // the line entirely). That is what left "Indexing 16/16" stuck on screen
    // after the run had reported complete.
    qaMock.mockRejectedValue(new Error('generate-qa: HTTP 500'));
    embedMock.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(json({ embeddings: [[0.1, 0.2]] })), 80))
    );

    const stages: string[] = [];
    await expect(indexSingleArtifact('p', art, (s) => stages.push(s))).rejects.toThrow();
    const atSettle = stages.length;

    // Long enough for any orphaned embed to land and try to report.
    await new Promise((r) => setTimeout(r, 200));
    expect(stages.length).toBe(atSettle);
  });

  it('still reports normally on the happy path', async () => {
    qaMock.mockResolvedValue(json({ qaPairs: [{ question: 'q', answer: 'a', keywords: [], sectionHeading: 'h' }] }));
    embedMock.mockImplementation(({ texts }: { texts: string[] }) =>
      Promise.resolve(json({ embeddings: texts.map(() => [0.1, 0.2]) }))
    );

    const stages: string[] = [];
    await indexSingleArtifact('p', art, (stage) => stages.push(stage));
    expect(stages.length).toBeGreaterThan(0);
    expect(stages[stages.length - 1]).toBe('Saved');
  });
});

describe('the counter must move as documents land, not at the end', () => {
  beforeEach(() => {
    qaMock.mockReset();
    embedMock.mockReset();
  });

  it('publishes each document as it is saved', async () => {
    // The bug: the map was swapped in ONCE, after the whole run. `indexedCount`
    // and the ranking key off the Map's identity, so both froze for the entire
    // job — "Indexed: 8 / 24" never moved while the line said 16/16.
    // A Response body is single-use: every call needs its own.
    qaMock.mockImplementation(() =>
      Promise.resolve(json({ qaPairs: [{ question: 'q', answer: 'a', keywords: [], sectionHeading: 'h' }] }))
    );
    embedMock.mockImplementation(({ texts }: { texts: string[] }) =>
      Promise.resolve(json({ embeddings: texts.map(() => [0.1, 0.2]) }))
    );

    const artB = { ...art, id: 'a2', title: 'B Note' } as unknown as UniversalArtifactDocument;
    const { indexProjectArtifacts } = await import('../application/artifactIndexer');

    const published: string[] = [];
    await indexProjectArtifacts('p', [art, artB], new Map(), {
      onIndexed: (r) => published.push(r.artifactId),
      onProgress: () => {},
    });

    expect(published).toEqual(['a1', 'a2']);
  });
});

describe('resume: a half-built record does not re-buy what it has', () => {
  beforeEach(() => {
    qaMock.mockReset();
    embedMock.mockReset();
    qaMock.mockImplementation(() =>
      Promise.resolve(json({ qaPairs: [{ question: 'q', answer: 'a', keywords: [], sectionHeading: 'h' }] }))
    );
    embedMock.mockImplementation(({ texts }: { texts: string[] }) =>
      Promise.resolve(json({ embeddings: texts.map(() => [0.1, 0.2]) }))
    );
  });

  it('skips section embedding when the vectors are already there', async () => {
    const prior = {
      key: 'k',
      projectId: 'p',
      artifactId: 'a1',
      contentHash: computeArtifactContentHash(art),
      updatedAt: 1,
      qaPairs: [],
      sectionIds: ['sec-meta'],
      sectionHeadings: ['Overview'],
      sectionSnippets: ['…'],
      sectionVectors: [new Float32Array([1, 0])],
      qaVectors: [],
      stages: { sectionsEmbedded: true, qaGenerated: false, qaEmbedded: false },
    } as never;

    await indexSingleArtifact('p', art, () => {}, undefined, prior);

    // Only the Q&A vectors were bought; the section vectors were reused.
    expect(embedMock.mock.calls.length).toBe(1);
  });

  it('skips everything when the record is already complete', async () => {
    const prior = {
      key: 'k',
      projectId: 'p',
      artifactId: 'a1',
      contentHash: computeArtifactContentHash(art),
      updatedAt: 1,
      qaPairs: [{ id: 'qa-0', question: 'q', answer: 'a', keywords: [], sectionHeading: 'h' }],
      sectionIds: ['sec-meta'],
      sectionHeadings: ['Overview'],
      sectionSnippets: ['…'],
      sectionVectors: [new Float32Array([1, 0])],
      qaVectors: [new Float32Array([0, 1])],
      stages: { sectionsEmbedded: true, qaGenerated: true, qaEmbedded: true },
    } as never;

    await indexSingleArtifact('p', art, () => {}, undefined, prior);
    expect(qaMock.mock.calls.length).toBe(0);
    expect(embedMock.mock.calls.length).toBe(0);
  });

  it('ignores a prior record built from different text', async () => {
    const prior = {
      key: 'k',
      projectId: 'p',
      artifactId: 'a1',
      contentHash: 'from-a-different-body',
      updatedAt: 1,
      qaPairs: [],
      sectionIds: [],
      sectionHeadings: [],
      sectionSnippets: [],
      sectionVectors: [new Float32Array([1, 0])],
      qaVectors: [],
      stages: { sectionsEmbedded: true, qaGenerated: true, qaEmbedded: true },
    } as never;

    await indexSingleArtifact('p', art, () => {}, undefined, prior);
    // A hash mismatch means the vectors are for another document: start over.
    expect(embedMock.mock.calls.length).toBeGreaterThan(0);
    expect(qaMock.mock.calls.length).toBeGreaterThan(0);
  });
});

describe('the embed route must not multiply metered calls', () => {
  it('chunks at the request cap, so one request is one embedContent call', () => {
    // embedContent calls are what the 1,000/day quota counts. Accepting 80
    // texts and then chunking them 50 + 30 makes TWO metered calls for content
    // that fits in one — which is how "send more per request" turned into
    // "spend more of the budget".
    const route = readFileSync('server/routes/searchIndex.ts', 'utf8');
    const max = /EMBED_MAX_PER_REQUEST\s*=\s*(\d+)/.exec(route);
    const chunk = /EMBED_BATCH_SIZE\s*=\s*([A-Z_0-9]+)/.exec(route);
    expect(max).not.toBeNull();
    expect(chunk).not.toBeNull();
    expect(chunk![1]).toBe('EMBED_MAX_PER_REQUEST');
    expect(Number(max![1])).toBeGreaterThanOrEqual(80);
  });

  it('client batches at the same cap as the route', () => {
    const client = readFileSync('src/application/artifactIndexer.ts', 'utf8');
    expect(client).toMatch(/EMBED_BATCH\s*=\s*80/);
  });
});
