/**
 * Local-mode flight recorder (design-docs/28 §4.3).
 *
 * In Local Workspace the browser talks to the provider directly, so the
 * flight recorder lives in its own IndexedDB database (`markbrain-call-logs`,
 * store `calls`, key `id`, index on `t_send`). Same shape as the server's
 * `api_call_logs` rows (src/domains/callLogTypes.ts), same pruning law:
 * 7-day TTL, capped count, never sent to any server, never backed up.
 *
 * Every function no-ops safely when `indexedDB` is absent (Node test env) —
 * the recorder must never break the call it records.
 */
import {
  scrubRequestDeep,
  pruneCallLogIds,
  CALL_LOG_TTL_MS,
  CALL_LOG_MAX_PER_USER,
  type ApiCallKind,
  type ApiCallLog,
  type ApiCallLogRequest,
  type ApiCallStatus,
} from '../domains/callLogTypes';

const DB_NAME = 'markbrain-call-logs';
const STORE = 'calls';
const RESPONSE_CAP = 200_000;
const ERROR_CAP = 2_000;

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex('t_send', 'tSend');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T> | void
): Promise<T | null> {
  const db = await openDb();
  if (!db) return null;
  try {
    return await new Promise<T | null>((resolve) => {
      const tx = db.transaction(STORE, mode);
      const store = tx.objectStore(STORE);
      const request = fn(store);
      tx.oncomplete = () => resolve((request as IDBRequest<T>)?.result ?? null);
      tx.onerror = () => resolve(null);
      tx.onabort = () => resolve(null);
    });
  } catch {
    return null;
  } finally {
    db.close();
  }
}

function newCallId(): string {
  return `call-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface LocalRecordCallStartInput {
  kind: ApiCallKind;
  provider: string;
  model: string;
  request: ApiCallLogRequest;
}

/** Fire-and-forget start: generates the id synchronously, writes async. */
export function recordCallStart(input: LocalRecordCallStartInput): string {
  const log: ApiCallLog = {
    id: newCallId(),
    userId: null,
    kind: input.kind,
    provider: input.provider,
    model: input.model,
    tSend: Date.now(),
    tAck: null,
    tFirstToken: null,
    tEnd: null,
    status: 'pending',
    request: scrubRequestDeep(input.request),
    responseText: null,
    usage: null,
    error: null,
    jobId: null,
    turnId: null,
  };
  void withStore('readwrite', (store) => {
    store.put(log);
  }).then(() => {
    void pruneOld();
  });
  return log.id;
}

export function recordCallAck(id: string | null): void {
  if (!id) return;
  void patch(id, { tAck: Date.now() });
}

export function recordCallFirstToken(id: string | null): void {
  if (!id) return;
  void patch(id, { tFirstToken: Date.now() });
}

export interface LocalRecordCallEndInput {
  status: Extract<ApiCallStatus, 'ok' | 'error' | 'aborted'>;
  responseText?: string | null;
  usage?: unknown | null;
  error?: string | null;
  turnId?: string | null;
}

export function recordCallEnd(id: string | null, extra: LocalRecordCallEndInput): void {
  if (!id) return;
  void patch(id, {
    tEnd: Date.now(),
    status: extra.status,
    responseText: extra.responseText ? extra.responseText.slice(0, RESPONSE_CAP) : null,
    usage: extra.usage === undefined ? null : extra.usage ?? null,
    error: extra.error ? extra.error.slice(0, ERROR_CAP) : null,
    turnId: extra.turnId ?? null,
  });
}

async function patch(id: string, fields: Partial<ApiCallLog>): Promise<void> {
  const existing = await getCallLog(id);
  if (!existing) return;
  await withStore('readwrite', (store) => {
    store.put({ ...existing, ...fields });
  });
}

/** 7-day TTL + cap, evaluated in memory then applied — one pass, cheap. */
async function pruneOld(): Promise<void> {
  // getAll already returns the whole store; the cap decision needs the full set.
  const all = (await withStore('readonly', (store) => store.getAll() as IDBRequest<ApiCallLog[]>)) ?? [];
  const doomed = new Set(pruneCallLogIds(all, Date.now(), CALL_LOG_TTL_MS, CALL_LOG_MAX_PER_USER));
  if (doomed.size === 0) return;
  await withStore('readwrite', (store) => {
    for (const id of doomed) store.delete(id);
  });
}

export async function listCallLogs(limit = 50): Promise<ApiCallLog[]> {
  const rows = (await withStore('readonly', (store) => store.getAll() as IDBRequest<ApiCallLog[]>)) ?? [];
  return rows
    .sort((a, b) => b.tSend - a.tSend)
    .slice(0, Math.max(1, limit));
}

export async function getCallLog(id: string): Promise<ApiCallLog | null> {
  return (await withStore('readonly', (store) => store.get(id) as IDBRequest<ApiCallLog>)) ?? null;
}
