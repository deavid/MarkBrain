import type { Turn } from '../01-dialogue-timeline';
import type { ChapterPartition } from '../02-chapter-segmentation';
import type { Granularity } from '../granularity';
import { normalizeGranularity } from '../granularity';
import {
  ChatAttachment,
  ChatThread,
  ThreadFolder,
  isAttachmentStaged,
  makeDefaultThread,
  makeGenesisChapter,
} from './types';
import { ThreadMetaStore } from './ThreadMetaStore';
import { ThreadAttachmentLedger } from './ThreadAttachmentLedger';
import { ThreadTitlePolicy } from './ThreadTitlePolicy';

export interface ThreadContent {
  turns: Turn[];
  chapters: ChapterPartition[];
}

export interface ThreadHydrateInput {
  projectId: string;
  threads?: ChatThread[];
  folders?: ThreadFolder[];
  turns?: Turn[];
  chapters?: ChapterPartition[];
  activeThreadId?: string;
}

/**
 * What hydrate hands back: the ACTIVE thread's content (loaded into the live
 * domains exactly as before) PLUS every thread's tagged content, which the
 * caller loads into the thread-keyed domains via loadAllTurns/loadAllChapters.
 */
export interface ThreadHydrateResult extends ThreadContent {
  allTurns: Turn[];
  allChapters: ChapterPartition[];
}

/**
 * Legacy and foreign snapshots: attachment arrays may be absent or half-formed.
 * An attachment with no explicit `turnIndex` hydrates as committed at `-1` —
 * "in the chat, provenance unknown" — NOT at turn 0 and NOT as staged. Two
 * failure modes this prevents: resurrecting it into the staged tray sends it a
 * second time; claiming "msg 1" invents a message nobody can point at.
 *
 * `-1` is committed. Only `null` means staged.
 */
/**
 * Merge two attachment lists WITHOUT downgrading provenance: a staged entry
 * (`turnIndex === null`) in `incoming` must never overwrite a committed entry
 * in `existing` (the delta thread row is the client's last save; the turn meta
 * is the server's truth). Committed wins per artifactId; attachments known
 * only to either side are kept.
 */
export function reconcileThreadAttachments(
  existing: ChatAttachment[],
  incoming: ChatAttachment[]
): ChatAttachment[] {
  const byId = new Map<string, ChatAttachment>();
  for (const a of existing) byId.set(a.artifactId, a);
  for (const a of incoming) {
    const prev = byId.get(a.artifactId);
    if (!prev) byId.set(a.artifactId, a);
    else if (isAttachmentStaged(a) && !isAttachmentStaged(prev)) byId.set(a.artifactId, prev); // no downgrade
    else byId.set(a.artifactId, a);
  }
  return [...byId.values()];
}

function normalizeAttachments(raw: unknown): ChatAttachment[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: ChatAttachment[] = [];
  for (const item of raw as any[]) {
    if (!item || typeof item.artifactId !== 'string' || !item.artifactId) continue;
    if (seen.has(item.artifactId)) continue;
    seen.add(item.artifactId);
    const turnIndex =
      item.turnIndex === null
        ? null
        : typeof item.turnIndex === 'number' && Number.isFinite(item.turnIndex)
          ? item.turnIndex
          : -1;
    out.push({
      artifactId: item.artifactId,
      granularity: normalizeGranularity(item.granularity as Granularity, 'full'),
      addedAt: typeof item.addedAt === 'number' ? item.addedAt : Date.now(),
      turnIndex,
      turnId: typeof item.turnId === 'string' ? item.turnId : null,
    });
  }
  return out;
}

/**
 * Hydrate, select, compose: the whole thread picture. A thin facade over the
 * single-phrase modules it composes — the metadata store (threads, folders,
 * the open thread), the attachment ledger, and the title state.
 *
 * Phase 4: this registry no longer owns ANY thread content. Turns and
 * chapters live per-thread in DialogueTimelineDomain and
 * ChapterSegmentationDomain; hydrate hands every thread's tagged content to
 * the caller (loadAllTurns / loadAllChapters), select just re-points the
 * domains, and compose re-groups the domains' allTurns/allChapters into the
 * unchanged snapshot shape.
 */
export class ThreadRegistry {
  private store = new ThreadMetaStore();
  private attachmentsLedger = new ThreadAttachmentLedger(this.store);
  private titles = new ThreadTitlePolicy(this.store);
  private projectId = '';

  subscribe(cb: () => void): () => void {
    return this.store.subscribe(cb);
  }

