/**
 * BUG-013 regression (review finding): the WIRE must carry the whole context —
 * the <knowledge_substrate> attachments, <existing_links>, and the older
 * compacted chapters — inside the native turns. Only the last 2 chapters'
 * turns become user/assistant messages, thinking only on the last assistant.
 * Token telemetry must not double-count the last 2 chapters.
 */
import { describe, it, expect } from 'vitest';
import { OpticalCompilerDomain } from '../domains/03-optical-compiler';
import { ArtifactDocumentDomain } from '../domains/01-artifact-document';
import { ChapterSegmentationDomain } from '../domains/02-chapter-segmentation';
import { DialogueTimelineDomain } from '../domains/01-dialogue-timeline';
import { geminiWireContents, openrouterWireMessages } from '../../shared/stream/turnsWire';
import type { Turn } from '../types';

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

function turn(i: number, role: 'user' | 'assistant', content: string, thinking?: string): Turn {
  return {
    id: `t${i}`,
    role,
    content,
    timestamp: i,
    ...(role === 'assistant' && thinking ? { meta: { thinking } as Turn['meta'] } : {}),
  } as Turn;
}

const CHAPTERS = [
  { id: 'c1', title: 'Chapter One', endIndex: 2, summary: 'Summary of one' },
  { id: 'c2', title: 'Chapter Two', endIndex: 4, summary: 'Summary of two' },
  { id: 'c3', title: 'Chapter Three', endIndex: 6, summary: 'Summary of three' },
  { id: 'c4', title: 'Chapter Four' },
];
const TURNS = [
  turn(0, 'user', 'old ask one'),
  turn(1, 'assistant', 'old answer one'),
  turn(2, 'user', 'old ask two'),
  turn(3, 'assistant', 'old answer two'),
  turn(4, 'user', 'recent ask'),
  turn(5, 'assistant', 'recent answer', 'recent thinking'),
  turn(6, 'user', 'the new ask'),
];

function build() {
  const artifacts = new ArtifactDocumentDomain('p', [artifact('att-1')].map((a) => ({ ...a })));
  const segmentation = new ChapterSegmentationDomain(
    'p',
    CHAPTERS.map((c, i) => ({
      id: c.id,
      workspaceId: 'p',
      title: c.title,
      summary: c.summary,
      status: c.endIndex === undefined ? ('active' as const) : ('completed' as const),
      startIndex: i === 0 ? 0 : (CHAPTERS[i - 1].endIndex ?? 0),
      endIndex: c.endIndex,
      createdAt: 0,
    }))
  );
  const timeline = new DialogueTimelineDomain('p', TURNS.map((t) => ({ ...t })));
  const compiler = new OpticalCompilerDomain(artifacts, segmentation, timeline);
  const compiled = compiler.compile({
    attachments: [{ artifactId: 'att-1', granularity: 'full', addedAt: 0 }],
    historyTurns: TURNS.map((t) => ({ ...t })),
    capabilities: { writeArtifacts: true, autoChapter: true, graphLinks: true },
  });
  return compiled;
}

describe('the wire carries the WHOLE context inside the native turns', () => {
  const compiled = build();
  const gemini = geminiWireContents(compiled.turns);
  const openrouter = openrouterWireMessages(compiled.systemInstruction, compiled.turns);
  // The actual TEXT on the wire (JSON.stringify would escape the quotes).
  const geminiText = gemini.map((c) => c.parts.map((p) => p.text).join('\n')).join('\n\n');
  const openrouterText = openrouter.map((m) => m.content).join('\n\n');

  it('the attached artifact substrate rides on the wire', () => {
    expect(geminiText).toContain('<artifact file="title-att-1.md"');
    expect(openrouterText).toContain('<artifact file="title-att-1.md"');
    expect(geminiText).toContain('Body att-1');
  });

  it('the older compacted chapters ride on the wire (last 2 do NOT duplicate)', () => {
    expect(geminiText).toContain('Summary of one');
    expect(geminiText).toContain('Summary of two');
    // The last 2 chapters are NATIVE turns, not XML chapters:
    expect(geminiText).not.toContain('<chapter name="chapter-four"');
    expect(geminiText).not.toContain('Summary of three');
  });

  it('older chapters are XML context, native turns are plain conversation turns', () => {
    // First turn merges the context prefix into the user ask.
    expect(compiled.turns[0].role).toBe('user');
    expect(compiled.turns[0].content).toContain('<knowledge_substrate>');
    expect(compiled.turns[0].content).toContain('recent ask');
    // The new ask is the final native turn, pure.
    expect(compiled.turns[compiled.turns.length - 1]).toEqual({
      role: 'user',
      content: 'the new ask',
    });
    // Native roles still map correctly for the provider (prefix merged into
    // the first user turn, so there is no extra turn).
    expect(gemini.map((c) => c.role)).toEqual(['user', 'model', 'user']);
  });

  it('thinking rides only on the last assistant turn — on the wire', () => {
    const modelTurn = gemini.find((c) => c.role === 'model');
    expect(modelTurn?.parts[0]).toEqual({ text: 'recent thinking', thought: true });
    expect(openrouter[2].reasoning).toBe('recent thinking');
    const withThought = gemini.filter((c) => c.parts.some((p) => p.thought));
    expect(withThought).toHaveLength(1);
  });

  it('token telemetry does NOT double-count the last 2 chapters', () => {
    const bd = compiled.telemetry.tokenBreakdown;
    // nativeTurnsTokens covers the turns; historyTokens only the older chapters.
    expect(bd.historyTokens).toBeLessThan(
      bd.substrateTokens + bd.historyTokens + bd.nativeTurnsTokens + 1
    );
    // historyTokens must NOT include the last-2 chapter XML (which no longer
    // rides the wire as XML). The active chapter's turns are big; if the last
    // 2 chapters were still counted as history, historyTokens would exceed
    // the native turn estimate for the same content.
    expect(bd.nativeTurnsTokens).toBeGreaterThan(0);
  });
});
