/**
 * Client-side API gateway.
 *
 * Thin, one-function-per-endpoint wrappers around `fetch`. Payload shapes are
 * mirrors of the existing call sites — this module must never change what goes
 * out on the wire, nor how callers interpret responses (no throwing, no
 * response parsing here; call sites keep owning non-ok/shape handling).
 *
 * Mode routing (design-docs/21C §1/§2.2):
 * - `vps` mode: EVERY call goes through the VPS proxy via `apiFetch`
 *   (baseUrl + `Authorization: Bearer <token>`). Browser-direct is never used —
 *   the server signs with its own unlocked vault.
 * - `local` mode: a filled key slot in the WebCrypto vault routes browser→
 *   provider through `direct.ts`; otherwise the request falls to the same-origin
 *   proxy unauthenticated (401 unless a server session also exists).
 * Both paths answer the same Response vocabulary; call sites cannot tell.
 */
import { resolveLaneKey, type ResolvedKey } from '../data/keySlots';
import { DEFAULT_MODEL_SLOTS } from '../data/modelConfig';
import { getWorkspaceMode, getVpsSession, isOfflineReplica, type VpsSessionInfo } from '../services/workspaceSession';
import { isCaptureMode } from '../services/persistenceService';
import {
  recordCallStart,
  recordCallAck,
  recordCallFirstToken,
  recordCallEnd,
} from '../services/callLogStore';
// Phase 6: this is the ONE callLogStore import left in the gateway — api.ts is
// the wiring point. It builds the real recorder and hands it down to the
// direct adapters, which record through the CallRecorder interface only.
import type { CallRecorder } from './recorder';
import {
  directChatStream,
  directEmbed,
  directExtractArtifact,
  directGenerateQa,
  directSummarizeChapter,
  directTitleThread,
  directTts,
} from './direct';


/** The real recorder, built once here and handed down to the direct adapters. */
const callRecorder: CallRecorder = {
  start: recordCallStart,
  ack: recordCallAck,
  firstToken: recordCallFirstToken,
  end: recordCallEnd,
};

/* ------------------------------------------------- capture-mode fake stream */

/**
 * Deterministic stream for capture/fixture runs (`?fixture=1` / `?capture=1`).
 * The send flow must be testable with ZERO provider traffic, so this fake sits
 * in front of every network path and speaks the same SSE vocabulary
 * (`status` / `chunk` / `complete`) the real adapters emit. What it replies is
 * decided by the prompt itself:
 *
 * - `Reply with exactly: X`  → the reply is exactly `X` (journeys assert on it)
 * - `EMIT-ARTIFACT: code`    → the reply carries an `<artifact_upsert>` sentinel
 *                              so the demuxer/upsert chain is exercised for real
 * - `EMIT-TOPIC: Title`      → same, for `<topic_shift>`
 * - `should fail`            → fails ONCE per distinct prompt; a Retry of the
 *                              same text succeeds (transient failure shape)
 * - anything else            → a short canned sentence
 *
 * Chunks arrive ~200ms apart so "Stop mid-stream" is clickable. Every call is
 * recorded in the flight recorder with provider `fixture`.
 */
const fixtureFailedOnce = new Set<string>();

function sseFrame(name: string, data: unknown): string {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}

