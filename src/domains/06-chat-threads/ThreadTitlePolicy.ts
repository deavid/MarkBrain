import type { ThreadMetaStore } from './ThreadMetaStore';

/**
 * When a thread's title may change. Auto-titling is version-gated and
 * permanently opted out by a manual rename; only an explicit user action
 * (force) overrides the lock.
 */
export class ThreadTitlePolicy {
  constructor(private store: ThreadMetaStore) {}

  /** Never downgrades a newer title version and never touches a manual lock. */
  applyAutoTitle(threadId: string, title: string, version: number): boolean {
    const thread = this.store.getThread(threadId);
    if (!thread || thread.titleState === 'manual') return false;
    if (version <= thread.titleVersion) return false;
    const clean = title.replace(/\s+/g, ' ').trim();
    if (!clean) return false;
    this.store.patch(threadId, { title: clean, titleState: 'auto', titleVersion: version });
    return true;
  }

  /** Explicit user action: overrides even a manual lock and sets `titleVersion = 2`. */
  forceAutoTitle(threadId: string, title: string): boolean {
    const clean = title.replace(/\s+/g, ' ').trim();
    if (!clean || !this.store.getThread(threadId)) return false;
    this.store.patch(threadId, { title: clean, titleState: 'auto', titleVersion: 2 });
    return true;
  }
}
