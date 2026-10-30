/**
 * Send orchestration — pairs only (design-docs/18, law by David 2026-10-25).
 *
 * A conversation is a sequence of complete pairs. An ask NEVER enters chat
 * storage at send time: it becomes a DraftQueue item and stays in the draft
 * area until it finishes successfully. Only `commitPair` writes to the
 * timeline — atomically, both turns at once, with the artifacts and topic
 * shifts buffered during the attempt. Failure, Stop, and partial text leave
 * NO turns behind: the draft keeps them (reason + partial) for retry /
 * store-as-is / discard. The walk is strict FIFO per thread and never skips
 * a failed head (see draftQueue.nextSendable).
 *
 * Two invariants, both easy to break:
 *   - `deps` are re-published by App on every render, but an ATTEMPT snapshots
 *     them (plus `getContext()`) and keeps them for its whole life. Re-reading
 *     mid-attempt mixes two renders' state into one conversation.
 *   - React state (stream phase, status, re-render tick) stays in App; the
 *     queue only drives it through injected callbacks.
 */
import type { DomainContextValue } from '../domains/DomainRegistry';
import {
  getMellowPastelColor,
  type Artifact,
  type ExtractedArtifact,
  type ModelOption,
} from '../types';
import { estimateTokens } from '../utils/estimateTokens';
import type { TurnMeta } from '../domains/01-dialogue-timeline/types';
import { serializeArtifactToYamlDoc } from '../utils/yamlArtifactParser';
import { logger } from '../utils/logger';
import { placeholderTitle, sampleTurnsForTitle, titlePipelineStep } from '../domains/06-chat-threads';
import {
  DEFAULT_CHAT_CAPABILITIES,
  resolveCapabilities,
  type ChatCapabilities,
} from '../domains/06-chat-threads/types';
import { isAttachmentStaged, type ChatAttachment } from '../domains/06-chat-threads/types';
import { DraftQueue, type DraftItem, regenerateAllowed } from './draftQueue';
import { apiFetch } from '../gateway/api';
import { getWorkspaceMode } from '../services/workspaceSession';
import { isOnline } from './connectivity';

/**
 * Honest phase mapping from a SERVER job state / status event (design 23 §2.2):
 * `queued` = accepted, not started (may be FIFO-blocked behind a dead head —
 * the card must NEVER say "thinking"); `sending`/`connecting` = the provider
 * RPC is in flight, no ACK yet; `connected` = the provider ACKed the stream
 * (zero text yet — only NOW may the card say the model is thinking).
 */
export function vpsPhaseFor(serverState: string): 'queued' | 'connecting' | 'awaiting-first-token' | 'writing' {
  switch (serverState) {
    case 'queued':
      return 'queued';
    case 'connected':
      return 'awaiting-first-token';
    case 'writing':
      return 'writing';
    default:
      // 'sending', 'connecting', legacy 'streaming': job started, nothing
      // received — connecting is the honest word for all of them.
      return 'connecting';
  }
}
import { isLocalVaultLockedError, resolveLaneKey } from '../data/keySlots';
import { isVaultLocked, getReArmKey, tryReArmVault } from '../data/vaultReArm';
import type { ExtractedArtifactUpsert, ExtractedTopicShift } from '../domains/03-stream-protocol';

/** App render values, snapshotted once when an attempt starts (see the header). */
export interface TurnSendContext {
  model: ModelOption;
  projectId: string;
  projectTitle: string;
  tokenCeiling: number;
  /**
   * Resolved chat capabilities for this attempt (Package 2): DEFAULT ←
   * project default ← thread override. Optional so test contexts keep
   * compiling — absent means DEFAULT_CHAT_CAPABILITIES.
   */
  capabilities?: ChatCapabilities;
}

export interface SendQueueDeps
  extends Pick<
    DomainContextValue,
    'threadRegistry' | 'timeline' | 'segmentation' | 'artifacts' | 'versioning' | 'compiler' | 'stream'
  > {
  triggerReRender: () => void;
  setStreamingStatus: (status: string | null) => void;
  setStreamPhase: (phase: 'waiting' | 'streaming' | null) => void;
  markThreadUnread: (threadId: string) => void;
  requestAutoTitle: (
    messages: Array<{ role: string; content: string }>,
    version: number
  ) => Promise<string | null>;
  postChatCancel: (reason: string) => void;
  confirm: (message: string) => boolean;
  getContext: () => TurnSendContext;
}

/** Deps + context captured at attempt start; never refreshed mid-attempt. */
interface QueueChain {
  deps: SendQueueDeps;
  ctx: TurnSendContext;
}

/**
 * Which turn does a retry weld staged attachments to?
 *
 * A retry compiles every attachment on the thread — staged included — so
 * anything armed right now is about to be delivered again. It must land on the
 * user turn this assistant reply answers; otherwise history claims the
 * attachment never entered while the model reads it twice.
 *
 * Pure, and exported, so the anchor rule is testable outside the queue's I/O.
 */
export function resolveRetryAnchorIndex(
  turns: Array<{ id: string; role: string }>,
  assistantTurnId: string
): number {
  const retryIdx = turns.findIndex((t) => t.id === assistantTurnId);
  if (retryIdx <= 0) return Math.max(0, turns.length - 1);
  for (let i = retryIdx - 1; i >= 0; i--) {
    if (turns[i].role === 'user') return i;
  }
  return retryIdx - 1;
}

/** The honest sentence for a locked-keyes failure (design 23 §2.3). */
export const VAULT_LOCKED_REASON =
  'Your keys are locked — enter your password below to unlock and resend this.';

/**
 * Does this failure message describe a locked vault? Matches the two known
 * sentences (server restart lock + local vault lock) and close variants.
 */
export function looksLikeVaultLocked(message: string): boolean {
  return /keys? (are |is )?locked|key vault is locked|locked after a server restart|vault.*locked/i.test(
    message
  );
}

/**
 * Local-mode VAULT_LOCKED detection (design 23 §2.3): a saved vault whose RAM
 * is locked and no resolvable lane key means the send cannot sign — code it,
 * don't bury it in a proxy 401.
 */
function localVaultLocked(modelId: string): boolean {
  return (
    getWorkspaceMode() !== 'vps' && isLocalVaultLockedError() && resolveLaneKey('chat', modelId) === null
  );
}

/** errorCode for a failure message, or undefined (design 23 §2.3). */
function errorCodeFor(message: string): string | undefined {
  return looksLikeVaultLocked(message) ? 'VAULT_LOCKED' : undefined;
}

export class SendQueue {
  private drafts = new DraftQueue();
  private activeDraft: DraftItem | null = null;
  private jobAbort: AbortController | null = null;
  private readonly getDeps: () => SendQueueDeps;

