/**
 * Lane AI surface (design-docs/24 §4) — the shape-compatible facade contract.
 *
 * Both providers expose the SAME call surface GoogleGenAI has for text lanes
 * (`models.generateContent` → `{text}`, `models.generateContentStream` →
 * async iterable of `{text}` chunks), so `aiForRequest` / routes /
 * chatJobRunner barely change. `embedContent` and TTS speechConfig stay
 * Gemini-only — the catalog caps those lanes to Gemini model ids.
 *
 * Provider-neutral usage vocabulary: the provider's wire names
 * (prompt_tokens / completion_tokens) never leave the adapter (same law as
 * the chat route's raw usage normalization).
 */

export interface LaneUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
}

export interface LaneGenerateConfig {
  systemInstruction?: string;
  temperature?: number;
  /** Cooperative abort — both providers honor it (GoogleGenAI config has the same field). */
  abortSignal?: AbortSignal;
}

export interface LaneGenerateParams {
  model: string;
  contents: string;
  config?: LaneGenerateConfig;
}

export interface LaneTextChunk {
  text?: string;
  usageMetadata?: LaneUsageMetadata;
}

export interface LaneGenerateResponse {
  text?: string;
  usageMetadata?: LaneUsageMetadata;
}

export interface LaneAiSurface {
  models: {
    generateContent(params: LaneGenerateParams): Promise<LaneGenerateResponse>;
    generateContentStream(params: LaneGenerateParams): Promise<AsyncIterable<LaneTextChunk>>;
  };
}