function fixtureChatStream(
  payload: { model?: string; compiledPrompt?: string; systemInstruction?: string },
  signal?: AbortSignal
): Promise<Response> {
  const prompt = payload.compiledPrompt || '';
  const model = payload.model || 'fixture-stream';
  const callId = recordCallStart({
    kind: 'chat',
    provider: 'fixture',
    model,
    request: {
      endpoint: 'fixture:stream',
      model,
      systemInstruction: payload.systemInstruction ?? null,
      compiledPrompt: prompt,
    },
  });
  recordCallAck(callId);

  const failsOnce = /should fail/i.test(prompt) && !fixtureFailedOnce.has(prompt);
  if (failsOnce) fixtureFailedOnce.add(prompt);

  const echo = /Reply with exactly: (\S+)/i.exec(prompt)?.[1] ?? null;
  const artCode = /EMIT-ARTIFACT:\s*([\w-]+)/i.exec(prompt)?.[1] ?? null;
  const topicTitle = /EMIT-TOPIC:\s*(.+)/i.exec(prompt)?.[1]?.trim() ?? null;

  let reply = echo ?? 'Fixture reply (capture mode): deterministic, no network.';
  if (artCode) reply += `\n\nSaving ${artCode} as a durable note.`;
  if (topicTitle) reply += `\n\nMoving on to ${topicTitle}.`;

  // The sentinels ride ONE atomic chunk each (never split across chunks) so
  // chunk-level demux stripping can never see half a block.
  const sentinelBlocks: string[] = [];
  if (artCode) {
    sentinelBlocks.push(
      `<artifact_upsert file="${artCode}.md" title="${artCode.replace(/-/g, ' ')}" type="document">\n` +
      `<subtitle>Fixture note ${artCode} (capture mode).</subtitle>\n` +
      `<description>Fixture description for ${artCode}: emitted by the capture-mode fake stream so the demuxer chain is exercised without a provider.</description>\n` +
      `<summary>Fixture summary for ${artCode}: a deterministic stand-in written by the fake stream.</summary>\n` +
      `<content>Fixture body for ${artCode}.</content>\n` +
      `</artifact_upsert>`
    );
  }
  if (topicTitle) {
    sentinelBlocks.push(`<topic_shift title="${topicTitle}" subtitle="Fixture chapter cut (capture mode)." />`);
  }
  const rawReply = reply + (sentinelBlocks.length ? '\n\n' + sentinelBlocks.join('\n\n') : '');

  const encoder = new TextEncoder();
  const startedAt = Date.now();
  let sentFirst = false;
  const frames: string[] = [];
  if (failsOnce) {
    frames.push(sseFrame('status', { state: 'error', message: 'Fixture failure injected (capture mode).' }));
  } else {
    // 10 text slices (~200ms apart) + one atomic frame per sentinel + complete.
    const slice = Math.max(1, Math.ceil(reply.length / 10));
    for (let i = 0; i < reply.length; i += slice) {
      frames.push(sseFrame('chunk', { delta: reply.slice(i, i + slice) }));
    }
    for (const block of sentinelBlocks) frames.push(sseFrame('chunk', { delta: '\n\n' + block }));
    frames.push(sseFrame('complete', {
      rawReply,
      telemetry: {
        model,
        inputTokens: Math.max(1, Math.round(prompt.length / 4)),
        outputTokens: Math.max(1, Math.round(rawReply.length / 4)),
        totalTokens: Math.max(1, Math.round((prompt.length + rawReply.length) / 4)),
        latencyMs: Date.now() - startedAt,
        timeToFirstChunkMs: 200,
        isFallback: true,
      },
    }));
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const frame of frames) {
        if (signal?.aborted) {
          recordCallEnd(callId, { status: 'aborted', responseText: rawReply.slice(0, 2000) });
          try { controller.close(); } catch { /* already closed */ }
          return;
        }
        if (!sentFirst && frame.startsWith('event: chunk')) {
          recordCallFirstToken(callId);
          sentFirst = true;
        }
        controller.enqueue(encoder.encode(frame));
        await new Promise((r) => setTimeout(r, 200));
      }
      recordCallEnd(callId, failsOnce
        ? { status: 'error', error: 'Fixture failure injected (capture mode).' }
        : { status: 'ok', responseText: rawReply, usage: { promptTokens: Math.round(prompt.length / 4), completionTokens: Math.round(rawReply.length / 4) } });
      controller.close();
    },
  });
  return Promise.resolve(new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  }));
}

/* ------------------------------------------------------------------ apiFetch */

