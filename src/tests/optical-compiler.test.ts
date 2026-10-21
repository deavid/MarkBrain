/**
 * Context compiler suite — the payload contract.
 *
 * What it locks down:
 *   1. Only ATTACHED artifacts reach the model (no distance, no radius, no pin).
 *   2. Granularity is a CUT: summary = title + description + summary, full adds
 *      the body / verbatim turns (Option A — the layers are read together).
 *   3. Chapters are always in, each at its own granularity (open → full,
 *      closed → summary unless the user chose otherwise).
 *   4. Break-down rows are single-sourced from the assembled XML, so the mirror
 *      cannot drift from the payload.
 */
import { describe, it, expect } from 'vitest';
import { OpticalCompilerDomain } from '../domains/03-optical-compiler';
import { ArtifactDocumentDomain } from '../domains/01-artifact-document';
import { ChapterSegmentationDomain } from '../domains/02-chapter-segmentation';
import { DialogueTimelineDomain } from '../domains/01-dialogue-timeline';
import type { ChatAttachment } from '../domains/06-chat-threads';
import type { Granularity } from '../domains/granularity';

function artifact(id: string) {
  return {
    id,
    workspaceId: 'p',
    code: id,
    title: `Title ${id}`,
    type: 'document' as const,
    category: 'note',
    isHighConcept: false,
    current: {
      description: `Description ${id}`,
      summary: `Summary ${id}`,
      body: `Body ${id}`,
    },
    tags: [],
    createdAt: 0,
    updatedAt: 0,
  };
}

function attach(id: string, granularity: Granularity): ChatAttachment {
  return { artifactId: id, granularity, addedAt: 0 };
}

function build(opts: {
  artifacts?: string[];
  chapters?: Array<{ id: string; title: string; granularity?: Granularity; summary?: string; description?: string; endIndex?: number }>;
  turns?: string[];
}) {
  const artifacts = new ArtifactDocumentDomain('p', (opts.artifacts ?? []).map(artifact));
  const segmentation = new ChapterSegmentationDomain(
    'p',
    (opts.chapters ?? []).map((c, i) => ({
      id: c.id,
      workspaceId: 'p',
      title: c.title,
      description: c.description,
      summary: c.summary,
      granularity: c.granularity,
      status: c.endIndex === undefined ? ('active' as const) : ('completed' as const),
      startIndex: i,
      endIndex: c.endIndex,
      createdAt: 0,
    }))
  );
  const timeline = new DialogueTimelineDomain(
    'p',
    (opts.turns ?? []).map((content, i) => ({
      id: `t${i}`,
      role: 'user' as const,
      content,
      timestamp: 0,
    }))
  );
  const compiler = new OpticalCompilerDomain(artifacts, segmentation, timeline);
  return { compiler, artifacts, segmentation, timeline };
}

describe('context compiler — attachments', () => {
  it('sends NOTHING from the library when the chat attached nothing', () => {
    const { compiler } = build({ artifacts: ['a', 'b'], chapters: [{ id: 'c1', title: 'One' }] });
    const out = compiler.compile({ attachments: [] });
    expect(out.compiledPrompt).not.toContain('Title a');
    expect(out.compiledPrompt).not.toContain('Title b');
    expect(out.telemetry.attachmentBreakdown).toHaveLength(0);
    expect(out.telemetry.tokenBreakdown.substrateTokens).toBe(0);
  });

  it('a dangling attachment (artifact deleted) is skipped, never re-invented', () => {
    const { compiler } = build({ artifacts: ['a'] });
    const out = compiler.compile({ attachments: [attach('gone', 'full'), attach('a', 'title')] });
    expect(out.telemetry.attachmentBreakdown.map((e) => e.artifactId)).toEqual(['a']);
  });

  it('title / description / summary / full are cumulative cuts (Option A)', () => {
    const { compiler } = build({ artifacts: ['a'] });

    const title = compiler.compile({ attachments: [attach('a', 'title')] }).compiledPrompt;
    expect(title).toContain('<title>Title a</title>');
    expect(title).not.toContain('Description a');
    expect(title).not.toContain('Summary a');
    expect(title).not.toContain('Body a');

    const description = compiler.compile({ attachments: [attach('a', 'description')] }).compiledPrompt;
    expect(description).toContain('Description a');
    expect(description).not.toContain('Summary a');
    expect(description).not.toContain('Body a');

    const summary = compiler.compile({ attachments: [attach('a', 'summary')] }).compiledPrompt;
    expect(summary).toContain('Description a');
    expect(summary).toContain('Summary a');
    expect(summary).not.toContain('Body a');

    const full = compiler.compile({ attachments: [attach('a', 'full')] }).compiledPrompt;
    expect(full).toContain('Description a');
    expect(full).toContain('Summary a');
    expect(full).toContain('Body a');
  });

  it('token costs grow monotonically along the cut, and rows sum to the subtotal', () => {
    const { compiler } = build({ artifacts: ['a'] });
    const costs = (['title', 'description', 'summary', 'full'] as Granularity[]).map(
      (g) => compiler.compile({ attachments: [attach('a', g)] }).telemetry.tokenBreakdown.substrateTokens
    );
    expect(costs[0]).toBeLessThan(costs[1]);
    expect(costs[1]).toBeLessThan(costs[2]);
    expect(costs[2]).toBeLessThan(costs[3]);

    const out = compiler.compile({ attachments: [attach('a', 'summary')] });
    const sum = out.telemetry.attachmentBreakdown.reduce((n, e) => n + e.tokens, 0);
    expect(sum).toBe(out.telemetry.tokenBreakdown.substrateTokens);
  });
});

