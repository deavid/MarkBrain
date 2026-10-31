/**
 * Gemini direct adapter (design-docs/16 §3.2) — browser →
 * generativelanguage.googleapis.com, no server in the path.
 *
 * Wire: REST v1beta. Auth is the `x-goog-api-key` header (never `?key=` —
 * keys in URLs land in logs and history, §4.4). CORS was probed live: the
 * endpoint echoes arbitrary origins and allows this header.
 *
 * Two credential slots (D8) share this adapter — gemini-free and gemini-paid
 * differ only in which `apiKey` arrives in the params.
 */
import type {
  EmbedParams,
  GenerateParams,
  ProviderAdapter,
  StreamChatParams,
  TtsParams,
} from './types';
import { errorResponse, jsonResponse, sseStreamResponse } from './types';
import { l2Normalize } from '../../domains/search/draftSearchEngine';
import { noopCallRecorder, type CallRecorder } from '../recorder';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

function headers(apiKey: string): Record<string, string> {
  return { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey };
}

function usageOf(payload: any): { input: number; output: number } | undefined {
  const u = payload?.usageMetadata;
  if (!u) return undefined;
  return {
    input: u.promptTokenCount ?? 0,
    output: u.candidatesTokenCount ?? 0,
  };
}

function textOf(payload: any): string {
  const parts = payload?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  // Thought parts (thinking models, includeThoughts on) are the model's
  // reasoning — EPHEMERAL preview material, never reply text.
  return parts
    .filter((p: any) => p?.thought !== true)
    .map((p: any) => p?.text ?? '')
    .join('');
}

/** Split a stream chunk's parts into visible text and reasoning (thought parts). */
function splitParts(payload: any): { text: string; reasoning: string } {
  const parts = payload?.candidates?.[0]?.content?.parts;
  let text = '';
  let reasoning = '';
  if (Array.isArray(parts)) {
    for (const p of parts as Array<{ text?: string; thought?: boolean }>) {
      if (typeof p?.text !== 'string') continue;
      if (p.thought === true) reasoning += p.text;
      else text += p.text;
    }
  }
  return { text, reasoning };
}

async function toError(res: Response): Promise<Response> {
  let detail = `${res.status}`;
  try {
    const body = await res.json();
    detail = body?.error?.message || JSON.stringify(body).slice(0, 300);
  } catch {
    /* non-JSON error body */
  }
  return errorResponse(`Gemini: ${detail}`, res.status);
}

/**
 * The streamChat wire body, extracted verbatim + flight-recorder milestones
 * (design-docs/28 §4.3): ACK when the fetch resolves, first-token at the
 * first delta, raw UNPARSED text accumulated for the log.
 */
async function streamGeminiChat(
  params: StreamChatParams,
  emit: (event: string, data: unknown) => void,
  callId: string,
  recorder: CallRecorder
): Promise<{ raw: string; reasoning: string; textChunks: number; reasoningChunks: number; usage?: { input: number; output: number } }> {
  // The EXACT wire body — recorded verbatim (scrubbed) so the inspector shows
  // what the provider received, not our internal arguments.
  const wireBody = {
    contents: [{ role: 'user', parts: [{ text: params.contents }] }],
    ...(params.systemInstruction
      ? { systemInstruction: { parts: [{ text: params.systemInstruction }] } }
      : {}),
    generationConfig: {
      temperature: params.temperature ?? 0.7,
      // David 2026-10-30: LOW thinking effort, thoughts streamed — the
      // reasoning rides its own SSE event as a live preview, never the
      // reply text.
      thinkingConfig: { thinkingLevel: 'low', includeThoughts: true },
    },
  };
  recorder.wire?.(callId, wireBody);
  const res = await fetch(
    `${BASE}/models/${encodeURIComponent(params.model)}:streamGenerateContent?alt=sse`,
    {
      method: 'POST',
      headers: headers(params.apiKey),
      body: JSON.stringify(wireBody),
    }
  );
  if (!res.ok || !res.body) {
    recorder.httpStatus?.(callId, res.status);
    let detail = `${res.status}`;
    try {
      const body = await res.json();
      detail = body?.error?.message || detail;
    } catch {
      /* non-JSON */
    }
    throw new Error(`Gemini: ${detail}`);
  }

  // THE ACK BEFORE FIRST TOKEN: the provider accepted the stream — from
  // here on "the model is thinking" is true.
  recorder.ack(callId);
  emit('status', {
    state: 'connected',
    message: `Connected to ${params.model} — awaiting first token`,
    timestamp: Date.now(),
    model: params.model,
  });

  // Parse SSE from the provider, re-emit in the app's vocabulary.
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let raw = '';
  let reasoningAccum = '';
  let textChunks = 0;
  let reasoningChunks = 0;
  let usage: { input: number; output: number } | undefined;
  let wrote = false;
  // Reasoning preview counter — EPHEMERAL, never part of the reply text.
  let reasoningChars = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';
    for (const frame of frames) {
      for (const line of frame.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        let payload: any;
        try {
          payload = JSON.parse(data);
        } catch {
          continue;
        }
        const { text: delta, reasoning } = splitParts(payload);
        // Reasoning rides its own event — a LIVE preview only; never enters
        // raw (the reply text). The count keeps running even after text
        // starts; the client decides what to show.
        if (reasoning) {
          reasoningChunks += 1;
          reasoningAccum += reasoning;
          reasoningChars += reasoning.length;
          if (reasoningChunks === 1) recorder.firstReasoning(callId);
          emit('reasoning', { delta: reasoning, chars: reasoningChars, timestamp: Date.now() });
        }
        if (delta) {
          textChunks += 1;
          if (!wrote) {
            wrote = true;
            recorder.firstToken(callId);
            emit('status', {
              state: 'writing',
              message: `Writing response with ${params.model}...`,
              timestamp: Date.now(),
              model: params.model,
            });
          }
          raw += delta;
          emit('chunk', {
            delta,
            accumulatedLength: raw.length,
            timestamp: Date.now(),
          });
        }
        if (payload?.usageMetadata) usage = usageOf(payload);
      }
    }
  }
  recorder.end(callId, {
    status: 'ok',
    responseText: raw,
    reasoningText: reasoningAccum,
    textChunks,
    reasoningChunks,
    httpStatus: res.status,
    usage: usage ?? null,
    usageEstimated: usage === undefined,
  });
  return { raw, reasoning: reasoningAccum, textChunks, reasoningChunks, usage };
}