/**
 * Prefix the active VPS baseUrl and attach the Bearer token when present.
 * Same-origin requests in local mode carry no Authorization header.
 */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  // Offline replica: NOTHING may leave the tab. The replica's IndexedDB is the
  // whole world — answer 503 without touching the network (an empty-Bearer
  // request to the last-known URL would at best 401, at worst hit a server
  // the user explicitly said is unreachable).
  if (isOfflineReplica()) {
    return new Response(JSON.stringify({ error: 'Offline replica mode', offline: true }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const session = getWorkspaceMode() === 'vps' ? getVpsSession() : null;
  const baseUrl = session?.baseUrl ?? '';
  const token = session?.token ?? '';
  return fetch(baseUrl + path, {
    ...init,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
}

/** Direct browser→provider is allowed only in local mode with a filled slot. */
function inVpsMode(): boolean {
  return getWorkspaceMode() === 'vps';
}

/* ------------------------------------------------------------ auth & account */

export interface LoginResponseUser {
  id: number;
  email: string;
  isOwner: boolean;
  vaultUnlocked: boolean;
}

export interface LoginResponse {
  token: string;
  user: LoginResponseUser;
}

/** POST /api/auth/login against an explicit server URL ('' = same origin). */
export function authLogin(baseUrl: string, email: string, password: string): Promise<Response> {
  return fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
}

export function authLogout(): Promise<Response> {
  return apiFetch('/api/auth/logout', { method: 'POST' });
}

export function authSession(): Promise<Response> {
  return apiFetch('/api/auth/session');
}

export function authUnlock(password: string): Promise<Response> {
  return apiFetch('/api/auth/unlock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
}

export interface AccountSettingsResponse {
  modelSlots: Record<string, string>;
  chatTier: 'free' | 'paid';
  vaultUnlocked: boolean;
  keys: Record<string, { configured: boolean; hint: string | null }>;
}

export function getAccountSettings(): Promise<Response> {
  return apiFetch('/api/account/settings');
}

export function putAccountSettings(body: { modelSlots?: Record<string, string>; chatTier?: string }): Promise<Response> {
  return apiFetch('/api/account/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function putAccountKeys(slot: string, apiKey: string | null): Promise<Response> {
  return apiFetch('/api/account/keys', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slot, apiKey }),
  });
}

export function changeAccountPassword(oldPassword: string, newPassword: string): Promise<Response> {
  return apiFetch('/api/account/password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ oldPassword, newPassword }),
  });
}

export interface AdminUserRow {
  id: number;
  email: string;
  isOwner: boolean;
  enabled: boolean;
  createdAt: number;
}

export function listAdminUsers(): Promise<Response> {
  return apiFetch('/api/admin/users');
}

export function createAdminUser(email: string, password: string): Promise<Response> {
  return apiFetch('/api/admin/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
}

export function patchAdminUser(id: number, patch: { enabled?: boolean; password?: string }): Promise<Response> {
  return apiFetch(`/api/admin/users/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
}

export type { VpsSessionInfo };

/* ----------------------------------------------------------------------- tts */

export interface TtsRequest {
  text: string;
  voice: string;
  /** Lane model id (modelConfig slot 'tts'). Server falls back to the lane default. */
  model?: string;
}

export function tts(params: TtsRequest): Promise<Response> {
  const key = resolveLaneKey('tts', params.model || 'gemini-3.8-flash-lite-tts');
  if (key && params.model && !inVpsMode()) {
    return directTts(key, { text: params.text, voice: params.voice, model: params.model });
  }
  return apiFetch('/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: params.text, voice: params.voice, model: params.model }),
  });
}

/* ------------------------------------------------------------------ extract */

export interface ExtractArtifactFromFileRequest {
  content: string;
  filename: string;
  projectTitle: string;
  fileType: 'gdoc' | 'doc';
  /** Failure-aware retry: last error message from a failed extraction. */
  previousError?: string;
  /** Failure-aware retry: raw (invalid) model output from that attempt. */
  previousOutput?: string;
  /** Lane model id (modelConfig slot 'extract'). */
  model?: string;
}

export interface ExtractArtifactFromFileInit {
  signal?: AbortSignal;
}

export function extractArtifactFromFile(
  params: ExtractArtifactFromFileRequest,
  init: ExtractArtifactFromFileInit = {}
): Promise<Response> {
  const key = resolveLaneKey('extract', params.model || 'gemini-3.5-flash-lite');
  if (key && params.model && !inVpsMode()) {
    return directExtractArtifact(key, { ...params, model: params.model }, callRecorder);
  }
  return apiFetch('/api/extract-artifact-from-file', {
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
      model: params.model,
    }),
  });
}

/* ------------------------------------------------------------ server logs */

export function serverLogs(): Promise<Response> {
  return apiFetch('/api/server-logs');
}

export function clearServerLogs(): Promise<Response> {
  return apiFetch('/api/server-logs/clear', { method: 'POST' });
}

/* ------------------------------------------------------ flight recorder API */

/** GET /api/logs/calls — the caller's own API call log, newest first.
 *  `job` narrows the flight recorder to one chat job (per-message receipts). */
export function listApiCallLogs(limit = 50, job?: string): Promise<Response> {
  return apiFetch(`/api/logs/calls?limit=${limit}${job ? `&job=${encodeURIComponent(job)}` : ''}`);
}

/** GET /api/logs/calls/:id — full record, 404 when it belongs to someone else. */
export function getApiCallLog(id: string): Promise<Response> {
  return apiFetch(`/api/logs/calls/${encodeURIComponent(id)}`);
}

/* --------------------------------------------------------------------- chat */

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
  // Capture/fixture runs NEVER touch the network, even with a key in the
  // vault: the fake stream speaks the same SSE vocabulary deterministically.
  if (isCaptureMode()) {
    return fixtureChatStream(payload, init.signal);
  }
  const key = resolveLaneKey('chat', payload.model || 'gemini-3.5-flash-lite');
  if (key && payload.model && !inVpsMode()) {
    return directChatStream(
      key,
      {
        model: payload.model,
        compiledPrompt: payload.compiledPrompt || '',
        systemInstruction: payload.systemInstruction,
      },
      callRecorder
    );
  }
  return apiFetch('/api/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: init.signal,
  });
}

export interface TitleThreadRequest {
  messages: Array<{ role: string; content: string }>;
  version: number;
  /** Lane model id (modelConfig slot 'title'). */
  model?: string;
}

export function titleThread(params: TitleThreadRequest): Promise<Response> {
  const key = resolveLaneKey('title', params.model || 'gemini-3.5-flash-lite');
  if (key && params.model && !inVpsMode()) {
    return directTitleThread(
      key,
      {
        messages: params.messages,
        version: params.version,
        model: params.model,
      },
      callRecorder
    );
  }
  return apiFetch('/api/title-thread', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: params.messages, version: params.version, model: params.model }),
  });
}

export function chatCancel(reason: string): Promise<Response> {
  return apiFetch('/api/chat/cancel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  });
}

/* ---------------------------------------------------------------- search index
 * Draft-proximity testbed. Raw Response on purpose — the module contract is
 * that call sites own non-ok and shape handling (see the header).
 */

export interface GenerateArtifactQaSection {
  id: string;
  heading: string;
  text: string;
}

export interface GenerateArtifactQaRequest {
  title: string;
  subtitle?: string;
  sections: GenerateArtifactQaSection[];
  /** Lane model id (modelConfig slot 'qaGen'). */
  model?: string;
}

export function generateArtifactQa(params: GenerateArtifactQaRequest): Promise<Response> {
  const key = resolveLaneKey('qaGen', params.model || 'gemini-3.5-flash-lite');
  if (key && params.model && !inVpsMode()) {
    return directGenerateQa(
      key,
      {
        title: params.title,
        subtitle: params.subtitle,
        sections: params.sections.map((s) => ({ id: s.id, heading: s.heading, text: s.text })),
        model: params.model,
      },
      callRecorder
    );
  }
  return apiFetch('/api/search-index/generate-qa', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: params.title, subtitle: params.subtitle, sections: params.sections, model: params.model }),
  });
}

export interface EmbedTextsRequest {
  texts: string[];
  taskType: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY';
  title?: string;
  /** Lane model id (modelConfig slot 'embed'). */
  model?: string;
}

export function embedTexts(params: EmbedTextsRequest): Promise<Response> {
  const key = resolveLaneKey('embed', params.model || DEFAULT_MODEL_SLOTS.embed);
  if (key && params.model && !inVpsMode()) {
    return directEmbed(key, { ...params, model: params.model }, callRecorder);
  }
  return apiFetch('/api/search-index/embed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ texts: params.texts, taskType: params.taskType, title: params.title, model: params.model }),
  });
}

export interface SummarizeChapterRequest {
  title: string;
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  steeringPrompt?: string;
  /** Lane model id (modelConfig slot 'summarize'). */
  model?: string;
}

/**
 * Summarize a chapter, with a hard client-side deadline.
 *
 * Do not remove the deadline: an unanswered request stays open until the page
 * reloads, and the user watches a spinner that will never resolve. A timeout
 * becomes visible text in the chapter chrome ("Summary request timed out or
 * failed." + Retry) — the user learns the truth instead.
 */
export async function summarizeChapter(
  params: SummarizeChapterRequest,
  timeoutMs = 15_000
): Promise<Response> {
  const key = resolveLaneKey('summarize', params.model || 'gemini-3.5-flash-lite');
  if (key && params.model && !inVpsMode()) {
    return directSummarizeChapter(
      key,
      {
        title: params.title,
        messages: params.messages,
        steeringPrompt: params.steeringPrompt,
        model: params.model,
      },
      callRecorder
    );
  }
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error('summarize-chapter timed out')),
    timeoutMs
  );
  try {
    return await apiFetch('/api/summarize-chapter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: params.title,
        messages: params.messages,
        steeringPrompt: params.steeringPrompt,
        model: params.model,
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

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
  /** Capability lanes this model may serve (design-docs/16 §3.1). Missing = legacy entry, all lanes. */
  capabilities?: string[];
  /** Quota/latency character shown in the picker. */
  quotaNote?: string;
}

export interface ModelsResponse {
  models: CatalogModel[];
  default: string;
}

/** Rejects on network/parse failure; callers keep their own fallback and shape validation. */
export function models(): Promise<ModelsResponse> {
  return apiFetch('/api/models').then((res) => res.json());
}
