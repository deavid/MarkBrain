/**
 * VPS Send-and-Forget chat job runner (design-docs/21E §2).
 *
 * The HTTP request that enqueues a job is NOT the job: `runJob` streams from
 * the provider decoupled from any socket, commits the Pair to SQLite on
 * success, and runs post-commit titling/summarization. SSE subscribers only
 * WATCH — closing their socket never aborts the job. Only `stopJob` (explicit
 * POST /api/jobs/:id/stop) aborts, landing the job in `stopped` with the
 * partial preserved for Retry / Store-as-is / Discard.
 */
import type { Response } from 'express';
import { getDb } from '../db/index';
import {
  aiClientForUser,
  isVaultUnlocked,
  VaultLockedError,
  NoKeyError,
} from '../lib/accountVault';
import type { LaneAiClient } from '../lib/accountVault';
import { requireModelId } from '../lib/models';
import { logServer } from '../lib/log';
import { buildSummarizePrompt, DEFAULT_SYSTEM_INSTRUCTION } from '../../src/prompts/prompt';
import { estimateTokens } from '../lib/tokens';
import { parseSentinelBlocks } from '../../src/utils/sentinelParser';
import { buildTitlePrompt, cleanupTitle } from '../../src/prompts/lanes';
import { StreamProtocolDomain } from '../../src/domains/03-stream-protocol';
import type { ExtractedArtifactUpsert, ExtractedTopicShift } from '../../src/domains/03-stream-protocol/types';
import {
  commitJobPairTransaction,
  bumpProjectRevision,
  getJobSummaryRows,
} from '../db/projectRepo';
import type { ChatJobSummary } from '../db/projectRepo';
import { isOpenRouterModel } from '../providers/openrouter';
import {
  recordCallStart,
  recordCallAck,
  recordCallFirstToken,
  recordCallEnd,
} from '../lib/callRecorder';
import type { ApiCallKind } from '../../src/domains/callLogTypes';

export type JobState = 'queued' | 'sending' | 'completed' | 'failed' | 'stopped';

export interface ChatJobRow {
  job_id: string;
  user_id: number;
  project_id: string;
  thread_id: string;
  kind: 'send' | 'regenerate';
  target_turn_id: string | null;
  ask_text: string;
  compiled_prompt: string;
  system_instruction: string | null;
  model: string;
  staged_attachments_json: string;
  capabilities_json: string | null;
  state: JobState;
  partial_text: string;
  error_reason: string | null;
}

interface ActiveJobContext {
  jobId: string;
  userId: number;
  projectId: string;
  threadId: string;
  abortController: AbortController;
  subscribers: Set<Response>;
  /** clean text accumulated so far (partial persisted periodically) */
  cleanText: string;
  /**
   * True for the context attachSubscriber stands in while the job is still
   * queued — runJob ADOPTS it so a watcher that attached early keeps
   * receiving events (a replaced context orphans the socket silently).
   */
  placeholder?: boolean;
  /** The provider accepted the stream (the ACK before first token). */
  connected?: boolean;
}

const activeJobs = new Map<string, ActiveJobContext>();
let lastPartialFlush = 0;

function parseJsonOrNull(raw: string | null | undefined): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/* ── job row helpers ──────────────────────────────────────────────────────── */

export function getJobRow(jobId: string): ChatJobRow | null {
  const row = getDb()
    .prepare(
      `SELECT job_id, user_id, project_id, thread_id, kind, target_turn_id, ask_text,
        compiled_prompt, system_instruction, model, staged_attachments_json, capabilities_json,
        state, partial_text, error_reason FROM chat_jobs WHERE job_id = ?`
    )
    .get(jobId) as ChatJobRow | undefined;
  return row ?? null;
}

export function setJobState(jobId: string, state: JobState, extra: { partial?: string; error?: string | null } = {}): void {
  getDb()
    .prepare(
      `UPDATE chat_jobs SET state = ?, partial_text = COALESCE(?, partial_text),
        error_reason = ?, updated_at = ? WHERE job_id = ?`
    )
    .run(state, extra.partial ?? null, extra.error ?? null, Date.now(), jobId);
}

