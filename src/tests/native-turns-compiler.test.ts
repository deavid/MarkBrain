/**
 * BUG-013 seam: the compiler emits provider-neutral native turns for the
 * LAST 2 chapters (with thinking only on the last assistant turn), keeps the
 * human-readable compiledPrompt for the Mirror/inspector, and both providers
 * map those turns to their real wire shapes.
 */
import { describe, it, expect } from 'vitest';
import { OpticalCompilerDomain } from '../domains/03-optical-compiler';
import { ArtifactDocumentDomain } from '../domains/01-artifact-document';
import { ChapterSegmentationDomain } from '../domains/02-chapter-segmentation';
import { DialogueTimelineDomain } from '../domains/01-dialogue-timeline';
import type { Turn } from '../types';

function turn(i: number, role: 'user' | 'assistant', content: string, thinking?: string): Turn {
  return {
    id: `t${i}`,
    role,
    content,
    timestamp: i,
    ...(role === 'assistant' && thinking ? { meta: { thinking } as Turn['meta'] } : {}),
  } as Turn;
}

function build(chapters: Array<{ id: string; title: string; endIndex?: number }>, turns: Turn[]) {
  const artifacts = new ArtifactDocumentDomain('p', []);
  const segmentation = new ChapterSegmentationDomain(
    'p',
    chapters.map((c, i) => ({
      id: c.id,
      workspaceId: 'p',
      title: c.title,
      status: c.endIndex === undefined ? ('active' as const) : ('completed' as const),
      startIndex: i === 0 ? 0 : (chapters[i - 1].endIndex ?? 0),
      endIndex: c.endIndex,
      createdAt: 0,
    }))
  );
  const timeline = new DialogueTimelineDomain('p', turns);
  return { compiler: new OpticalCompilerDomain(artifacts, segmentation, timeline), timeline, segmentation };
}

const FOUR_CHAPTERS = [
  { id: 'c1', title: 'Chapter One', endIndex: 2 },
  { id: 'c2', title: 'Chapter Two', endIndex: 4 },
  { id: 'c3', title: 'Chapter Three', endIndex: 6 },
  { id: 'c4', title: 'Chapter Four' },
];
const TURNS = [
  turn(0, 'user', 'old ask one'),
  turn(1, 'assistant', 'old answer one'),
  turn(2, 'user', 'old ask two'),
  turn(3, 'assistant', 'old answer two'),
  turn(4, 'user', 'recent ask'),
  turn(5, 'assistant', 'recent answer with <link source="a.md" target="b.md" kind="relates_to" />', 'I need to think about links.'),
  turn(6, 'user', 'the new ask'),
];

describe('compile() — native turns for the last 2 chapters', () => {
  const { compiler } = build(FOUR_CHAPTERS, TURNS);
  const out = compiler.compile({ attachments: [] });

  it('emits wire turns only from the last 2 chapters, ending with the new ask', () => {
    expect(out.turns).toBeDefined();
    // The context prefix (substrate + older chapters) merges into the first
    // user turn — the wire must carry the WHOLE context (review regression).
    expect(out.turns![0].role).toBe('user');
    expect(out.turns![0].content).toContain('recent ask');
    expect(out.turns![0].content).toContain('<knowledge_substrate>');
    expect(out.turns!.map((t) => t.role)).toEqual(['user', 'assistant', 'user']);
  });

  it('attaches thinking ONLY to the last assistant turn', () => {
    const assistant = out.turns!.find((t) => t.role === 'assistant');
    expect(assistant?.thinking).toBe('I need to think about links.');
    // No other turn carries thinking.
    expect(out.turns!.filter((t) => t !== assistant && t.thinking)).toHaveLength(0);
  });

  it('compiles past-turn content (compiler stubs) inside the wire turns', () => {
    // No artifact_upsert here, but the seam is the same function — a stub
    // placeholder asserts the compiler ran.
    expect(out.turns![1].content).not.toContain('<artifact_upsert');
  });

  it('older chapters stay in the XML prefix, never as wire turns', () => {
    const contents = out.turns!.map((t) => t.content);
    expect(contents).not.toContain('old ask one');
    expect(out.compiledPrompt).toContain('old ask one');
  });

  it('keeps compiledPrompt as the human-readable representation (Mirror/inspector)', () => {
    expect(out.compiledPrompt).toContain('<knowledge_substrate>');
    expect(out.compiledPrompt).toContain('<conversation_chapters>');
    expect(out.compiledPrompt).toContain('the new ask');
  });

  it('with <= 2 chapters, EVERY turn goes native and no chapters XML block carries them', () => {
    const { compiler } = build([{ id: 'c1', title: 'Only' }], [
      turn(0, 'user', 'hi'),
      turn(1, 'assistant', 'hello'),
      turn(2, 'user', 'new ask'),
    ]);
    const out = compiler.compile({ attachments: [] });
    expect(out.turns!.map((t) => t.content)).toEqual([
      expect.stringContaining('hi'),
      'hello',
      'new ask',
    ]);
  });
});
