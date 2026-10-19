/**
 * Legacy snapshot hydration — owned by the persistence facade.
 *
 * Raw stored artifacts are normalized into the canonical domain shape on the
 * way OUT of storage (domain model = source of truth). This is a read-path
 * transform shared by every backend: Firestore docs written by old builds and
 * IndexedDB records from old sessions hydrate the same way.
 */
import { logger } from '../../utils/logger';
import type { ProjectSnapshot } from './projectStore';

/**
 * Hydrate a raw stored artifact into canonical shape (domain model = source
 * of truth): ensure camelCase ids/dates exist and the layered `current`
 * fields (description/summary/body) are populated — from the legacy tier
 * names (description/summary/body) or flat fields when missing.
 * Extra legacy fields ride along untouched (nothing stripped).
 */
export function hydrateArtifact(raw: any, projectId: string): any {
  const cur = raw?.current || {};
  const flatDesc = raw?.description ?? raw?.abstract ?? '';
  return {
    ...raw,
    id: raw?.id || `art-${Math.random().toString(36).slice(2, 10)}`,
    workspaceId: raw?.workspaceId ?? raw?.workspace_id ?? projectId,
    title: raw?.title ?? cur.t0_label ?? cur.title ?? 'Untitled',
    code: raw?.code ?? '',
    category: raw?.category ?? 'note',
    tags: Array.isArray(raw?.tags) ? raw.tags : [],
    createdAt:
      typeof raw?.createdAt === 'number'
        ? raw.createdAt
        : typeof raw?.created_at === 'number'
          ? raw.created_at
          : Date.now(),
    updatedAt:
      typeof raw?.updatedAt === 'number'
        ? raw.updatedAt
        : typeof raw?.updated_at === 'number'
          ? raw.updated_at
          : Date.now(),
    current: {
      description: cur.description ?? cur.description ?? flatDesc,
      summary: cur.summary ?? cur.summary ?? raw?.summary ?? '',
      body: cur.body ?? cur.body ?? raw?.content ?? '',
    },
    // `resolution` was an artifact-level husk the compiler never read; drop it.
    resolution: undefined,
  };
}

/** True when the record is already canonical — no hydration needed. */
function isCanonical(raw: any): boolean {
  return Boolean(
    raw &&
      raw.workspaceId !== undefined &&
      raw.createdAt !== undefined &&
      raw.current &&
      raw.current.description !== undefined &&
      raw.current.body !== undefined
  );
}

/**
 * Legacy turn-meta rename map (pre-collapse writers): only fills MISSING
 * targets — existing canonical values are never overwritten, and extra
 * legacy keys ride along untouched (no storage rewrite; the next auto-save
 * naturally persists the healed meta).
 */
const TURN_META_RENAMES: ReadonlyArray<readonly [target: string, legacy: string]> = [
  ['latencyMs', 'durationMs'], // domain latencyMs had no writer before
  ['inputTokens', 'promptTokens'],
  ['outputTokens', 'candidatesTokens'],
];

/** Backfill one turn's meta. Returns the (possibly copied) meta + whether anything healed. */
function backfillTurnMeta(meta: any): { meta: any; healed: boolean } {
  if (!meta || typeof meta !== 'object') return { meta, healed: false };
  let healed = false;
  let next = meta;
  for (const [target, legacy] of TURN_META_RENAMES) {
    if (next[target] == null && meta[legacy] != null) {
      if (next === meta) next = { ...meta };
      next[target] = meta[legacy];
      healed = true;
    }
  }
  return { meta: next, healed };
}

/** Map a turn array through the meta backfill; bumps healed/seen counters. */
function healTurns(
  turns: any[] | undefined,
  counters: { healed: number; seen: number }
): any[] | undefined {
  if (!Array.isArray(turns)) return turns;
  return turns.map((t: any) => {
    if (!t || !t.meta) return t;
    counters.seen++;
    const { meta, healed } = backfillTurnMeta(t.meta);
    if (healed) counters.healed++;
    return healed ? { ...t, meta } : t;
  });
}

/**
 * Normalize every artifact in a loaded snapshot; one warn per project load.
 * Also backfills legacy turn meta across ALL turn arrays in the snapshot —
 * the top-level `turns` (active + inactive threads are flattened there at
 * the compose boundary) plus any turns embedded in `threads` entries
 * defensively (ChatThread itself carries no turns field today).
 */
export function hydrateSnapshot(snap: ProjectSnapshot): ProjectSnapshot {
  let backfilled = 0;
  const artifacts = (snap.artifacts || []).map((raw: any) => {
    if (isCanonical(raw)) return raw;
    backfilled++;
    return hydrateArtifact(raw, snap.projectId);
  });
  if (backfilled > 0) {
    logger.warn(
      'Persistence',
      `Backfilled ${backfilled}/${artifacts.length} artifacts missing canonical tier fields (legacy flat records)`,
      { projectId: snap.projectId }
    );
  }

  // Chapters: legacy snapshots carry `topicShiftReason` (the model's 1-sentence
  // essence, misfiled) and `keyPoints` (never sent). Map the first onto the
  // description layer; granularity stays absent so the resolver defaults it
  // (open → full, closed → summary).
  const chapters = Array.isArray(snap.chapters)
    ? (snap.chapters.map((c: any) => {
        if (!c || typeof c !== 'object') return c;
        const { topicShiftReason, keyPoints, ...rest } = c;
        return {
          ...rest,
          ...(rest.description === undefined && typeof topicShiftReason === 'string'
            ? { description: topicShiftReason }
            : {}),
        };
      }) as ProjectSnapshot['chapters'])
    : snap.chapters;

  const turnCounters = { healed: 0, seen: 0 };
  const turns = healTurns(snap.turns as any, turnCounters) as ProjectSnapshot['turns'];
  const threads = Array.isArray(snap.threads)
    ? (snap.threads.map((th: any) =>
        Array.isArray(th?.turns) ? { ...th, turns: healTurns(th.turns, turnCounters) } : th
      ) as ProjectSnapshot['threads'])
    : snap.threads;
  if (turnCounters.healed > 0) {
    logger.warn(
      'Persistence',
      `Backfilled ${turnCounters.healed}/${turnCounters.seen} turns with legacy meta (durationMs→latencyMs, prompt/candidatesTokens→input/outputTokens)`,
      { projectId: snap.projectId }
    );
  }

  return { ...snap, artifacts, chapters, turns, threads };
}