export function persistPartial(ctx: ActiveJobContext, force = false): void {
  const now = Date.now();
  if (!force && now - lastPartialFlush < 250) return;
  lastPartialFlush = now;
  getDb()
    .prepare('UPDATE chat_jobs SET partial_text = ?, updated_at = ? WHERE job_id = ?')
    .run(ctx.cleanText, now, ctx.jobId);
}

/** Per-thread FIFO: a failed/stopped HEAD blocks later queued jobs (21E §2.2). */
function threadHeadBlocks(threadId: string, projectId: string, userId: number): boolean {
  const head = getDb()
    .prepare(
      `SELECT state FROM chat_jobs WHERE user_id = ? AND project_id = ? AND thread_id = ?
       ORDER BY created_at ASC, rowid ASC LIMIT 1`
    )
    .get(userId, projectId, threadId) as { state: JobState } | undefined;
  if (!head) return false;
  return head.state === 'failed' || head.state === 'stopped';
}

/** The thread's oldest job row — the only one allowed to run (nextSendable mirror). */
function threadHeadJobId(threadId: string, projectId: string, userId: number): string | null {
  const head = getDb()
    .prepare(
      `SELECT job_id FROM chat_jobs WHERE user_id = ? AND project_id = ? AND thread_id = ?
       ORDER BY created_at ASC, rowid ASC LIMIT 1`
    )
    .get(userId, projectId, threadId) as { job_id: string } | undefined;
  return head?.job_id ?? null;
}

function nextQueuedJob(threadId: string, projectId: string, userId: number): ChatJobRow | null {
  if (threadHeadBlocks(threadId, projectId, userId)) return null;
  const row = getDb()
    .prepare(
      `SELECT job_id FROM chat_jobs WHERE user_id = ? AND project_id = ? AND thread_id = ?
         AND state = 'queued' ORDER BY created_at ASC, rowid ASC LIMIT 1`
    )
    .get(userId, projectId, threadId) as { job_id: string } | undefined;
  return row ? getJobRow(row.job_id) : null;
}

/** Head resolved (completed / discarded / stored) → the next queued job may run. */
function kickNextQueuedOnThread(threadId: string, projectId: string, userId: number): void {
  const next = nextQueuedJob(threadId, projectId, userId);
  if (next) void runJob(next.job_id);
}

/* ── SSE fan-out ──────────────────────────────────────────────────────────── */

type SseEvent = Record<string, unknown>;

function broadcast(ctx: ActiveJobContext | undefined, event: string, data: SseEvent): void {
  if (!ctx) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of ctx.subscribers) {
    try {
      res.write(payload);
    } catch {
      ctx.subscribers.delete(res);
    }
  }
}

function closeSubscribers(ctx: ActiveJobContext): void {
  for (const res of ctx.subscribers) {
    try {
      res.end();
    } catch {
      /* already gone */
    }
  }
  ctx.subscribers.clear();
}

/* ── enqueue ──────────────────────────────────────────────────────────────── */

export interface EnqueueSendInput {
  userId: number;
  projectId: string;
  threadId: string;
  kind: 'send' | 'regenerate';
  askText: string;
  compiledPrompt: string;
  systemInstruction?: string;
  model: string;
  stagedAttachments?: unknown[];
  /** Resolved chat capabilities (Package 2 §2.4) — committed with the pair so the commit gates match. */
  capabilities?: unknown;
  targetTurnId?: string | null;
}

export function enqueueJob(input: EnqueueSendInput): ChatJobRow {
  const jobId = `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO chat_jobs (job_id, user_id, project_id, thread_id, kind, target_turn_id,
        ask_text, compiled_prompt, system_instruction, model, staged_attachments_json,
        capabilities_json, state, partial_text, error_reason, buffered_artifacts_json,
        buffered_shifts_json, result_user_turn_id, result_assistant_turn_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', '', NULL, '[]', '[]', NULL, NULL, ?, ?)`
    )
    .run(
      jobId,
      input.userId,
      input.projectId,
      input.threadId,
      input.kind,
      input.targetTurnId ?? null,
      input.askText,
      input.compiledPrompt,
      input.systemInstruction ?? DEFAULT_SYSTEM_INSTRUCTION,
      input.model,
      JSON.stringify(input.stagedAttachments ?? []),
      input.capabilities === undefined ? null : JSON.stringify(input.capabilities),
      now,
      now
    );
  const job = getJobRow(jobId);
  if (!job) throw new Error('job insert failed');
  void runJob(jobId); // fire-and-forget: decoupled from the enqueue request
  return job;
}

