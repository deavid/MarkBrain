/**
 * Gemini provider — per-request clients only (design-docs/21B §7.3).
 *
 * There is no process-wide singleton and no process.env key: every request
 * builds its client from the authenticated user's own vault key via
 * `aiForRequest()` in server/lib/accountVault.ts. `streamFromModel` takes the
 * client as its first argument so call sites cannot fall back to a global.
 */
import { GoogleGenAI } from '@google/genai';
import type { ThinkingLevel } from '@google/genai';
import type { LaneAiSurface, LaneTextChunk } from './lane';

export type { GoogleGenAI };

/** Explicit constructor — apiKey arrives from the caller's vault, never env. */
export function createGeminiClient(apiKey: string): GoogleGenAI {
  return new GoogleGenAI({ apiKey });
}

/**
 * David's decision 2026-10-30: chat asks for LOW thinking effort and the
 * model's thoughts stream to the UI as a live preview. EPHEMERAL — reasoning
 * never persists and never becomes part of a turn. The enum's wire value is
 * the string "LOW"; kept as a literal so test mocks of the SDK need no extra
 * value export.
 */
const THINKING_LEVEL = 'LOW' as ThinkingLevel;

/**
 * The SDK hands back raw GenerateContentResponse chunks (parts with
 * `thought: true` when includeThoughts is on). This generator splits each
 * chunk into the lane vocabulary: normal parts → `text`, thought parts →
 * `reasoning`. A chunk may carry either or both; usage rides through.
 */
async function* splitThoughtParts(
  stream: AsyncIterable<LaneTextChunk>
): AsyncGenerator<LaneTextChunk> {
  for await (const chunk of stream) {
    const raw = chunk as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>;
      text?: string;
      reasoning?: string;
    };
    // Two shapes arrive here: the raw SDK chunk (candidates → parts, thought
    // parts are the reasoning) and the already-lane-shaped chunk (the
    // OpenRouter adapter yields {text, reasoning}). Split the former, pass
    // the latter straight through.
    if (!raw.candidates) {
      yield chunk;
      continue;
    }
    const parts = raw.candidates?.[0]?.content?.parts;
    let text = '';
    let reasoning = '';
    if (Array.isArray(parts)) {
      for (const part of parts) {
        if (typeof part?.text !== 'string') continue;
        if (part.thought === true) reasoning += part.text;
        else text += part.text;
      }
    }
    const out: LaneTextChunk = {};
    if (text) out.text = text;
    if (reasoning) out.reasoning = reasoning;
    if (chunk.usageMetadata) out.usageMetadata = chunk.usageMetadata;
    if (text || reasoning || chunk.usageMetadata) yield out;
  }
}

/**
 * Optional hooks for the flight recorder: the caller (routes/chat, job runner)
 * passes onWire to capture the EXACT payload the provider receives, and
 * onChunk to see the split lane chunks (reasoning vs text) as they stream.
 * Both no-op when omitted — the recorder must never break the call.
 */
export interface StreamFromModelHooks {
  onWire?: (payload: unknown) => void;
  onChunk?: (chunk: LaneTextChunk) => void;
}

export async function streamFromModel(
  client: LaneAiSurface,
  modelName: string,
  contents: string,
  systemInstruction: string,
  reqId: number,
  hooks?: StreamFromModelHooks
) {
  void reqId; // kept in the signature for call-site stability
  const payload = {
    model: modelName,
    contents,
    config: {
      systemInstruction,
      temperature: 0.7,
      thinkingConfig: { thinkingLevel: THINKING_LEVEL, includeThoughts: true },
    },
  };
  // The recorder must see the EXACT object the provider call gets — the
  // wire body is built here, at the only place it can be captured truthfully.
  hooks?.onWire?.(payload);
  const stream = await client.models.generateContentStream(payload);
  const split = splitThoughtParts(stream);
  if (!hooks?.onChunk) return split;
  // Wrap: every chunk the splitter yields also flows to the hook — the
  // recorder caller counts reasoning vs text chunks and accumulates reasoning.
  return (async function* () {
    for await (const chunk of split) {
      hooks.onChunk!(chunk);
      yield chunk;
    }
  })();
}
