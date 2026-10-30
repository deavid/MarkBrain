import {
  ChatThread,
  ThreadFolder,
  makeDefaultThread,
  makeThreadId,
} from './types';

const rand = () => Math.random().toString(36).slice(2, 6);

/**
 * Threads, folders, and which one is open — the metadata store. Pure CRUD:
 * no content (turns and chapters live in the thread-keyed domains), no
 * attachments (ThreadAttachmentLedger), no titles (ThreadTitleState).
 */
export class ThreadMetaStore {
  private threads: ChatThread[] = [];
  private folders: ThreadFolder[] = [];
  private activeId = '';
  private listeners: Set<() => void> = new Set();

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  emit(): void {
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

  setActiveThreadId(id: string): void {
    this.activeId = id;
  }

  /** Switches the open thread; false when it is already open or unknown. */
  select(threadId: string): boolean {
    if (threadId === this.activeId) return false;
    if (!this.threads.some((t) => t.id === threadId)) return false;
    this.activeId = threadId;
    this.emit();
    return true;
  }

  /** Creates a thread without selecting it. Content is the domains' business. */
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
    this.emit();
    return thread;
  }

  /**
   * Deletes a thread. Deleting the open one falls back to the most recently
   * active thread (or a fresh "Main") — the caller re-points the domains.
   */
  deleteThread(threadId: string): void {
    const idx = this.threads.findIndex((t) => t.id === threadId);
    if (idx === -1) return;
    this.threads.splice(idx, 1);

    if (this.activeId !== threadId) {
      this.emit();
      return;
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
    this.emit();
  }

  /** Single mutation primitive for the sibling modules (attachments, titles). */
  mutate(threadId: string, fn: (thread: ChatThread) => ChatThread): void {
    const idx = this.threads.findIndex((t) => t.id === threadId);
    if (idx === -1) return;
    this.threads[idx] = fn(this.threads[idx]);
    this.emit();
  }

  /** Shallow merge of metadata. Not for turns, chapters or attachments. */
  patch(threadId: string, partial: Partial<ChatThread>): void {
    this.mutate(threadId, (t) => ({ ...t, ...partial, updatedAt: Date.now() }));
  }

  /** Manual rename → permanent lock. */
  rename(threadId: string, title: string): void {
    const clean = title.replace(/\s+/g, ' ').trim();
    if (!clean) return;
    this.patch(threadId, { title: clean, titleState: 'manual' });
  }

  /** Hydration installs the whole metadata picture at once. */
  install(threads: ChatThread[], folders: ThreadFolder[], activeId: string): void {
    this.threads = threads;
    this.folders = folders;
    this.activeId = activeId;
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
}
