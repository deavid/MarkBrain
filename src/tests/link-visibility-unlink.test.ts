/**
 * DAVID'S SECOND TEST (2026-10-30): the model must SEE the links among the
 * notes it can see (full/summary granularity only — a title-cut note carries
 * no content to reason about), and must be able to BREAK links it can see
 * (<unlink>), with the same demux → gate → apply → receipt path as <link>.
 *
 * RED first, then the implementation turns it green.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { OpticalCompilerDomain } from '../domains/03-optical-compiler';
import { TopologicalGraphDomain } from '../domains/02-topological-graph/TopologicalGraphDomain';
import { StreamProtocolDomain } from '../domains/03-stream-protocol';
import type { UniversalArtifactDocument } from '../domains/01-artifact-document/types';

function makeArt(id: string, title: string): UniversalArtifactDocument {
  return {
    id,
    workspaceId: 'w1',
    code: id,
    title,
    type: 'document',
    category: 'note',
    isHighConcept: false,
    current: { subtitle: '', description: '', summary: '', body: `# ${title}` },
    tags: [],
    createdAt: 1,
    updatedAt: 1,
  } as unknown as UniversalArtifactDocument;
}

describe('compiler — the model SEES existing links among fully-visible notes', () => {
  it('lists edges between full/summary attachments, using payload file names', () => {
    const arts = new Map([
      ['a', makeArt('a', 'Alpha Doc')],
      ['b', makeArt('b', 'Beta Doc')],
      ['c', makeArt('c', 'Gamma Doc')],
    ]);
    const artifacts = {
      getArtifact: (id: string) => arts.get(id),
    } as never;
    const segmentation = { listChapters: () => [] } as never;
    const timeline = {} as never;
    const graph = new TopologicalGraphDomain();
    graph.addEdge('a', 'b', 'refines');
    graph.addEdge('b', 'c', 'relates_to'); // c is title-cut → must be hidden

    const compiler = new OpticalCompilerDomain(
      artifacts,
      segmentation,
      timeline,
      graph
    );
    const payload = compiler.compile({
      attachments: [
        { artifactId: 'a', granularity: 'full' },
        { artifactId: 'b', granularity: 'summary' },
        { artifactId: 'c', granularity: 'title' },
      ] as never,
      capabilities: { graphLinks: true, writeArtifacts: true, autoChapter: false },
    } as never);

    // The visible link (a—b, both full/summary) is listed by PAYLOAD name.
    const linksBlock = payload.compiledPrompt.match(/<existing_links>[\s\S]*?<\/existing_links>/)?.[0] ?? '';
    expect(linksBlock).toContain('alpha-doc.md');
    expect(linksBlock).toContain('beta-doc.md');
    expect(linksBlock).toContain('refines');
    // The link INTO a title-cut note is HIDDEN from the link list — the model
    // cannot reason about a note whose content it never sees. (The note's own
    // substrate stub still shows its name; only the LINK is filtered.)
    expect(linksBlock).not.toContain('gamma-doc.md');
  });

  it('graphLinks OFF: no link block at all', () => {
    const arts = new Map([['a', makeArt('a', 'Alpha Doc')]]);
    const compiler = new OpticalCompilerDomain(
      { getArtifact: (id: string) => arts.get(id) } as never,
      { listChapters: () => [] } as never,
      {} as never,
      new TopologicalGraphDomain()
    );
    const payload = compiler.compile({
      attachments: [{ artifactId: 'a', granularity: 'full' }] as never,
      capabilities: { graphLinks: false, writeArtifacts: true, autoChapter: false },
    } as never);
    expect(payload.compiledPrompt).not.toContain('existing_links');
  });
});

describe('demuxer — <unlink> parses and strips like <link>', () => {
  it('parses unlinks into demuxed.unlinks and strips them from clean prose', () => {
    const demuxed = new StreamProtocolDomain().demuxFullTurn(
      'Prose.\n\n<unlink source="a.md" target="b.md" />\n\nMore prose.\n\n' +
        '<link source="a.md" target="b.md" kind="refines" />'
    );
    expect(demuxed.unlinks).toEqual([{ source: 'a.md', target: 'b.md', kind: null }]);
    expect(demuxed.links).toHaveLength(1);
    expect(demuxed.cleanText.includes('<unlink')).toBe(false);
    expect(demuxed.cleanText.includes('More prose')).toBe(true);
  });
});
