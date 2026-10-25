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

/** Honest, observable phases only (design 23 §2.2) — never invent "thinking". */
export type DraftPhase = 'queued' | 'connecting' | 'awaiting-first-token' | 'writing';

export interface DraftProgress {
  phase: DraftPhase;
  /** When the current phase began (ms epoch) — the card ticks off this. */
  since: number;
  /** When the first chunk landed (writing phase). */
  firstTokenAt?: number;
  /** Clean partial length while writing. */
  chars?: number;
}

export interface DraftItem {
  /** Connected-mode only (21E §4): the VPS job this draft is watching. */
  serverJobId?: string;
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
  /**
   * Machine-readable exit (design 23 §2.3) — `reason` stays the human
   * sentence. `VAULT_LOCKED` drives the on-card unlock row. Persisted: a
   * reloaded failed draft still shows the right recovery.
   */
  errorCode?: string;
  /** Partial reply text if the attempt got somewhere before failing/stopping. */
  partial?: string;
  createdAt: number;
  /**
   * THE PAYLOAD (design 23 §2.1): snapshot of the armed attachment set
   * (staged + committed) taken at enqueue. The draft owns it — retry re-sends
   * THIS, never a live re-read. SESSION-ONLY (like bufferedArtifacts): a
   * reload keeps text+partial and the compile falls back to the live set.
   */
  attachments?: ChatAttachment[];
  /**
   * Honest stream phase + clock (design 23 §2.2). SESSION-ONLY — a reloaded
   * draft has no attempt in flight, so no stale clock is shown.
   */
  progress?: DraftProgress;
  /**
   * Side effects buffered during the attempt and applied ONLY on commit
   * (pair + its artifacts + its topic shifts land atomically). Discard drops
   * them. Not persisted across reload — a reloaded draft keeps text+partial.
   */
  bufferedArtifacts?: unknown[];
  bufferedShifts?: unknown[];
}

const STORAGE_KEY = 'markbrain:draftQueue';
// Mode-scoped reads/writes: a draft queued in Local never appears in VPS (21C §1).
import { getScopedStorageKey } from '../services/workspaceSession';
import type { ChatAttachment } from '../domains/06-chat-threads/types';

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
      const raw = storage()?.getItem(getScopedStorageKey(STORAGE_KEY));
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
          // The SERVER-JOB BINDING is identity, not session state (design 23
          // §4): a reload must keep it, or reconcile materializes a SECOND
          // draft for the same job and Retry creates a duplicate send behind
          // the dead head. Bug found live 2026-10-25.
          ...(typeof i.serverJobId === 'string' ? { serverJobId: i.serverJobId } : {}),
        }));
    } catch {
      /* junk storage → empty queue */
    }
  }

  private save(): void {
    try {
      // Session-only fields (design 23): attachments snapshot + progress clock
      // die with the page — like bufferedArtifacts, they describe THIS attempt
      // on THIS device. Reload keeps text+partial+reason+errorCode.
      const serializable = this.items.map(
        ({ bufferedArtifacts: _a, bufferedShifts: _s, attachments: _att, progress: _p, ...rest }) => rest
      );
      storage()?.setItem(getScopedStorageKey(STORAGE_KEY), JSON.stringify(serializable));
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

  /** Reconcile entry point (design 23 §4): a server job that has no local
   *  draft materializes as one — a lost failed HEAD must never silently
   *  FIFO-block the thread forever. */
  materialize(init: {
    threadId: string;
    text: string;
    state: DraftState;
    kind?: 'send' | 'regenerate';
    targetTurnId?: string;
    partial?: string;
    reason?: string;
    errorCode?: string;
    serverJobId?: string;
  }): DraftItem {
    const item: DraftItem = {
      id: makeDraftId(),
      threadId: init.threadId,
      text: init.text,
      kind: init.kind,
      targetTurnId: init.targetTurnId,
      state: init.state,
      partial: init.partial,
      reason: init.reason,
      errorCode: init.errorCode,
      serverJobId: init.serverJobId,
      createdAt: Date.now(),
    };
    this.items.push(item);
    this.emit();
    return item;
  }

  findByServerJobId(jobId: string): DraftItem | undefined {
    return this.items.find((i) => i.serverJobId === jobId);
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
      // Design 23 §2.2: the clock starts the moment the ask is queued.
      progress: { phase: 'queued', since: Date.now() },
      ...(extra.kind ? { kind: extra.kind } : {}),
      ...(extra.targetTurnId ? { targetTurnId: extra.targetTurnId } : {}),
    };
    this.items.push(item);
    this.emit();
    return item;
  }

  /**
   * Snapshot the armed attachment set onto the draft (design 23 §2.1) — the
   * draft OWNS its payload from here on. Call once at enqueue; retry never
   * re-snapshots (it is the same send).
   */
  setAttachments(id: string, list: ChatAttachment[]): void {
    const item = this.getItem(id);
    if (!item) return;
    item.attachments = list.map((a) => ({ ...a }));
    this.emit();
  }

  /** Merge a partial progress update. A phase change resets `since` to now. */
  setProgress(id: string, partial: Partial<DraftProgress>): void {
    const item = this.getItem(id);
    if (!item) return;
    const prev = item.progress;
    const phase = partial.phase ?? prev?.phase ?? 'queued';
    const phaseChanged = phase !== (prev?.phase ?? 'queued');
    const firstTokenAt = partial.firstTokenAt ?? prev?.firstTokenAt;
    const chars = partial.chars ?? prev?.chars;
    item.progress = {
      phase,
      since: partial.since ?? (phaseChanged || !prev ? Date.now() : prev.since),
      ...(firstTokenAt !== undefined ? { firstTokenAt } : {}),
      ...(chars !== undefined ? { chars } : {}),
    };
    this.emit();
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

  /**
   * Attempt finished with no reply — the draft stays, with the reason and an
   * optional machine-readable `errorCode` (design 23 §2.3; reason is the
   * human sentence either way).
   */
  fail(id: string, reason: string, partial?: string, errorCode?: string): void {
    const item = this.getItem(id);
    if (!item) return;
    item.state = 'failed';
    item.reason = reason;
    if (partial !== undefined) item.partial = partial;
    if (errorCode !== undefined) item.errorCode = errorCode;
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

  /**
   * Clean resend of the ask. The partial is kept for store-as-is only. The
   * attachment snapshot is KEPT (same send — design 23 §2.1.4); the previous
   * attempt's errorCode is cleared — the new attempt re-lands it if needed.
   */
  retry(id: string): void {
    const item = this.getItem(id);
    if (!item || item.state === 'sending' || item.state === 'queued') return;
    item.state = 'queued';
    delete item.reason;
    delete item.errorCode;
    if (item.progress) item.progress = { phase: 'queued', since: Date.now() };
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
