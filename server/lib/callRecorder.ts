/**
 * Flight recorder for API calls (design-docs/28 §4.2) — server side.
 *
 * Every provider call gets one row in `api_call_logs`: the exact SCRUBBED
 * request, stopwatch milestones (t_send → t_ack → t_first_token → t_end),
 * status, the raw UNPARSED response text (before any demuxer strips
 * <artifact_upsert>/<topic_shift>), usage, error text, and the job/turn ids
 * it belongs to. Ephemeral by design: 7-day TTL, capped per user, never
 * backed up, never synced.
 *
 * Laws:
 * - The recorder must NEVER break the call it is recording. Every function
 *   swallows its own errors (a warn line at most) and returns null/no-op.
 * - Secrets never land here: scrubRequestDeep runs before serialization.
 */
import { getDb } from '../db';
import { logServer } from './log';
import { isOpenRouterModel } from '../providers/openrouter';
import {
  scrubRequestDeep,
  CALL_LOG_TTL_MS,
  CALL_LOG_MAX_PER_USER,
  type ApiCallKind,
  type ApiCallLog,
  type ApiCallLogRequest,
  type ApiCallStatus,
} from '../../src/domains/callLogTypes';

/** Cap what a single row can hold — a runaway model reply must not bloat the DB. */
const RESPONSE_CAP = 200_000;
const ERROR_CAP = 2_000;

export interface RecordCallStartInput {
  userId?: number | null;
  kind: ApiCallKind;
  /** 'gemini' | 'openrouter' — derived from the model id when omitted. */
  provider?: string;
  model: string;
  request: ApiCallLogRequest;
  jobId?: string | null;
}

