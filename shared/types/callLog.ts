/**
 * Shared flight-recorder types (design-docs/28 §4).
 *
 * Used by BOTH the server recorder (server/lib/callRecorder.ts, SQLite
 * `api_call_logs`) and the local-mode store (src/services/callLogStore.ts,
 * IndexedDB `markbrain-call-logs`). The shape is deliberately wire-neutral:
 * camelCase here, mapped to the snake_case columns at the storage boundary.
 *
 * Laws (do not weaken):
 * - Secrets NEVER land in a log: `scrubRequestDeep` strips apiKey /
 *   Authorization-style keys anywhere in the request tree before storage.
 * - The recorder is ephemeral: 7-day TTL, capped per user, never backed up,
 *   never synced. It is a debugging inspector, not a data store.
 */

export type ApiCallKind = 'chat' | 'summarize' | 'extract' | 'title' | 'embed' | 'qa';

export type ApiCallStatus = 'pending' | 'ok' | 'error' | 'aborted';

/** The scrubbed request payload stored alongside a call. No keys, no headers. */
export interface ApiCallLogRequest {
  endpoint: string;
  model: string;
  systemInstruction?: string | null;
  compiledPrompt?: string | null;
  messages?: unknown | null;
  params?: Record<string, unknown> | null;
  /**
   * The EXACT payload the provider call received (scrubbed of secrets) —
   * what we sent, how (inspector tab 4, David 2026-10-30). Set by the
   * provider adapters at the moment they build the wire body, so it never
   * drifts from what actually left the process.
   */
  wire?: unknown | null;
}

export interface ApiCallLog {
  id: string;
  userId: number | null;
  kind: ApiCallKind;
  provider: string;
  model: string;
  tSend: number;
  tAck: number | null;
  /** Wall-clock of the first thinking token (inspector tab 5 timing). */
  tFirstReasoning: number | null;
  tFirstToken: number | null;
  tEnd: number | null;
  status: ApiCallStatus;
  request: ApiCallLogRequest;
  /** Raw UNPARSED provider text — before any demuxer strips sentinel blocks. */
  responseText: string | null;
  /**
   * The model's thinking stream, EPHEMERAL like the row (7-day TTL, never
   * synced, never part of a turn). Empty for non-thinking calls.
   */
  reasoningText: string | null;
  /** Streaming chunk counts (inspector tab 5/6: both phases). */
  textChunks: number | null;
  reasoningChunks: number | null;
  /** The provider's HTTP status when the wire is raw fetch; null when the SDK hides it. */
  httpStatus: number | null;
  usage: unknown | null;
  error: string | null;
  jobId: string | null;
  turnId: string | null;
}

/* ── secrets scrubbing ───────────────────────────────────────────────────── */

/**
 * Keys that must never be persisted. Matched case-insensitively on the LAST
 * path segment of any object key, so `headers.Authorization`, `apiKey`,
 * `x-goog-api-key`, `user_secrets` etc. all match wherever they nest.
 */
const SECRET_KEY_RE =
  /(^|[\s._-])(api[-_]?key|x-goog-api-key|x-api-key|authorization|user[-_]secrets|password|secret)$/i;

function isSecretKey(key: string): boolean {
  return SECRET_KEY_RE.test(key) || key.toLowerCase() === 'authorization';
}

function scrubValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrubValue);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (isSecretKey(k)) continue;
      out[k] = scrubValue(v);
    }
    return out;
  }
  return value;
}

/**
 * Deep-clone a request payload with every secret-looking key removed. The
 * recorder calls this BEFORE serializing — scrubbed data is the only thing
 * that ever reaches storage. JSON-safe: non-JSON values survive as-is, but
 * callers serialize with JSON.stringify anyway.
 */
export function scrubRequestDeep<T>(value: T): T {
  return scrubValue(value) as T;
}

/* ── pruning (pure, shared) ──────────────────────────────────────────────── */

export const CALL_LOG_TTL_MS = 7 * 24 * 3600 * 1000;
export const CALL_LOG_MAX_PER_USER = 500;

/**
 * Pure prune decision: given the full set of logs, which ids must go?
 * - everything older than the TTL,
 * - everything beyond the newest `maxPerUser` per user (null userId counts as
 *   its own bucket — local mode has exactly that one bucket).
 * Newest wins: sorted by tSend desc, ties keep the first occurrence.
 */
export function pruneCallLogIds(
  logs: ApiCallLog[],
  now: number = Date.now(),
  ttlMs: number = CALL_LOG_TTL_MS,
  maxPerUser: number = CALL_LOG_MAX_PER_USER
): string[] {
  const cutoff = now - ttlMs;
  const byUser = new Map<number | null, ApiCallLog[]>();
  for (const log of logs) {
    const bucket = byUser.get(log.userId ?? null) ?? [];
    bucket.push(log);
    byUser.set(log.userId ?? null, bucket);
  }
  const doomed: string[] = [];
  for (const bucket of byUser.values()) {
    bucket.sort((a, b) => b.tSend - a.tSend);
    bucket.forEach((log, i) => {
      if (log.tSend < cutoff || i >= maxPerUser) doomed.push(log.id);
    });
  }
  return doomed;
}

/* ── timing helpers (pure, shared by the UI) ─────────────────────────────── */

export interface CallDurations {
  ackMs: number | null;
  ttftMs: number | null;
  totalMs: number | null;
}

export function callDurations(log: Pick<ApiCallLog, 'tSend' | 'tAck' | 'tFirstToken' | 'tEnd'>): CallDurations {
  return {
    ackMs: log.tAck !== null ? log.tAck - log.tSend : null,
    ttftMs: log.tFirstToken !== null ? log.tFirstToken - log.tSend : null,
    totalMs: log.tEnd !== null ? log.tEnd - log.tSend : null,
  };
}
