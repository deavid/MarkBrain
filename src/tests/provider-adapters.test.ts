/**
 * Provider adapters + routing (design-docs/16 Phase 1).
 * Pins the request shapes that go on the wire — auth header style (never
 * `?key=` in URLs), endpoints, and the direct-or-proxy routing contract —
 * against a mocked fetch. No network in these tests, ever.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { geminiAdapter } from '../gateway/providers/gemini';
import { openrouterAdapter } from '../gateway/providers/openrouter';

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('window', {
    localStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    },
    location: { search: '' },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function okJson(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('gemini adapter request shapes', () => {
  it('generate: POSTs generateContent with the key in x-goog-api-key, never in the URL', async () => {
    fetchMock.mockResolvedValue(okJson({ candidates: [{ content: { parts: [{ text: 'hi' }] } }] }));
    const res = await geminiAdapter.generate({
      apiKey: 'AIza-test',
      model: 'gemini-3.8-flash',
      prompt: 'say hi',
      temperature: 0.4,
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/models/gemini-3.8-flash:generateContent');
    expect(String(url)).not.toContain('AIza-test');
    expect(String(url)).not.toContain('key=');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('AIza-test');
    const body = await res.json();
    expect(body.text).toBe('hi');
  });

  it('embed: batchEmbedContents one request per batch + LAW 6 unit-length output', async () => {
    fetchMock.mockResolvedValue(
      okJson({
        embeddings: [{ values: [3, 4] }, { values: [0, 2] }],
      })
    );
    const res = await geminiAdapter.embed({
      apiKey: 'AIza-test',
      model: 'gemini-embedding-001',
      texts: ['a', 'b'],
      taskType: 'RETRIEVAL_DOCUMENT',
      title: 'Doc',
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain(':batchEmbedContents');
    const sent = JSON.parse(init.body as string);
    expect(sent.requests).toHaveLength(2);
    expect(sent.requests[0].taskType).toBe('RETRIEVAL_DOCUMENT');
    const body = await res.json();
    const norms = body.embeddings.map((v: number[]) =>
      Math.sqrt(v.reduce((s: number, x: number) => s + x * x, 0))
    );
    for (const n of norms) expect(n).toBeCloseTo(1, 5);
  });

  it('generate: maps an upstream error into the routes error vocabulary', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'quota exceeded' } }), { status: 429 })
    );
    const res = await geminiAdapter.generate({ apiKey: 'AIza-test', model: 'm', prompt: 'p' });
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toContain('quota exceeded');
  });
});

describe('openrouter adapter request shapes', () => {
  it('generate: Bearer auth + OpenAI chat/completions body', async () => {
    fetchMock.mockResolvedValue(
      okJson({ choices: [{ message: { content: 'hello' } }], usage: { prompt_tokens: 3, completion_tokens: 2 } })
    );
    const res = await openrouterAdapter.generate({
      apiKey: 'sk-or-test',
      model: 'openai/gpt-5',
      prompt: 'hi',
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-or-test');
    expect(String(url)).not.toContain('sk-or-test');
    const body = await res.json();
    expect(body.text).toBe('hello');
    expect(body.usage).toEqual({ input: 3, output: 2 });
  });

  it('embed: unified embeddings endpoint, normalized output', async () => {
    fetchMock.mockResolvedValue(
      okJson({ data: [{ embedding: [3, 4] }] })
    );
    const res = await openrouterAdapter.embed({
      apiKey: 'sk-or-test',
      model: 'some/embed',
      texts: ['x'],
      taskType: 'RETRIEVAL_QUERY',
    });
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://openrouter.ai/api/v1/embeddings');
    const body = await res.json();
    const n = Math.hypot(...body.embeddings[0]);
    expect(n).toBeCloseTo(1, 5);
  });

  it('tts: honest not-wired fallback instead of a fake success', async () => {
    const res = await openrouterAdapter.tts({
      apiKey: 'sk-or-test',
      model: 'openai/tts',
      text: 'hi',
      voice: 'Kore',
    });
    const body = await res.json();
    expect(body.fallback).toBe(true);
    expect(body.error).toContain('not wired');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('stream vocabulary', () => {
  it('streamChat emits the app SSE event names so 03-stream-protocol parses unchanged', async () => {
    const encoder = new TextEncoder();
    const sse =
      'data: {"candidates":[{"content":{"parts":[{"text":"He"}]}}]}\n\n' +
      'data: {"candidates":[{"content":{"parts":[{"text":"llo"}]}}],"usageMetadata":{"promptTokenCount":2,"candidatesTokenCount":2}}\n\n';
    fetchMock.mockResolvedValue(
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(encoder.encode(sse));
            c.close();
          },
        }),
        { status: 200 }
      )
    );
    const res = await geminiAdapter.streamChat({
      apiKey: 'AIza-test',
      model: 'gemini-3.8-flash',
      contents: 'prompt',
      systemInstruction: 'sys',
    });
    expect(res.headers.get('Content-Type')).toContain('text/event-stream');
    const text = await res.text();
    expect(text).toContain('event: status');
    expect(text).toContain('event: chunk');
    expect(text).toContain('event: complete');
    expect(text).toContain('event: done');
    const completeLine = text.split('\n\n').find((f) => f.includes('event: complete'));
    const data = JSON.parse(completeLine!.split('data: ')[1]);
    expect(data.rawReply).toBe('Hello');
    expect(data.telemetry.model).toBe('gemini-3.8-flash');
  });
});

/* ── the reasoning split (David 2026-10-30) ──────────────────────────────── */