  getThreads(): ChatThread[] {
    return this.store.getThreads();
  }

  getFolders(): ThreadFolder[] {
    return this.store.getFolders();
  }

  getActiveThreadId(): string {
    return this.store.getActiveThreadId();
  }

  getThread(id: string): ChatThread | null {
    return this.store.getThread(id);
  }

  getAttachments(threadId?: string): ChatAttachment[] {
    return this.attachmentsLedger.getAttachments(threadId);
  }

  getStagedAttachments(threadId?: string): ChatAttachment[] {
    return this.attachmentsLedger.getStagedAttachments(threadId);
  }

  attachArtifact(
    threadId: string,
    artifactId: string,
    granularity?: Granularity,
    turnIndex?: number | null,
    turnId?: string | null
  ): ChatAttachment | null {
    return this.attachmentsLedger.attachArtifact(threadId, artifactId, granularity, turnIndex ?? null, turnId ?? null);
  }

  stageArtifact(threadId: string, artifactId: string, granularity?: Granularity): ChatAttachment | null {
    return this.attachmentsLedger.stageArtifact(threadId, artifactId, granularity);
  }

  unstageArtifact(threadId: string, artifactId: string): boolean {
    return this.attachmentsLedger.unstageArtifact(threadId, artifactId);
  }

  toggleStageOrCycleAttachment(threadId: string, artifactId: string): void {
    return this.attachmentsLedger.toggleStageOrCycleAttachment(threadId, artifactId);
  }

  commitStagedAttachments(threadId: string, turnIndex: number | null, turnId?: string | null): number {
    return this.attachmentsLedger.commitStagedAttachments(threadId, turnIndex, turnId ?? null);
  }

  commitAttachment(threadId: string, artifactId: string, turnIndex: number | null, turnId?: string | null): boolean {
    return this.attachmentsLedger.commitAttachment(threadId, artifactId, turnIndex, turnId ?? null);
  }

  ensureAttached(
    threadId: string,
    artifactId: string,
    turnIndex: number | null,
    turnId?: string | null,
    granularity?: Granularity
  ): boolean {
    return this.attachmentsLedger.ensureAttached(threadId, artifactId, turnIndex, turnId ?? null, granularity);
  }

  setAttachmentGranularity(threadId: string, artifactId: string, granularity: Granularity): void {
    return this.attachmentsLedger.setAttachmentGranularity(threadId, artifactId, granularity);
  }

  purgeArtifact(artifactId: string): void {
    return this.attachmentsLedger.purgeArtifact(artifactId);
  }

  applyAutoTitle(threadId: string, title: string, version: number): boolean {
    return this.titles.applyAutoTitle(threadId, title, version);
  }

  forceAutoTitle(threadId: string, title: string): boolean {
    return this.titles.forceAutoTitle(threadId, title);
  }

  patch(threadId: string, partial: Partial<ChatThread>): void {
    return this.store.patch(threadId, partial);
  }

  rename(threadId: string, title: string): void {
    return this.store.rename(threadId, title);
  }

  createFolder(name: string): ThreadFolder {
    return this.store.createFolder(name);
  }

  renameFolder(folderId: string, name: string): void {
    return this.store.renameFolder(folderId, name);
  }

  deleteFolder(folderId: string): void {
    return this.store.deleteFolder(folderId);
  }

  moveThreadToFolder(threadId: string, folderId: string | null): void {
    return this.store.moveThreadToFolder(threadId, folderId);
  }

  setThreadLifecycle(threadId: string, lifecycle: ChatThread['lifecycle']): void {
    return this.store.setThreadLifecycle(threadId, lifecycle);
  }

  reorderFolderBefore(dragId: string, targetId: string): void {
    return this.store.reorderFolderBefore(dragId, targetId);
  }

