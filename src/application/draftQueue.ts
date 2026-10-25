/**
 * DraftQueue — unpaired asks (design-docs/18, law by David 2026-10-25).
 *
 * A conversation is a sequence of complete pairs. An ask NEVER enters chat
 * storage until it finishes successfully — it lives here first:
 *
 *   queued → sending → paired          (pair commits; the draft is resolved)
 *              ├→ failed  (reason + any partial reply kept on the draft)
 *              └→ stopped (user pressed Stop — same exits as failed)
 *
 * Exits from a non-success state, exactly three:
 *   retry       — clean resend of the ask (partial kept only for store-as-is)
 *   store-as-is — the user decides the partial becomes the reply; pair commits
 *   discard     — the would-be pair is thrown away with no trace
 *
 * Laws:
 *   - one message in flight at a time (provider quota; also the offline queue)
 *   - strict FIFO per thread: a failed/stopped HEAD blocks its thread and is
 *     NEVER skipped — later drafts wait their turn (pair order = send order)
 *   - drafts are device-local: persisted in localStorage so a reload cannot
 *     lose them, never part of the project snapshot, exports, or LLM payload
 *   - the failure reason lives ONLY on the draft — it is never turn content
 */

export type DraftState = 'queued' | 'sending' | 'failed' | 'stopped';

export interface DraftItem {
  id: string;
  threadId: string;
  /** The ask — exactly what the user sent. */
  text: string;
  /**
   * send = a new ask awaiting its reply. regenerate = a replacement reply for
   * an existing pair (David 2026-10-25): also unpaired work — it lives in the
   * draft area until it succeeds, and only then replaces the pair's reply.
   */
  kind?: 'send' | 'regenerate';
  /** For kind='regenerate': the committed assistant turn to replace on success. */
  targetTurnId?: string;
  state: DraftState;
  /** Failure reason (provider text). Queue-side only; never turn content. */
  reason?: string;
  /** Partial reply text if the attempt got somewhere before failing/stopping. */
  partial?: string;
  createdAt: number;
  /**
   * Side effects buffered during the attempt and applied ONLY on commit
   * (pair + its artifacts + its topic shifts land atomically). Discard drops
   * them. Not persisted across reload — a reloaded draft keeps text+partial.
   */
  bufferedArtifacts?: unknown[];
  bufferedShifts?: unknown[];
}

