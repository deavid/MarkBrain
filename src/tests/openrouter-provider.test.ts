/**
 * OpenRouter provider + facade branching (design-docs/24 §4–§5).
 *
 * ALL fetch calls are stubbed — zero external calls (design 24 §0 hygiene law).
 * Pins:
 * - OpenAI-compatible wire: POST /api/v1/chat/completions, Bearer key,
 *   stream:true SSE parsing → `{text}` chunks; non-stream → `{text}`.
 * - The facade: `/`-shaped model ids → OpenRouter client, everything else →
 *   GoogleGenAI, both behind the identical call surface.
 * - Gemini-only lanes (embed/tts) refuse OpenRouter ids — errors are final.
 * - Legacy `openrouter` slot reads as openrouter-free.
 */
import { describe, it, expect, vi, afterAll, beforeEach } from 'vitest';
import { initDb, closeDbForTests, getDb } from '../../server/db';

initDb(':memory:');

import { OpenRouterClient, parseOpenAiSseData, isOpenRouterModel } from '../../server/providers/openrouter';
import {
  aiForRequest,
  aiClientForUser,
  geminiAiForRequest,
  resolveServerLaneKey,
  unlockVaultWithPassword,
  writeKeysPayload,
  clearUnlockedVaultKeysForTests,
} from '../../server/lib/accountVault';
import { createUser } from '../../server/lib/users';

const OR_KEY = 'sk-or-TESTKEY0000000000000000000000000';
const GEM_KEY = 'AIzaTESTKEY000000000000000000000000000';

const { GoogleGenAI } = await import('@google/genai');

/* ── fetch stubs (no network) ─────────────────────────────────────────────── */

interface CapturedRequest {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  signal: AbortSignal | null | undefined;
}

const captured: CapturedRequest[] = [];

function stubFetch(responder: () => Response): void {
  captured.length = 0;
  vi.stubGlobal('fetch', async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    } catch {
      /* not json */
    }
    captured.push({ url, headers, body, signal: init?.signal ?? null });
    return responder();
  });
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
}

function sseResponse(lines: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(line));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

afterAll(() => {
  vi.unstubAllGlobals();
  closeDbForTests();
});

beforeEach(() => {
  vi.unstubAllGlobals();
});

/* ── wire shape ───────────────────────────────────────────────────────────── */

