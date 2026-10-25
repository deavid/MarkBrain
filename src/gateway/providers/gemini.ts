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
  return parts.map((p: any) => p?.text ?? '').join('');
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

  async streamChat(params: StreamChatParams): Promise<Response> {
    return sseStreamResponse(async (emit) => {
      emit('status', {
        state: 'thinking',
        message: `Thinking with ${params.model}...`,
        timestamp: Date.now(),
        model: params.model,
      });
      const res = await fetch(
        `${BASE}/models/${encodeURIComponent(params.model)}:streamGenerateContent?alt=sse`,
        {
          method: 'POST',
          headers: headers(params.apiKey),
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: params.contents }] }],
            ...(params.systemInstruction
              ? { systemInstruction: { parts: [{ text: params.systemInstruction }] } }
              : {}),
            generationConfig: { temperature: params.temperature ?? 0.7 },
          }),
        }
      );
      if (!res.ok || !res.body) {
        let detail = `${res.status}`;
        try {
          const body = await res.json();
          detail = body?.error?.message || detail;
        } catch {
          /* non-JSON */
        }
        throw new Error(`Gemini: ${detail}`);
      }

      // Parse SSE from the provider, re-emit in the app's vocabulary.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let raw = '';
      let usage: { input: number; output: number } | undefined;
      let wrote = false;

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
            const delta = textOf(payload);
            if (delta) {
              if (!wrote) {
                wrote = true;
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
      return { raw, usage };
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