function newCallId(): string {
  return `call-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function providerFor(model: string, explicit?: string): string {
  if (explicit) return explicit;
  return isOpenRouterModel(model) ? 'openrouter' : 'gemini';
}

/** Prune on insert: drop everything older than the TTL, then cap per user. */
function pruneCallLogs(userId: number | null): void {
  const db = getDb();
  db.prepare('DELETE FROM api_call_logs WHERE t_send < ?').run(Date.now() - CALL_LOG_TTL_MS);
  db.prepare(
    `DELETE FROM api_call_logs WHERE user_id IS ? AND id NOT IN (
       SELECT id FROM api_call_logs WHERE user_id IS ? ORDER BY t_send DESC, rowid DESC LIMIT ?
     )`
  ).run(userId, userId, CALL_LOG_MAX_PER_USER);
}

export function recordCallStart(input: RecordCallStartInput): string | null {
  try {
    const db = getDb();
    const id = newCallId();
    db.prepare(
      `INSERT INTO api_call_logs (id, user_id, kind, provider, model, t_send, status, request_json, job_id)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
    ).run(
      id,
      input.userId ?? null,
      input.kind,
      providerFor(input.model, input.provider),
      input.model,
      Date.now(),
      JSON.stringify(scrubRequestDeep(input.request)),
      input.jobId ?? null
    );
    pruneCallLogs(input.userId ?? null);
    return id;
  } catch (err) {
    logServer('warn', 'CALLLOG', `recordCallStart failed: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

export function recordCallAck(id: string | null): void {
  if (!id) return;
  try {
    getDb().prepare('UPDATE api_call_logs SET t_ack = ? WHERE id = ? AND t_ack IS NULL').run(Date.now(), id);
  } catch {
    /* the recorder must never break the call */
  }
}

export function recordCallFirstToken(id: string | null): void {
  if (!id) return;
  try {
    getDb()
      .prepare('UPDATE api_call_logs SET t_first_token = ? WHERE id = ? AND t_first_token IS NULL')
      .run(Date.now(), id);
  } catch {
    /* the recorder must never break the call */
  }
}

export interface RecordCallEndInput {
  status: Extract<ApiCallStatus, 'ok' | 'error' | 'aborted'>;
  responseText?: string | null;
  usage?: unknown | null;
  error?: string | null;
  turnId?: string | null;
}

export function recordCallEnd(id: string | null, extra: RecordCallEndInput): void {
  if (!id) return;
  try {
    getDb()
      .prepare(
        `UPDATE api_call_logs SET t_end = ?, status = ?, response_text = ?, usage_json = ?,
          error_text = ?, turn_id = COALESCE(?, turn_id) WHERE id = ?`
      )
      .run(
        Date.now(),
        extra.status,
        extra.responseText ? extra.responseText.slice(0, RESPONSE_CAP) : null,
        extra.usage === undefined || extra.usage === null ? null : JSON.stringify(extra.usage),
        extra.error ? extra.error.slice(0, ERROR_CAP) : null,
        extra.turnId ?? null,
        id
      );
  } catch (err) {
    logServer('warn', 'CALLLOG', `recordCallEnd failed: ${err instanceof Error ? err.message : err}`);
  }
}

/* ── read paths (own-user only, enforced here and by the route) ──────────── */

const LIST_TRUNCATE = 200;

interface CallLogRow {
  id: string;
  user_id: number | null;
  kind: ApiCallKind;
  provider: string;
  model: string;
  t_send: number;
  t_ack: number | null;
  t_first_token: number | null;
  t_end: number | null;
  status: ApiCallStatus;
  request_json: string;
  response_text: string | null;
  usage_json: string | null;
  error_text: string | null;
  job_id: string | null;
  turn_id: string | null;
}

const SELECT_COLS =
  `id, user_id, kind, provider, model, t_send, t_ack, t_first_token, t_end, status,
   request_json, response_text, usage_json, error_text, job_id, turn_id`;

function rowToApiCallLog(row: CallLogRow, truncate: boolean): ApiCallLog {
  let request: ApiCallLogRequest = { endpoint: '', model: row.model };
  try {
    request = JSON.parse(row.request_json) as ApiCallLogRequest;
  } catch {
    /* keep the empty fallback */
  }
  let usage: unknown = null;
  if (row.usage_json) {
    try {
      usage = JSON.parse(row.usage_json);
    } catch {
      usage = null;
    }
  }
  return {
    id: row.id,
    userId: row.user_id,
    kind: row.kind,
    provider: row.provider,
    model: row.model,
    tSend: row.t_send,
    tAck: row.t_ack,
    tFirstToken: row.t_first_token,
    tEnd: row.t_end,
    status: row.status,
    request,
    responseText: truncate && row.response_text ? row.response_text.slice(0, LIST_TRUNCATE) : row.response_text,
    usage,
    error: row.error_text,
    jobId: row.job_id,
    turnId: row.turn_id,
  };
}

/** Newest first, optionally paginated by `before` (a t_send boundary). List view truncates the heavy text fields. */
export function listCallLogs(userId: number, limit = 50, before?: number): ApiCallLog[] {
  try {
    const rows = getDb()
      .prepare(
        `SELECT ${SELECT_COLS} FROM api_call_logs
         WHERE user_id IS ? AND (? IS NULL OR t_send < ?)
         ORDER BY t_send DESC, rowid DESC LIMIT ?`
      )
      .all(userId, before ?? null, before ?? null, Math.max(1, Math.min(limit, 200))) as CallLogRow[];
    return rows.map((r) => rowToApiCallLog(r, true));
  } catch (err) {
    logServer('warn', 'CALLLOG', `listCallLogs failed: ${err instanceof Error ? err.message : err}`);
    return [];
  }
}

/** Full record — or null when it does not exist or belongs to someone else. */
export function getCallLog(userId: number, id: string): ApiCallLog | null {
  try {
    const row = getDb()
      .prepare(`SELECT ${SELECT_COLS} FROM api_call_logs WHERE id = ? AND user_id IS ?`)
      .get(id, userId) as CallLogRow | undefined;
    return row ? rowToApiCallLog(row, false) : null;
  } catch (err) {
    logServer('warn', 'CALLLOG', `getCallLog failed: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}
