import type { Granularity } from '../granularity';
import { cycleGranularity } from '../granularity';
import {
  ChatAttachment,
  ChatThread,
  isAttachmentStaged,
} from './types';
import type { ThreadMetaStore } from './ThreadMetaStore';

/**
 * What rides on which turn — the attachment ledger. One thread's list of
 * artifacts with their provenance: staging (armed for the next send),
 * commit (welded to the turn that delivered them), granularity steering,
 * the AI-attachment law, and the garbage collection when an artifact dies.
 */
export class ThreadAttachmentLedger {
  constructor(private store: ThreadMetaStore) {}

  /** A copy: callers may sort or splice it without touching registry state. */
  getAttachments(threadId?: string): ChatAttachment[] {
    const id = threadId || this.store.getActiveThreadId();
    return [...(this.store.getThread(id)?.attachments || [])];
  }

  /** Staged attachments (`turnIndex === null`) — the ones about to ride the next send. */
  getStagedAttachments(threadId?: string): ChatAttachment[] {
    return this.getAttachments(threadId).filter(isAttachmentStaged);
  }

  /** Idempotent: re-attaching never resets the granularity nor moves the turn anchor. */
  attachArtifact(
    threadId: string,
    artifactId: string,
    granularity: Granularity = 'full',
    turnIndex: number | null = null,
    turnId: string | null = null
  ): ChatAttachment | null {
    if (!artifactId || !this.store.getThread(threadId)) return null;
    const existing = this.store.getThread(threadId)?.attachments.find((a) => a.artifactId === artifactId);
    if (existing) return existing;
    const attachment: ChatAttachment = {
      artifactId,
      granularity,
      addedAt: Date.now(),
      turnIndex,
      turnId,
    };
    this.store.mutate(threadId, (thread) => ({
      ...thread,
      attachments: [...thread.attachments, attachment],
      updatedAt: Date.now(),
    }));
    return attachment;
  }

  stageArtifact(
    threadId: string,
    artifactId: string,
    granularity: Granularity = 'full'
  ): ChatAttachment | null {
    return this.attachArtifact(threadId, artifactId, granularity, null, null);
  }

  /** Removes a STAGED attachment. A committed one is a no-op: the turn already happened. Returns true when something was removed. */
  unstageArtifact(threadId: string, artifactId: string): boolean {
    const thread = this.store.getThread(threadId);
    const target = thread?.attachments.find((a) => a.artifactId === artifactId);
    if (!thread || !target || !isAttachmentStaged(target)) return false;
    this.store.mutate(threadId, (t) => ({
      ...t,
      attachments: t.attachments.filter((a) => a.artifactId !== artifactId),
      updatedAt: Date.now(),
    }));
    return true;
  }

  /** Not in chat → stage at Full; staged → unstage; committed → cycle granularity. */
  toggleStageOrCycleAttachment(threadId: string, artifactId: string): void {
    if (!artifactId) return;
    const existing = this.store.getThread(threadId)?.attachments.find((a) => a.artifactId === artifactId);
    if (!existing) {
      this.stageArtifact(threadId, artifactId, 'full');
      return;
    }
    if (isAttachmentStaged(existing)) {
      this.unstageArtifact(threadId, artifactId);
      return;
    }
    this.setAttachmentGranularity(threadId, artifactId, cycleGranularity(existing.granularity));
  }

  /** Welds all staged attachments (`turnIndex === null`) to `turnIndex`/`turnId`. */
  commitStagedAttachments(
    threadId: string,
    turnIndex: number | null,
    turnId: string | null = null
  ): number {
    const thread = this.store.getThread(threadId);
    if (!thread) return 0;
    const staged = thread.attachments.filter(isAttachmentStaged);
    if (staged.length === 0) return 0;
    this.store.mutate(threadId, (t) => ({
      ...t,
      attachments: t.attachments.map((a) =>
        isAttachmentStaged(a) ? { ...a, turnIndex, turnId } : a
      ),
      updatedAt: Date.now(),
    }));
    return staged.length;
  }

  /**
   * Welds ONE attachment to its provenance — the VPS delta mirror of
   * commitStagedAttachments. When a pair commits SERVER-side, the delta turn
   * arrives with meta.attachments carrying turnId + turnIndex; the registry's
   * staged entries must follow (live 2026-10-25: they stayed `null`, so the
   * staged tray never emptied and the chips never rendered on the turn).
   * Unknown artifact ids are ignored (purged elsewhere), non-staged entries
   * keep their granularity.
   */
  commitAttachment(
    threadId: string,
    artifactId: string,
    turnIndex: number | null,
    turnId: string | null = null
  ): boolean {
    if (!artifactId) return false;
    const att = this.store.getThread(threadId)?.attachments.find((a) => a.artifactId === artifactId);
    if (!att || !isAttachmentStaged(att)) return false;
    this.store.mutate(threadId, (t) => ({
      ...t,
      attachments: t.attachments.map((a) =>
        a.artifactId === artifactId ? { ...a, turnIndex, turnId } : a
      ),
      updatedAt: Date.now(),
    }));
    return true;
  }

  /**
   * The AI-attachment law (David 2026-10-25: "it is an attachment. It is the
   * same thing"): artifacts the model extracted during its reply are attached
   * to that reply's turn — committed provenance, Full granularity by default,
   * steerable afterwards, compiled into every next context call, and NEVER
   * re-staged (already attached). Idempotent: an entry that already exists
   * keeps the user's granularity choices; a STAGED entry (user armed it
   * before the reply landed) is welded to the turn instead of duplicated.
   */
  ensureAttached(
    threadId: string,
    artifactId: string,
    turnIndex: number | null,
    turnId: string | null = null,
    granularity: Granularity = 'full'
  ): boolean {
    if (!artifactId) return false;
    const existing = this.store.getThread(threadId)?.attachments.find((a) => a.artifactId === artifactId);
    if (existing) {
      if (!isAttachmentStaged(existing)) return false; // committed — nothing to do
      return this.commitAttachment(threadId, artifactId, turnIndex, turnId);
    }
    this.store.mutate(threadId, (t) => ({
      ...t,
      attachments: [
        ...t.attachments,
        { artifactId, granularity, addedAt: Date.now(), turnIndex, turnId },
      ],
      updatedAt: Date.now(),
    }));
    return true;
  }


  setAttachmentGranularity(
    threadId: string,
    artifactId: string,
    granularity: Granularity
  ): void {
    if (!this.store.getThread(threadId)?.attachments.some((a) => a.artifactId === artifactId)) return;
    this.store.mutate(threadId, (t) => ({
      ...t,
      attachments: t.attachments.map((a) =>
        a.artifactId === artifactId ? { ...a, granularity } : a
      ),
      updatedAt: Date.now(),
    }));
  }

  /** Garbage collection on artifact deletion — NOT a user-facing "detach". */
  purgeArtifact(artifactId: string): void {
    let changed = false;
    const threads = this.store.getThreads().map((t) => {
      if (!t.attachments.some((a) => a.artifactId === artifactId)) return t;
      changed = true;
      return { ...t, attachments: t.attachments.filter((a) => a.artifactId !== artifactId) };
    });
    if (!changed) return;
    // Re-install the purged list and notify once (the store is the owner).
    this.store.install(threads, this.store.getFolders(), this.store.getActiveThreadId());
    this.store.emit();
  }
}
