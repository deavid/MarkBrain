/**
 * offlineOutbox — the VPS mirror IS the outbox; this module only tracks WHAT
 * went dirty while the server was unreachable (design discussion 2026-10-26).
 *
 * Why this shape: vpsStore.save writes the mirror FIRST, then the server. A
 * failed server write leaves a correct snapshot sitting in IndexedDB — the
 * data is not lost, it is just unsynced. The only thing missing is knowing
 * which entities changed since the last server-confirmed state, so replay can
 * overlay exactly those onto the server copy instead of clobbering the whole
 * project (David's call: more granularity than project-level LWW).
 *
 * Deletion semantics: deleting an ENTITY (thread, artifact, folder...) is
 * ordinary user intent and is handled by the EXISTING persistent mutation
 * queue (serverMutationQueue → POST /mutate → tombstones), which already
 * survives offline and flushes on reconnect — the outbox deliberately does
 * NOT track removals, because the snapshot PUT is upsert-only server-side
 * (anti-clobber law) and cannot express them. PROJECT deletion is online-only
 * (refused in vpsStore).
 *
 * Storage: localStorage (ids + a revision number, not payloads — the snapshot
 * itself stays in the mirror, no duplicate storage). Namespaced per workspace
 * DB via getActiveIdbName(), so local and VPS mirrors never share an outbox.
 *
 * The record also keeps baseRevision — the server revision the mirror had
 * last seen. Replay compares it against the server's CURRENT revision to know
 * whether anyone else wrote in between (no clock trust, no timestamps — the
 * revision counter is the judge; see vpsSync.replayOne).
 */
import { getActiveIdbName } from './workspaceSession';
import type { ProjectSnapshot } from './stores/projectStore';
import { logger } from '../utils/logger';

/** Top-level scalar fields tracked as whole-value dirty (no ids to diff). */
const SCALAR_FIELDS = [
  'name',
  'codeName',
  'description',
  'color',
  'activeThreadId',
  'granularityLaw',
] as const;

type ScalarField = (typeof SCALAR_FIELDS)[number];

type EntityCollection = 'turns' | 'chapters' | 'artifacts' | 'edges' | 'threads' | 'folders';

const COLLECTIONS: EntityCollection[] = ['turns', 'chapters', 'artifacts', 'edges', 'threads', 'folders'];

/** Per-collection dirty (added or changed offline) entity ids. */
export interface DirtyEntities {
  added: Record<EntityCollection, Set<string>>;
}

export interface OutboxRecord {
  projectId: string;
  dirty: DirtyEntities;
  scalars: ScalarField[];
  /** Server revision the mirror last saw (null = created offline / never synced). */
  baseRevision: number | null;
  /** Failed replay attempts — informational; replay is event-driven, not a timer. */
  attempts: number;
  dirtyAt: number;
}

const KEY_PREFIX = 'markbrain:outbox:';

function storageKey(): string {
  return KEY_PREFIX + getActiveIdbName();
}

/** Fired on every mutation so the UI (badge) can re-render. */
export const OUTBOX_CHANGED_EVENT = 'markbrain:outbox-changed';

function notify(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(OUTBOX_CHANGED_EVENT));
}

interface OutboxRecordSerialized {
  projectId: string;
  added: Record<EntityCollection, string[]>;
  scalars: ScalarField[];
  baseRevision: number | null;
  attempts: number;
  dirtyAt: number;
}

function emptyDirty(): DirtyEntities {
  const sets = () =>
    ({
      turns: new Set<string>(),
      chapters: new Set<string>(),
      artifacts: new Set<string>(),
      edges: new Set<string>(),
      threads: new Set<string>(),
      folders: new Set<string>(),
    }) as Record<EntityCollection, Set<string>>;
  return { added: sets() };
}

function readAll(): Record<string, OutboxRecord> {
  try {
    const raw = localStorage.getItem(storageKey());
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, OutboxRecordSerialized>;
    const out: Record<string, OutboxRecord> = {};
    for (const [projectId, rec] of Object.entries(parsed)) {
      const dirty = emptyDirty();
      for (const col of COLLECTIONS) {
        dirty.added[col] = new Set(rec.added?.[col] ?? []);
      }
      out[projectId] = {
        projectId: rec.projectId,
        dirty,
        scalars: rec.scalars ?? [],
        baseRevision: rec.baseRevision ?? null,
        attempts: rec.attempts ?? 0,
        dirtyAt: rec.dirtyAt ?? Date.now(),
      };
    }
    return out;
  } catch (err) {
    // Corrupt outbox must never block a save: drop it, start clean. Worst
    // case is a whole-project push on next replay — the mirror is still truth.
    logger.warn('offlineOutbox', 'unreadable outbox — resetting', err);
    return {};
  }
}

