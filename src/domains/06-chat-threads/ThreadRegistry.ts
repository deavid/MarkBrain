import type { Turn } from '../01-dialogue-timeline';
import type { ChapterPartition } from '../02-chapter-segmentation';
import type { Granularity } from '../granularity';
import { cycleGranularity, normalizeGranularity } from '../granularity';
import {
  ChatAttachment,
  ChatThread,
  ThreadFolder,
  isAttachmentStaged,
  makeDefaultThread,
  makeGenesisChapter,
  makeThreadId,
} from './types';

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

const rand = () => Math.random().toString(36).slice(2, 6);

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
      granularity: normalizeGranularity(item.granularity, 'full'),
      addedAt: typeof item.addedAt === 'number' ? item.addedAt : Date.now(),
      turnIndex,
      turnId: typeof item.turnId === 'string' ? item.turnId : null,
    });
  }
  return out;
}

/**
 * Owner of thread/folder metadata plus the content of every INACTIVE thread in
 * the active project.
 *
 * The split-brain invariant — the whole design in four lines:
 *   - the LIVE domains hold ONLY the active thread's turns and chapters;
 *     this registry's inactive map holds everyone else's;
 *   - `select()` flushes live → cache for the outgoing thread and hands the
 *     incoming thread's content to the live domains;
 *   - `compose()` re-flattens both halves for the snapshot save.
 *
 * Background generation writes through the appendInactiveTurn /
 * updateInactiveTurn / declareChapterInactive methods, with the same Turn and
 * Chapter shapes, so a later select() is seamless. Writing an inactive thread
 * through the live domains instead would corrupt the visible conversation.
 */
export class ThreadRegistry {
  private threads: ChatThread[] = [];
  private folders: ThreadFolder[] = [];
  private activeId = '';
  private projectId = '';
  private inactive = new Map<string, ThreadContent>();
  private listeners: Set<() => void> = new Set();

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(): void {
    this.listeners.forEach((l) => l());
  }

  getThreads(): ChatThread[] {
    return [...this.threads];
  }

  getFolders(): ThreadFolder[] {
    return [...this.folders];
  }

  getActiveThreadId(): string {
    return this.activeId;
  }

  getThread(id: string): ChatThread | null {
    return this.threads.find((t) => t.id === id) || null;
  }

  /** A copy: callers may sort or splice it without touching registry state. */
  getAttachments(threadId?: string): ChatAttachment[] {
    const id = threadId || this.activeId;
    return [...(this.getThread(id)?.attachments || [])];
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
    const idx = this.threads.findIndex((t) => t.id === threadId);
    if (idx === -1 || !artifactId) return null;
    const thread = this.threads[idx];
    const existing = thread.attachments.find((a) => a.artifactId === artifactId);
    if (existing) return existing;
    const attachment: ChatAttachment = {
      artifactId,
      granularity,
      addedAt: Date.now(),
      turnIndex,
      turnId,
    };
    this.threads[idx] = {
      ...thread,
      attachments: [...thread.attachments, attachment],
      updatedAt: Date.now(),
    };
    this.emit();
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
    const idx = this.threads.findIndex((t) => t.id === threadId);
    if (idx === -1) return false;
    const thread = this.threads[idx];
    const target = thread.attachments.find((a) => a.artifactId === artifactId);
    if (!target || !isAttachmentStaged(target)) return false;
    this.threads[idx] = {
      ...thread,
      attachments: thread.attachments.filter((a) => a.artifactId !== artifactId),
      updatedAt: Date.now(),
    };
    this.emit();
    return true;
  }

  /** Not in chat → stage at Full; staged → unstage; committed → cycle granularity. */
  toggleStageOrCycleAttachment(threadId: string, artifactId: string): void {
    const idx = this.threads.findIndex((t) => t.id === threadId);
    if (idx === -1 || !artifactId) return;
    const thread = this.threads[idx];
    const existing = thread.attachments.find((a) => a.artifactId === artifactId);
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
    const idx = this.threads.findIndex((t) => t.id === threadId);
    if (idx === -1) return 0;
    const thread = this.threads[idx];
    const staged = thread.attachments.filter(isAttachmentStaged);
    if (staged.length === 0) return 0;
    this.threads[idx] = {
      ...thread,
      attachments: thread.attachments.map((a) =>
        isAttachmentStaged(a) ? { ...a, turnIndex, turnId } : a
      ),
      updatedAt: Date.now(),
    };
    this.emit();
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
    const idx = this.threads.findIndex((t) => t.id === threadId);
    if (idx === -1 || !artifactId) return false;
    const thread = this.threads[idx];
    const att = thread.attachments.find((a) => a.artifactId === artifactId);
    if (!att || !isAttachmentStaged(att)) return false;
    this.threads[idx] = {
      ...thread,
      attachments: thread.attachments.map((a) =>
        a.artifactId === artifactId ? { ...a, turnIndex, turnId } : a
      ),
      updatedAt: Date.now(),
    };
    this.emit();
    return true;
  }

