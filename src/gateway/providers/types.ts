/**
 * Provider-adapter contract (design-docs/16 §3.2, Phase 1).
 *
 * Every adapter function returns a WHATWG `Response` carrying the SAME body
 * vocabulary the server routes produce today — same JSON shapes, same SSE
 * event names. The gateway can therefore route direct-or-proxy per request
 * and no call site learns which happened. This is the whole trick; do not
 * "improve" call sites to talk provider dialect.
 */

export interface GenerateParams {
  apiKey: string;
  model: string;
  prompt: string;
  temperature?: number;
}

export interface StreamChatParams {
  apiKey: string;
  model: string;
  contents: string;
  systemInstruction?: string;
  temperature?: number;
}

export interface EmbedParams {
  apiKey: string;
  model: string;
  texts: string[];
  taskType: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY';
  title?: string;
}

export interface TtsParams {
  apiKey: string;
  model: string;
  text: string;
  voice: string;
}

export interface CatalogEntry {
  id: string;
  name: string;
  description?: string;
  provider: string;
}

export interface ProviderAdapter {
  id: 'gemini' | 'openrouter';
  /** Blocking text generation. Body: `{ text, usage? }`. */
  generate(params: GenerateParams): Promise<Response>;
  /** SSE stream in the app's `event: status|chunk|complete|done` vocabulary. */
  streamChat(params: StreamChatParams): Promise<Response>;
  /** Body: `{ embeddings: number[][], offline?: boolean }`. */
  embed(params: EmbedParams): Promise<Response>;
  /** Body: `{ audioData, mimeType, cleanSpokenText }` or `{ fallback: true, … }`. */
  tts(params: TtsParams): Promise<Response>;
  /** Body: `{ models: CatalogEntry[] }`. */
  listModels(apiKey: string): Promise<Response>;
}

/** JSON envelope helper — adapters answer with Response so call sites never branch. */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Build an SSE `Response` in the app's stream vocabulary from an async token
 * source. Event shapes mirror server/routes/chat.ts so 03-stream-protocol
 * parses both without knowing which one it got.
 */
export function sseStreamResponse(
  produce: (emit: (event: string, data: unknown) => void) => Promise<{ raw: string; usage?: { input: number; output: number } }>,
  model: string
): Response {
  const encoder = new TextEncoder();
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };
      const started = Date.now();
      let firstChunkMs: number | null = null;
      send('status', {
        state: 'connecting',
        message: `Connecting to ${model}...`,
        timestamp: started,
        model,
      });
      try {
        const { raw, usage } = await produce(send);
        if (firstChunkMs === null) firstChunkMs = Date.now() - started;
        send('complete', {
          rawReply: raw,
          telemetry: {
            model,
            inputTokens: usage?.input ?? 0,
            outputTokens: usage?.output ?? 0,
            totalTokens: (usage?.input ?? 0) + (usage?.output ?? 0),
            latencyMs: Date.now() - started,
            timeToFirstChunkMs: firstChunkMs ?? Date.now() - started,
            isFallback: false,
          },
        });
        send('done', { success: true });
      } catch (err: unknown) {
        send('status', {
          state: 'error',
          message: err instanceof Error ? err.message : 'stream failed',
          timestamp: Date.now(),
          model,
        });
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform' },
  });
}

/** Non-fatal fetch → Response with the routes' error vocabulary. */
export function errorResponse(message: string, status = 502, extra: Record<string, unknown> = {}): Response {
  return jsonResponse({ error: message, ...extra }, status);
}