export const geminiAdapter: ProviderAdapter = {
  id: 'gemini',

  async generate(params: GenerateParams): Promise<Response> {
    try {
      const res = await fetch(
        `${BASE}/models/${encodeURIComponent(params.model)}:generateContent`,
        {
          method: 'POST',
          headers: headers(params.apiKey),
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: params.prompt }] }],
            generationConfig: { temperature: params.temperature ?? 0.4 },
          }),
        }
      );
      if (!res.ok) return toError(res);
      const payload = await res.json();
      return jsonResponse({ text: textOf(payload), usage: usageOf(payload) });
    } catch (err: unknown) {
      return errorResponse(`Gemini: ${err instanceof Error ? err.message : 'network error'}`);
    }
  },

  async streamChat(params: StreamChatParams, recorder: CallRecorder = noopCallRecorder): Promise<Response> {
    return sseStreamResponse(async (emit) => {
      // Local-mode flight recorder (design-docs/28 §4.3) — the request is
      // scrubbed inside recorder.start (the apiKey lives in params).
      const callId = recorder.start({
        kind: 'chat',
        provider: 'gemini',
        model: params.model,
        request: {
          endpoint: 'direct:streamGenerateContent?alt=sse',
          model: params.model,
          systemInstruction: params.systemInstruction ?? null,
          compiledPrompt: params.contents,
          params: { temperature: params.temperature ?? 0.7 },
        },
      });
      // Inspector linkage: the row id rides the SSE as its own event so the
      // client can open the inspector even if the stream later fails.
      emit('call', { callId });
      try {
        return await streamGeminiChat(params, emit, callId, recorder);
      } catch (err: unknown) {
        recorder.end(callId, { status: 'error', error: err instanceof Error ? err.message : String(err) });
        throw err;
      }
    }, params.model);
  },

  async embed(params: EmbedParams): Promise<Response> {
    try {
      // One request per batch — matches the metered call contract the indexer
      // already assumes (dev-vega 0421d24: one request = one embedContent call).
      const res = await fetch(
        `${BASE}/models/${encodeURIComponent(params.model)}:batchEmbedContents`,
        {
          method: 'POST',
          headers: headers(params.apiKey),
          body: JSON.stringify({
            requests: params.texts.map((text) => ({
              content: { parts: [{ text }] },
              taskType: params.taskType,
              ...(params.taskType === 'RETRIEVAL_DOCUMENT' && params.title
                ? { title: params.title }
                : {}),
            })),
          }),
        }
      );
      if (!res.ok) return toError(res);
      const payload = await res.json();
      const raw: number[][] = (payload?.embeddings ?? []).map((e: any) =>
        Array.isArray(e?.values) ? e.values : []
      );
      // LAW 6: Matryoshka-truncated output is not unit-length. Normalize here.
      return jsonResponse({ embeddings: raw.map((v) => l2Normalize(v)) });
    } catch (err: unknown) {
      return errorResponse(`Gemini: ${err instanceof Error ? err.message : 'network error'}`);
    }
  },

  async tts(params: TtsParams): Promise<Response> {
    const cleanSpokenText = params.text; // caller already cleaned via cleanTtsText
    try {
      const res = await fetch(
        `${BASE}/models/${encodeURIComponent(params.model)}:generateContent`,
        {
          method: 'POST',
          headers: headers(params.apiKey),
          body: JSON.stringify({
            contents: [
              {
                role: 'user',
                parts: [
                  {
                    text: cleanSpokenText,
                    speechMetadata: { style: 'Articulate, calm, natural' },
                  },
                ],
              },
            ],
            generationConfig: {
              responseModalities: ['AUDIO'],
              speechConfig: {
                speechConfig: undefined,
                voiceConfig: { prebuiltVoiceConfig: { voiceName: params.voice } },
              } as any,
            },
          }),
        }
      );
      if (!res.ok) return jsonResponse({ fallback: true, cleanSpokenText });
      const payload = await res.json();
      const inline = payload?.candidates?.[0]?.content?.parts?.[0]?.inlineData;
      if (inline?.data) {
        return jsonResponse({
          audioData: inline.data,
          mimeType: inline.mimeType || 'audio/wav',
          cleanSpokenText,
        });
      }
      return jsonResponse({ fallback: true, cleanSpokenText });
    } catch {
      return jsonResponse({ fallback: true, cleanSpokenText });
    }
  },

};
