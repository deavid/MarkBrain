/**
 * Client-side API gateway.
 *
 * Thin, one-function-per-endpoint wrappers around `fetch`. Payload shapes are
 * mirrors of the existing call sites — this module must never change what goes
 * out on the wire, nor how callers interpret responses (no throwing, no
 * response parsing here; call sites keep owning non-ok/shape handling).
 */

// ── /api/tts ────────────────────────────────────────────────────────────────

export interface TtsRequest {
  text: string;
  voice: string;
}

export function tts(params: TtsRequest): Promise<Response> {
  return fetch('/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: params.text, voice: params.voice }),
  });
}

// ── /api/extract-artifact-from-file ────────────────────────────────────────

export interface ExtractArtifactFromFileRequest {
  content: string;
  filename: string;
  projectTitle: string;
  fileType: 'gdoc' | 'doc';
  /** Failure-aware retry: last error message from a failed extraction. */
  previousError?: string;
  /** Failure-aware retry: raw (invalid) model output from that attempt. */
  previousOutput?: string;
}

export interface ExtractArtifactFromFileInit {
  signal?: AbortSignal;
}

export function extractArtifactFromFile(
  params: ExtractArtifactFromFileRequest,
  init: ExtractArtifactFromFileInit = {}
): Promise<Response> {
  return fetch('/api/extract-artifact-from-file', {
    method: 'POST',
    signal: init.signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: params.content,
      filename: params.filename,
      projectTitle: params.projectTitle,
      fileType: params.fileType,
      previousError: params.previousError,
      previousOutput: params.previousOutput,
    }),
  });
}

// ── /api/server-logs ───────────────────────────────────────────────────────

export function serverLogs(): Promise<Response> {
  return fetch('/api/server-logs');
}

export function clearServerLogs(): Promise<Response> {
  return fetch('/api/server-logs/clear', { method: 'POST' });
}

// ── /api/auth/config ───────────────────────────────────────────────────────

export function authConfig(): Promise<Response> {
  return fetch('/api/auth/config');
}

// ── /api/chat/stream ───────────────────────────────────────────────────────

export interface ChatStreamPayload {
  model?: string;
  messages?: any[];
  contextPayload?: string;
  currentTopic?: string;
  chapterSummaries?: any[];
  projectTitle?: string;
  compiledPrompt?: string;
  systemInstruction?: string;
}

export interface ChatStreamInit {
  signal?: AbortSignal;
}

/**
 * Returns the raw Response so the stream protocol domain keeps owning SSE
 * reading and abort handling. Thin wrapper only — no parsing, no behavior.
 */
export function chatStream(
  payload: ChatStreamPayload,
  init: ChatStreamInit = {}
): Promise<Response> {
  return fetch('/api/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: init.signal,
  });
}

// ── /api/title-thread ──────────────────────────────────────────────────────

export interface TitleThreadRequest {
  messages: Array<{ role: string; content: string }>;
  version: number;
}

export function titleThread(params: TitleThreadRequest): Promise<Response> {
  return fetch('/api/title-thread', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: params.messages, version: params.version }),
  });
}

// ── /api/chat/cancel ───────────────────────────────────────────────────────

export function chatCancel(reason: string): Promise<Response> {
  return fetch('/api/chat/cancel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  });
}

// ── /api/summarize-chapter ─────────────────────────────────────────────────

export interface SummarizeChapterRequest {
  title: string;
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  steeringPrompt?: string;
}

export function summarizeChapter(params: SummarizeChapterRequest): Promise<Response> {
  return fetch('/api/summarize-chapter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: params.title,
      messages: params.messages,
      steeringPrompt: params.steeringPrompt,
    }),
  });
}

// ── /api/models ─────────────────────────────────────────────────────────────

/** Server-owned catalog entry (mirror of server/lib/models.ts `CatalogModel`). */
export interface CatalogModel {
  id: string;
  provider: string;
  available: boolean;
  name: string;
  badge: string;
  powerRating: number;
  latency: string;
  contextWindow: string;
  description: string;
  costMultiplier: number;
}

/** Body of GET /api/models — the single source of truth for the lineup. */
export interface ModelsResponse {
  models: CatalogModel[];
  default: string;
}

/**
 * Fetches the server-owned model catalog. Resolves with the parsed body;
 * rejects on network/parse failure — callers keep their own fallback and own
 * shape validation (nothing throws from inside this module).
 */
export function models(): Promise<ModelsResponse> {
  return fetch('/api/models').then((res) => res.json());
}
