import type { Turn } from '../01-dialogue-timeline';
import type { ChapterPartition } from '../02-chapter-segmentation';
import type { Granularity } from '../granularity';
import { normalizeGranularity, sealedGranularity } from '../granularity';
import {
  ChatAttachment,
  ChatThread,
  ThreadFolder,
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

/** Legacy/foreign snapshots: attachment arrays may be absent or half-formed. */
function normalizeAttachments(raw: unknown): ChatAttachment[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: ChatAttachment[] = [];
  for (const item of raw as any[]) {
    if (!item || typeof item.artifactId !== 'string' || !item.artifactId) continue;
    if (seen.has(item.artifactId)) continue;
    seen.add(item.artifactId);
    out.push({
      artifactId: item.artifactId,
      granularity: normalizeGranularity(item.granularity, 'full'),
      addedAt: typeof item.addedAt === 'number' ? item.addedAt : Date.now(),
    });
  }
  return out;
}

/**
 * ThreadRegistry — owner of thread/folder metadata + the content of every
 * INACTIVE thread in the active project.
 *
 * Split-brain invariant (the whole design in one line):
 *   - LIVE domains (timeline/segmentation) hold ONLY the active thread's
 *     turns/chapters; the registry's inactive map holds everyone else's.
 *   - `select()` flushes live → cache for the outgoing thread and pops the
 *     incoming thread's content for the live domains to load.
 *   - `compose()` re-flattens both halves for the snapshot save.
 *
 * Mutations on inactive threads (background generation streaming into a
 * thread you're not looking at) go through appendInactiveTurn /
 * updateInactiveTurn / declareChapterInactive — same Turn/Chapter shapes,
 * so a later select() is seamless.
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

  // ── Queries ────────────────────────────────────────────────────────────

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

  /** Attachments of a thread (defaults to the active one), in attach order. */
  getAttachments(threadId?: string): ChatAttachment[] {
    const id = threadId || this.activeId;
    return [...(this.getThread(id)?.attachments || [])];
  }

  // ── Attachments (per chat — the unit that carries granularity) ─────────

  /**
   * Attach an artifact to a chat. Idempotent: an already-attached artifact is
   * left exactly as it is (RE-ATTACHING never resets a user's granularity).
   */
  attachArtifact(
    threadId: string,
    artifactId: string,
    granularity: Granularity = 'full'
  ): ChatAttachment | null {
    const idx = this.threads.findIndex((t) => t.id === threadId);
    if (idx === -1 || !artifactId) return null;
    const thread = this.threads[idx];
    const existing = thread.attachments.find((a) => a.artifactId === artifactId);
    if (existing) return existing;
    const attachment: ChatAttachment = { artifactId, granularity, addedAt: Date.now() };
    this.threads[idx] = {
      ...thread,
      attachments: [...thread.attachments, attachment],
      updatedAt: Date.now(),
    };
    this.emit();
    return attachment;
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

  /**
   * The artifact left the library — drop every dangling attachment. This is
   * garbage collection on artifact deletion, NOT a user-facing "detach".
   */
  purgeArtifact(artifactId: string): void {
    let changed = false;
    this.threads = this.threads.map((t) => {
      if (!t.attachments.some((a) => a.artifactId === artifactId)) return t;
      changed = true;
      return { ...t, attachments: t.attachments.filter((a) => a.artifactId !== artifactId) };
    });
    if (changed) this.emit();
  }

  /** Content of a NON-active thread (auto-seeds genesis chapter). Null for the active one. */
  getInactiveContent(threadId: string): ThreadContent | null {
    if (threadId === this.activeId) return null;
    let content = this.inactive.get(threadId);
    if (!content) {
      content = { turns: [], chapters: [makeGenesisChapter(this.projectId, threadId)] };
      this.inactive.set(threadId, content);
    }
    return content;
  }

  // ── Snapshot hydration ────────────────────────────────────────────────

  /**
   * Replace ALL registry state from a loaded snapshot and return the ACTIVE
   * thread's content for the live domains. Normalizes legacy snapshots:
   * missing threads → one default "Main" thread; turns/chapters without a
   * known threadId → assigned to the first thread.
   */
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

  /**
   * Flatten live (active) + cached (inactive) into snapshot arrays. Every
   * turn/chapter is tagged with its owning threadId at this boundary.
   */
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

  // ── Thread lifecycle ──────────────────────────────────────────────────

  /**
   * Switch the active thread. `live` is the outgoing thread's current live
   * content (flushed to cache); returns the incoming thread's content for
   * the caller to load into timeline/segmentation. Null = no-op.
   */
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

  /**
   * Create a thread (NOT selected). Seeds its cache entry so a follow-up
   * select() finds empty content + genesis chapter.
   */
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

  /**
   * Delete a thread. When the ACTIVE thread dies, its live content is
   * discarded (not flushed) and a fallback thread becomes active — returns
   * its content for the caller to load. Returns null when no switch needed.
   */
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

  /** Merge metadata into a thread (preview, lastOutcome, activity, …). */
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

  // ── Folders (one level deep — Inbox is folderId null) ─────────────────

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

  /**
   * Delete a folder — its threads RETURN TO INBOX (never deleted with it).
   * Dangling references are rehomed here in one pass before emit.
   */
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

  /** Drag-reorder: place `dragId` immediately before `targetId`, renumber. */
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

  /**
   * Auto-title from the pipeline. Never downgrades a newer version, never
   * touches a manual lock.
   */
  applyAutoTitle(threadId: string, title: string, version: number): boolean {
    const thread = this.getThread(threadId);
    if (!thread || thread.titleState === 'manual') return false;
    if (version <= thread.titleVersion) return false;
    const clean = title.replace(/\s+/g, ' ').trim();
    if (!clean) return false;
    this.patch(threadId, { title: clean, titleState: 'auto', titleVersion: version });
    return true;
  }

  /**
   * User-initiated "Suggest new title" — explicitly overrides even a manual
   * lock (the user asked for it) and retires the pipeline (version 2).
   */
  forceAutoTitle(threadId: string, title: string): boolean {
    const clean = title.replace(/\s+/g, ' ').trim();
    if (!clean || !this.getThread(threadId)) return false;
    this.patch(threadId, { title: clean, titleState: 'auto', titleVersion: 2 });
    return true;
  }

  // ── Background-thread content mutations (serial queue may run jobs
  //    against threads the user is NOT looking at) ───────────────────────

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

  /** Same sealing semantics as ChapterSegmentationDomain.declareNewChapter. */
  declareChapterInactive(
    threadId: string,
    title: string,
    startIndex: number,
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
        c.granularity = sealedGranularity(c.granularity);
      }
    });
    const chapter: ChapterPartition = {
      id: `chap-${Date.now()}-${rand()}`,
      workspaceId: this.projectId,
      threadId,
      title,
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