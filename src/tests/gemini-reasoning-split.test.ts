/**
 * The Gemini reasoning split (David 2026-10-30): thought parts stream to the
 * UI as a live preview but NEVER enter the reply text.
 *
 * streamFromModel wraps the SDK stream in an async generator that splits
 * `{text}` / `{reasoning}` per chunk, and asks for LOW thinking effort with
 * thoughts included. All chunk shapes here mimic the real @google/genai
 * GenerateContentResponse wire (parts with thought:true).
 */
import { describe, it, expect, vi } from 'vitest';
import { streamFromModel } from '../../server/providers/gemini';
import type { LaneAiSurface, LaneTextChunk } from '../../server/providers/lane';

/** A raw SDK-shaped chunk (NOT a LaneTextChunk — the wrapper's job). */
function sdkChunk(parts: Array<{ text: string; thought?: boolean }>, usage?: unknown) {
  return {
    candidates: [{ content: { parts } }],
    ...(usage ? { usageMetadata: usage } : {}),
  };
}

function fakeSurface(stream: unknown[]): { surface: LaneAiSurface; streamSpy: ReturnType<typeof vi.fn> } {
  const streamSpy = vi.fn(async () =>
    (async function* () {
      for (const c of stream) yield c;
    })()
  );
  const surface = {
    models: {
      generateContent: async () => ({ text: '' }),
      generateContentStream: streamSpy,
    },
  } as unknown as LaneAiSurface;
  return { surface, streamSpy };
}

async function collect(stream: AsyncIterable<LaneTextChunk>): Promise<LaneTextChunk[]> {
  const out: LaneTextChunk[] = [];
  for await (const c of stream) out.push(c);
  return out;
}

describe('streamFromModel — the reasoning split (David 2026-10-30)', () => {
  it('asks for LOW thinking effort with thoughts included', async () => {
    const { surface, streamSpy } = fakeSurface([]);
    await streamFromModel(surface, 'gemini-3.8-flash', 'PROMPT', 'SYSTEM', 1);
    expect(streamSpy).toHaveBeenCalledTimes(1);
    const config = streamSpy.mock.calls[0][0].config;
    // ThinkingLevel is the SDK's enum — its wire value is "LOW" (low effort).
    expect(config.thinkingConfig).toEqual({ thinkingLevel: 'LOW', includeThoughts: true });
  });

  it('splits thought parts into reasoning and normal parts into text — one chunk may carry both', async () => {
    const { surface } = fakeSurface([
      sdkChunk([{ text: 'pondering the ask', thought: true }]),
      sdkChunk([{ text: 'Hello' }, { text: ' still pondering', thought: true }]),
      sdkChunk([{ text: ' world' }], { promptTokenCount: 3, candidatesTokenCount: 2, totalTokenCount: 5 }),
    ]);
    const stream = await streamFromModel(surface, 'gemini-3.8-flash', 'PROMPT', 'SYSTEM', 1);
    const chunks = await collect(stream as AsyncIterable<LaneTextChunk>);
    expect(chunks).toEqual([
      { reasoning: 'pondering the ask' },
      { text: 'Hello', reasoning: ' still pondering' },
      { text: ' world', usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2, totalTokenCount: 5 } },
    ]);
  });

  it('a chunk with neither text nor reasoning is not emitted as prose', async () => {
    const { surface } = fakeSurface([
      sdkChunk([{ text: 'only thinking', thought: true }]),
      sdkChunk([]),
      sdkChunk([{ text: 'answer' }]),
    ]);
    const stream = await streamFromModel(surface, 'gemini-3.8-flash', 'PROMPT', 'SYSTEM', 1);
    const chunks = await collect(stream as AsyncIterable<LaneTextChunk>);
    expect(chunks).toEqual([{ reasoning: 'only thinking' }, { text: 'answer' }]);
  });
});
