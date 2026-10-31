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
  /** True when `usage` is our estimate, false/absent when the provider reported it. */
  usageEstimated?: boolean | null;
  error: string | null;
  jobId: string | null;
  turnId: string | null;
  /** What the demuxer extracted and what the commit planner did with it. */
  outcome?: CallOutcome | null;
}

/**
 * What the demuxer extracted from a reply AND what the commit planner did
 * with it (plan doc 30 Phase 4). Derived PURELY from the planner request +
 * plan (shared/turnCommit), so the client and server commit paths record
 * the same truth. Stored on the flight-recorder row so the inspector's
 * "Extracted actions" view shows applied/ignored AND WHY.
 */
export interface CallOutcomeTopicShift {
  title: string;
  applied: boolean;
  reason: string;
}

export interface CallOutcomeArtifact {
  /** The slug/file name the model emitted. */
  file: string;
  title: string;
  result: 'created' | 'updated' | 'dropped';
  reason: string;
}

export interface CallOutcomeLink {
  action: 'link' | 'unlink';
  sourceFile: string;
  targetFile: string;
  kind: string;
  applied: boolean;
  reason: string;
}

export interface CallOutcome {
  topicShift: CallOutcomeTopicShift | null;
  artifacts: CallOutcomeArtifact[];
  links: CallOutcomeLink[];
  /** The clean (tags-stripped) reply that landed in the chat bubble. */
  cleanReply: string;
  rawChars: number;
  cleanChars: number;
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

/**
 * Token in/out from a provider usage blob — the recorder stores the provider's
 * EXACT usage JSON (gemini `usageMetadata`, openrouter `usage`, our normalized
 * telemetry), so the inspector reads every common shape and never guesses.
 * Unknown shapes render as —, never as invented numbers.
 */
export function usageTokens(usage: unknown): { in: number | null; out: number | null } {
  if (!usage || typeof usage !== 'object') return { in: null, out: null };
  const u = usage as Record<string, unknown>;
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    in: num(u.promptTokenCount) ?? num((u as any).prompt_tokens) ?? num((u as any).inputTokens),
    out: num(u.candidatesTokenCount) ?? num((u as any).completion_tokens) ?? num((u as any).outputTokens),
  };
}

/* ── phase math (pure, shared by the inspector) ──────────────────────────── */

export interface CallPhases extends CallDurations {
  /** tSend → tFirstReasoning. */
  firstReasoningMs: number | null;
  /** tFirstReasoning → tFirstToken (thinking ends when visible text starts). */
  thinkingMs: number | null;
  /** tFirstToken → tEnd (the writing phase). */
  writingMs: number | null;
  reasoningChars: number;
  responseChars: number;
  /** reasoning chars per second over the thinking phase. */
  reasoningCharsPerSec: number | null;
  /** response chars per second over the writing phase. */
  responseCharsPerSec: number | null;
}

export function callPhases(
  log: Pick<
    ApiCallLog,
    'tSend' | 'tAck' | 'tFirstReasoning' | 'tFirstToken' | 'tEnd' | 'reasoningText' | 'responseText'
  >
): CallPhases {
  const firstReasoningMs = log.tFirstReasoning !== null ? log.tFirstReasoning - log.tSend : null;
  const thinkingMs =
    log.tFirstReasoning !== null && log.tFirstToken !== null ? log.tFirstToken - log.tFirstReasoning : null;
  const writingMs = log.tFirstToken !== null && log.tEnd !== null ? log.tEnd - log.tFirstToken : null;
  const reasoningChars = (log.reasoningText ?? '').length;
  const responseChars = (log.responseText ?? '').length;
  const rate = (chars: number, ms: number | null): number | null =>
    ms && ms > 0 && chars > 0 ? chars / (ms / 1000) : null;
  return {
    ...callDurations(log),
    firstReasoningMs,
    thinkingMs,
    writingMs,
    reasoningChars,
    responseChars,
    reasoningCharsPerSec: rate(reasoningChars, thinkingMs),
    responseCharsPerSec: rate(responseChars, writingMs),
  };
}
