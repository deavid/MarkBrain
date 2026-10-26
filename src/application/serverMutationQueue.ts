/**
 * serverMutationQueue — explicit deletes that MUST reach the VPS (design 21D §2.4).
 *
 * Found live 2026-10-26: deleting a thread/folder/artifact only mutated the
 * local domains. The debounced snapshot save is upsert-only server-side (the
 * anti-clobber law: a stale snapshot must never delete rows), so the deleted
 * row survived on the VPS and resurrected on the next refresh. The
 * POST /api/projects/:id/mutate endpoint (deleteThread / deleteFolder /
 * deleteArtifact ops, tombstoned) existed but nothing in the client called it.
 *
 * Law: user-facing deletes are QUEUED here and flushed to /mutate. The queue
 * persists in localStorage so a refresh inside the debounce window cannot
 * resurrect the deletion. Deltas (server-initiated tombstones) never queue —
 * they are the result, not the cause.
 */
import { apiFetch } from '../gateway/api';
import { getWorkspaceMode } from '../services/workspaceSession';
import { logger } from '../utils/logger';
import { isCaptureMode } from '../services/persistenceService';

export type ServerMutation =
  | { op: 'deleteThread'; threadId: string }
  | { op: 'deleteFolder'; folderId: string }
  | { op: 'deleteArtifact'; artifactId: string };

const STORAGE_KEY = 'markbrain-pending-mutations:v1';

type StoredMutation = ServerMutation & { projectId: string };

/** localStorage may not exist in node test envs — in-memory fallback keeps the law testable. */
const memoryStore: StoredMutation[] = [];

function hasLocalStorage(): boolean {
  return typeof localStorage !== 'undefined';
}

function readQueue(): StoredMutation[] {
  if (!hasLocalStorage()) return memoryStore;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as StoredMutation[]) : [];
  } catch {
    return [];
  }
}

function writeQueue(queue: StoredMutation[]): void {
  if (!hasLocalStorage()) {
    memoryStore.length = 0;
    memoryStore.push(...queue);
    return;
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
  } catch (err) {
    logger.warn('ServerMutationQueue', 'Could not persist pending delete mutations', err);
  }
}

/** Queues a user-initiated deletion for the VPS. No-op outside VPS mode and in capture runs. */
export function queueServerMutation(projectId: string | null, mutation: ServerMutation): void {
  if (!projectId) return;
  if (getWorkspaceMode() !== 'vps') return;
  if (isCaptureMode()) return;
  const queue = readQueue();
  const key = (m: StoredMutation) => `${m.op}:${m.projectId}:${entityId(m)}`;
  if (queue.some((m) => key(m) === key({ ...mutation, projectId }))) return; // idempotent
  queue.push({ ...mutation, projectId });
  writeQueue(queue);
  logger.action('ServerMutationQueue', `Queued ${mutation.op} for ${projectId}`);
}

function entityId(m: StoredMutation): string {
  if (m.op === 'deleteThread') return m.threadId;
  if (m.op === 'deleteFolder') return m.folderId;
  return m.artifactId;
}

export function pendingMutationCount(projectId: string): number {
  return readQueue().filter((m) => m.projectId === projectId).length;
}

/**
 * Flushes every queued mutation for this project in ONE /mutate call. Succeeded
 * mutations leave the queue; failures stay (the next delta tick retries).
 */
export async function flushServerMutations(projectId: string): Promise<void> {
  const queue = readQueue();
  const mine = queue.filter((m) => m.projectId === projectId);
  if (mine.length === 0) return;
  try {
    const res = await apiFetch(`/api/projects/${encodeURIComponent(projectId)}/mutate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mutations: mine.map(({ projectId: _p, ...op }) => op) }),
    });
    if (!res.ok) {
      logger.warn('ServerMutationQueue', `Flush failed: HTTP ${res.status} — ${mine.length} delete(s) stay queued`);
      return;
    }
    const done = new Set(mine.map((m) => `${m.op}:${m.projectId}:${entityId(m)}`));
    writeQueue(readQueue().filter((m) => !done.has(`${m.op}:${m.projectId}:${entityId(m)}`)));
    logger.action('ServerMutationQueue', `Flushed ${mine.length} delete mutation(s) for ${projectId}`);
  } catch (err) {
    // Offline — the queue survives; the next delta tick retries.
    logger.warn('ServerMutationQueue', 'Flush failed (offline?) — deletes stay queued', err);
  }
}