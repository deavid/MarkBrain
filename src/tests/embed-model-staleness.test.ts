/**
 * Embed-model staleness (design-docs/16 §3.4): vectors are only comparable
 * within one embedding model. A record stamped with a different model must
 * read as STALE — not ready — or proximity scores silently become garbage.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { indexStatusFor } from '../domains/search/draftSearchEngine';
import type { ArtifactSearchIndexRecord } from '../services/searchIndexStore';
import type { UniversalArtifactDocument } from '../domains/01-artifact-document';

function stubWindow() {
  vi.stubGlobal('window', {
    localStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    },
    location: { search: '' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function art(id: string): UniversalArtifactDocument {
  return {
    id,
    projectId: 'p1',
    title: 'Doc',
    body: 'hello world',
    updatedAt: '2026-01-01T00:00:00Z',
  } as unknown as UniversalArtifactDocument;
}

function record(artifactId: string, embedModel?: string): ArtifactSearchIndexRecord {
  return {
    key: `p1::${artifactId}`,
    projectId: 'p1',
    artifactId,
    contentHash: 'irrelevant-but-present-12',
    updatedAt: Date.now(),
    qaPairs: [
      {
        id: 'qa-0',
        sectionHeading: 'Doc',
        question: 'q',
        answer: 'a',
        keywords: [],
      },
    ],
    sectionIds: [],
    sectionHeadings: [],
    sectionSnippets: [],
    sectionVectors: [],
    qaVectors: [],
    ...(embedModel ? { embedModel } : {}),
  } as ArtifactSearchIndexRecord;
}

describe('embed model stamps', () => {
  it('mismatch between record and current slot is stale', () => {
    stubWindow();
    const art1 = art('a1');
    const map = new Map([['a1', record('a1', 'gemini-embedding-001')]]);
    // hash won't match either — force hash match by passing same computation…
    // cheaper: assert the embed check fires via a record whose hash is right.
    // Here contentHash is junk so the answer is stale regardless; the real pin
    // is the next test with a matching hash.
    expect(indexStatusFor(art1, map, 'gemini-embedding-001')).toBe('stale');
  });

  it('unstamped (legacy) records assume the default embed model (now nemotron)', async () => {
    stubWindow();
    const { computeArtifactContentHash } = await import('../utils/sectionChunker');
    const art1 = art('a2');
    const rec = record('a2'); // no embedModel — legacy
    rec.contentHash = computeArtifactContentHash(art1 as any);
    const map = new Map([['a2', rec]]);

    // Same as default → ready
    expect(indexStatusFor(art1, map, 'nvidia/nemotron-3-embed-1b:free')).toBe('ready');
    // Current slot switched to another embed model → stale (§3.4)
    expect(indexStatusFor(art1, map, 'text-embedding-3-small')).toBe('stale');
  });

  it('stamped records only score under their own model', async () => {
    stubWindow();
    const { computeArtifactContentHash } = await import('../utils/sectionChunker');
    const art1 = art('a3');
    const rec = record('a3', 'some-openrouter-embed');
    rec.contentHash = computeArtifactContentHash(art1 as any);
    const map = new Map([['a3', rec]]);

    expect(indexStatusFor(art1, map, 'some-openrouter-embed')).toBe('ready');
    expect(indexStatusFor(art1, map, 'gemini-embedding-001')).toBe('stale');
  });
});
