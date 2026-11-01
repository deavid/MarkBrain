/**
 * The per-turn record core (long-chat Phase 3.2, design-docs/31 §3.4).
 *
 * Turns used to live INSIDE the monolithic project blob in IndexedDB, so
 * appending one message re-serialized and rewrote the entire project history
 * on every send. Now each turn is its own record in an indexed `turns` object
 * store, and this module owns the pure logic around them:
 *
 *   - `toTurnRecord`        — the [projectId, id] key + [projectId, threadId, seq] index projection
 *   - `turnSignature`       — the cheap change detector (seq, timestamp, sizes)
 *   - `diffTurnRecords`     — which records a save must write/delete (append → exactly the new turn)
 *   - `reassembleProject`   — blob + records → the canonical ProjectSnapshot (reads, export)
 *   - `migrateProjectBlob`  — the one-time v1→v2 upgrade: embedded turns → records + bare blob
 *
 * PURE: no IndexedDB here. `localBackend.ts` wires these into transactions;
 * the Node test env (no indexedDB) exercises this core directly.
 */
import type { ProjectSnapshot, Turn } from './stores/projectStore';

export interface TurnRecord {
  /** Store keyPath: [projectId, id] — one record per turn, never a blob. */
  projectId: string;
  id: string;
  /** Index member: '' when the turn has no threadId (still addressable). */
  threadId: string;
  /** Index member: position within the project's turn list at write time. */
  seq: number;
  /** The canonical Turn doc — the record IS the turn, envelope-style. */
  turn: Turn;
}

/** The indexed `turns` store name inside getActiveIdbName(). */
export const TURNS_STORE = 'turns';

/** Index: every turn of one project (range deletes, reassembly). */
export const IDX_BY_PROJECT = 'byProject';
/** Index: [projectId, threadId, seq] — a thread's tail is an index seek. */
export const IDX_BY_PROJECT_THREAD = 'byProjectThread';

export function toTurnRecord(projectId: string, turn: Turn, seq = 0): TurnRecord {
  return {
    projectId,
    id: turn.id,
    threadId: turn.threadId ?? '',
    seq,
    turn,
  };
}

/**
 * The cheap change detector. Turns are immutable after their commit except
 * regenerate (same id, new content) and boundary bookkeeping — comparing seq,
 * timestamp and content/meta SIZES catches both; a same-length-same-time
 * content edit does not exist in any write path.
 */
export function turnSignature(r: TurnRecord): string {
  const c = r.turn.content ?? '';
  const m = r.turn.meta ? JSON.stringify(r.turn.meta) : '';
  const ea = r.turn.extractedArtifacts ? JSON.stringify(r.turn.extractedArtifacts).length : 0;
  return `${r.seq}|${r.turn.timestamp}|${c.length}|${m.length}|${ea}|${r.threadId}`;
}

/** The previous-writes index: turn id → signature. `undefined` = first write this session. */
export type TurnIndex = Map<string, string>;

export interface TurnDiff {
  /** Turns whose record must be written (new or changed). */
  upserts: Turn[];
  /** Turn ids whose record must be deleted (removed from the snapshot). */
  deletes: string[];
}

export function diffTurnRecords(previous: TurnIndex | undefined, turns: Turn[]): TurnDiff {
  const upserts: Turn[] = [];
  const seen = new Set<string>();
  turns.forEach((t, seq) => {
    if (!t?.id) return;
    seen.add(t.id);
    const record = toTurnRecord('', t, seq);
    const sig = turnSignature(record);
    if (previous === undefined || previous.get(t.id) !== sig) upserts.push(t);
  });
  const deletes: string[] = [];
  if (previous) {
    for (const id of previous.keys()) {
      if (!seen.has(id)) deletes.push(id);
    }
  }
  return { upserts, deletes };
}

/**
 * Blob + records → the canonical ProjectSnapshot. The meta blob never carries
 * `turns` after the split; turns come from the record store, ordered by seq.
 */
export function reassembleProject<T extends Record<string, unknown>>(
  blob: T,
  records: TurnRecord[]
): ProjectSnapshot {
  const turns = records
    .slice()
    .sort((a, b) => a.seq - b.seq || (a.turn.timestamp ?? 0) - (b.turn.timestamp ?? 0))
    .map((r) => r.turn);
  const { turns: _stripped, ...rest } = blob as { turns?: unknown } & T;
  void _stripped;
  return { ...(rest as unknown as ProjectSnapshot), turns };
}

/**
 * The v1→v2 upgrade, as data: a legacy blob with embedded turns becomes the
 * per-turn records PLUS the same blob without the `turns` key. Pure — the
 * upgrade transaction in localBackend applies it row by row.
 */
export function migrateProjectBlob(blob: Record<string, unknown>): {
  blob: Record<string, unknown>;
  records: TurnRecord[];
} {
  const projectId = String(blob.projectId ?? '');
  const turns = Array.isArray(blob.turns) ? (blob.turns as Turn[]) : [];
  const records = turns
    .filter((t) => t && typeof t.id === 'string')
    .map((t, seq) => toTurnRecord(projectId, t, seq));
  const { turns: _stripped, ...rest } = blob;
  void _stripped;
  return { blob: rest, records };
}
