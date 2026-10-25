/**
 * A failed request must never render as a model reply.
 *
 * The bug this pins (David, 2026-10-25): a wrong BYOK key → Gemini 401 →
 * the adapter swallowed it into status{state:'error'} inside an HTTP-200 SSE
 * → executeStreamingTurn found no 'complete' event and returned an empty
 * SUCCESS → the queue wrote "No reply came back. Try again." with model name
 * and token counts, i.e. the UI said the LLM had replied with an error note.
 *
 * Contract:
 *  1. status{state:'error'} → executeStreamingTurn REJECTS with the real reason
 *  2. an 'error' event → REJECTS (it used to be swallowed by the frame catch)
 *  3. a stream that just ends with no text → REJECTS (never an empty success)
 *  4. happy path still resolves (no regression)
 *  5. sendQueue keeps no impersonation copy ("No reply came back", "reasoning
 *     engine") — source-level, because that string WAS the bug report
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const { chatStreamMock } = vi.hoisted(() => ({ chatStreamMock: vi.fn() }));
vi.mock('../gateway/api', () => ({ chatStream: chatStreamMock }));

import { StreamProtocolDomain } from '../domains/03-stream-protocol';

const frame = (event: string, data: unknown): string =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

const sse = (frames: string[]): Response =>
  new Response(frames.join(''), {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });

const turn = () => new StreamProtocolDomain().executeStreamingTurn({ model: 'gemini-3.5-flash-lite' });

describe('stream failures propagate — never an empty success', () => {
  beforeEach(() => chatStreamMock.mockReset());

  it('rejects with the provider reason when status carries state=error (the 401 case)', async () => {
    chatStreamMock.mockResolvedValue(
      sse([
        frame('status', { state: 'connecting', message: 'Connecting…', timestamp: 1, model: 'gemini-3.5-flash-lite' }),
        frame('status', {
          state: 'error',
          message: 'Gemini: API key not valid. Please pass a valid API key.',
          timestamp: 2,
          model: 'gemini-3.5-flash-lite',
        }),
      ])
    );
    await expect(turn()).rejects.toThrow(/API key not valid/);
  });

  it('rejects on an explicit error event — the frame handler must not swallow it', async () => {
    chatStreamMock.mockResolvedValue(
      sse([frame('error', { error: 'provider exploded' })])
    );
    await expect(turn()).rejects.toThrow('provider exploded');
  });

  it('rejects when the stream ends with no text and no complete event', async () => {
    chatStreamMock.mockResolvedValue(
      sse([frame('status', { state: 'connecting', message: 'Connecting…', timestamp: 1, model: 'm' })])
    );
    await expect(turn()).rejects.toThrow(/ended without a reply/);
  });

  it('rejects on a completely empty body', async () => {
    chatStreamMock.mockResolvedValue(sse([]));
    await expect(turn()).rejects.toThrow(/ended without a reply/);
  });

  it('still resolves the happy path: chunk + complete → cleanReply', async () => {
    chatStreamMock.mockResolvedValue(
      sse([
        frame('chunk', { delta: 'Hello back' }),
        frame('complete', {
          rawReply: 'Hello back',
          telemetry: {
            model: 'gemini-3.5-flash-lite',
            inputTokens: 10,
            outputTokens: 3,
            totalTokens: 13,
            latencyMs: 5,
            timeToFirstChunkMs: 2,
            isFallback: false,
          },
        }),
        frame('done', { success: true }),
      ])
    );
    const result = await turn();
    expect(result.cleanReply).toContain('Hello back');
  });

  it('rejects even when partial text arrived before the error status — partial is not success', async () => {
    chatStreamMock.mockResolvedValue(
      sse([
        frame('chunk', { delta: 'partial words' }),
        frame('status', { state: 'error', message: 'Gemini: 429 quota exceeded', timestamp: 2, model: 'm' }),
      ])
    );
    await expect(turn()).rejects.toThrow(/429 quota exceeded/);
  });
});

describe('sendQueue carries no impersonation copy', () => {
  const src = readFileSync(join(process.cwd(), 'src/application/sendQueue.ts'), 'utf8');

  it('no longer contains the ghost reply the model never said', () => {
    expect(src).not.toContain('No reply came back. Try again.');
  });

  it('no longer contains the AI-speak failure line', () => {
    expect(src).not.toContain('reasoning engine');
  });

  it('records a failed turn with streamState error and lastOutcome error', () => {
    expect(src).toContain("streamState: 'error' as const");
    expect(src).toContain("lastOutcome: failedEmpty ? 'error'");
  });
});