describe('reasoning: thoughts stream as their own event, never as reply text', () => {
  function sseFetch(sse: string) {
    const encoder = new TextEncoder();
    fetchMock.mockResolvedValue(
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(encoder.encode(sse));
            c.close();
          },
        }),
        { status: 200 }
      )
    );
  }

  it('gemini: asks for LOW thinking effort + thoughts; thought parts ride `reasoning` only', async () => {
    sseFetch(
      'data: {"candidates":[{"content":{"parts":[{"text":"pondering","thought":true}]}}]}\n\n' +
        'data: {"candidates":[{"content":{"parts":[{"text":"He"},{"text":" more","thought":true}]}}]}\n\n' +
        'data: {"candidates":[{"content":{"parts":[{"text":"llo"}]}}],"usageMetadata":{"promptTokenCount":2,"candidatesTokenCount":2}}\n\n'
    );
    const res = await geminiAdapter.streamChat({
      apiKey: 'AIza-test',
      model: 'gemini-3.8-flash',
      contents: 'prompt',
    });
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    // LOW thinking effort rides generationConfig (David 2026-10-30).
    expect(sent.generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'low', includeThoughts: true });

    const text = await res.text();
    const reasoning = text
      .split('\n\n')
      .filter((f) => f.includes('event: reasoning'))
      .map((f) => JSON.parse(f.split('data: ')[1]));
    expect(reasoning).toEqual([
      { delta: 'pondering', chars: 9, timestamp: expect.any(Number) },
      { delta: ' more', chars: 14, timestamp: expect.any(Number) },
    ]);
    const chunkDeltas = text
      .split('\n\n')
      .filter((f) => f.includes('event: chunk'))
      .map((f) => JSON.parse(f.split('data: ')[1]).delta);
    expect(chunkDeltas).toEqual(['He', 'llo']); // thought text NEVER rides chunk
    const complete = JSON.parse(
      text.split('\n\n').find((f) => f.includes('event: complete'))!.split('data: ')[1]
    );
    expect(complete.rawReply).toBe('Hello'); // and never the reply
  });

  it('openrouter: body asks reasoning effort low; delta.reasoning / reasoning_content ride `reasoning`', async () => {
    sseFetch(
      'data: {"choices":[{"delta":{"reasoning":"let me think"}}]}\n\n' +
        'data: {"choices":[{"delta":{"content":"Hi","reasoning_content":"why not"}}]}\n\n' +
        'data: [DONE]\n\n'
    );
    const res = await openrouterAdapter.streamChat({
      apiKey: 'sk-or-test',
      model: 'nvidia/nemotron-3.5-lightning:free',
      contents: 'prompt',
    });
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(sent.reasoning).toEqual({ effort: 'low' });

    const text = await res.text();
    const reasoning = text
      .split('\n\n')
      .filter((f) => f.includes('event: reasoning'))
      .map((f) => JSON.parse(f.split('data: ')[1]));
    expect(reasoning).toEqual([
      { delta: 'let me think', chars: 12, timestamp: expect.any(Number) },
      { delta: 'why not', chars: 19, timestamp: expect.any(Number) },
    ]);
    const chunkDeltas = text
      .split('\n\n')
      .filter((f) => f.includes('event: chunk'))
      .map((f) => JSON.parse(f.split('data: ')[1]).delta);
    expect(chunkDeltas).toEqual(['Hi']);
  });
});
