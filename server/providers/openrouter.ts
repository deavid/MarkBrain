/**
 * OpenRouter provider (design-docs/24 §4) — OpenAI-compatible facade partner.
 *
 * Wire: POST https://openrouter.ai/api/v1/chat/completions,
 * `Authorization: Bearer <key>`, `stream:true` SSE parsing → async iterable
 * of `{text}` chunks; non-stream generate → `{text}`. Abort flows through
 * `config.abortSignal` (AbortController), same field GoogleGenAI accepts.
 *
 * The call surface mirrors `GoogleGenAI` (models.generateContent /
 * models.generateContentStream yielding `{text}`) so aiForRequest can hand
 * either client to unchanged call sites. Embed + TTS stay Gemini-only — the
 * catalog caps those lanes to Gemini ids, so this client never sees them.
 *
 * Keys arrive per-request from the user's vault — NEVER process.env
 * (design-docs/24 §0 hygiene law).
 */
import type {
  LaneGenerateParams,
  LaneGenerateResponse,
  LaneTextChunk,
  LaneUsageMetadata,
} from './lane';

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

export function isOpenRouterModel(modelId: string): boolean {
  // OpenRouter ids are `vendor/model` — Gemini ids never carry a slash.
  return modelId.includes('/');
}

interface OpenAiUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

interface OpenAiDelta {
  content?: string | null;
}

interface OpenAiChunk {
  choices?: Array<{ delta?: OpenAiDelta; message?: { content?: string | null } }>;
  usage?: OpenAiUsage;
}

function usageOf(usage: OpenAiUsage | undefined): LaneUsageMetadata | undefined {
  if (!usage) return undefined;
  const out: LaneUsageMetadata = {};
  if (usage.prompt_tokens !== undefined) out.promptTokenCount = usage.prompt_tokens;
  if (usage.completion_tokens !== undefined) out.candidatesTokenCount = usage.completion_tokens;
  if (usage.total_tokens !== undefined) out.totalTokenCount = usage.total_tokens;
  return out;
}

function headersOf(apiKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };
}

function bodyOf(params: LaneGenerateParams, stream: boolean): string {
  const messages: Array<{ role: string; content: string }> = [];
  if (params.config?.systemInstruction) {
    messages.push({ role: 'system', content: params.config.systemInstruction });
  }
  messages.push({ role: 'user', content: params.contents });
  return JSON.stringify({
    model: params.model,
    messages,
    stream,
    ...(params.config?.temperature !== undefined ? { temperature: params.config.temperature } : {}),
  });
}

async function throwUpstreamError(res: globalThis.Response, model: string): Promise<never> {
  let detail = `${res.status}`;
  try {
    const body = await res.text();
    detail = body ? `${res.status} ${body.slice(0, 300)}` : detail;
  } catch {
    /* body unreadable — the status is the honest reason */
  }
  throw new Error(`OpenRouter ${model}: ${detail}`);
}

/** Parse one OpenAI-SSE `data:` payload into a lane chunk (null → skip). */
export function parseOpenAiSseData(data: string): LaneTextChunk | null {
  const trimmed = data.trim();
  if (!trimmed || trimmed === '[DONE]') return null;
  let payload: OpenAiChunk;
  try {
    payload = JSON.parse(trimmed) as OpenAiChunk;
  } catch {
    return null; // keepalives / comments never kill the stream
  }
  const choice = payload.choices?.[0];
  const text = choice?.delta?.content ?? choice?.message?.content ?? '';
  const usage = usageOf(payload.usage);
  // A chunk with neither text nor usage is pure keepalive noise — null it.
  if (!text && !usage) return null;
  const chunk: LaneTextChunk = {};
  if (text) chunk.text = text;
  if (usage) chunk.usageMetadata = usage;
  return chunk;
}

async function* readSse(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal
): AsyncGenerator<LaneTextChunk> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      if (signal?.aborted) throw new Error('OpenRouter stream aborted');
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        if (!line.startsWith('data:')) continue;
        const chunk = parseOpenAiSseData(line.slice(5));
        if (chunk) yield chunk;
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* reader already closed */
    }
  }
}

export class OpenRouterClient {
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  /** Explicit constructor — apiKey arrives from the caller's vault, never env. */
  constructor(apiKey: string, opts: { fetchImpl?: typeof fetch } = {}) {
    this.apiKey = apiKey;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  readonly models = {
    /** Non-stream generate → `{text}` (same shape GoogleGenAI answers). */
    generateContent: async (params: LaneGenerateParams): Promise<LaneGenerateResponse> => {
      const res = await this.fetchImpl(`${OPENROUTER_BASE}/chat/completions`, {
        method: 'POST',
        headers: headersOf(this.apiKey),
        body: bodyOf(params, false),
        signal: params.config?.abortSignal,
      });
      if (!res.ok) await throwUpstreamError(res, params.model);
      const payload = (await res.json()) as OpenAiChunk & { usage?: OpenAiUsage };
      const text = payload.choices?.[0]?.message?.content ?? '';
      return { text, ...(payload.usage ? { usageMetadata: usageOf(payload.usage) } : {}) };
    },

    /** stream=true SSE → async iterable of `{text}` chunks (FIFO Pair Law consumers). */
    generateContentStream: async (
      params: LaneGenerateParams
    ): Promise<AsyncIterable<LaneTextChunk>> => {
      const res = await this.fetchImpl(`${OPENROUTER_BASE}/chat/completions`, {
        method: 'POST',
        headers: headersOf(this.apiKey),
        body: bodyOf(params, true),
        signal: params.config?.abortSignal,
      });
      if (!res.ok) await throwUpstreamError(res, params.model);
      if (!res.body) throw new Error(`OpenRouter ${params.model}: empty stream body`);
      return readSse(res.body as ReadableStream<Uint8Array>, params.config?.abortSignal);
    },
  };
}