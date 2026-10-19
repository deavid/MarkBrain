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
 * of truth): ensure camelCase ids/dates exist and `current.t0..t3` tiers are
 * populated — synthesizing tiers from legacy flat description/summary/content
 * when missing. Extra legacy fields ride along untouched (nothing stripped).
 */
export function hydrateArtifact(raw: any, projectId: string): any {
  const cur = raw?.current || {};
  const flatDesc = raw?.description ?? raw?.abstract ?? '';
  return {
    ...raw,
    id: raw?.id || `art-${Math.random().toString(36).slice(2, 10)}`,
    workspaceId: raw?.workspaceId ?? raw?.workspace_id ?? projectId,
    title: raw?.title ?? cur.t0_label ?? 'Untitled',
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
      t0_label: cur.t0_label ?? raw?.title ?? 'Untitled',
      t1_abstract: cur.t1_abstract ?? flatDesc,
      t2_summary: cur.t2_summary ?? raw?.summary ?? '',
      t3_body: cur.t3_body ?? raw?.content ?? '',
    },
  };
}

/** True when the record is already canonical — no hydration needed. */
function isCanonical(raw: any): boolean {
  return Boolean(
    raw &&
      raw.workspaceId !== undefined &&
      raw.createdAt !== undefined &&
      raw.current &&
      raw.current.t0_label !== undefined &&
      raw.current.t3_body !== undefined
  );
}

/** Normalize every artifact in a loaded snapshot; one warn per project load. */
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
  return { ...snap, artifacts };
}