function writeAll(records: Record<string, OutboxRecord>): void {
  const serialized: Record<string, OutboxRecordSerialized> = {};
  for (const [projectId, rec] of Object.entries(records)) {
    serialized[projectId] = {
      projectId: rec.projectId,
      added: Object.fromEntries(COLLECTIONS.map((c) => [c, [...rec.dirty.added[c]]])) as Record<EntityCollection, string[]>,
      scalars: rec.scalars,
      baseRevision: rec.baseRevision,
      attempts: rec.attempts,
      dirtyAt: rec.dirtyAt,
    };
  }
  localStorage.setItem(storageKey(), JSON.stringify(serialized));
  notify();
}

function idsOf(list: unknown): Set<string> {
  const out = new Set<string>();
  if (Array.isArray(list)) {
    for (const item of list) {
      if (item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string') {
        out.add((item as { id: string }).id);
      }
    }
  }
  return out;
}

function collectionOf(snapshot: ProjectSnapshot, col: EntityCollection): unknown[] {
  switch (col) {
    case 'turns':
      return snapshot.turns;
    case 'chapters':
      return snapshot.chapters;
    case 'artifacts':
      return snapshot.artifacts;
    case 'edges':
      return snapshot.edges;
    case 'threads':
      return snapshot.threads ?? [];
    case 'folders':
      return snapshot.folders ?? [];
  }
}

function diffEntities(prev: ProjectSnapshot | null, next: ProjectSnapshot): DirtyEntities {
  const dirty = emptyDirty();
  for (const col of COLLECTIONS) {
    if (!prev) {
      // Nothing to diff against (offline-created or mirror cold): everything
      // is dirty — replay will push the whole snapshot.
      dirty.added[col] = idsOf(collectionOf(next, col));
      continue;
    }
    const before = new Map<string, string>();
    for (const item of collectionOf(prev, col)) {
      if (item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string') {
        before.set((item as { id: string }).id, JSON.stringify(item));
      }
    }
    for (const item of collectionOf(next, col)) {
      if (!item || typeof item !== 'object' || typeof (item as { id?: unknown }).id !== 'string') continue;
      const id = (item as { id: string }).id;
      const json = JSON.stringify(item);
      if (before.get(id) !== json) dirty.added[col].add(id); // added OR changed
      // Entities that vanished locally are NOT tracked here: entity deletion
      // is the mutation queue's job (see the header comment).
    }
  }
  return dirty;
}

function diffScalars(prev: ProjectSnapshot | null, next: ProjectSnapshot): ScalarField[] {
  const dirty: ScalarField[] = [];
  for (const field of SCALAR_FIELDS) {
    if (!prev || prev[field] !== next[field]) dirty.push(field);
  }
  return dirty;
}

/**
 * Record what changed between the last known-synced mirror copy (`prev`) and
 * the just-saved (`next`) snapshot. Called by vpsStore when the server write
 * fails for network reasons. Unions with existing dirty state — multiple
 * offline saves accumulate, never reset.
 */
export function markDirty(
  projectId: string,
  prev: ProjectSnapshot | null,
  next: ProjectSnapshot,
  baseRevision: number | null
): void {
  const records = readAll();
  const existing = records[projectId];
  const dirty = diffEntities(prev, next);
  if (existing) {
    for (const col of COLLECTIONS) {
      dirty.added[col] = new Set([...existing.dirty.added[col], ...dirty.added[col]]);
    }
  }
  const scalars = [...new Set([...(existing?.scalars ?? []), ...diffScalars(prev, next)])];
  records[projectId] = {
    projectId,
    dirty,
    scalars,
    baseRevision: existing?.baseRevision ?? baseRevision,
    attempts: existing?.attempts ?? 0,
    dirtyAt: existing?.dirtyAt ?? Date.now(),
  };
  writeAll(records);
  logger.warn('offlineOutbox', `marked dirty: ${projectId} (${scalars.length} scalar fields, offline edit queued)`);
}

export function clearDirty(projectId: string): void {
  const records = readAll();
  if (!records[projectId]) return;
  delete records[projectId];
  writeAll(records);
}

export function getRecord(projectId: string): OutboxRecord | null {
  return readAll()[projectId] ?? null;
}

export function getAllRecords(): OutboxRecord[] {
  return Object.values(readAll());
}

export function bumpAttempts(projectId: string): void {
  const records = readAll();
  const rec = records[projectId];
  if (!rec) return;
  rec.attempts += 1;
  writeAll(records);
}

/** Live count for the sidebar badge (subscribe to OUTBOX_CHANGED_EVENT). */
export function countDirty(): number {
  return Object.keys(readAll()).length;
}
