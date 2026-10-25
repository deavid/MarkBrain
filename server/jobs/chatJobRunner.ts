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
import { buildSummarizePrompt, DEFAULT_SYSTEM_INSTRUCTION } from '../lib/prompt';
import { buildTitlePrompt, cleanupTitle } from '../../src/prompts/lanes';
import { StreamProtocolDomain } from '../../src/domains/03-stream-protocol';
import type { ExtractedArtifactUpsert, ExtractedTopicShift } from '../../src/domains/03-stream-protocol/types';
import {
  commitJobPairTransaction,
  bumpProjectRevision,
  getJobSummaryRows,
} from '../db/projectRepo';
import type { ChatJobSummary } from '../db/projectRepo';

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
}

const activeJobs = new Map<string, ActiveJobContext>();
let lastPartialFlush = 0;

/* ── job row helpers ──────────────────────────────────────────────────────── */

export function getJobRow(jobId: string): ChatJobRow | null {
  const row = getDb()
    .prepare(
      `SELECT job_id, user_id, project_id, thread_id, kind, target_turn_id, ask_text,
        compiled_prompt, system_instruction, model, staged_attachments_json, state,
        partial_text, error_reason FROM chat_jobs WHERE job_id = ?`
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
  targetTurnId?: string | null;
}

export function enqueueJob(input: EnqueueSendInput): ChatJobRow {
  const jobId = `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO chat_jobs (job_id, user_id, project_id, thread_id, kind, target_turn_id,
        ask_text, compiled_prompt, system_instruction, model, staged_attachments_json, state,
        partial_text, error_reason, buffered_artifacts_json, buffered_shifts_json,
        result_user_turn_id, result_assistant_turn_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', '', NULL, '[]', '[]', NULL, NULL, ?, ?)`
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
  const ctx: ActiveJobContext = {
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
  broadcast(ctx, 'status', { type: 'status', state: 'streaming' });

  try {
    const model = requireModelId(job.model, 'chat');
    // Facade (design-docs/24 §4): a `/`-shaped model id streams from
    // OpenRouter; the `{text}` chunk shape is identical either way.
    const client = aiClientForUser(job.user_id, 'chat', model);

    const stream = await client.models.generateContentStream({
      model,
      contents: job.compiled_prompt,
      config: { systemInstruction: job.system_instruction || DEFAULT_SYSTEM_INSTRUCTION, temperature: 0.7 },
    });

    const domain = new StreamProtocolDomain();
    let seenArtifacts = 0;
    let lastCleanLen = 0;
    // Accumulate RAW provider text and re-demux from raw each flush — demuxing
    // from previously-cleaned text eats the spaces at chunk boundaries.
    let raw = '';

    for await (const chunk of stream) {
      if (abortController.signal.aborted) break;
      const text = chunk.text || '';
      if (!text) continue;
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
      artifacts,
      shifts: finalDemux.topicShift ? [finalDemux.topicShift] : [],
      pairKey: jobId,
    });

    getDb().prepare('DELETE FROM chat_jobs WHERE job_id = ?').run(jobId);
    kickNextQueuedOnThread(job.thread_id, job.project_id, job.user_id);
    broadcast(ctx, 'complete', { type: 'complete', revision, userTurnId, assistantTurnId });
    closeSubscribers(ctx);
    activeJobs.delete(jobId);
    logServer('success', 'JOB:COMMIT', `Job ${jobId} committed pair at revision ${revision}`);

    void runPostCommitChores(job.user_id, job.project_id, job.thread_id);
  } catch (err) {
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

  // Immediate snapshot (21E §3).
  res.write(`event: snapshot\ndata: ${JSON.stringify({ type: 'snapshot', partialText: job.partial_text, state: job.state })}\n\n`);

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
    // queued-but-not-yet-running (or runner restarted): show queued, kick once.
    ctx = {
      jobId,
      userId: job.user_id,
      projectId: job.project_id,
      threadId: job.thread_id,
      abortController: new AbortController(),
      subscribers: new Set(),
      cleanText: job.partial_text,
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

export function retryJob(jobId: string): boolean {
  const job = getJobRow(jobId);
  if (!job || (job.state !== 'failed' && job.state !== 'stopped')) return false;
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
    artifacts: [],
    shifts: [],
    pairKey: jobId,
    isFallbackPartial: true,
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
  const response = await client.models.generateContent({ model, contents: prompt, config: { temperature: 0.4 } });
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
    if (chapter.description && chapter.summary) continue; // never re-summarizes

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
    const response = await Promise.race([
      client.models.generateContent({ model, contents: prompt, config: { temperature: 0.3 } }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('summarize exceeded 12s')), 12_000)),
    ]);
    const raw = response.text || '';
    // Same fallback parse as routes/summarize: DESCRIPTION:/SUMMARY: or raw.
    const descMatch = raw.match(/DESCRIPTION:\s*([\s\S]*?)(?=SUMMARY:|$)/i);
    const summaryMatch = raw.match(/SUMMARY:\s*([\s\S]*)$/i);
    chapter.description = descMatch ? descMatch[1].trim() : chapter.description ?? raw.trim().slice(0, 4000);
    chapter.summary = summaryMatch ? summaryMatch[1].trim() : chapter.summary ?? raw.trim().slice(0, 4000);
    chapter.subtitle = (chapter as { subtitle?: string }).subtitle ?? chapter.title;

    db.prepare(
      'UPDATE chapters SET title = ?, description = ?, summary = ?, doc_json = ?, revision = ? WHERE user_id = ? AND project_id = ? AND chapter_id = ?'
    ).run(chapter.title, chapter.description, chapter.summary, JSON.stringify(chapter), Date.now(), userId, projectId, row.chapter_id);
    bumpProjectRevision(userId, projectId);
    logServer('info', 'JOB:SUMMARIZE', `Filled sealed chapter ${row.chapter_id}`);
  }
}
