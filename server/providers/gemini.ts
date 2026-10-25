/**
 * Gemini provider — per-request clients only (design-docs/21B §7.3).
 *
 * There is no process-wide singleton and no process.env key: every request
 * builds its client from the authenticated user's own vault key via
 * `aiForRequest()` in server/lib/accountVault.ts. `streamFromModel` takes the
 * client as its first argument so call sites cannot fall back to a global.
 */
import { GoogleGenAI } from '@google/genai';

export type { GoogleGenAI };

/** Explicit constructor — apiKey arrives from the caller's vault, never env. */
export function createGeminiClient(apiKey: string): GoogleGenAI {
  return new GoogleGenAI({ apiKey });
}

export async function streamFromModel(
  client: GoogleGenAI,
  modelName: string,
  contents: string,
  systemInstruction: string,
  reqId: number
) {
  return await client.models.generateContentStream({
    model: modelName,
    contents,
    config: {
      systemInstruction,
      temperature: 0.7,
    },
  });
}
