/**
 * Notes are sent to the model as FILES, not as rows.
 *
 * The bug this locks down, seen live: the payload carried the internal id
 * (`art-1792614286498-4845`), the model had no schema telling it what that was,
 * so it read the id as the note's name and wrote it into prose —
 * "…the sprawling procedural dream (art-1792614286498-4845, art-1792614209332-9472)".
 * A database key is not a handle. The filename is.
 */
import { describe, it, expect } from 'vitest';
import {
  OpticalCompilerDomain,
  artifactFileName,
  artifactXml,
  uniqueFileName,
} from '../domains/03-optical-compiler';
import { mapLimit, isIndexStale } from '../application/artifactIndexer';
import { computeArtifactContentHash } from '../utils/sectionChunker';
import { ArtifactDocumentDomain } from '../domains/01-artifact-document';
import { ChapterSegmentationDomain } from '../domains/02-chapter-segmentation';
import { DialogueTimelineDomain } from '../domains/01-dialogue-timeline';
import { StreamProtocolDomain } from '../domains/03-stream-protocol';
import type { UniversalArtifactDocument } from '../domains/01-artifact-document/types';
import type { ChatAttachment } from '../domains/06-chat-threads';

const art = (over: Partial<UniversalArtifactDocument> = {}): UniversalArtifactDocument =>
  ({
    id: 'art-1792614286498-4845',
    workspaceId: 'p',
    code: 'early-sprawling-dream',
    title: 'Early, sprawling sci-fi/4D procedural dream',
    type: 'document',
    category: 'note',
    isHighConcept: false,
    current: {
      subtitle: 'Non-Euclidean mazes and gradient descent AI.',
      description: 'The thesis.',
      summary: 'The digest.',
      body: 'The body.',
    },
    tags: [],
    createdAt: 0,
    updatedAt: 0,
    ...over,
  }) as UniversalArtifactDocument;

describe('artifactFileName', () => {
  it('names the note after its title, as a file', () => {
    expect(artifactFileName(art())).toBe('early-sprawling-sci-fi-4d-procedural-dream.md');
  });

  it('is a filename, never the database id', () => {
    const name = artifactFileName(art());
    expect(name).not.toContain('art-1792614286498-4845');
    expect(name).toMatch(/^[a-z0-9-]+\.md$/);
  });

  it('falls back to the code when the title slugifies to nothing', () => {
    expect(artifactFileName(art({ title: '!!!' }))).toBe('early-sprawling-dream.md');
    expect(artifactFileName(art({ title: '...' }))).toBe('early-sprawling-dream.md');
  });

  it('falls back to a plain name when title and code both slugify to nothing', () => {
    expect(artifactFileName(art({ title: '日本語', code: '（メモ）' }))).toBe('note.md');
  });

  it('clamps a long title without leaving a trailing dash', () => {
    const name = artifactFileName(art({ title: 'x'.repeat(80) }));
    expect(name.length).toBeLessThanOrEqual(64);
    expect(name).not.toMatch(/-\.md$/);
  });
});

describe('uniqueFileName', () => {
  it('leaves the first name alone and disambiguates the rest', () => {
    const used = new Set<string>();
    expect(uniqueFileName('notes.md', used)).toBe('notes.md');
    expect(uniqueFileName('notes.md', used)).toBe('notes-2.md');
    expect(uniqueFileName('notes.md', used)).toBe('notes-3.md');
    expect(used.size).toBe(3);
  });
});