  setAttachmentGranularity(
    threadId: string,
    artifactId: string,
    granularity: Granularity
  ): void {
    const idx = this.threads.findIndex((t) => t.id === threadId);
    if (idx === -1) return;
    const thread = this.threads[idx];
    if (!thread.attachments.some((a) => a.artifactId === artifactId)) return;
    this.threads[idx] = {
      ...thread,
      attachments: thread.attachments.map((a) =>
        a.artifactId === artifactId ? { ...a, granularity } : a
      ),
      updatedAt: Date.now(),
    };
    this.emit();
  }

  /** Garbage collection on artifact deletion — NOT a user-facing "detach". */
  purgeArtifact(artifactId: string): void {
    let changed = false;
    this.threads = this.threads.map((t) => {
      if (!t.attachments.some((a) => a.artifactId === artifactId)) return t;
      changed = true;
      return { ...t, attachments: t.attachments.filter((a) => a.artifactId !== artifactId) };
    });
    if (changed) this.emit();
  }

  /** Null for the active thread. */
  getInactiveContent(threadId: string): ThreadContent | null {
    if (threadId === this.activeId) return null;
    let content = this.inactive.get(threadId);
    if (!content) {
      content = { turns: [], chapters: [makeGenesisChapter(this.projectId, threadId)] };
      this.inactive.set(threadId, content);
    }
    return content;
  }