  constructor(getDeps: () => SendQueueDeps) {
    this.getDeps = getDeps;
    // Reconnect: an offline gate held the head queued — walk it now. Kick is
    // idempotent (activeDraft guard), so a single raw listener is enough.
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.kick());
    }
  }

  /** Live drafts — the queue of unpaired asks (design-docs/18). */
  getQueue(): DraftItem[] {
    return this.drafts.getItems();
  }

  getActiveJob(): DraftItem | null {
    return this.activeDraft;
  }

  getDraftsForThread(threadId: string): DraftItem[] {
    return this.drafts.getItemsForThread(threadId);
  }

  /** Thread turns for the CURRENT render's deps (used by handleSuggestTitle). */
  getTurnsOf(threadId: string) {
    return this.turnsOf(this.getDeps(), threadId);
  }

  handleSendMessage(text: string): void {
    const deps = this.getDeps();
    const threadId = deps.threadRegistry.getActiveThreadId();
    if (!threadId) return;
    const thread = deps.threadRegistry.getThread(threadId);
    if (thread?.lifecycle === 'archived') {
      if (!deps.confirm('Unarchive and continue this thread?')) return;
      deps.threadRegistry.patch(threadId, { lifecycle: 'active' });
    }
    this.noteSendIntent(deps, threadId, text);
    // New sends enter the tail; the walk stays strict FIFO (nextSendable).
    const item = this.drafts.enqueue(threadId, text);
    // Design 23 §2.1: ENQUEUE SNAPSHOTS the armed set (staged + committed) —
    // the draft owns its payload from here on; retry re-sends this exact set.
    this.drafts.setAttachments(item.id, deps.threadRegistry.getAttachments(threadId));
    deps.triggerReRender();
    this.kick();
  }

  /**
   * Reconcile server jobs into local drafts (design 23 §4). The server is the
   * source of truth for sends in Connected mode: a failed/stopped job that
   * lost its draft (reload, older client) materializes WITH its exits, and
   * queued/sending jobs materialize as queued drafts whose executeVpsAttempt
   * only attaches (never double-sends). Without this, a vault-locked failure
   * FIFO-blocks every later send behind an invisible head — "chat never sends".
   * No kick() here: user actions (exit the head, next send) drive watchers.
   */
  private reconcileInFlight = false;
  private lastReconcileAt = 0;
  /** Hard rate cap (David 2026-10-25): no caller may drive /jobs into a storm. */
  private static RECONCILE_COOLDOWN_MS = 2000;

  async reconcileServerJobs(projectId: string): Promise<void> {
    if (getWorkspaceMode() !== 'vps') return;
    if (this.reconcileInFlight) return; // never overlap: each run re-renders
    if (Date.now() - this.lastReconcileAt < SendQueue.RECONCILE_COOLDOWN_MS) return;
    this.lastReconcileAt = Date.now();
    this.reconcileInFlight = true;
    const deps = this.getDeps();
    try {
      const res = await apiFetch(`/api/projects/${encodeURIComponent(projectId)}/jobs`);
      if (!res.ok) return;
      const body = (await res.json()) as {
        jobs: Array<{
          jobId: string;
          threadId: string;
          kind?: 'send' | 'regenerate';
          state: string;
          askText: string;
          partialText: string;
          errorReason: string | null;
        }>;
      };
      for (const job of body.jobs ?? []) {
        if (this.drafts.findByServerJobId(job.jobId)) continue; // a draft already owns it
        const state: DraftItem['state'] =
          job.state === 'failed' ? 'failed' : job.state === 'stopped' ? 'stopped' : 'queued';
        const reason = job.errorReason || undefined;
        this.drafts.materialize({
          threadId: job.threadId,
          text: job.askText,
          kind: job.kind,
          state,
          partial: job.partialText || undefined,
          reason,
          errorCode: looksLikeVaultLocked(reason ?? '') ? 'VAULT_LOCKED' : undefined,
          serverJobId: job.jobId,
        });
        logger.info('App', `Reconciled server job ${job.jobId} → ${state} draft`);
      }
      deps.triggerReRender();
    } catch (err) {
      logger.warn('App', 'reconcileServerJobs failed', err);
    } finally {
      this.reconcileInFlight = false;
    }
  }

  /**
   * design 25: silent re-arm + one bounded retry after a VAULT_LOCKED send
   * failure. Bounded so a genuinely rejected key can't loop sends.
   */
  private reArmAttempts = new Map<string, number>();
  private reArmAndRetry(draftId: string): void {
    const tries = this.reArmAttempts.get(draftId) ?? 0;
    if (tries >= 2 || !getReArmKey()) return;
    this.reArmAttempts.set(draftId, tries + 1);
    void tryReArmVault().then((ok) => {
      if (ok) {
        logger.action('App', 'Vault re-armed from tab key — resending the failed draft');
        this.retryDraft(draftId);
      }
    });
  }

  /**
   * Retry a failed/stopped draft — clean resend of the ask. The attachment
   * snapshot is KEPT as-is (design 23 §2.1.4: same send, same payload) — it
   * is deliberately NOT re-snapshotted here.
   */
  retryDraft(id: string): void {
    logger.action('App', 'Retry draft', { draftId: id });
    this.drafts.retry(id);
    this.getDeps().triggerReRender();
    this.kick();
  }

  /**
   * The draft whose un-sent payload the staged tray edits (design 23 §2.1.2):
   * the thread's HEAD draft while it is `queued` and nothing is `sending`.
   * Once a draft is sending/failed/stopped its snapshot is frozen and new
   * staging arms the NEXT send (registry staged set) again.
   */
  getEditableDraftForThread(threadId: string): DraftItem | null {
    const items = this.drafts.getItemsForThread(threadId);
    if (items.some((i) => i.state === 'sending')) return null;
    const head = items[0];
    return head && head.state === 'queued' ? head : null;
  }

  /**
   * Tray editor verb (design 23 §2.1.2). SOURCE OF TRUTH: the draft's
   * `attachments` snapshot — `mutator` returns the next list and the thread
   * registry's staged set is re-mirrored from it (stage/unstage/granularity),
   * so `commitStagedAttachments` welds exactly this payload at commit. Committed
   * entries are history: the mutator may change their granularity but never
   * drop them (a dropped one is restored). Refused on a frozen draft.
   */
  updateDraftAttachments(
    id: string,
    mutator: (list: ChatAttachment[]) => ChatAttachment[]
  ): void {
    const item = this.drafts.getItem(id);
    if (!item || item.state === 'sending') return;
    const deps = this.getDeps();
    const current = item.attachments ?? [];
    const committed = current.filter((a) => !isAttachmentStaged(a));
    const mutated = mutator(current.map((a) => ({ ...a })));
    // Committed = history: keep every one that the mutator dropped.
    const keptCommitted = committed.map(
      (c) => mutated.find((m) => m.artifactId === c.artifactId) ?? c
    );
    const next = [
      ...keptCommitted,
      ...mutated.filter((m) => isAttachmentStaged(m)),
    ];
    this.drafts.setAttachments(id, next);
    // Mirror the staged subset (and committed granularity) into the registry.
    const threadId = item.threadId;
    const live = deps.threadRegistry.getAttachments(threadId);
    for (const att of live) {
      const want = next.find((n) => n.artifactId === att.artifactId);
      if (!want && isAttachmentStaged(att)) {
        deps.threadRegistry.unstageArtifact(threadId, att.artifactId);
      } else if (want && want.granularity !== att.granularity) {
        deps.threadRegistry.setAttachmentGranularity(threadId, att.artifactId, want.granularity);
      }
    }
    for (const want of next) {
      if (isAttachmentStaged(want) && !live.some((l) => l.artifactId === want.artifactId)) {
        deps.threadRegistry.stageArtifact(threadId, want.artifactId, want.granularity);
      }
    }
    deps.triggerReRender();
  }

  /** Discard the would-be pair — ask, partial, buffers, gone with no trace. */
  discardDraft(id: string): void {
    logger.action('App', 'Discard draft', { draftId: id });
    const existing = this.drafts.getItem(id);
    if (getWorkspaceMode() === 'vps' && existing?.serverJobId) {
      void apiFetch(`/api/jobs/${encodeURIComponent(existing.serverJobId)}`, { method: 'DELETE' }).catch(() => {});
    }
    this.drafts.discard(id);
    this.getDeps().triggerReRender();
    this.kick();
  }

  /**
   * Store as-is: the user decides the partial becomes the reply. A normal
   * commit — the pair enters chat storage. No marker: marking would be state
   * painted onto conversation content again.
   */
  storeAsIsDraft(id: string): void {
    const item = this.drafts.getItem(id);
    if (!item || !item.partial) return;
    logger.action('App', 'Store draft as-is', { draftId: id });
    if (getWorkspaceMode() === 'vps' && item.serverJobId) {
      // Server commits the partial pair to SQLite; delta brings it home.
      void apiFetch(`/api/jobs/${encodeURIComponent(item.serverJobId)}/store-as-is`, { method: 'POST' })
        .catch((err) => logger.warn('App', 'store-as-is failed', err))
        .finally(() => {
          this.drafts.resolve(item.id);
          // Wake the delta poller so the pair lands now, not on the next tick.
          if (typeof window !== 'undefined') window.dispatchEvent(new Event('focus'));
          this.getDeps().triggerReRender();
          this.kick();
        });
      return;
    }
    const deps = this.getDeps();
    const ctx = deps.getContext();
    const chain: QueueChain = { deps, ctx };
    // Same per-thread resolution as runDraft (Package 2 §2.4): the stored
    // partial must obey the thread's own capability toggles.
    chain.ctx.capabilities = resolveCapabilities(
      deps.threadRegistry.getThread(item.threadId),
      chain.ctx.capabilities
    );
    const artifacts = (item.bufferedArtifacts ?? []) as ExtractedArtifactUpsert[];
    const shifts = (item.bufferedShifts ?? []) as ExtractedTopicShift[];
    const estPrompt = Math.max(1, estimateTokens(item.text));
    const estCand = Math.max(1, estimateTokens(item.partial));
    const meta: TurnMeta = {
      model: ctx.model.name,
      inputTokens: estPrompt,
      outputTokens: estCand,
      totalTokens: estPrompt + estCand,
      isFallback: true,
      isStreaming: false,
      streamState: 'completed',
    };
    if (item.kind === 'regenerate' && item.targetTurnId) {
      this.commitRegenerate(chain, item, item.partial, artifacts, shifts, meta);
    } else {
      this.commitPair(chain, item, item.partial, artifacts, shifts, meta);
    }
    this.drafts.resolve(item.id);
    this.maybeRetitle(chain, item.threadId);
    this.kick();
  }

  handleCancelQueued(threadId: string): void {
    const queued = this.drafts.getItemsForThread(threadId).filter((d) => d.state === 'queued');
    if (queued.length === 0) return;
    for (const d of queued) this.drafts.discard(d.id);
    const thread = this.getDeps().threadRegistry.getThread(threadId);
    const deps = this.getDeps();
    if (
      thread &&
      this.drafts.getItemsForThread(threadId).length === 0 &&
      this.turnsOf(deps, threadId).length === 0 &&
      thread.titleState === 'placeholder' &&
      thread.titleVersion === 0
    ) {
      deps.threadRegistry.patch(threadId, { title: 'New thread', preview: '' });
    }
    logger.action('App', 'Cancelled queued messages', { threadId, removed: queued.length });
    deps.triggerReRender();
    this.kick();
  }

  /**
   * Regenerate the last pair's reply (David 2026-10-25): a special request
   * that REPLACES the reply on success. Unpaired work like any other — it
   * lives in the draft area until it succeeds and the old reply stays put
   * until then. Never jumps the queue: refused unless the queue is empty and
   * nothing is in flight (regenerateAllowed).
   */
  regenerateLastReply(): void {
    const deps = this.getDeps();
    const threadId = deps.threadRegistry.getActiveThreadId();
    if (!threadId) return;
    const turns = this.turnsOf(deps, threadId);
    const lastAssistant = [...turns].reverse().find((t) => t.role === 'assistant');
    if (!lastAssistant) return;
    if (!regenerateAllowed(this.drafts.getItems())) {
      logger.warn('App', 'Regenerate refused — the queue is not empty');
      return;
    }
    const anchorIdx = resolveRetryAnchorIndex(turns, lastAssistant.id);
    const askText = turns[anchorIdx]?.content || lastAssistant.content || 'Regenerate the last reply';
    logger.action('App', 'Regenerate last reply', { threadId, turnId: lastAssistant.id });
    const item = this.drafts.enqueue(threadId, askText, {
      kind: 'regenerate',
      targetTurnId: lastAssistant.id,
    });
    // Same snapshot law as a send (design 23 §2.1) — regenerate carries its
    // payload with it.
    this.drafts.setAttachments(item.id, deps.threadRegistry.getAttachments(threadId));
    deps.triggerReRender();
    this.kick();
  }

  stopGeneration(): void {
    const deps = this.getDeps();
    logger.action('App', 'Stop generation');
    const item = this.activeDraft;
    if (getWorkspaceMode() === 'vps' && item?.serverJobId) {
      // Explicit stop is the ONLY cancel (21E §1): server aborts upstream and
      // keeps the partial for Retry / Store-as-is / Discard.
      void apiFetch(`/api/jobs/${encodeURIComponent(item.serverJobId)}/stop`, { method: 'POST' }).catch(() => {});
      this.drafts.stop(item.id, item.partial);
      deps.setStreamingStatus(null);
      deps.setStreamPhase(null);
      deps.triggerReRender();
      return;
    }
    if (item && this.jobAbort) {
      this.jobAbort.abort();
      deps.postChatCancel('Stop button pressed by user');
      // runDraft.finally() clears the active draft and promotes the queue
    }
  }

  // Live domains hold ONLY the active thread's turns/chapters; background
  // jobs write through the registry into the inactive thread's cached content.
  private isActiveThread(deps: SendQueueDeps, threadId: string): boolean {
    return threadId === deps.threadRegistry.getActiveThreadId();
  }

  private turnsOf(deps: SendQueueDeps, threadId: string) {
    return this.isActiveThread(deps, threadId)
      ? deps.timeline.getTurns()
      : deps.threadRegistry.getInactiveContent(threadId)?.turns ?? [];
  }

  private chaptersOf(deps: SendQueueDeps, threadId: string) {
    return this.isActiveThread(deps, threadId)
      ? deps.segmentation.listChapters()
      : deps.threadRegistry.getInactiveContent(threadId)?.chapters ?? [];
  }

  private appendTurnToThread(
    deps: SendQueueDeps,
    threadId: string,
    role: 'user' | 'assistant' | 'system',
    content: string,
    extractedArtifacts?: ExtractedArtifact[],
    meta?: TurnMeta
  ) {
    if (this.isActiveThread(deps, threadId)) {
      return deps.timeline.appendTurn(role, content, extractedArtifacts, meta);
    }
    const turn = deps.threadRegistry.appendInactiveTurn(threadId, role, content, extractedArtifacts, meta);
    if (!turn) throw new Error(`appendInactiveTurn failed for thread ${threadId}`);
    return turn;
  }

  private updateTurnInThread(
    deps: SendQueueDeps,
    threadId: string,
    turnId: string,
    partial: { content?: string; extractedArtifacts?: ExtractedArtifact[]; meta?: TurnMeta }
  ) {
    if (this.isActiveThread(deps, threadId)) deps.timeline.updateTurn(turnId, partial);
    else deps.threadRegistry.updateInactiveTurn(threadId, turnId, partial);
  }

  private noteSendIntent(deps: SendQueueDeps, threadId: string, text: string) {
    const thread = deps.threadRegistry.getThread(threadId);
    if (!thread) return;
    const existingUserTurns = this.turnsOf(deps, threadId).filter((t) => t.role === 'user').length;
    const queuedNew = this.drafts.getItemsForThread(threadId).filter((d) => d.state !== 'failed' && d.state !== 'stopped').length;
    if (
      existingUserTurns + queuedNew === 0 &&
      thread.titleVersion === 0 &&
      thread.titleState !== 'manual'
    ) {
      deps.threadRegistry.patch(threadId, {
        title: placeholderTitle(text),
        titleState: 'placeholder',
        preview: text.slice(0, 100),
        lastActivityAt: Date.now(),
      });
    } else {
      deps.threadRegistry.patch(threadId, { preview: text.slice(0, 100), lastActivityAt: Date.now() });
    }
  }

  // Staged titling pipeline: stage1 after the 1st reply, stage2 once after the 3rd.
  // Fire-and-forget — failures keep the current title.
  private maybeRetitle(chain: QueueChain, threadId: string) {
    const deps = chain.deps;
    const thread = deps.threadRegistry.getThread(threadId);
    if (!thread || thread.titleState === 'manual') return;
    const turns = this.turnsOf(deps, threadId);
    // Every assistant turn is a committed pair — nothing to exclude.
    const assistantCount = turns.filter((t) => t.role === 'assistant').length;
    const step = titlePipelineStep(thread, assistantCount);
    if (!step) return;
    const version = step === 'stage1' ? 1 : 2;
    deps
      .requestAutoTitle(sampleTurnsForTitle(turns), version)
      .then((title) => {
        if (title && deps.threadRegistry.applyAutoTitle(threadId, title, version)) {
          logger.info('App', `Thread title ${step} applied`, { threadId, title });
          deps.triggerReRender();
        }
      })
      .catch((err) => logger.warn('App', 'title-thread request failed', err));
  }

  /** One stream at a time; the walk stops at a failed head and never skips. */
  private kick(): void {
    if (this.activeDraft) return;
    // Offline: sends stay QUEUED, never attempted — no doomed request that
    // marks the head failed and blocks its thread. The 'online' listener in
    // the constructor walks the queue the moment the device reconnects.
    if (!isOnline()) return;
    const item = this.drafts.nextSendable();
    if (!item) return;
    void this.runDraft(item);
  }

  private async runDraft(item: DraftItem): Promise<void> {
    this.activeDraft = item;
    this.drafts.markSending(item.id);
    const deps = this.getDeps();
    const chain: QueueChain = { deps, ctx: deps.getContext() };
    // Package 2 §2.4: capabilities resolve per THREAD (project default ←
    // thread override) — the ask about to compile must match what its commit
    // will later be allowed to apply.
    chain.ctx.capabilities = resolveCapabilities(
      deps.threadRegistry.getThread(item.threadId),
      chain.ctx.capabilities
    );
    try {
      // Connected VPS mode (21E §4): the SERVER owns the attempt — send-and-
      // forget. Local mode keeps today's in-browser stream untouched.
      if (getWorkspaceMode() === 'vps') {
        await this.executeVpsAttempt(chain, item);
      } else if (item.kind === 'regenerate') {
        await this.executeRegenerateAttempt(chain, item);
      } else {
        await this.executeAttempt(chain, item);
      }
    } catch (err) {
      logger.error('App', 'Draft attempt failed unexpectedly', err);
      const reason =
        err instanceof Error && err.message.trim()
          ? err.message.trim().slice(0, 400)
          : 'The request failed — no reply came back.';
      this.drafts.fail(item.id, reason, item.partial, errorCodeFor(reason));
    } finally {
      this.activeDraft = null;
      this.jobAbort = null;
      deps.setStreamingStatus(null);
      deps.setStreamPhase(null);
      // Finished while the user was elsewhere → brightness bump until opened.
      deps.markThreadUnread(item.threadId);
      deps.triggerReRender();
      // Per-thread FIFO: a failed head blocks its own thread (nextSendable),
      // other threads' heads keep going.
      this.kick();
    }
  }

  private async executeAttempt(chain: QueueChain, item: DraftItem): Promise<void> {
    const deps = chain.deps;
    const ctx = chain.ctx;
    const threadId = item.threadId;
    deps.setStreamingStatus(`Connecting to ${ctx.model.name}...`);
    deps.setStreamPhase('waiting');
    const controller = new AbortController();
    this.jobAbort = controller;

    const bufferedArtifacts: ExtractedArtifactUpsert[] = [];
    const bufferedShifts: ExtractedTopicShift[] = [];
    let streamedContent = '';
    let sawFirstChunk = false;

    try {
      // design 25: a restart locked the vault while we were idle — re-arm from
      // the tab-held derived key BEFORE the send, so it just works.
      if (getWorkspaceMode() === 'vps' && isVaultLocked() && getReArmKey()) {
        await tryReArmVault();
      }
      // Design 23 §2.3: a locked local vault with no signable key is a
      // VAULT_LOCKED exit — code it so the card can unlock + auto-retry.
      if (localVaultLocked(ctx.model.id)) {
        this.drafts.fail(item.id, VAULT_LOCKED_REASON, undefined, 'VAULT_LOCKED');
        return;
      }
      // Design 23 §2.1: compile from the draft's SNAPSHOT (fallback: live set
      // for drafts that pre-date the snapshot / survived a reload).
      const payloadAttachments = item.attachments ?? deps.threadRegistry.getAttachments(threadId);
      this.drafts.setProgress(item.id, { phase: 'connecting' });
      // The ask is NOT a turn yet — it rides the payload as the last message
      // and becomes a turn only at commitPair.
      const virtualAsk = { id: `virtual-${item.id}`, role: 'user' as const, content: item.text, timestamp: Date.now() };
      const compiled = deps.compiler.compile({
        attachments: payloadAttachments,
        tokenCeiling: ctx.tokenCeiling,
        log: true, // once-per-send lifecycle log (display memo must stay silent)
        historyTurns: [...this.turnsOf(deps, threadId), virtualAsk],
        historyChapters: this.chaptersOf(deps, threadId),
        capabilities: chain.ctx.capabilities ?? DEFAULT_CHAT_CAPABILITIES,
      });
      // The phase moves on the provider's real ACK ('connected' status, or
      // legacy 'thinking') — never on optimism before the RPC is even sent.

      const result = await deps.stream.executeStreamingTurn(
        {
          model: ctx.model.id,
          projectTitle: ctx.projectTitle,
          compiledPrompt: compiled.compiledPrompt,
          systemInstruction: compiled.systemInstruction,
        },
        {
          signal: controller.signal,
          onStatus: (status) => {
            deps.setStreamingStatus(status.message);
            deps.setStreamPhase(status.state === 'writing' ? 'streaming' : 'waiting');
            if (status.state === 'thinking' || status.state === 'connected') {
              this.drafts.setProgress(item.id, { phase: 'awaiting-first-token' });
            } else if (status.state === 'writing' && !sawFirstChunk) {
              this.drafts.setProgress(item.id, {
                phase: 'writing',
                firstTokenAt: Date.now(),
                chars: streamedContent.length,
              });
            }
            deps.triggerReRender();
          },
          onChunk: (_cleanDelta, accumulatedClean) => {
            streamedContent = accumulatedClean;
            this.drafts.updatePartial(item.id, accumulatedClean);
            if (!sawFirstChunk) {
              sawFirstChunk = true;
              this.drafts.setProgress(item.id, {
                phase: 'writing',
                firstTokenAt: Date.now(),
                chars: accumulatedClean.length,
              });
            } else {
              this.drafts.setProgress(item.id, { chars: accumulatedClean.length });
            }
            deps.setStreamPhase('streaming');
            deps.triggerReRender();
          },
          onTopicShift: (shift) => {
            bufferedShifts.push(shift);
            this.drafts.setBuffers(item.id, bufferedArtifacts, bufferedShifts);
          },
          onArtifact: (u) => {
            bufferedArtifacts.push(u);
            this.drafts.setBuffers(item.id, bufferedArtifacts, bufferedShifts);
          },
        }
      );

      // Stop = the draft stays. (executeStreamingTurn returns a stub with the
      // partial on abort — the partial lives on the draft, never as a turn.)
      if (controller.signal.aborted) {
        this.drafts.stop(item.id, streamedContent || result.cleanReply || undefined);
        return;
      }

      const prose = result.cleanReply || streamedContent;
      if (!prose && bufferedArtifacts.length === 0) {
        // Transport returned an empty "success" — that is a failed attempt,
        // never a reply. (The stream layer throws first; this is the brace.)
        this.drafts.fail(item.id, 'The stream ended without a reply.', item.partial);
        return;
      }

      const estPrompt =
        result.telemetry?.inputTokens ?? Math.max(1, estimateTokens(compiled.compiledPrompt || ''));
      const estCand =
        result.telemetry?.outputTokens ?? Math.max(1, estimateTokens(prose || ''));
      const totalTok = result.telemetry?.totalTokens ?? (estPrompt + estCand);
      const replyText =
        prose ||
        `Extracted ${bufferedArtifacts.length} note${bufferedArtifacts.length === 1 ? '' : 's'}.`;

      this.commitPair(chain, item, replyText, bufferedArtifacts, bufferedShifts, {
        model: result.telemetry?.model || ctx.model.name,
        inputTokens: estPrompt,
        outputTokens: estCand,
        totalTokens: totalTok,
        latencyMs: result.telemetry?.latencyMs,
        timeToFirstChunkMs: result.telemetry?.timeToFirstChunkMs,
        isFallback: result.telemetry?.isFallback ?? true,
        isStreaming: false,
        streamState: 'completed',
      });
      this.drafts.resolve(item.id);
      this.maybeRetitle(chain, threadId);
    } catch (err: any) {
      if (err.name === 'AbortError' || controller.signal.aborted) {
        this.drafts.stop(item.id, streamedContent || undefined);
        return;
      }
      const reason =
        typeof err?.message === 'string' && err.message.trim()
          ? err.message.trim().slice(0, 400)
          : 'The request failed — no reply came back.';
      this.drafts.fail(item.id, reason, streamedContent || undefined, errorCodeFor(reason));
    }
  }

  /**
   * The only place a pair enters chat storage: both turns, atomically, with
   * the attempt's artifacts and topic shifts. Callers resolve the draft only
   * after this returns — nothing unpaired is ever persisted.
   */
  private commitPair(
    chain: QueueChain,
    item: DraftItem,
    replyText: string,
    bufferedArtifacts: ExtractedArtifactUpsert[],
    bufferedShifts: ExtractedTopicShift[],
    meta: TurnMeta
  ): void {
    const deps = chain.deps;
    const threadId = item.threadId;

    const userTurn = this.appendTurnToThread(deps, threadId, 'user', item.text);
    const userTurnIndex = this.turnsOf(deps, threadId).length - 1;
    const committedAttachments = deps.threadRegistry.commitStagedAttachments(
      threadId,
      userTurnIndex,
      userTurn.id
    );
    if (committedAttachments > 0) {
      logger.info(
        'App',
        `Committed ${committedAttachments} staged attachment(s) to turn ${userTurnIndex}`,
        { threadId }
      );
    }

    const extractedList: ExtractedArtifact[] = bufferedArtifacts.map((u) => ({
      id: u.id,
      title: u.title,
      type: u.type,
      code: u.id || u.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30),
      category: u.type === 'chapter' ? 'chapter' : 'note',
      subtitle: u.content.subtitle,
      description: u.content.description,
      summary: u.content.summary,
      content: u.content.body,
      isHighConcept: false,
    }));
    const assistantTurn = this.appendTurnToThread(deps, threadId, 'assistant', replyText, extractedList, meta);

    // Artifacts land with the pair (discarding a draft drops them too).
    this.applyBufferedArtifacts(chain, threadId, bufferedArtifacts, userTurnIndex + 1, assistantTurn.id);

    // AI-attachment law: the reply's extracted artifacts are ATTACHMENTS on
    // the reply — committed, Full by default, steerable, compiled into every
    // next context call, never re-staged (2026-10-25).
    for (const art of extractedList) {
      if (art.id) deps.threadRegistry.ensureAttached(threadId, art.id, userTurnIndex + 1, assistantTurn.id);
    }

    // Topic shifts land after the pair: the new chapter starts after it.
    this.applyBufferedShifts(chain, threadId, bufferedShifts, userTurnIndex);

    deps.threadRegistry.patch(threadId, { lastOutcome: 'ok', lastActivityAt: Date.now() });
    deps.triggerReRender();
    logger.info('App', 'Pair committed', {
      threadId,
      model: meta.model,
      totalTokens: meta.totalTokens,
      artifacts: extractedList.length,
      topicShifts: bufferedShifts.length,
    });
  }

  /**
   * Connected-mode attempt (21E §4): enqueue (or re-attach to) a VPS job and
   * WATCH it over SSE. Disconnects never fail the draft — the watcher
   * re-attaches until a terminal event or a 404 (job completed & committed).
   */
  private async executeVpsAttempt(chain: QueueChain, item: DraftItem): Promise<void> {
    const deps = chain.deps;
    const ctx = chain.ctx;
    const threadId = item.threadId;
    deps.setStreamingStatus(`Connecting to ${ctx.model.name}...`);
    deps.setStreamPhase('waiting');
    this.drafts.setProgress(item.id, { phase: 'connecting' });

    // Design 23 §2.1: compile + staged payload come from the draft's SNAPSHOT
    // (fallback keeps pre-snapshot drafts working).
    const payloadAttachments = item.attachments ?? deps.threadRegistry.getAttachments(threadId);
    const virtualAsk = { id: `virtual-${item.id}`, role: 'user' as const, content: item.text, timestamp: Date.now() };
    const compiled = deps.compiler.compile({
      attachments: payloadAttachments,
      tokenCeiling: ctx.tokenCeiling,
      log: true,
      historyTurns: [...this.turnsOf(deps, threadId), virtualAsk],
      historyChapters: this.chaptersOf(deps, threadId),
      capabilities: chain.ctx.capabilities ?? DEFAULT_CHAT_CAPABILITIES,
    });

    let jobId = item.serverJobId;
    if (jobId) {
      // Re-entry: is the job still live, failed/stopped (retry), or gone?
      const listRes = await apiFetch(`/api/projects/${encodeURIComponent(ctx.projectId)}/jobs`);
      const list = listRes.ok ? ((await listRes.json()) as { jobs: Array<{ jobId: string; state: string }> }) : { jobs: [] };
      const known = list.jobs.find((j) => j.jobId === jobId);
      if (!known) {
        // Completed and deleted server-side — the pair arrives via delta.
        this.drafts.resolve(item.id);
        if (typeof window !== 'undefined') window.dispatchEvent(new Event('focus'));
        return;
      }
      if (known.state === 'failed' || known.state === 'stopped') {
        // Only reachable via an explicit user Retry (failed heads never auto-kick).
        // Design 23 §2.5 (live 2026-10-25): the retry carries the CURRENT
        // selection — the user may have changed the model after the failure,
        // and the recompiled prompt reflects the draft's payload. Re-running
        // the frozen failed request verbatim would just fail the same way.
        const retryRes = await apiFetch(`/api/jobs/${encodeURIComponent(jobId)}/retry`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: ctx.model.id,
            compiledPrompt: compiled.compiledPrompt,
            systemInstruction: compiled.systemInstruction,
            // The commit gates on the job's stored capabilities — the fresh
            // compile taught per the CURRENT ones. They must agree.
            capabilities: chain.ctx.capabilities ?? DEFAULT_CHAT_CAPABILITIES,
          }),
        });
        if (!retryRes.ok) throw new Error(`Retry failed (HTTP ${retryRes.status})`);
      }
    } else {
      const createRes = await apiFetch(
        `/api/projects/${encodeURIComponent(ctx.projectId)}/jobs/send`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            threadId,
            kind: item.kind ?? 'send',
            askText: item.text,
            compiledPrompt: compiled.compiledPrompt,
            systemInstruction: compiled.systemInstruction,
            model: ctx.model.id,
            stagedAttachments: payloadAttachments.filter(isAttachmentStaged),
            targetTurnId: item.targetTurnId ?? null,
            // Package 2 §2.4: the job carries the resolved toggles so the
            // SERVER commit path gates exactly like the client one.
            capabilities: chain.ctx.capabilities ?? DEFAULT_CHAT_CAPABILITIES,
          }),
        }
      );
      if (!createRes.ok) {
        const body = await createRes.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error || `Job enqueue failed (HTTP ${createRes.status})`);
      }
      const body = (await createRes.json()) as { job: { jobId: string } };
      jobId = body.job.jobId;
      item.serverJobId = jobId;
    }

    await this.watchVpsJob(jobId, item, deps);
  }

  /** SSE watch with re-attach on disconnect — never fails the draft (21E §4.3). */
  private async watchVpsJob(jobId: string, item: DraftItem, deps: SendQueueDeps): Promise<void> {
    for (;;) {
      // Another action (stop/discard) may have taken over the draft.
      if (this.activeDraft !== item) return;
      try {
        const res = await apiFetch(`/api/jobs/${encodeURIComponent(jobId)}/stream`);
        if (res.status === 404) {
          // Completed & deleted — commit is already in SQLite.
          this.drafts.resolve(item.id);
          if (typeof window !== 'undefined') window.dispatchEvent(new Event('focus'));
          deps.triggerReRender();
          return;
        }
        if (!res.ok || !res.body) throw new Error(`stream HTTP ${res.status}`);
        // Watch attached. The snapshot's state is the truth: a job can be
        // attached AND queued (FIFO-blocked behind a dead head) — claiming
        // "the model is thinking" here was a live-found lie (2026-10-25).
        // The phase moves when the server SAYS so (snapshot + status events).

        const terminal = await this.readVpsSse(res, item, deps);
        if (terminal) return;
        // Clean close without terminal → re-attach.
      } catch {
        // Screen locked / network blip: WAIT and re-attach. Never fail here.
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }

  /** Reads SSE frames; returns true on a terminal event. */
  private async readVpsSse(res: Response, item: DraftItem, deps: SendQueueDeps): Promise<boolean> {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return false; // disconnect → caller re-attaches
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const eventMatch = frame.match(/^event: (.+)$/m);
        const dataMatch = frame.match(/^data: (.+)$/m);
        if (!eventMatch || !dataMatch) continue;
        const event = eventMatch[1].trim();
        let data: any = {};
        try {
          data = JSON.parse(dataMatch[1]);
        } catch {
          continue;
        }
        if (event === 'snapshot') {
          const snapState = String(data.state ?? 'queued');
          // A late watcher learns the provider ACK via the snapshot — otherwise
          // it would sit in CONNECTING through a slow time-to-first-token.
          const phase =
            snapState === 'sending' && data.connected
              ? 'awaiting-first-token'
              : vpsPhaseFor(snapState);
          this.drafts.setProgress(item.id, { phase });
          if (data.state === 'sending' && typeof data.partialText === 'string' && data.partialText) {
            this.drafts.updatePartial(item.id, data.partialText);
          }
          deps.triggerReRender();
        } else if (event === 'status') {
          // Server-side lifecycle ACKs (design 23 §2.2): connecting →
          // connected (provider ACK) → chunks. Writing never downgrades.
          const phase = vpsPhaseFor(String(data.state ?? ''));
          const current = this.drafts.getItem(item.id);
          if (phase !== 'writing' && current?.progress?.phase !== 'writing') {
            this.drafts.setProgress(item.id, { phase });
          }
          deps.triggerReRender();
        } else if (event === 'chunk') {
          deps.setStreamPhase('streaming');
          deps.setStreamingStatus(null);
          this.drafts.updatePartial(item.id, data.partialText ?? '');
          const current = this.drafts.getItem(item.id);
          if (current?.progress?.phase !== 'writing') {
            this.drafts.setProgress(item.id, {
              phase: 'writing',
              firstTokenAt: Date.now(),
              chars: (data.partialText ?? '').length,
            });
          } else {
            this.drafts.setProgress(item.id, { chars: (data.partialText ?? '').length });
          }
          deps.triggerReRender();
        } else if (event === 'complete') {
          this.drafts.resolve(item.id);
          deps.markThreadUnread(item.threadId);
          if (typeof window !== 'undefined') window.dispatchEvent(new Event('focus')); // delta pull NOW
          deps.triggerReRender();
          return true;
        } else if (event === 'error') {
          // Terminal server failure: land the draft failed with the server's
          // reason + machine code (retry re-attaches to the same job id).
          const failCode =
            typeof data.code === 'string' && data.code ? data.code : errorCodeFor(String(data.message || ''));
          this.drafts.fail(
            item.id,
            String(data.message || 'The request failed — no reply came back.'),
            item.partial,
            failCode
          );
          deps.triggerReRender();
          // design 25: a restart locked the vault mid-session — re-arm from the
          // tab-held derived key and resend, so the user never sees this.
          if (failCode === 'VAULT_LOCKED') this.reArmAndRetry(item.id);
          return true;
        } else if (event === 'stopped') {
          this.drafts.stop(item.id, data.partialText || item.partial);
          deps.triggerReRender();
          return true;
        }
      }
    }
  }

  /**
   * Regenerate attempt: the OLD reply stays visible and untouched until the
   * new one is complete. The model is shown the pair with an empty reply
   * (virtual — storage is not written until commit).
   */
  private async executeRegenerateAttempt(chain: QueueChain, item: DraftItem): Promise<void> {
    const deps = chain.deps;
    const ctx = chain.ctx;
    const threadId = item.threadId;
    const targetTurnId = item.targetTurnId!;
    deps.setStreamingStatus(`Connecting to ${ctx.model.name}...`);
    deps.setStreamPhase('waiting');
    const controller = new AbortController();
    this.jobAbort = controller;

    const bufferedArtifacts: ExtractedArtifactUpsert[] = [];
    const bufferedShifts: ExtractedTopicShift[] = [];
    let streamedContent = '';

    try {
      if (localVaultLocked(ctx.model.id)) {
        this.drafts.fail(item.id, VAULT_LOCKED_REASON, undefined, 'VAULT_LOCKED');
        return;
      }
      const payloadAttachments = item.attachments ?? deps.threadRegistry.getAttachments(threadId);
      this.drafts.setProgress(item.id, { phase: 'connecting' });
      const historyTurns = this.turnsOf(deps, threadId).map((t) =>
        t.id === targetTurnId ? { ...t, content: '' } : t
      );
      const compiled = deps.compiler.compile({
        attachments: payloadAttachments,
        tokenCeiling: ctx.tokenCeiling,
        log: true,
        historyTurns,
        historyChapters: this.chaptersOf(deps, threadId),
        capabilities: chain.ctx.capabilities ?? DEFAULT_CHAT_CAPABILITIES,
      });
      // ACK-driven phase ladder (same as executeAttempt) — no optimistic
      // "thinking" before the provider has even accepted the connection.

      const result = await deps.stream.executeStreamingTurn(
        {
          model: ctx.model.id,
          projectTitle: ctx.projectTitle,
          compiledPrompt: compiled.compiledPrompt,
          systemInstruction: compiled.systemInstruction,
        },
        {
          signal: controller.signal,
          onStatus: (status) => {
            deps.setStreamingStatus(status.message);
            deps.setStreamPhase(status.state === 'writing' ? 'streaming' : 'waiting');
            if (status.state === 'thinking' || status.state === 'connected') {
              const current = this.drafts.getItem(item.id);
              if (current?.progress?.phase !== 'writing') {
                this.drafts.setProgress(item.id, { phase: 'awaiting-first-token' });
              }
            }
            deps.triggerReRender();
          },
          onChunk: (_d, acc) => {
            streamedContent = acc;
            this.drafts.updatePartial(item.id, acc);
            if (this.drafts.getItem(item.id)?.progress?.phase !== 'writing') {
              this.drafts.setProgress(item.id, {
                phase: 'writing',
                firstTokenAt: Date.now(),
                chars: acc.length,
              });
            } else {
              this.drafts.setProgress(item.id, { chars: acc.length });
            }
            deps.setStreamPhase('streaming');
            deps.triggerReRender();
          },
          onTopicShift: (shift) => {
            bufferedShifts.push(shift);
            this.drafts.setBuffers(item.id, bufferedArtifacts, bufferedShifts);
          },
          onArtifact: (u) => {
            bufferedArtifacts.push(u);
            this.drafts.setBuffers(item.id, bufferedArtifacts, bufferedShifts);
          },
        }
      );

      if (controller.signal.aborted) {
        this.drafts.stop(item.id, streamedContent || result.cleanReply || undefined);
        return;
      }

      const prose = result.cleanReply || streamedContent;
      if (!prose) {
        this.drafts.fail(item.id, 'The stream ended without a reply.', item.partial);
        return;
      }

      const estPrompt =
        result.telemetry?.inputTokens ?? Math.max(1, estimateTokens(compiled.compiledPrompt || ''));
      const estCand =
        result.telemetry?.outputTokens ?? Math.max(1, estimateTokens(prose));
      this.commitRegenerate(chain, item, prose, bufferedArtifacts, bufferedShifts, {
        model: result.telemetry?.model || ctx.model.name,
        inputTokens: estPrompt,
        outputTokens: estCand,
        totalTokens: result.telemetry?.totalTokens ?? (estPrompt + estCand),
        latencyMs: result.telemetry?.latencyMs,
        timeToFirstChunkMs: result.telemetry?.timeToFirstChunkMs,
        isFallback: result.telemetry?.isFallback ?? true,
        isStreaming: false,
        streamState: 'completed',
      });
      this.drafts.resolve(item.id);
    } catch (err: any) {
      if (err.name === 'AbortError' || controller.signal.aborted) {
        this.drafts.stop(item.id, streamedContent || undefined);
        return;
      }
      const reason =
        typeof err?.message === 'string' && err.message.trim()
          ? err.message.trim().slice(0, 400)
          : 'The request failed — no reply came back.';
      this.drafts.fail(item.id, reason, streamedContent || undefined, errorCodeFor(reason));
    }
  }

  /**
   * Success half of a regenerate: the pair's reply is replaced atomically
   * with the completed new one (content + extracted artifacts + side effects).
   * The turn id and the ask stay — it is still the same pair.
   */
  private commitRegenerate(
    chain: QueueChain,
    item: DraftItem,
    replyText: string,
    bufferedArtifacts: ExtractedArtifactUpsert[],
    bufferedShifts: ExtractedTopicShift[],
    meta: TurnMeta
  ): void {
    const deps = chain.deps;
    const threadId = item.threadId;
    const targetTurnId = item.targetTurnId!;
    const turns = this.turnsOf(deps, threadId);
    const targetIndex = turns.findIndex((t) => t.id === targetTurnId);

    const extractedList: ExtractedArtifact[] = bufferedArtifacts.map((u) => ({
      id: u.id,
      title: u.title,
      type: u.type,
      code: u.id || u.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30),
      category: u.type === 'chapter' ? 'chapter' : 'note',
      subtitle: u.content.subtitle,
      description: u.content.description,
      summary: u.content.summary,
      content: u.content.body,
      isHighConcept: false,
    }));
    this.updateTurnInThread(deps, threadId, targetTurnId, {
      content: replyText,
      extractedArtifacts: extractedList,
      meta,
    });
    this.applyBufferedArtifacts(
      chain,
      threadId,
      bufferedArtifacts,
      targetIndex >= 0 ? targetIndex : turns.length - 1,
      targetTurnId
    );
    // AI-attachment law on regenerate too: new extractions attach to the
    // replaced reply (existing entries keep the user's granularity).
    for (const art of extractedList) {
      if (art.id) {
        deps.threadRegistry.ensureAttached(
          threadId,
          art.id,
          targetIndex >= 0 ? targetIndex : turns.length - 1,
          targetTurnId
        );
      }
    }
    // The regenerated pair is the thread's last two turns — the cut applies
    // at its ask, exactly as a fresh send's would.
    this.applyBufferedShifts(chain, threadId, bufferedShifts, Math.max(0, this.turnsOf(deps, threadId).length - 2));
    deps.threadRegistry.patch(threadId, { lastOutcome: 'ok', lastActivityAt: Date.now() });
    deps.triggerReRender();
    logger.info('App', 'Pair reply replaced (regenerate)', {
      threadId,
      turnId: targetTurnId,
      model: meta.model,
    });
  }

  /** Artifacts extracted during an attempt land ONLY when the work commits. */
  private applyBufferedArtifacts(
    chain: QueueChain,
    threadId: string,
    bufferedArtifacts: ExtractedArtifactUpsert[],
    assistantTurnIndex: number,
    assistantTurnId: string
  ): void {
    const deps = chain.deps;
    // Package 2 §2.4: a capability that is OFF means its XML block was never
    // taught — a rogue block that slipped through the demuxer is IGNORED here.
    if (!(chain.ctx.capabilities ?? DEFAULT_CHAT_CAPABILITIES).writeArtifacts) {
      if (bufferedArtifacts.length) {
        logger.info('App', `Dropped ${bufferedArtifacts.length} buffered note(s) — note writing is switched off for this chat`);
      }
      return;
    }
    for (const u of bufferedArtifacts) {
      const code = u.id || u.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30);
      const existing = deps.artifacts.getArtifact(code) || deps.artifacts.getArtifact(u.id);
      let artifactId = existing?.id || u.id || '';
      if (existing) {
        // Revision of the OLD state FIRST (full title + layers snapshot), so
        // History can show and revert what the chat just overwrote…
        deps.versioning.recordSnapshot(existing.id, {
          actor: 'ai',
          changeSummary: `Update from chat: ${u.content.description}`,
          provenance: { threadId, turnId: assistantTurnId, turnIndex: assistantTurnIndex },
          title: existing.title,
          layers: { ...existing.current },
        });
        // …then actually apply the update. (Bug 2026-10-27: the revision was
        // recorded but the upsert was forgotten — existing notes never
        // changed on the client path, the reply just claimed they had.)
        const savedExisting = deps.artifacts.upsertArtifact({
          ...existing,
          title: u.title || existing.title,
          current: {
            subtitle: u.content.subtitle,
            description: u.content.description,
            summary: u.content.summary,
            body: u.content.body,
          },
          updatedAt: Date.now(),
          // The AI rewrote every layer, so nothing is stale anymore.
          layersStaleAt: undefined,
        });
        artifactId = savedExisting.id;
      } else {
        const now = Date.now();
        const newArtifact: Artifact = {
          id: u.id || `art-${now}`,
          workspaceId: chain.ctx.projectId,
          code,
          title: u.title || 'Extracted note',
          type: u.type === 'chapter' ? 'chapter' : 'document',
          category: u.type === 'chapter' ? 'chapter' : 'note',
          color: getMellowPastelColor(code),
          isHighConcept: false,
          current: {
            subtitle: u.content.subtitle || '',
            description: u.content.description || '',
            summary: u.content.summary || '',
            body: u.content.body || `# ${u.title}`,
          },
          tags: ['chat-extracted', u.type || 'note'],
          createdAt: now,
          updatedAt: now,
          graph: { is_high_concept: false, x: 300, y: 200 },
        };
        const saved = deps.artifacts.upsertArtifact({
          ...newArtifact,
          yamlDocument: serializeArtifactToYamlDoc(newArtifact),
        });
        artifactId = saved.id;
        // Initial revision (v1): the note's birth state, with chat provenance.
        deps.versioning.recordSnapshot(saved.id, {
          actor: 'ai',
          changeSummary: `Created from chat: ${u.content.description}`,
          provenance: { threadId, turnId: assistantTurnId, turnIndex: assistantTurnIndex },
          title: saved.title,
          layers: { ...saved.current },
        });
      }
      if (artifactId) {
        deps.threadRegistry.attachArtifact(threadId, artifactId, 'full', assistantTurnIndex, assistantTurnId);
      }
    }
  }

  /** Topic shifts land after the committed work — never mid-attempt. */
  /**
   * Topic-shift chapter law (David 2026-10-25):
   *   1. LAST shift wins — one reply may carry several sentinels.
   *   2. The cut applies at the human ask that caused the change (askIndex),
   *      not after the reply.
   *   3. A cut that already exists at that index is RETITLED, never duplicated.
   */
  private applyBufferedShifts(
    chain: QueueChain,
    threadId: string,
    bufferedShifts: ExtractedTopicShift[],
    askIndex: number
  ): void {
    const deps = chain.deps;
    // Package 2 §2.4: autoChapter OFF = no model-cut chapters, even if a rogue
    // <topic_shift> arrived. Manual splits stay unaffected.
    if (!(chain.ctx.capabilities ?? DEFAULT_CHAT_CAPABILITIES).autoChapter) return;
    const shift = bufferedShifts[bufferedShifts.length - 1];
    if (!shift) return;
    if (this.isActiveThread(deps, threadId)) {
      deps.segmentation.upsertChapterAtBoundary(
        shift.title,
        askIndex,
        shift.subtitle,
        shift.description,
        shift.summary
      );
    } else {
      deps.threadRegistry.upsertChapterAtBoundaryInactive(
        threadId,
        shift.title,
        askIndex,
        shift.subtitle,
        shift.description,
        shift.summary
      );
    }
  }
}