/* ── execution ────────────────────────────────────────────────────────────── */

export async function runJob(jobId: string): Promise<void> {
  const job = getJobRow(jobId);
  if (!job || job.state !== 'queued') return;

  // Per-thread FIFO (21E §2.2): only the HEAD job may run. A failed/stopped
  // head blocks later queued jobs on the thread until the user retries,
  // stores as-is, or discards the head — then the queue proceeds in order.
  if (threadHeadJobId(job.thread_id, job.project_id, job.user_id) !== jobId) return;

  if (!isVaultUnlocked(job.user_id)) {
    failJob(jobId, new VaultLockedError());
    return;
  }

  const abortController = new AbortController();
  // Adopt a placeholder left by attachSubscriber (watcher attached while the
  // job was queued) — its subscribers must keep receiving this attempt.
  const existing = activeJobs.get(jobId);
  const ctx: ActiveJobContext =
    existing && existing.placeholder
      ? { ...existing, abortController, placeholder: false }
      : {
          jobId,
          userId: job.user_id,
          projectId: job.project_id,
          threadId: job.thread_id,
          abortController,
          subscribers: new Set(),
          cleanText: '',
        };
  activeJobs.set(jobId, ctx);

  setJobState(jobId, 'sending');
  // Honest ladder (design 23 §2.2): the RPC is going out — no ACK yet, so
  // this is CONNECTING, never "the model is thinking".
  broadcast(ctx, 'status', { type: 'status', state: 'connecting' });

  // Flight recorder (design-docs/28 §4.2). Started only AFTER the client is
  // resolved — vault-locked / no-key jobs never touched the wire, so they
  // leave no row.
  let callLogId: string | null = null;
  try {
    const model = requireModelId(job.model, 'chat');
    // Facade (design-docs/24 §4): a `/`-shaped model id streams from
    // OpenRouter; the `{text}` chunk shape is identical either way.
    const client = aiClientForUser(job.user_id, 'chat', model);

    const systemInstruction = job.system_instruction || DEFAULT_SYSTEM_INSTRUCTION;
    callLogId = recordCallStart({
      userId: job.user_id,
      kind: 'chat',
      provider: isOpenRouterModel(model) ? 'openrouter' : 'gemini',
      model,
      jobId,
      request: {
        endpoint: 'generateContentStream',
        model,
        systemInstruction,
        compiledPrompt: job.compiled_prompt,
        params: { temperature: 0.7 },
      },
    });

    const stream = await client.models.generateContentStream({
      model,
      contents: job.compiled_prompt,
      config: { systemInstruction, temperature: 0.7 },
    });
    recordCallAck(callLogId);

    // THE ACK BEFORE FIRST TOKEN (David 2026-10-25): the provider accepted
    // the stream — from here on "the model is thinking" is true. Zero bytes
    // before this point is CONNECTING, not thinking. Recorded on the context
    // so a watcher that attaches LATE still learns it via its snapshot.
    ctx.connected = true;
    broadcast(ctx, 'status', { type: 'status', state: 'connected' });

    const domain = new StreamProtocolDomain();
    let seenArtifacts = 0;
    let lastCleanLen = 0;
    // Token telemetry (mirror of the client stream path): real provider usage
    // when it arrives, honest estimates otherwise. Zero-token turns are a lie.
    let usage: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number } | null = null;
    let timeToFirstChunkMs: number | null = null;
    const jobStart = Date.now();
    // Accumulate RAW provider text and re-demux from raw each flush — demuxing
    // from previously-cleaned text eats the spaces at chunk boundaries.
    let raw = '';

    for await (const chunk of stream) {
      if (abortController.signal.aborted) break;
      // Usage often rides the FINAL chunk (no text, just the bill). Capture
      // it BEFORE the empty-text skip or the honest token count is lost.
      if (chunk.usageMetadata) usage = chunk.usageMetadata;
      const text = chunk.text || '';
      if (!text) continue;
      if (timeToFirstChunkMs === null) {
        timeToFirstChunkMs = Date.now() - jobStart;
        recordCallFirstToken(callLogId);
      }
      raw += text;
      const demuxed = domain.demuxFullTurn(raw);
      // Live partial = prose without sentinel blocks; buffers ride alongside.
      ctx.cleanText = demuxed.cleanText;
      persistPartial(ctx);

      const cleanDelta = ctx.cleanText.slice(lastCleanLen);
      lastCleanLen = ctx.cleanText.length;
      if (cleanDelta) broadcast(ctx, 'chunk', { type: 'chunk', delta: cleanDelta, partialText: ctx.cleanText });

      if (demuxed.artifactUpserts.length > seenArtifacts) {
        for (const a of demuxed.artifactUpserts.slice(seenArtifacts)) {
          broadcast(ctx, 'artifact_upsert', { type: 'artifact_upsert', artifact: a });
        }
        seenArtifacts = demuxed.artifactUpserts.length;
      }
    }

    if (abortController.signal.aborted) {
      // stopJob already flipped state; just close out.
      recordCallEnd(callLogId, { status: 'aborted', responseText: raw });
      closeSubscribers(ctx);
      activeJobs.delete(jobId);
      return;
    }

    const finalDemux = domain.demuxFullTurn(raw);
    const clean = finalDemux.cleanText.trim();
    const artifacts = finalDemux.artifactUpserts;
    if (!clean && artifacts.length === 0) {
      throw new Error('The stream ended without a reply.');
    }

    const reply = clean || `Extracted ${artifacts.length} note${artifacts.length === 1 ? '' : 's'}.`;
    const inputTokens = usage?.promptTokenCount ?? estimateTokens(job.compiled_prompt);
    const outputTokens = usage?.candidatesTokenCount ?? estimateTokens(reply);
    const { revision, userTurnId, assistantTurnId } = commitJobPairTransaction({
      userId: job.user_id,
      projectId: job.project_id,
      threadId: job.thread_id,
      kind: job.kind,
      targetTurnId: job.target_turn_id,
      askText: job.ask_text,
      replyText: reply,
      model,
      stagedAttachments: JSON.parse(job.staged_attachments_json || '[]'),
      capabilities: parseJsonOrNull(job.capabilities_json) ?? undefined,
      artifacts,
      shifts: finalDemux.topicShift ? [finalDemux.topicShift] : [],
      links: finalDemux.links,
      unlinks: finalDemux.unlinks,
      pairKey: jobId,
      // Real provider usage when the wire carried it, estimates otherwise.
      telemetry: {
        inputTokens,
        outputTokens,
        totalTokens: usage?.totalTokenCount ?? inputTokens + outputTokens,
        latencyMs: Date.now() - jobStart,
        timeToFirstChunkMs: timeToFirstChunkMs ?? Date.now() - jobStart,
      },
    });

    getDb().prepare('DELETE FROM chat_jobs WHERE job_id = ?').run(jobId);
    // Link the recorder row to the committed assistant turn (pack §4.2).
    recordCallEnd(callLogId, { status: 'ok', responseText: raw, usage, turnId: assistantTurnId });
    kickNextQueuedOnThread(job.thread_id, job.project_id, job.user_id);
    broadcast(ctx, 'complete', { type: 'complete', revision, userTurnId, assistantTurnId });
    closeSubscribers(ctx);
    activeJobs.delete(jobId);
    logServer('success', 'JOB:COMMIT', `Job ${jobId} committed pair at revision ${revision}`);

    void runPostCommitChores(job.user_id, job.project_id, job.thread_id);
  } catch (err) {
    recordCallEnd(callLogId, {
      status: 'error',
      error: err instanceof Error ? err.message : String(err).slice(0, 500),
    });
    if (abortController.signal.aborted) {
      closeSubscribers(ctx);
      activeJobs.delete(jobId);
      return;
    }
    failJob(jobId, err, ctx.cleanText);
    closeSubscribers(ctx);
    activeJobs.delete(jobId);
  }
}