  /** Replaces registry state from a snapshot and returns the active thread's content. Backfills missing threads with "Main". */
  hydrate(input: ThreadHydrateInput): ThreadContent {
    this.projectId = input.projectId;
    this.inactive.clear();

    const rawThreads = (input.threads || []).filter((t) => t && t.id);
    this.threads =
      rawThreads.length > 0
        ? rawThreads.map((t) => ({ ...t, attachments: normalizeAttachments(t.attachments) }))
        : [makeDefaultThread()];
    this.folders = (input.folders || []).map((f) => ({ ...f }));
    // Normalize dangling folder references (folder deleted elsewhere, bad import)
    const folderIds = new Set(this.folders.map((f) => f.id));
    this.threads = this.threads.map((t) => ({
      ...t,
      folderId: t.folderId && folderIds.has(t.folderId) ? t.folderId : null,
    }));

    const known = new Set(this.threads.map((t) => t.id));
    const fallbackId = this.threads[0].id;
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
      this.threads = this.threads.map((t) => {
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

    const preferred = this.threads.find(
      (t) => t.id === input.activeThreadId && t.lifecycle === 'active'
    );
    const mostRecent = this.threads
      .filter((t) => t.lifecycle === 'active')
      .sort((a, b) => b.lastActivityAt - a.lastActivityAt)[0];
    const active = preferred || mostRecent || this.threads[0];
    this.activeId = active.id;

    const contentOf = (id: string): ThreadContent => {
      const turns = allTurns.filter((t) => (t as any).threadId === id);
      let chapters = allChapters.filter((c) => (c as any).threadId === id);
      if (chapters.length === 0) chapters = [makeGenesisChapter(this.projectId, id)];
      return { turns, chapters };
    };

    const activeContent = contentOf(active.id);
    for (const t of this.threads) {
      if (t.id === active.id) continue;
      this.inactive.set(t.id, contentOf(t.id));
    }
    return activeContent;
  }

  /** Flattens live + cached turns/chapters into snapshot arrays tagged with `threadId`. */
  compose(activeTurns: Turn[], activeChapters: ChapterPartition[]): {
    threads: ChatThread[];
    folders: ThreadFolder[];
    activeThreadId: string;
    turns: Turn[];
    chapters: ChapterPartition[];
  } {
    const turns: Turn[] = [];
    const chapters: ChapterPartition[] = [];
    for (const t of this.threads) {
      const content =
        t.id === this.activeId
          ? { turns: activeTurns, chapters: activeChapters }
          : this.inactive.get(t.id) || {
              turns: [],
              chapters: [makeGenesisChapter(this.projectId, t.id)],
            };
      content.turns.forEach((turn) => turns.push({ ...turn, threadId: t.id }));
      content.chapters.forEach((chap) => chapters.push({ ...chap, threadId: t.id }));
    }
    return {
      threads: this.threads,
      folders: this.folders,
      activeThreadId: this.activeId,
      turns,
      chapters,
    };
  }

  /** Flushes `live` into the outgoing thread's cache; returns the incoming thread's content. Null = no-op. */
  select(threadId: string, live: ThreadContent): ThreadContent | null {
    if (threadId === this.activeId) return null;
    if (!this.threads.some((t) => t.id === threadId)) return null;
    this.inactive.set(this.activeId, { turns: live.turns, chapters: live.chapters });
    this.activeId = threadId;
    let incoming = this.inactive.get(threadId);
    this.inactive.delete(threadId);
    if (!incoming) {
      incoming = { turns: [], chapters: [makeGenesisChapter(this.projectId, threadId)] };
    }
    this.emit();
    return incoming;
  }

  /** Creates a thread without selecting it; seeds its cache with a genesis chapter. */
  createThread(partial: Partial<ChatThread> = {}): ChatThread {
    const thread: ChatThread = {
      id: makeThreadId(),
      folderId: null,
      title: 'New thread',
      titleState: 'placeholder',
      titleVersion: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastActivityAt: Date.now(),
      lifecycle: 'active',
      lastOutcome: 'ok',
      preview: '',
      attachments: [],
      ...partial,
    };
    this.threads.unshift(thread);
    this.inactive.set(thread.id, {
      turns: [],
      chapters: [makeGenesisChapter(this.projectId, thread.id)],
    });
    this.emit();
    return thread;
  }

  /** Discards live content if the active thread is deleted; returns the fallback thread's content. Null when no switch is needed. */
  deleteThread(threadId: string): ThreadContent | null {
    const idx = this.threads.findIndex((t) => t.id === threadId);
    if (idx === -1) return null;
    this.threads.splice(idx, 1);
    this.inactive.delete(threadId);

    if (this.activeId !== threadId) {
      this.emit();
      return null;
    }

    let next =
      this.threads
        .filter((t) => t.lifecycle === 'active')
        .sort((a, b) => b.lastActivityAt - a.lastActivityAt)[0] || null;
    if (!next) {
      next = makeDefaultThread();
      this.threads.push(next);
    }
    this.activeId = next.id;
    let incoming = this.inactive.get(next.id);
    this.inactive.delete(next.id);
    if (!incoming) {
      incoming = { turns: [], chapters: [makeGenesisChapter(this.projectId, next.id)] };
    }
    this.emit();
    return incoming;
  }

  /** Shallow merge of metadata. Not for turns, chapters or attachments. */
  patch(threadId: string, partial: Partial<ChatThread>): void {
    const idx = this.threads.findIndex((t) => t.id === threadId);
    if (idx === -1) return;
    this.threads[idx] = { ...this.threads[idx], ...partial, updatedAt: Date.now() };
    this.emit();
  }

  /** Manual rename → permanent lock. */
  rename(threadId: string, title: string): void {
    const clean = title.replace(/\s+/g, ' ').trim();
    if (!clean) return;
    this.patch(threadId, { title: clean, titleState: 'manual' });
  }

  createFolder(name: string): ThreadFolder {
    const folder: ThreadFolder = {
      id: `folder-${Date.now().toString(36)}-${rand()}`,
      name: name.replace(/\s+/g, ' ').trim() || 'New Folder',
      order: this.folders.reduce((max, f) => Math.max(max, f.order), -1) + 1,
    };
    this.folders.push(folder);
    this.emit();
    return folder;
  }

  renameFolder(folderId: string, name: string): void {
    const clean = name.replace(/\s+/g, ' ').trim();
    if (!clean) return;
    const idx = this.folders.findIndex((f) => f.id === folderId);
    if (idx === -1) return;
    this.folders[idx] = { ...this.folders[idx], name: clean };
    this.emit();
  }

  /** Deletes the folder; its threads return to Inbox (`folderId = null`). */
  deleteFolder(folderId: string): void {
    this.folders = this.folders.filter((f) => f.id !== folderId);
    this.threads = this.threads.map((t) =>
      t.folderId === folderId ? { ...t, folderId: null, updatedAt: Date.now() } : t
    );
    this.emit();
  }

  moveThreadToFolder(threadId: string, folderId: string | null): void {
    if (folderId !== null && !this.folders.some((f) => f.id === folderId)) return;
    this.patch(threadId, { folderId });
  }

  setThreadLifecycle(threadId: string, lifecycle: ChatThread['lifecycle']): void {
    this.patch(threadId, { lifecycle });
  }

  reorderFolderBefore(dragId: string, targetId: string): void {
    if (dragId === targetId) return;
    const ordered = [...this.folders].sort((a, b) => a.order - b.order);
    const from = ordered.findIndex((f) => f.id === dragId);
    const to = ordered.findIndex((f) => f.id === targetId);
    if (from === -1 || to === -1) return;
    const [moved] = ordered.splice(from, 1);
    const newTo = ordered.findIndex((f) => f.id === targetId);
    ordered.splice(newTo === -1 ? ordered.length : newTo, 0, moved);
    ordered.forEach((f, i) => (f.order = i));
    this.folders = ordered;
    this.emit();
  }

  /** Never downgrades a newer title version and never touches a manual lock. */
  applyAutoTitle(threadId: string, title: string, version: number): boolean {
    const thread = this.getThread(threadId);
    if (!thread || thread.titleState === 'manual') return false;
    if (version <= thread.titleVersion) return false;
    const clean = title.replace(/\s+/g, ' ').trim();
    if (!clean) return false;
    this.patch(threadId, { title: clean, titleState: 'auto', titleVersion: version });
    return true;
  }

  /** Explicit user action: overrides even a manual lock and sets `titleVersion = 2`. */
  forceAutoTitle(threadId: string, title: string): boolean {
    const clean = title.replace(/\s+/g, ' ').trim();
    if (!clean || !this.getThread(threadId)) return false;
    this.patch(threadId, { title: clean, titleState: 'auto', titleVersion: 2 });
    return true;
  }

  appendInactiveTurn(
    threadId: string,
    role: 'user' | 'assistant' | 'system',
    content: string,
    extractedArtifacts?: any[],
    meta?: any
  ): Turn | null {
    if (threadId === this.activeId) return null;
    const target = this.getInactiveContent(threadId);
    if (!target) return null;
    const turn: Turn = {
      id: `turn-${Date.now()}-${rand()}`,
      role,
      content,
      timestamp: Date.now(),
      extractedArtifacts,
      meta,
      threadId,
    };
    target.turns.push(turn);
    this.emit();
    return turn;
  }

  updateInactiveTurn(threadId: string, turnId: string, partial: Partial<Turn>): void {
    if (threadId === this.activeId) return;
    const target = this.getInactiveTurns(threadId);
    if (!target) return;
    const idx = target.findIndex((t) => t.id === turnId);
    if (idx === -1) return;
    target[idx] = { ...target[idx], ...partial };
    this.emit();
  }

  /**
   * Topic-shift law for inactive threads (mirror of the segmentation domain's
   * upsertChapterAtBoundary): a cut that already exists at startIndex is
   * retitled, never duplicated.
   */
  upsertChapterAtBoundaryInactive(
    threadId: string,
    title: string,
    startIndex: number,
    subtitle?: string,
    description?: string,
    summary?: string
  ): ChapterPartition | null {
    if (threadId === this.activeId) return null;
    const target = this.getInactiveContent(threadId);
    if (!target) return null;
    const existing = target.chapters.find((c) => c.startIndex === startIndex);
    if (existing) {
      existing.title = title;
      existing.subtitle = subtitle || existing.subtitle || '';
      existing.description = description || existing.description || '';
      existing.summary = summary || existing.summary || '';
      existing.status = 'active';
      existing.endIndex = undefined;
      this.emit();
      return existing;
    }
    return this.declareChapterInactive(threadId, title, startIndex, subtitle, description, summary);
  }

  /** Server delta merge: chapters of an INACTIVE thread land in its cache (by id). */
  mergeInactiveChapters(threadId: string, incoming: ChapterPartition[]): void {
    if (threadId === this.activeId || incoming.length === 0) return;
    const target = this.getInactiveContent(threadId);
    if (!target) return; // unknown thread — hydration owns it on first switch
    const merged = [...target.chapters];
    for (const ch of incoming) {
      const idx = merged.findIndex((c) => c.id === ch.id);
      if (idx >= 0) merged[idx] = ch;
      else merged.push(ch);
    }
    merged.sort((a, b) => a.startIndex - b.startIndex);
    target.chapters = merged;
    this.emit();
  }

  declareChapterInactive(
    threadId: string,
    title: string,
    startIndex: number,
    subtitle?: string,
    description?: string,
    summary?: string
  ): ChapterPartition | null {
    if (threadId === this.activeId) return null;
    const target = this.getInactiveContent(threadId);
    if (!target) return null;
    target.chapters.forEach((c) => {
      if (c.status === 'active') {
        c.status = 'completed';
        if (c.endIndex === undefined) c.endIndex = startIndex;
        // The cut is untouched: sealing a window never downgrades what is sent.
      }
    });
    const chapter: ChapterPartition = {
      id: `chap-${Date.now()}-${rand()}`,
      workspaceId: this.projectId,
      threadId,
      title,
      subtitle: subtitle || '',
      description: description || '',
      summary: summary || '',
      granularity: 'full',
      status: 'active',
      startIndex,
      createdAt: Date.now(),
    };
    target.chapters.push(chapter);
    this.emit();
    return chapter;
  }

  private getInactiveTurns(threadId: string): Turn[] | null {
    const target = this.getInactiveContent(threadId);
    return target ? target.turns : null;
  }
}