const STORAGE_KEY = 'markbrain:draftQueue';

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function makeDraftId(): string {
  return `draft-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Which draft may be attempted next — pure, so the law is testable.
 *
 * One in flight globally (any `sending` draft blocks everyone). Otherwise the
 * first unresolved draft of each thread is its head; only a head in state
 * `queued` is sendable. A failed/stopped head marks its thread blocked — the
 * scan continues to OTHER threads (a broken conversation must not freeze the
 * whole device) but nothing later in the blocked thread is ever attempted.
 * Among sendable heads, FIFO order wins (first in the array = oldest ask).
 */
/**
 * A regenerate may only start when the queue is completely empty and nothing
 * is in flight (David: "it cannot have any other LLM activity ongoing … or not
 * allow retry if queue is not empty"). It never jumps FIFO and never preempts.
 */
export function regenerateAllowed(items: DraftItem[]): boolean {
  return items.length === 0;
}

export function nextSendable(items: DraftItem[]): DraftItem | null {
  if (items.some((i) => i.state === 'sending')) return null;
  const headSeen = new Set<string>();
  for (const it of items) {
    if (headSeen.has(it.threadId)) continue;
    headSeen.add(it.threadId);
    if (it.state === 'queued') return it;
    // failed/stopped head → this thread is blocked; try the next thread.
  }
  return null;
}

type Listener = () => void;

export class DraftQueue {
  private items: DraftItem[] = [];
  private listeners = new Set<Listener>();

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      const raw = storage()?.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      this.items = parsed
        .filter((i: any) => i && typeof i.id === 'string' && typeof i.threadId === 'string')
        .map((i: any) => ({
          id: i.id,
          threadId: i.threadId,
          text: String(i.text ?? ''),
          // A 'sending' draft that survived a reload is a dead attempt — the
          // page died mid-stream. Demote to stopped so the head can be retried
          // or discarded instead of blocking the thread forever.
          state: i.state === 'sending'
            ? 'stopped'
            : (['queued', 'failed', 'stopped'] as const).includes(i.state)
              ? (i.state as DraftState)
              : 'queued',
          ...(typeof i.reason === 'string' ? { reason: i.reason } : {}),
          ...(typeof i.partial === 'string' ? { partial: i.partial } : {}),
          createdAt: Number(i.createdAt) || Date.now(),
          ...(i.kind === 'regenerate' ? { kind: 'regenerate' as const } : {}),
          ...(typeof i.targetTurnId === 'string' ? { targetTurnId: i.targetTurnId } : {}),
        }));
    } catch {
      /* junk storage → empty queue */
    }
  }

  private save(): void {
    try {
      const serializable = this.items.map(({ bufferedArtifacts: _a, bufferedShifts: _s, ...rest }) => rest);
      storage()?.setItem(STORAGE_KEY, JSON.stringify(serializable));
    } catch {
      /* storage full/unavailable — drafts still live in memory */
    }
  }

  private emit(): void {
    this.save();
    for (const fn of this.listeners) fn();
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  getItems(): DraftItem[] {
    return this.items;
  }

  getItemsForThread(threadId: string): DraftItem[] {
    return this.items.filter((i) => i.threadId === threadId);
  }

  getItem(id: string): DraftItem | undefined {
    return this.items.find((i) => i.id === id);
  }

  enqueue(
    threadId: string,
    text: string,
    extra: { kind?: 'send' | 'regenerate'; targetTurnId?: string } = {}
  ): DraftItem {
    const item: DraftItem = {
      id: makeDraftId(),
      threadId,
      text,
      state: 'queued',
      createdAt: Date.now(),
      ...(extra.kind ? { kind: extra.kind } : {}),
      ...(extra.targetTurnId ? { targetTurnId: extra.targetTurnId } : {}),
    };
    this.items.push(item);
    this.emit();
    return item;
  }

  markSending(id: string): void {
    const item = this.getItem(id);
    if (!item) return;
    item.state = 'sending';
    this.emit();
  }

  updatePartial(id: string, partial: string): void {
    const item = this.getItem(id);
    if (!item) return;
    item.partial = partial;
    this.emit();
  }

  setBuffers(id: string, bufferedArtifacts: unknown[], bufferedShifts: unknown[]): void {
    const item = this.getItem(id);
    if (!item) return;
    item.bufferedArtifacts = bufferedArtifacts;
    item.bufferedShifts = bufferedShifts;
    // No emit: buffers are in-memory only and not worth a re-render.
  }

  /** Attempt finished with no reply — the draft stays, with the reason. */
  fail(id: string, reason: string, partial?: string): void {
    const item = this.getItem(id);
    if (!item) return;
    item.state = 'failed';
    item.reason = reason;
    if (partial !== undefined) item.partial = partial;
    this.emit();
  }

  /** User pressed Stop — a failed variant with the same three exits. */
  stop(id: string, partial?: string): void {
    const item = this.getItem(id);
    if (!item) return;
    item.state = 'stopped';
    if (partial !== undefined) item.partial = partial;
    this.emit();
  }

  /** Clean resend of the ask. The partial is kept for store-as-is only. */
  retry(id: string): void {
    const item = this.getItem(id);
    if (!item || item.state === 'sending' || item.state === 'queued') return;
    item.state = 'queued';
    delete item.reason;
    this.emit();
  }

  /** The pair committed (success or store-as-is) — the draft is done. */
  resolve(id: string): void {
    const before = this.items.length;
    this.items = this.items.filter((i) => i.id !== id);
    if (this.items.length !== before) this.emit();
  }

  /** Discard the would-be pair: ask, partial, buffers — gone with no trace. */
  discard(id: string): void {
    this.resolve(id);
  }

  nextSendable(): DraftItem | null {
    return nextSendable(this.items);
  }
}