function failJob(jobId: string, err: unknown, partial = ''): void {
  const message =
    err instanceof VaultLockedError || err instanceof NoKeyError
      ? err.message
      : err instanceof Error && err.message
        ? err.message.slice(0, 500)
        : 'The request failed — no reply came back.';
  // Design 23 §2.3: the SSE error event carries a machine code alongside the
  // human sentence (client maps it to draft.errorCode → on-card unlock).
  const code =
    err instanceof VaultLockedError || err instanceof NoKeyError ? err.code : undefined;
  setJobState(jobId, 'failed', { partial, error: message });
  const job = getJobRow(jobId);
  if (job) bumpProjectRevision(job.user_id, job.project_id); // reconnecting clients see the failed state
  const ctx = activeJobs.get(jobId);
  broadcast(ctx, 'error', { type: 'error', message, ...(code ? { code } : {}) });
  logServer('error', 'JOB:FAIL', `Job ${jobId}: ${message}`);
}

/* ── lifecycle endpoints ──────────────────────────────────────────────────── */

export function attachSubscriber(jobId: string, res: Response): 'snapshot' | 'gone' {
  const job = getJobRow(jobId);
  if (!job) return 'gone';

  // Immediate snapshot (21E §3) — including whether the provider ACK already
  // happened (a late watcher must not sit in CONNECTING through slow TTFT).
  const liveCtx = activeJobs.get(jobId);
  res.write(
    `event: snapshot\ndata: ${JSON.stringify({
      type: 'snapshot',
      partialText: job.partial_text,
      state: job.state,
      ...(job.state === 'sending' && liveCtx?.connected ? { connected: true } : {}),
    })}\n\n`
  );

  if (job.state === 'completed') {
    res.write(`event: complete\ndata: ${JSON.stringify({ type: 'complete' })}\n\n`);
    res.end();
    return 'gone';
  }
  if (job.state === 'failed') {
    // Cheap code re-derivation (no schema change): the known vault sentence
    // maps back to VAULT_LOCKED so a reconnecting client still shows unlock.
    const reason = job.error_reason ?? 'failed';
    const code = /locked after a server restart|keys? (are |is )?locked/i.test(reason)
      ? 'VAULT_LOCKED'
      : /No API key configured/i.test(reason)
        ? 'NO_API_KEY'
        : undefined;
    res.write(
      `event: error\ndata: ${JSON.stringify({ type: 'error', message: reason, ...(code ? { code } : {}) })}\n\n`
    );
    res.end();
    return 'gone';
  }
  if (job.state === 'stopped') {
    res.write(`event: stopped\ndata: ${JSON.stringify({ type: 'stopped', partialText: job.partial_text })}\n\n`);
    res.end();
    return 'gone';
  }

  let ctx = activeJobs.get(jobId);
  if (!ctx) {
    // queued-but-not-yet-running (or runner restarted): stand in with a
    // placeholder the real runJob will adopt, kick once.
    ctx = {
      jobId,
      userId: job.user_id,
      projectId: job.project_id,
      threadId: job.thread_id,
      abortController: new AbortController(),
      subscribers: new Set(),
      cleanText: job.partial_text,
      placeholder: true,
    };
    activeJobs.set(jobId, ctx);
    if (job.state === 'queued') void runJob(jobId);
  }
  ctx.subscribers.add(res);
  // CRITICAL LAW: close removes the subscriber ONLY — never the abort controller.
  res.on('close', () => {
    ctx?.subscribers.delete(res);
  });
  return 'snapshot';
}