  /** Replaces registry metadata from a snapshot and returns every thread's content. Backfills missing threads with "Main". */
  hydrate(input: ThreadHydrateInput): ThreadHydrateResult {
    this.projectId = input.projectId;

    const rawThreads = (input.threads || []).filter((t) => t && t.id);
    let threads =
      rawThreads.length > 0
        ? rawThreads.map((t) => ({ ...t, attachments: normalizeAttachments(t.attachments) }))
        : [makeDefaultThread()];
    const folders = (input.folders || []).map((f) => ({ ...f }));
    // Normalize dangling folder references (folder deleted elsewhere, bad import)
    const folderIds = new Set(folders.map((f) => f.id));
    threads = threads.map((t) => ({
      ...t,
      folderId: t.folderId && folderIds.has(t.folderId) ? t.folderId : null,
    }));

    const known = new Set(threads.map((t) => t.id));
    const fallbackId = threads[0].id;
    const tag = <T extends { threadId?: string }>(item: T): T =>
      item.threadId && known.has(item.threadId) ? item : { ...item, threadId: fallbackId };

    const allTurns = ((input.turns || []) as Turn[]).map(tag);
    const allChapters = ((input.chapters || []) as ChapterPartition[]).map(tag);

    // Attachment provenance from the SERVER's turns (live 2026-10-25, David:
    // "I refreshed, and it does not work"). The thread's attachment list rides
    // the client's last save — a pair that committed server-side (VPS job)
    // left the staged entries `turnIndex: null` in that list, so after a
    // refresh the tray showed them STAGED again (a re-send trap) and the chips
    // never rendered. The turns are the truth: an attachment named in a turn's
    // meta.attachments is IN the chat, whatever the stale thread doc says.
    const provenance = new Map<string, { turnIndex: number; turnId: string | null }>();
    for (const turn of allTurns) {
      const atts = (turn as { meta?: { attachments?: unknown } }).meta?.attachments;
      if (!Array.isArray(atts)) continue;
      for (const att of atts as Array<{ artifactId?: unknown; turnIndex?: unknown; turnId?: unknown }>) {
        if (typeof att.artifactId !== 'string' || !att.artifactId || provenance.has(att.artifactId)) continue;
        const turnIndex =
          typeof att.turnIndex === 'number' && Number.isFinite(att.turnIndex) && att.turnIndex >= 0
            ? att.turnIndex
            : -1; // in the chat, provenance unknown — never staged again
        provenance.set(att.artifactId, {
          turnIndex,
          turnId: typeof att.turnId === 'string' ? att.turnId : null,
        });
      }
    }
    if (provenance.size > 0) {
      threads = threads.map((t) => {
        let changed = false;
        const attachments = t.attachments.map((a) => {
          if (!isAttachmentStaged(a)) return a;
          const prov = provenance.get(a.artifactId);
          if (!prov) return a;
          changed = true;
          return { ...a, turnIndex: prov.turnIndex, turnId: prov.turnId };
        });
        return changed ? { ...t, attachments } : t;
      });
    }

    // AI-attachment law on hydrate (David 2026-10-25: "it is an attachment.
    // It is the same thing"): the reply's extracted artifacts are attachments
    // welded to the reply's turn — committed, Full by default, steerable,
    // compiled into every next context call, never re-staged. Derived from the
    // turns (server truth), not the thread doc's stale attachment list.
    // NOTE: derived from the RAW input turns, BEFORE tagging — unknown thread
    // ids get coerced to the fallback thread by tag(), which would weld a
    // foreign thread's extraction onto the active thread.
    const aiAttached = new Map<string, { turnIndex: number; turnId: string | null; threadId: string }>();
    const perThreadSeq = new Map<string, number>();
    for (const turn of input.turns || []) {
      const tid = (turn as { threadId?: string }).threadId ?? '';
      const n = perThreadSeq.get(tid) ?? 0;
      perThreadSeq.set(tid, n + 1);
      const extracted = (turn as { extractedArtifacts?: unknown }).extractedArtifacts;
      if (!Array.isArray(extracted)) continue;
      for (const ea of extracted as Array<{ id?: unknown; turnIndex?: unknown }>) {
        if (typeof ea.id !== 'string' || !ea.id || aiAttached.has(ea.id)) continue;
        const idx =
          typeof ea.turnIndex === 'number' && Number.isFinite(ea.turnIndex) && ea.turnIndex >= 0
            ? ea.turnIndex
            : n;
        aiAttached.set(ea.id, { turnIndex: idx, turnId: (turn as { id?: string }).id ?? null, threadId: tid });
      }
    }
    if (aiAttached.size > 0) {
      threads = threads.map((t) => {
        let changed = false;
        let attachments = t.attachments.map((a) => {
          if (!isAttachmentStaged(a)) return a;
          const prov = aiAttached.get(a.artifactId);
          if (!prov || prov.threadId !== t.id) return a;
          changed = true;
          return { ...a, turnIndex: prov.turnIndex, turnId: prov.turnId };
        });
        // Missing entries → attach (the registry list is a client-side cache;
        // the turns are the truth about what the AI attached — own thread only).
        for (const [artifactId, prov] of aiAttached) {
          if (prov.threadId !== t.id || attachments.some((a) => a.artifactId === artifactId)) continue;
          changed = true;
          attachments = [
            ...attachments,
            { artifactId, granularity: 'full' as const, addedAt: Date.now(), turnIndex: prov.turnIndex, turnId: prov.turnId },
          ];
        }
        return changed ? { ...t, attachments } : t;
      });
    }

    const preferred = threads.find(
      (t) => t.id === input.activeThreadId && t.lifecycle === 'active'
    );
    const mostRecent = threads
      .filter((t) => t.lifecycle === 'active')
      .sort((a, b) => b.lastActivityAt - a.lastActivityAt)[0];
    const active = preferred || mostRecent || threads[0];
    this.store.install(threads, folders, active.id);

    // Every thread's content, in registry order, tagged with its threadId.
    // A thread with no chapters keeps its Genesis chapter — the invariant the
    // old per-thread cache enforced, now delivered to the thread-keyed domains.
    const turnsByThread = new Map<string, Turn[]>();
    for (const turn of allTurns) {
      const list = turnsByThread.get(turn.threadId!) ?? [];
      list.push(turn);
      turnsByThread.set(turn.threadId!, list);
    }
    const chaptersByThread = new Map<string, ChapterPartition[]>();
    for (const chapter of allChapters) {
      const list = chaptersByThread.get(chapter.threadId!) ?? [];
      list.push(chapter);
      chaptersByThread.set(chapter.threadId!, list);
    }
    const orderedTurns: Turn[] = [];
    const orderedChapters: ChapterPartition[] = [];
    for (const t of threads) {
      orderedTurns.push(...(turnsByThread.get(t.id) ?? []));
      const chapters = chaptersByThread.get(t.id) ?? [];
      orderedChapters.push(...(chapters.length > 0 ? chapters : [makeGenesisChapter(this.projectId, t.id)]));
    }

    return {
      turns: turnsByThread.get(active.id) ?? [],
      chapters:
        (chaptersByThread.get(active.id)?.length ?? 0) > 0
          ? chaptersByThread.get(active.id)!
          : [makeGenesisChapter(this.projectId, active.id)],
      allTurns: orderedTurns,
      allChapters: orderedChapters,
    };
  }

