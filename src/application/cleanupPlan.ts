/**
 * Cleanup planning — the deletion law, pure and unit-tested.
 *
 * Two rules live here and nowhere else:
 *   1. Only an ARCHIVED item may be permanently deleted. Archiving is the door.
 *   2. An artifact dies only when no ACTIVE chat still points at it. Archived
 *      chats that point at it are either detached (default) or — when the user
 *      asks for the cascade — deleted along with it.
 *
 * This module decides; the caller destroys. Nothing here mutates anything.
 */
import type { ChatThread } from '../domains/06-chat-threads';
import { threadsReferencingArtifact } from '../domains/06-chat-threads';
import type { UniversalArtifactDocument } from '../domains/01-artifact-document';
import { isArtifactArchived } from '../domains/01-artifact-document';

export type CleanupSkipReason = 'missing' | 'not-archived' | 'referenced-by-active-chat';

export interface CleanupSkip {
  kind: 'thread' | 'artifact';
  id: string;
  title: string;
  reason: CleanupSkipReason;
  /** For `referenced-by-active-chat`: the chats that must be archived first. */
  blockers?: Array<{ threadId: string; title: string }>;
}

export interface CleanupDetach {
  artifactId: string;
  title: string;
  threadIds: string[];
}

export interface CleanupPlan {
  threadsToDelete: string[];
  artifactsToDelete: string[];
  /** Archived chats the cascade deletes too — only when the user asked for it. */
  cascadeThreads: string[];
  /** Archived chats that survive and lose the attachment. Informational: the purge takes it everywhere. */
  detach: CleanupDetach[];
  skipped: CleanupSkip[];
}

export interface CleanupRequest {
  threadIds: string[];
  artifactIds: string[];
  threads: ChatThread[];
  artifacts: UniversalArtifactDocument[];
  /** Archived chats referencing a doomed artifact: delete them too instead of only detaching. */
  deleteReferencingArchivedChats: boolean;
}

export function planCleanup(req: CleanupRequest): CleanupPlan {
  const threadsById = new Map(req.threads.map((t) => [t.id, t]));
  const artifactsById = new Map(req.artifacts.map((a) => [a.id, a]));
  const skipped: CleanupSkip[] = [];

  const threadsToDelete: string[] = [];
  for (const id of req.threadIds) {
    const thread = threadsById.get(id);
    if (!thread) {
      skipped.push({ kind: 'thread', id, title: id, reason: 'missing' });
      continue;
    }
    if (thread.lifecycle !== 'archived') {
      skipped.push({ kind: 'thread', id, title: thread.title, reason: 'not-archived' });
      continue;
    }
    threadsToDelete.push(id);
  }

  const cascade = new Set<string>();
  const artifactsToDelete: string[] = [];
  const detach: CleanupDetach[] = [];

  for (const id of req.artifactIds) {
    const artifact = artifactsById.get(id);
    if (!artifact) {
      skipped.push({ kind: 'artifact', id, title: id, reason: 'missing' });
      continue;
    }
    if (!isArtifactArchived(artifact)) {
      skipped.push({ kind: 'artifact', id, title: artifact.title, reason: 'not-archived' });
      continue;
    }

    // Chats dying in this same pass no longer count as references.
    const referencing = threadsReferencingArtifact(req.threads, id).filter(
      (t) => !threadsToDelete.includes(t.id)
    );
    const blockers = referencing.filter((t) => t.lifecycle !== 'archived');
    if (blockers.length > 0) {
      skipped.push({
        kind: 'artifact',
        id,
        title: artifact.title,
        reason: 'referenced-by-active-chat',
        blockers: blockers.map((t) => ({ threadId: t.id, title: t.title })),
      });
      continue;
    }

    const archivedRefs = referencing.filter((t) => t.lifecycle === 'archived');
    if (archivedRefs.length > 0) {
      if (req.deleteReferencingArchivedChats) {
        archivedRefs.forEach((t) => cascade.add(t.id));
      } else {
        detach.push({
          artifactId: id,
          title: artifact.title,
          threadIds: archivedRefs.map((t) => t.id),
        });
      }
    }
    artifactsToDelete.push(id);
  }

  return {
    threadsToDelete,
    artifactsToDelete,
    cascadeThreads: Array.from(cascade).filter((id) => !threadsToDelete.includes(id)),
    detach,
    skipped,
  };
}

/** True when the plan would not destroy anything — the confirm step stays shut. */
export function planIsEmpty(plan: CleanupPlan): boolean {
  return plan.threadsToDelete.length === 0 && plan.artifactsToDelete.length === 0;
}

/** Chats that must be archived before an artifact in `skipped` can be destroyed. */
export function blockingThreadIds(plan: CleanupPlan): string[] {
  const ids = new Set<string>();
  plan.skipped.forEach((s) => s.blockers?.forEach((b) => ids.add(b.threadId)));
  return Array.from(ids);
}