export function stopJob(jobId: string): boolean {
  const job = getJobRow(jobId);
  if (!job) return false;
  const ctx = activeJobs.get(jobId);
  if (ctx && !ctx.abortController.signal.aborted) {
    ctx.abortController.abort();
  }
  setJobState(jobId, 'stopped', { partial: ctx?.cleanText || job.partial_text });
  bumpProjectRevision(job.user_id, job.project_id);
  broadcast(ctx, 'stopped', { type: 'stopped', partialText: ctx?.cleanText || job.partial_text });
  closeSubscribers(ctx ?? { subscribers: new Set() } as ActiveJobContext);
  activeJobs.delete(jobId);
  // Unblock FIFO handling: nothing auto-runs a stopped head (user chooses exit).
  return true;
}

export function retryJob(
  jobId: string,
  overrides?: { model?: string; compiledPrompt?: string; systemInstruction?: string; capabilities?: unknown }
): boolean {
  const job = getJobRow(jobId);
  if (!job || (job.state !== 'failed' && job.state !== 'stopped')) return false;
  // FIFO integrity (21E §2.2): only the thread's HEAD may be retried — a
  // retry that would land BEHIND a live/dead head just stacks duplicate work.
  if (threadHeadJobId(job.thread_id, job.project_id, job.user_id) !== jobId) return false;
  // Design 23 §2.5 (live 2026-10-25): the user may have CHANGED the model (or
  // the staged payload) before retrying. The retry is the user's next attempt
  // — it must carry the CURRENT selection and a freshly compiled prompt, not
  // silently re-run the exact request that already failed.
  const model = overrides?.model?.trim();
  const compiledPrompt = overrides?.compiledPrompt;
  const systemInstruction = overrides?.systemInstruction;
  // The capabilities MUST ride the retry: the fresh compile teaches per the
  // CURRENT toggles — a stale stored set would gate the commit with different
  // rules than the prompt taught (live 2026-10-30: a retry taught <link> while
  // the stored job row had graphLinks absent → every link silently dropped).
  const capabilities =
    overrides?.capabilities && typeof overrides.capabilities === 'object'
      ? JSON.stringify(overrides.capabilities)
      : null;
  if (model || compiledPrompt !== undefined || systemInstruction !== undefined || capabilities) {
    getDb()
      .prepare(
        `UPDATE chat_jobs SET
          model = COALESCE(?, model),
          compiled_prompt = COALESCE(?, compiled_prompt),
          system_instruction = COALESCE(?, system_instruction),
          capabilities_json = COALESCE(?, capabilities_json),
          updated_at = ? WHERE job_id = ?`
      )
      .run(model ?? null, compiledPrompt ?? null, systemInstruction ?? null, capabilities, Date.now(), jobId);
  }
  getDb()
    .prepare(
      `UPDATE chat_jobs SET state = 'queued', partial_text = '', error_reason = NULL,
        buffered_artifacts_json = '[]', buffered_shifts_json = '[]', updated_at = ? WHERE job_id = ?`
    )
    .run(Date.now(), jobId);
  bumpProjectRevision(job.user_id, job.project_id);
  void runJob(jobId);
  return true;
}

