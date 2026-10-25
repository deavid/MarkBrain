/**
 * OpenRouter direct adapter (design-docs/16 §3.2) — browser → openrouter.ai.
 *
 * Wire: OpenAI-compatible. Auth is `Authorization: Bearer …` (CORS probed
 * live: `allow-origin: *`, this header allowed). Embeddings ride the unified
 * embeddings endpoint (verified in the docs 2026-10-24).
 *
 * Every function answers in the app's existing Response vocabulary — see
 * providers/types.ts for why.
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

const BASE = 'https://openrouter.ai/api/v1';

function headers(apiKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
    // Optional attribution headers; harmless if the deployment has no listing.
    'X-OpenRouter-Title': 'MarkBrain',
  };
}

async function toError(res: Response): Promise<Response> {
  let detail = `${res.status}`;
  try {
    const body = await res.json();
    detail = body?.error?.message || JSON.stringify(body).slice(0, 300);
  } catch {
    /* non-JSON error body */
  }
  return errorResponse(`OpenRouter: ${detail}`, res.status);
}

export const openrouterAdapter: ProviderAdapter = {
  id: 'openrouter',

  async generate(params: GenerateParams): Promise<Response> {
    try {
      const res = await fetch(`${BASE}/chat/completions`, {
        method: 'POST',
        headers: headers(params.apiKey),
        body: JSON.stringify({
          model: params.model,
          messages: [{ role: 'user', content: params.prompt }],
          temperature: params.temperature ?? 0.4,
        }),
      });
      if (!res.ok) return toError(res);
      const payload = await res.json();
      const text = payload?.choices?.[0]?.message?.content ?? '';
      const usage = payload?.usage
        ? {
            input: payload.usage.prompt_tokens ?? 0,
            output: payload.usage.completion_tokens ?? 0,
          }
        : undefined;
      return jsonResponse({ text, usage });
    } catch (err: unknown) {
      return errorResponse(`OpenRouter: ${err instanceof Error ? err.message : 'network error'}`);
    }
  },

  async streamChat(params: StreamChatParams): Promise<Response> {
    return sseStreamResponse(async (emit) => {
      // Honest ladder (design 23 §2.2): before the RPC answers it is
      // CONNECTING; the provider ACK comes after the fetch resolves.
      emit('status', {
        state: 'connecting',
        message: `Sending to ${params.model}...`,
        timestamp: Date.now(),
        model: params.model,
      });
      const messages = [
        ...(params.systemInstruction
          ? [{ role: 'system', content: params.systemInstruction }]
          : []),
        { role: 'user', content: params.contents },
      ];
      const res = await fetch(`${BASE}/chat/completions`, {
        method: 'POST',
        headers: headers(params.apiKey),
        body: JSON.stringify({
          model: params.model,
          messages,
          temperature: params.temperature ?? 0.7,
          stream: true,
        }),
      });
      if (!res.ok || !res.body) {
        let detail = `${res.status}`;
        try {
          const body = await res.json();
          detail = body?.error?.message || detail;
        } catch {
          /* non-JSON */
        }
        throw new Error(`OpenRouter: ${detail}`);
      }

      // THE ACK BEFORE FIRST TOKEN: the provider accepted the stream — from
      // here on "the model is thinking" is true.
      emit('status', {
        state: 'connected',
        message: `Connected to ${params.model} — awaiting first token`,
        timestamp: Date.now(),
        model: params.model,
      });

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
            const delta = payload?.choices?.[0]?.delta?.content ?? '';
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
            if (payload?.usage) {
              usage = {
                input: payload.usage.prompt_tokens ?? usage?.input ?? 0,
                output: payload.usage.completion_tokens ?? usage?.output ?? 0,
              };
            }
          }
        }
      }
      return { raw, usage };
    }, params.model);
  },

  async embed(params: EmbedParams): Promise<Response> {
    try {
      const res = await fetch(`${BASE}/embeddings`, {
        method: 'POST',
        headers: headers(params.apiKey),
        body: JSON.stringify({
          model: params.model,
          input: params.texts,
          ...(params.taskType === 'RETRIEVAL_DOCUMENT' && params.title
            ? { title: params.title }
            : {}),
        }),
      });
      if (!res.ok) return toError(res);
      const payload = await res.json();
      // `data` is index-ordered like our `texts` — map straight across.
      const ordered: number[][] = (payload?.data ?? []).map((d: any) =>
        Array.isArray(d?.embedding) ? d.embedding : []
      );
      // LAW 6: normalize whatever came back before it touches the index.
      return jsonResponse({ embeddings: ordered.map((v) => l2Normalize(v)) });
    } catch (err: unknown) {
      return errorResponse(`OpenRouter: ${err instanceof Error ? err.message : 'network error'}`);
    }
  },

  // TTS exists on OpenRouter but is alpha — the app's default stays Gemini (D7).
  // Honest fallback instead of a half-supported call.
  async tts(_params: TtsParams): Promise<Response> {
    return jsonResponse({
      fallback: true,
      cleanSpokenText: _params.text,
      error: 'OpenRouter TTS is not wired yet — use a Gemini TTS model (design-docs/16 D7)',
    });
  },

};