describe('artifactXml', () => {
  it('carries a file attribute and no id at all', () => {
    const xml = artifactXml(art(), 'summary');
    expect(xml).toContain('file="early-sprawling-sci-fi-4d-procedural-dream.md"');
    expect(xml).toContain('granularity="summary"');
    expect(xml).not.toMatch(/\bid="/);
    expect(xml).not.toContain('art-1792614286498-4845');
  });

  it('keeps the title as the human-readable name beside the file', () => {
    const xml = artifactXml(art(), 'title');
    expect(xml).toContain(
      '<title>Early, sprawling sci-fi/4D procedural dream — Non-Euclidean mazes and gradient descent AI.</title>'
    );
  });

  it('honours an explicit name (the payload-level disambiguation)', () => {
    expect(artifactXml(art(), 'title', 'dream-2.md')).toContain('file="dream-2.md"');
  });
});

describe('the compiled payload', () => {
  const compile = (arts: UniversalArtifactDocument[]) => {
    const documents = new ArtifactDocumentDomain('p', arts);
    const segmentation = new ChapterSegmentationDomain('p', []);
    const timeline = new DialogueTimelineDomain('p', []);
    const compiler = new OpticalCompilerDomain(documents, segmentation, timeline);
    const attachments: ChatAttachment[] = arts.map((a) => ({
      artifactId: a.id,
      granularity: 'summary' as const,
      addedAt: 0,
    }));
    // Package 2: the <link> block is now capability-gated — this suite pins the
    // filename law, so it opts into graphLinks explicitly.
    return compiler.compile({ attachments, capabilities: { autoChapter: false, writeArtifacts: true, graphLinks: true } });
  };

  it('leaks no internal artifact id into what the model reads', () => {
    const out = compile([art(), art({ id: 'art-1792614209332-9472', title: 'Second dream' })]);
    expect(out.compiledPrompt).not.toMatch(/art-\d{10,}/);
    expect(out.compiledPrompt).toContain('file="early-sprawling-sci-fi-4d-procedural-dream.md"');
    expect(out.compiledPrompt).toContain('file="second-dream.md"');
  });

  it('gives two notes that share a title two distinct files', () => {
    const out = compile([art(), art({ id: 'art-2' })]);
    expect(out.compiledPrompt).toContain('file="early-sprawling-sci-fi-4d-procedural-dream.md"');
    expect(out.compiledPrompt).toContain('file="early-sprawling-sci-fi-4d-procedural-dream-2.md"');
    checkFileNamesAreUnique(out.compiledPrompt);
  });

  it('teaches the model to name notes by file, never by an id it never saw', () => {
    const out = compile([art()]);
    expect(out.systemInstruction).toContain('named by its `file`');
    expect(out.systemInstruction).toContain('<artifact_upsert file="kebab-case-slug.md"');
    expect(out.systemInstruction).not.toContain('source="id1"');
    expect(out.systemInstruction).toMatch(/<link source="file1\.md" target="file2\.md"/);
  });
});

const checkFileNamesAreUnique = (payload: string) => {
  const names = [...payload.matchAll(/file="([^"]+)"/g)].map((m) => m[1]);
  expect(new Set(names).size).toBe(names.length);
};

describe('the model can name a note back', () => {
  it('reads a file attribute as the note identity, extension and all', () => {
    const stream = new StreamProtocolDomain();
    const result = stream.demuxFullTurn(
      'Here it is.\n\n<artifact_upsert file="early-sprawling-dream.md" title="Early dream" type="document">\n<description>d</description>\n</artifact_upsert>'
    );
    expect(result.artifactUpserts).toHaveLength(1);
    expect(result.artifactUpserts[0].id).toBe('early-sprawling-dream');
    expect(result.artifactUpserts[0].title).toBe('Early dream');
  });

  it('still accepts the legacy id attribute, unchanged', () => {
    const stream = new StreamProtocolDomain();
    const result = stream.demuxFullTurn(
      '<artifact id="art-lens-spec" title="Optical Lens State Machine" type="architecture"><description>d</description></artifact>'
    );
    expect(result.artifactUpserts[0].id).toBe('art-lens-spec');
  });

  it('never leaves a stray .md in a note id', () => {
    const stream = new StreamProtocolDomain();
    const withDefaultTitle = stream.demuxFullTurn(
      '<artifact file="untitled-note.md">\n<description>d</description>\n</artifact>'
    );
    expect(withDefaultTitle.artifactUpserts[0].id).toBe('untitled-note');
    expect(withDefaultTitle.artifactUpserts[0].title).toBe('untitled-note');
  });
});
describe('chapters follow the same naming law (§21 follow-up)', () => {
  const compileOne = (title: string) => {
    const documents = new ArtifactDocumentDomain('p', []);
    const segmentation = new ChapterSegmentationDomain('p', [
      {
        id: 'chap-fx-1',
        workspaceId: 'p',
        title,
        status: 'active' as const,
        startIndex: 0,
        createdAt: 0,
        granularity: 'full' as const,
      },
    ]);
    const timeline = new DialogueTimelineDomain('p', [
      { id: 't0', role: 'user' as const, content: 'hello', timestamp: 0 },
    ]);
    return new OpticalCompilerDomain(documents, segmentation, timeline).compile({ attachments: [] });
  };

  it('names a chapter from its title and carries no row key', () => {
    const out = compileOne('Chapter 1: Fixture Genesis');
    expect(out.compiledPrompt).toContain('name="chapter-1-fixture-genesis"');
    expect(out.compiledPrompt).not.toMatch(/chap-\w|id="/);
    expect(out.compiledPrompt).not.toContain('chap-fx-1');
  });

  it('is what the model is told to call a chapter', () => {
    const out = compileOne('Anything');
    expect(out.systemInstruction).toContain('each chapter by its `name`');
    expect(out.systemInstruction).toContain('never quote something that looks like a database key');
  });

  it('indents layer bodies under their own tag instead of column zero', () => {
    const documents = new ArtifactDocumentDomain('p', []);
    const segmentation = new ChapterSegmentationDomain('p', []);
    const timeline = new DialogueTimelineDomain('p', []);
    const art = {
      id: 'a1',
      workspaceId: 'p',
      code: 'c',
      title: 'T',
      type: 'document' as const,
      category: 'note',
      isHighConcept: false,
      current: { subtitle: '', description: 'd', summary: 'line one\nline two', body: 'b' },
      tags: [],
      createdAt: 0,
      updatedAt: 0,
    } as never;
    void documents; void segmentation; void timeline;
    const direct = artifactXml(art as never, 'summary');
    const lines = direct.split('\n');
    const summaryIdx = lines.findIndex((l) => l.includes('<summary>'));
    expect(lines[summaryIdx + 1].startsWith('      ')).toBe(true);
    expect(lines[summaryIdx + 2].startsWith('      ')).toBe(true);
  });
});

describe('mapLimit — the indexer\'s parallelism cap', () => {
  it('preserves input order even when later items finish first', async () => {
    const delays = [30, 20, 10, 0];
    const out = await mapLimit(delays, 3, async (ms, i) => {
      await new Promise((r) => setTimeout(r, ms));
      return `r${i}`;
    });
    expect(out).toEqual(['r0', 'r1', 'r2', 'r3']);
  });

  it('never exceeds the cap on in-flight work', async () => {
    let inflight = 0;
    let peak = 0;
    await mapLimit([1, 2, 3, 4, 5, 6, 7, 8], 3, async () => {
      inflight += 1;
      peak = Math.max(peak, inflight);
      await new Promise((r) => setTimeout(r, 5));
      inflight -= 1;
    });
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1); // it really did overlap
  });

  it('stops starting new work once aborted', async () => {
    const signal = { aborted: false };
    const started: number[] = [];
    await expect(
      mapLimit(
        [1, 2, 3, 4, 5, 6],
        1,
        async (_n, i) => {
          started.push(i);
          if (i === 1) signal.aborted = true;
          return i;
        },
        signal
      )
    ).rejects.toThrow(/Indexing stopped/);
    expect(started.length).toBeLessThan(6);
  });
});

describe('regression: the indexing UI must never get stuck', () => {
  it('a failed task stops its siblings from STARTING new work', async () => {
    // mapLimit cannot cancel a call already in flight (no per-call abort in the
    // fetch layer), so its contract is: stop launching. The in-flight straggler
    // is handled separately — see indexer-stragglers.test.ts, which pins that a
    // late callback can no longer repaint the progress line.
    const started: number[] = [];
    await expect(
      mapLimit([1, 2, 3, 4, 5, 6], 1, async (n) => {
        started.push(n);
        if (n === 1) throw new Error('boom');
        return n;
      })
    ).rejects.toThrow(/boom/);
    expect(started).toEqual([1]);
  });

  it('a note with no Q&A pairs still counts as indexed', () => {
    // The bug: isIndexStale treated `qaPairs.length === 0` as stale, so a note
    // with no body (legitimately zero Q&A) could never count — "Indexed: 8/24"
    // was permanently short no matter how often you re-ran it.
    //
    // The rule is now stage-based: a note is fresh when its stages are ALL
    // complete, whether or not they produced any Q&A.
    const art = {
      id: 'a1',
      workspaceId: 'p',
      code: 'c',
      title: 'T',
      type: 'document',
      category: 'note',
      isHighConcept: false,
      current: { subtitle: '', description: '', summary: '', body: '' },
      tags: [],
      createdAt: 0,
      updatedAt: 0,
    } as never;
    const fresh = {
      artifactId: 'a1',
      contentHash: computeArtifactContentHash(art as never),
      qaPairs: [],
      sectionVectors: [new Float32Array([1])],
      qaVectors: [],
      stages: { sectionsEmbedded: true, qaGenerated: true, qaEmbedded: true },
    } as never;
    const map = new Map([['a1', fresh]]);
    expect(isIndexStale(map, 'p', art as never)).toBe(false);
  });

  it('a HALF-built record is stale to resume — not to restart', () => {
    // This is the quota bug. A note whose sections embedded but whose Q&A
    // never did used to look either fresh (stranded forever) or absent (repaid
    // the whole embed budget on every attempt). Now it is visibly incomplete,
    // and indexSingleArtifact resumes from it.
    const art = {
      id: 'a1', workspaceId: 'p', code: 'c', title: 'T', type: 'document',
      category: 'note', isHighConcept: false,
      current: { subtitle: '', description: '', summary: '', body: 'body' },
      tags: [], createdAt: 0, updatedAt: 0,
    } as never;
    const half = {
      artifactId: 'a1',
      contentHash: computeArtifactContentHash(art as never),
      qaPairs: [],
      sectionVectors: [new Float32Array([1])],
      qaVectors: [],
      stages: { sectionsEmbedded: true, qaGenerated: false, qaEmbedded: false },
    } as never;
    expect(isIndexStale(new Map([['a1', half]]), 'p', art as never)).toBe(true);
  });

  it('a note whose text moved IS stale again', () => {
    const art = {
      id: 'a1', workspaceId: 'p', code: 'c', title: 'T', type: 'document',
      category: 'note', isHighConcept: false,
      current: { subtitle: '', description: '', summary: '', body: 'body v1' },
      tags: [], createdAt: 0, updatedAt: 0,
    } as never;
    const map = new Map([['a1', { artifactId: 'a1', contentHash: 'stale-hash', qaPairs: [] }]]) as never;
    expect(isIndexStale(map, 'p', art as never)).toBe(true);
    expect(isIndexStale(new Map(), 'p', art as never)).toBe(true);
  });
});