export function storeJobAsIs(jobId: string): { revision: number } | null {
  const job = getJobRow(jobId);
  if (!job) return null;
  const partial = job.partial_text || '[Stopped before reply completed]';
  const result = commitJobPairTransaction({
    userId: job.user_id,
    projectId: job.project_id,
    threadId: job.thread_id,
    kind: job.kind,
    targetTurnId: job.target_turn_id,
    askText: job.ask_text,
    replyText: partial,
    model: job.model,
    stagedAttachments: JSON.parse(job.staged_attachments_json || '[]'),
    capabilities: parseJsonOrNull(job.capabilities_json) ?? undefined,
    artifacts: [],
    shifts: [],
    pairKey: jobId,
    isFallbackPartial: true,
    telemetry: {
      inputTokens: estimateTokens(job.compiled_prompt),
      outputTokens: estimateTokens(partial),
      totalTokens: estimateTokens(job.compiled_prompt) + estimateTokens(partial),
    },
  });
  getDb().prepare('DELETE FROM chat_jobs WHERE job_id = ?').run(jobId);
  kickNextQueuedOnThread(job.thread_id, job.project_id, job.user_id);
  return { revision: result.revision };
}

export function discardJob(jobId: string): boolean {
  const job = getJobRow(jobId);
  if (!job) return false;
  const ctx = activeJobs.get(jobId);
  if (ctx) ctx.abortController.abort();
  getDb().prepare('DELETE FROM chat_jobs WHERE job_id = ?').run(jobId);
  bumpProjectRevision(job.user_id, job.project_id);
  closeSubscribers(ctx ?? ({ subscribers: new Set() } as ActiveJobContext));
  activeJobs.delete(jobId);
  // Kick the next queued job on this thread, if the head is clear.
  kickNextQueuedOnThread(job.thread_id, job.project_id, job.user_id);
  return true;
}