describe('context compiler — chapters', () => {
  it('closed chapters default to summary; the open one defaults to full', () => {
    const { compiler } = build({
      chapters: [
        { id: 'c1', title: 'Old', summary: 'Recap one', endIndex: 1 },
        { id: 'c2', title: 'Open' },
      ],
      turns: ['old turn', 'hello open'],
    });
    const out = compiler.compile({ attachments: [] });
    expect(out.telemetry.chapterBreakdown.map((c) => [c.chapterId, c.granularity])).toEqual([
      ['c1', 'summary'],
      ['c2', 'full'],
    ]);
    expect(out.compiledPrompt).toContain('Recap one');
    expect(out.compiledPrompt).toContain('hello open');
  });

  it('honors an explicit chapter granularity — including title-only and full+summary', () => {
    const { compiler } = build({
      chapters: [
        { id: 'c1', title: 'Whisper', granularity: 'title', summary: 'SHOULD NOT APPEAR' },
        { id: 'c2', title: 'Loud', granularity: 'summary', summary: 'SHOULD APPEAR', endIndex: 1 },
      ],
    });
    const out = compiler.compile({ attachments: [] });
    expect(out.compiledPrompt).toContain('Whisper');
    expect(out.compiledPrompt).not.toContain('SHOULD NOT APPEAR');
    expect(out.compiledPrompt).toContain('SHOULD APPEAR');
  });

  it('at full, chapter layers are sent with the verbatim turns (cumulative cut)', () => {
    const { compiler } = build({
      chapters: [{ id: 'c1', title: 'Open', description: 'about things', summary: 'the recap' }],
      turns: ['verbatim turn'],
    });
    const out = compiler.compile({ attachments: [] });
    expect(out.compiledPrompt).toContain('about things');
    expect(out.compiledPrompt).toContain('the recap');
    expect(out.compiledPrompt).toContain('verbatim turn');
  });

  it('sealing a chapter steps full → summary but keeps a manual choice', () => {
    const { segmentation } = build({ chapters: [{ id: 'g', title: 'Genesis' }] });
    segmentation.setGranularity('g', 'description');
    segmentation.declareNewChapter('Next', 1);
    expect(segmentation.getChapter('g')!.granularity).toBe('description');
    expect(segmentation.getChapter('g')!.status).toBe('completed');

    const second = build({ chapters: [{ id: 'g', title: 'Genesis' }] });
    second.segmentation.declareNewChapter('Next', 1);
    expect(second.segmentation.getChapter('g')!.granularity).toBe('summary');
  });

  it('a new chapter starts at full with the subtitle and description the model emitted', () => {
    const { segmentation } = build({ chapters: [] });
    const chap = segmentation.declareNewChapter('Shifted', 0, 'the hook', 'what it is about');
    expect(chap.granularity).toBe('full');
    expect(chap.subtitle).toBe('the hook');
    expect(chap.description).toBe('what it is about');
  });
});

describe('context compiler — isolation and telemetry', () => {
  it('two chats attaching the same artifact at different granularities compile independently', () => {
    const { compiler } = build({ artifacts: ['a'] });
    const chatA = compiler.compile({ attachments: [attach('a', 'title')] }).compiledPrompt;
    const chatB = compiler.compile({ attachments: [attach('a', 'full')] }).compiledPrompt;
    expect(chatA).not.toContain('Body a');
    expect(chatB).toContain('Body a');
  });

  it('breakdown rows are the assembled XML and sum to their subtotals', () => {
    const { compiler } = build({
      artifacts: ['a', 'b'],
      chapters: [
        { id: 'c1', title: 'One', endIndex: 1 },
        { id: 'c2', title: 'Two' },
      ],
    });
    const out = compiler.compile({ attachments: [attach('a', 'summary'), attach('b', 'full')] });
    const substrate = out.telemetry.attachmentBreakdown.reduce((n, e) => n + e.tokens, 0);
    const history = out.telemetry.chapterBreakdown.reduce((n, e) => n + e.tokens, 0);
    expect(substrate).toBe(out.telemetry.tokenBreakdown.substrateTokens);
    expect(history).toBe(out.telemetry.tokenBreakdown.historyTokens);
    expect(out.telemetry.granularityDistribution).toMatchObject({
      summary: 2, // artifact a at summary + chapter c1 (closed) at summary
      full: 2, // artifact b + the open chapter c2
    });
  });

  it('historyTurns/historyChapters override the live domains (background threads)', () => {
    const { compiler } = build({
      chapters: [{ id: 'live', title: 'LIVE' }],
      turns: ['VISIBLE-THREAD-CONTENT'],
    });
    const bg = compiler.compile({
      attachments: [],
      historyTurns: [{ id: 'bg', role: 'user', content: 'BACKGROUND-THREAD-CONTENT', timestamp: 0 }],
      historyChapters: [
        {
          id: 'bg-chapter',
          workspaceId: 'p',
          title: 'BG',
          status: 'active',
          startIndex: 0,
          createdAt: 0,
          granularity: 'full',
        },
      ],
    });
    expect(bg.compiledPrompt).toContain('BACKGROUND-THREAD-CONTENT');
    expect(bg.compiledPrompt).not.toContain('VISIBLE-THREAD-CONTENT');
    expect(bg.compiledPrompt).toContain('bg-chapter');
    expect(bg.compiledPrompt).not.toContain('live');
  });
});