describe('OpenRouterClient wire shape (fetch-stubbed)', () => {
  it('generateContent posts OpenAI-compatible JSON with the Bearer key and answers {text}', async () => {
    stubFetch(() =>
      jsonResponse({
        choices: [{ message: { content: 'Hello from OpenRouter.' } }],
        usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
      })
    );
    const client = new OpenRouterClient(OR_KEY);
    const res = await client.models.generateContent({
      model: 'nvidia/nemotron-3.5-lightning:free',
      contents: 'Say hi.',
      config: { systemInstruction: 'Be brief.', temperature: 0.7 },
    });

    expect(captured).toHaveLength(1);
    expect(captured[0].url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(captured[0].headers.Authorization).toBe(`Bearer ${OR_KEY}`);
    expect(captured[0].body.stream).toBe(false);
    expect(captured[0].body.model).toBe('nvidia/nemotron-3.5-lightning:free');
    // systemInstruction rides as a system message; the ask is the user message.
    expect(captured[0].body.messages).toEqual([
      { role: 'system', content: 'Be brief.' },
      { role: 'user', content: 'Say hi.' },
    ]);
    // Provider-neutral vocabulary — wire names never leave the adapter.
    expect(res.text).toBe('Hello from OpenRouter.');
    expect(res.usageMetadata).toEqual({
      promptTokenCount: 11,
      candidatesTokenCount: 7,
      totalTokenCount: 18,
    });
  });

  it('generateContentStream parses SSE data lines into {text} chunks in order', async () => {
    stubFetch(() =>
      sseResponse([
        'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
        ': keepalive comment\n',
        'data: {"choices":[{"delta":{"content":"lo "}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"world"}}],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}\n\n',
        'data: [DONE]\n\n',
      ])
    );
    const client = new OpenRouterClient(OR_KEY);
    const stream = await client.models.generateContentStream({
      model: 'nvidia/nemotron-3.5-lightning:free',
      contents: 'Say hi.',
    });

    const chunks: string[] = [];
    let usage: unknown;
    for await (const chunk of stream) {
      if (chunk.text) chunks.push(chunk.text);
      if (chunk.usageMetadata) usage = chunk.usageMetadata;
    }
    expect(chunks.join('')).toBe('Hello world');
    expect(usage).toEqual({ promptTokenCount: 3, candidatesTokenCount: 2, totalTokenCount: 5 });
    expect(captured[0].body.stream).toBe(true);
  });

  it('an upstream failure is the real error — no swap, no fallback', async () => {
    stubFetch(() => new Response('{"error":{"message":"bad key"}}', { status: 401 }));
    const client = new OpenRouterClient(OR_KEY);
    await expect(
      client.models.generateContent({ model: 'nvidia/nemotron-3.5-lightning:free', contents: 'hi' })
    ).rejects.toThrow(/OpenRouter nvidia\/nemotron-3.5-lightning:free: 401/);
  });

  it('honors config.abortSignal (AbortController flows to fetch)', async () => {
    stubFetch(() => jsonResponse({ choices: [{ message: { content: 'x' } }] }));
    const client = new OpenRouterClient(OR_KEY);
    const controller = new AbortController();
    await client.models.generateContent({
      model: 'z-ai/glm-5.3-flash',
      contents: 'hi',
      config: { abortSignal: controller.signal },
    });
    expect(captured[0].signal).toBe(controller.signal);
  });

  it('SSE parsing skips keepalives and junk without killing the stream', () => {
    expect(parseOpenAiSseData('')).toBeNull();
    expect(parseOpenAiSseData('[DONE]')).toBeNull();
    expect(parseOpenAiSseData('not-json{')).toBeNull();
    expect(parseOpenAiSseData('{"choices":[{"delta":{}}]}')).toBeNull(); // no content → no chunk
    expect(parseOpenAiSseData('{"choices":[{"delta":{"content":"ok"}}]}')).toEqual({ text: 'ok' });
  });

  it('isOpenRouterModel: slash-shaped ids only', () => {
    expect(isOpenRouterModel('nvidia/nemotron-3.5-lightning:free')).toBe(true);
    expect(isOpenRouterModel('openai/gpt-5')).toBe(true);
    expect(isOpenRouterModel('gemini-3.8-flash')).toBe(false);
    expect(isOpenRouterModel('gemini-embedding-001')).toBe(false);
  });

  it('reasoning rides the delta: reasoning-only, text+reasoning, reasoning_content fallback', () => {
    // Reasoning-only delta — this is the model THINKING, not keepalive noise.
    expect(
      parseOpenAiSseData('{"choices":[{"delta":{"reasoning":"let me think"}}]}')
    ).toEqual({ reasoning: 'let me think' });
    // Text + reasoning on the same delta — both ride.
    expect(
      parseOpenAiSseData('{"choices":[{"delta":{"content":"Hi","reasoning":"why"}}]}')
    ).toEqual({ text: 'Hi', reasoning: 'why' });
    // Some models use reasoning_content instead of reasoning.
    expect(
      parseOpenAiSseData('{"choices":[{"delta":{"reasoning_content":"deep thought"}}]}')
    ).toEqual({ reasoning: 'deep thought' });
  });

  it('the chat body asks for low thinking effort (David 2026-10-30)', async () => {
    stubFetch(() =>
      sseResponse(['data: {"choices":[{"delta":{"content":"x"}}]}', 'data: [DONE]'])
    );
    const client = new OpenRouterClient(OR_KEY);
    await client.models.generateContentStream({
      model: 'nvidia/nemotron-3.5-lightning:free',
      contents: 'Say hi.',
      config: { systemInstruction: 'Be brief.', temperature: 0.7 },
    });
    expect(captured[0].body.reasoning).toEqual({ effort: 'low' });
  });
});

/* ── facade branching ─────────────────────────────────────────────────────── */

describe('aiForRequest facade branching (design 24 §4)', () => {
  let userId = 0;

  beforeEach(() => {
    if (userId === 0) {
      const user = createUser('facade@example.com', 'facade-pass-123456', { isOwner: true });
      userId = user.id;
    }
    unlockVaultWithPassword(userId, 'facade-pass-123456');
    writeKeysPayload(userId, { 'openrouter-free': OR_KEY, 'gemini-free': GEM_KEY });
  });

  function fakeReq(): Parameters<typeof aiForRequest>[0] {
    return { user: { id: userId, email: 'facade@example.com', isOwner: true, vaultUnlocked: true } } as never;
  }

  it('a `/`-shaped model id returns the OpenRouter client', () => {
    const ai = aiForRequest(fakeReq(), 'chat', 'nvidia/nemotron-3.5-lightning:free');
    expect(ai).toBeInstanceOf(OpenRouterClient);
    expect(ai).not.toBeInstanceOf(GoogleGenAI);
  });

  it('every other model id returns the GoogleGenAI client', () => {
    const ai = aiForRequest(fakeReq(), 'chat', 'gemini-3.8-flash');
    expect(ai).toBeInstanceOf(GoogleGenAI);
    expect(ai).not.toBeInstanceOf(OpenRouterClient);
  });

  it('aiClientForUser branches the same way (job-runner path, no Request)', () => {
    expect(aiClientForUser(userId, 'chat', 'z-ai/glm-5.3-flash')).toBeInstanceOf(OpenRouterClient);
    expect(aiClientForUser(userId, 'title', 'gemini-3.5-flash-lite')).toBeInstanceOf(GoogleGenAI);
  });

  it('the facade signs with the tier-resolved OpenRouter key', () => {
    getDb()
      .prepare(
        `INSERT INTO user_settings (user_id, model_slots_json, chat_tier, updated_at) VALUES (?, '{}', 'paid', ?)
         ON CONFLICT(user_id) DO UPDATE SET chat_tier = excluded.chat_tier`
      )
      .run(userId, Date.now());
    // paid tier, only the free slot filled → falls back to the free key
    expect(resolveServerLaneKey(userId, 'chat', 'nvidia/nemotron-3.5-lightning:free')).toBe(OR_KEY);
  });

  it('locked vault → 428 VaultLockedError before any key resolution', () => {
    clearUnlockedVaultKeysForTests();
    expect(() => aiClientForUser(userId, 'chat', 'nvidia/nemotron-3.5-lightning:free')).toThrow(
      /locked after a server restart/
    );
    unlockVaultWithPassword(userId, 'facade-pass-123456');
  });

  it('Gemini-only lanes refuse OpenRouter ids — errors are final', () => {
    expect(() => geminiAiForRequest(fakeReq(), 'tts', 'nvidia/nemotron-3.5-lightning:free')).toThrow(
      /not available for tts/
    );
    expect(() => geminiAiForRequest(fakeReq(), 'embed', 'z-ai/glm-5.3-flash')).toThrow(/not available for embed/);
  });
});