export function listActiveJobSummaries(userId: number, projectId: string): ChatJobSummary[] {
  return getJobSummaryRows(userId, projectId);
}

/* ── post-commit chores (21E §2.5) ────────────────────────────────────────── */

export async function runPostCommitChores(userId: number, projectId: string, threadId: string): Promise<void> {
  try {
    await runTitleChore(userId, projectId, threadId);
  } catch (err) {
    logServer('warn', 'JOB:TITLE', `Auto-title failed: ${err instanceof Error ? err.message : err}`);
  }
  try {
    await runChapterSummaries(userId, projectId, threadId);
  } catch (err) {
    logServer('warn', 'JOB:SUMMARIZE', `Chapter summarize failed: ${err instanceof Error ? err.message : err}`);
  }
}

function choreClient(userId: number, capability: 'title' | 'summarize', modelId: string): LaneAiClient {
  return aiClientForUser(userId, capability, modelId);
}

/** Flight recorder for a post-commit chore call (design-docs/28 §4.2). */
function recordChoreCall(
  userId: number,
  kind: ApiCallKind,
  model: string,
  contents: string,
  temperature: number
): string | null {
  return recordCallStart({
    userId,
    kind,
    provider: isOpenRouterModel(model) ? 'openrouter' : 'gemini',
    model,
    request: { endpoint: 'generateContent', model, compiledPrompt: contents, params: { temperature } },
  });
}