  /**
   * Re-groups the domains' flattened content into the snapshot arrays, tagged
   * with threadId — the SAME shape as always (persistWorker, plaintext export
   * and the tests read it). A registry thread with no chapters on record
   * keeps its Genesis chapter.
   */
  compose(allTurns: Turn[], allChapters: ChapterPartition[]): {
    threads: ChatThread[];
    folders: ThreadFolder[];
    activeThreadId: string;
    turns: Turn[];
    chapters: ChapterPartition[];
  } {
    const activeId = this.getActiveThreadId();
    const turnsByThread = new Map<string, Turn[]>();
    for (const turn of allTurns) {
      const tid = turn.threadId ?? activeId; // untagged turns belong to the open thread
      const list = turnsByThread.get(tid) ?? [];
      list.push(turn);
      turnsByThread.set(tid, list);
    }
    const chaptersByThread = new Map<string, ChapterPartition[]>();
    for (const chapter of allChapters) {
      const tid = chapter.threadId ?? activeId;
      const list = chaptersByThread.get(tid) ?? [];
      list.push(chapter);
      chaptersByThread.set(tid, list);
    }

    const turns: Turn[] = [];
    const chapters: ChapterPartition[] = [];
    for (const t of this.getThreads()) {
      turnsByThread.get(t.id)?.forEach((turn) => turns.push({ ...turn, threadId: t.id }));
      const threadChapters = chaptersByThread.get(t.id) ?? [];
      (threadChapters.length > 0
        ? threadChapters
        : [makeGenesisChapter(this.projectId, t.id)]
      ).forEach((chap) => chapters.push({ ...chap, threadId: t.id }));
    }
    return {
      threads: this.getThreads(),
      folders: this.getFolders(),
      activeThreadId: activeId,
      turns,
      chapters,
    };
  }

  /** Switches the open thread. False = no-op (already open, or unknown id). The caller re-points the domains. */
  select(threadId: string): boolean {
    return this.store.select(threadId);
  }

  /** Creates a thread without selecting it; the caller seeds its genesis chapter. */
  createThread(partial: Partial<ChatThread> = {}): ChatThread {
    return this.store.createThread(partial);
  }

  /** Deletes a thread; deleting the open one falls back (the caller re-points the domains and seeds genesis). */
  deleteThread(threadId: string): void {
    return this.store.deleteThread(threadId);
  }
}