async function runTitleChore(userId: number, projectId: string, threadId: string): Promise<void> {
  const db = getDb();
  const thread = db
    .prepare('SELECT thread_id, title_version, doc_json FROM threads WHERE user_id = ? AND project_id = ? AND thread_id = ?')
    .get(userId, projectId, threadId) as { thread_id: string; title_version: number; doc_json: string } | undefined;
  if (!thread) return;

  const turns = db
    .prepare('SELECT doc_json FROM turns WHERE user_id = ? AND project_id = ? AND thread_id = ? ORDER BY seq ASC')
    .all(userId, projectId, threadId) as Array<{ doc_json: string }>;
  const parsed = turns
    .map((t) => {
      try {
        return JSON.parse(t.doc_json) as { role: string; content: string };
      } catch {
        return null;
      }
    })
    .filter(Boolean) as Array<{ role: string; content: string }>;

  // Stage 1 law: first title when there are at least 2 turns and version is 0.
  if (thread.title_version !== 0 || parsed.length < 2) return;

  const model = requireModelId('gemini-3.5-flash-lite', 'title');
  const client = choreClient(userId, 'title', model);
  const messages = parsed.slice(-10).map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
  const prompt = buildTitlePrompt(messages, 1);
  const choreLogId = recordChoreCall(userId, 'title', model, prompt, 0.4);
  let response: Awaited<ReturnType<typeof client.models.generateContent>>;
  try {
    response = await client.models.generateContent({ model, contents: prompt, config: { temperature: 0.4 } });
    recordCallEnd(choreLogId, { status: 'ok', responseText: response.text || '' });
  } catch (err) {
    recordCallEnd(choreLogId, { status: 'error', error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
  const title = cleanupTitle(response.text || '');
  if (!title) return;

  const doc = thread.doc_json ? (JSON.parse(thread.doc_json) as Record<string, unknown>) : {};
  doc.title = title;
  doc.titleVersion = Number(doc.titleVersion ?? 0) + 1;
  doc.titleState = doc.titleState === 'manual' ? 'manual' : 'auto';
  db.prepare('UPDATE threads SET title = ?, title_version = ?, doc_json = ?, revision = ?, updated_at = ? WHERE user_id = ? AND project_id = ? AND thread_id = ?')
    .run(title, thread.title_version + 1, JSON.stringify(doc), Date.now(), Date.now(), userId, projectId, threadId);
  bumpProjectRevision(userId, projectId);
  logServer('info', 'JOB:TITLE', `Auto-titled thread ${threadId} → "${title}"`);
}

async function runChapterSummaries(userId: number, projectId: string, threadId: string): Promise<void> {
  const db = getDb();
  const rows = db
    .prepare(
      'SELECT chapter_id, doc_json FROM chapters WHERE user_id = ? AND project_id = ? AND chapter_thread_id = ? ORDER BY order_index ASC'
    )
    .all(userId, projectId, threadId) as Array<{ chapter_id: string; doc_json: string }>;

  for (const row of rows) {
    let chapter: { id: string; title: string; status?: string; description?: string; summary?: string; [k: string]: unknown } | null;
    try {
      chapter = JSON.parse(row.doc_json);
    } catch {
      continue;
    }
    if (!chapter) continue;
    const sealed = chapter.status === 'completed';
    if (!sealed) continue;
    // Never re-summarizes — UNLESS the stored fields are sentinel soup from
    // the old parser (live 2026-10-25): garbage in the fields is not content,
    // so the chore rewrites it on its next pass.
    const soup = /===\s*(SUBTITLE|DESCRIPTION|SUMMARY)\s*===/i.test(
      `${(chapter as { description?: string }).description ?? ''}${(chapter as { summary?: string }).summary ?? ''}`
    );
    if (chapter.description && chapter.summary && !soup) continue; // never re-summarizes

    // Gather this chapter's turns (startIndex..endIndex window).
    const turns = db
      .prepare('SELECT doc_json FROM turns WHERE user_id = ? AND project_id = ? AND thread_id = ? ORDER BY seq ASC')
      .all(userId, projectId, threadId) as Array<{ doc_json: string }>;
    const parsedTurns = turns
      .map((t) => {
        try {
          return JSON.parse(t.doc_json) as { role: string; content: string };
        } catch {
          return null;
        }
      })
      .filter(Boolean) as Array<{ role: string; content: string }>;

    const model = requireModelId('gemini-3.5-flash-lite', 'summarize');
    const client = choreClient(userId, 'summarize', model);
    const prompt = buildSummarizePrompt({ title: chapter.title, messages: parsedTurns });
    const choreLogId = recordChoreCall(userId, 'summarize', model, prompt, 0.3);
    let raw = '';
    try {
      const response = await Promise.race([
        client.models.generateContent({ model, contents: prompt, config: { temperature: 0.3 } }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('summarize exceeded 12s')), 12_000)),
      ]);
      raw = response.text || '';
      recordCallEnd(choreLogId, { status: 'ok', responseText: raw });
    } catch (err) {
      recordCallEnd(choreLogId, { status: 'error', error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
    // Sentinel headers FIRST (the prompt's own format, `=== FIELD ===`), then
    // the legacy `FIELD:` colon form. Live 2026-10-25: the model obeyed the
    // prompt, the parser only knew the colon form → the whole reply INCLUDING
    // the `=== SUBTITLE ===` markers was stored as description AND summary,
    // and the detail modal rendered the sentinel soup.
    const blocks = parseSentinelBlocks(raw);
    const descMatch = raw.match(/DESCRIPTION:\s*([\s\S]*?)(?=SUMMARY:|$)/i);
    const summaryMatch = raw.match(/SUMMARY:\s*([\s\S]*)$/i);
    chapter.description =
      blocks.description || (descMatch ? descMatch[1].trim() : '') || chapter.description || raw.trim().slice(0, 4000);
    chapter.summary =
      blocks.summary || (summaryMatch ? summaryMatch[1].trim() : '') || chapter.summary || raw.trim().slice(0, 4000);
    chapter.subtitle = blocks.subtitle || (chapter as { subtitle?: string }).subtitle || chapter.title;

    db.prepare(
      'UPDATE chapters SET title = ?, description = ?, summary = ?, doc_json = ?, revision = ? WHERE user_id = ? AND project_id = ? AND chapter_id = ?'
    ).run(chapter.title, chapter.description, chapter.summary, JSON.stringify(chapter), Date.now(), userId, projectId, row.chapter_id);
    bumpProjectRevision(userId, projectId);
    logServer('info', 'JOB:SUMMARIZE', `Filled sealed chapter ${row.chapter_id}`);
  }
}
