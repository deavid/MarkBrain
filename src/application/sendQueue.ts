/**
 * Serial send queue and thread-turn orchestration.
 *
 * One stream at a time — by design (Gemini quota). A send in another thread
 * enqueues; a send queued in the same thread buffer-appends, so a chain is a
 * sequence of jobs, each producing one user turn and one assistant turn.
 *
 * Two invariants, both easy to break:
 *   - `deps` are re-published by App on every render, but a CHAIN snapshots
 *     them (plus `getContext()`) at chain start and keeps them for its whole
 *     life. Re-reading mid-chain mixes two renders' state into one conversation.
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

export interface QueueJob {
  id: string;
  threadId: string;
  mode: 'new' | 'retry';
  text?: string;
  turnId?: string; // retry target (assistant turn to regenerate)
}

/** App render values, snapshotted once when a chain starts (see the header). */
export interface TurnSendContext {
  model: ModelOption;
  projectId: string;
  projectTitle: string;
  tokenCeiling: number;
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

/** Deps + context captured at chain start; never refreshed mid-chain. */
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

export class SendQueue {
  private queue: QueueJob[] = [];
  private activeJob: QueueJob | null = null;
  private jobAbort: AbortController | null = null;
  private chain: QueueChain | null = null;
  private readonly getDeps: () => SendQueueDeps;

  constructor(getDeps: () => SendQueueDeps) {
    this.getDeps = getDeps;
  }

  /** Live pending jobs — the array itself, not a copy. */
  getQueue(): QueueJob[] {
    return this.queue;
  }

  getActiveJob(): QueueJob | null {
    return this.activeJob;
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
    this.enqueueJob({
      id: `job-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      threadId,
      mode: 'new',
      text,
    });
  }

  handleCancelQueued(threadId: string): void {
    const deps = this.getDeps();
    const before = this.queue.length;
    this.queue = this.queue.filter((j) => j.threadId !== threadId);
    const removed = before - this.queue.length;
    if (removed === 0) return;
    const thread = deps.threadRegistry.getThread(threadId);
    const stillQueued = this.queue.some((j) => j.threadId === threadId);
    if (
      thread &&
      !stillQueued &&
      this.turnsOf(deps, threadId).length === 0 &&
      thread.titleState === 'placeholder' &&
      thread.titleVersion === 0
    ) {
      deps.threadRegistry.patch(threadId, { title: 'New thread', preview: '' });
    }
    logger.action('App', 'Cancelled queued messages', { threadId, removed });
    deps.triggerReRender();
  }

  handleRetryThread(): void {
    const deps = this.getDeps();
    const threadId = deps.threadRegistry.getActiveThreadId();
    const turns = this.turnsOf(deps, threadId);
    const lastAssistant = [...turns].reverse().find((t) => t.role === 'assistant');
    if (!lastAssistant) return;
    logger.action('App', 'Retry last assistant turn', { threadId, turnId: lastAssistant.id });
    this.enqueueJob({
      id: `job-${Date.now()}-retry`,
      threadId,
      mode: 'retry',
      turnId: lastAssistant.id,
    });
  }

  stopGeneration(): void {
    const deps = this.getDeps();
    logger.action('App', 'Stop generation');
    const job = this.activeJob;
    if (job && job.threadId === deps.threadRegistry.getActiveThreadId() && this.jobAbort) {
      this.jobAbort.abort();
      deps.postChatCancel('Stop button pressed by user');
      // runJob.finally() clears the active job and promotes the queue
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
    const queuedNew = this.queue.filter(
      (j) => j.threadId === threadId && j.mode === 'new'
    ).length;
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
    const assistantCount = turns.filter(
      (t) =>
        t.role === 'assistant' &&
        t.meta?.streamState !== 'error' &&
        t.meta?.streamState !== 'interrupted'
    ).length;
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

  private async executeTurn(chain: QueueChain, job: QueueJob) {
    const deps = chain.deps;
    const ctx = chain.ctx;
    const threadId = job.threadId;
    deps.setStreamingStatus(`Connecting to ${ctx.model.name}...`);
    deps.setStreamPhase('waiting');
    const controller = new AbortController();
    this.jobAbort = controller;

    let assistantTurnId: string;
    if (job.mode === 'retry' && job.turnId) {
      assistantTurnId = job.turnId;
      // Weld any staged attachments to the user turn this retry answers (see resolveRetryAnchorIndex).
      const turnsForAnchor = this.turnsOf(deps, threadId);
      const anchorIdx = resolveRetryAnchorIndex(turnsForAnchor, assistantTurnId);
      const anchorTurn = turnsForAnchor[anchorIdx];
      const committedOnRetry = deps.threadRegistry.commitStagedAttachments(
        threadId,
        anchorIdx,
        anchorTurn?.id ?? null
      );
      if (committedOnRetry > 0) {
        logger.info(
          'App',
          `Committed ${committedOnRetry} staged attachment(s) on retry to turn ${anchorIdx}`,
          { threadId }
        );
      }
      this.updateTurnInThread(deps, threadId, assistantTurnId, {
        content: '',
        extractedArtifacts: [],
        meta: { model: ctx.model.name, isStreaming: true, streamState: 'connecting' },
      });
    } else {
      const userTurn = this.appendTurnToThread(deps, threadId, 'user', job.text!);
      // Weld staged attachments before compile() so history and payload agree.
      const userTurnIndex = this.turnsOf(deps, threadId).length - 1;
      const committed = deps.threadRegistry.commitStagedAttachments(
        threadId,
        userTurnIndex,
        userTurn.id
      );
      if (committed > 0) {
        logger.info('App', `Committed ${committed} staged attachment(s) to turn ${userTurnIndex}`, {
          threadId,
        });
      }
      assistantTurnId = this.appendTurnToThread(deps, threadId, 'assistant', '', [], {
        model: ctx.model.name,
        isStreaming: true,
        streamState: 'connecting',
      }).id;
    }
    deps.triggerReRender();

    let streamedContent = '';
    let compiled: any = null;
    try {
      // Background jobs must never leak the visible thread's context.
      compiled = deps.compiler.compile({
        // A chain can span threads: each payload carries only its own thread's attachments.
        attachments: deps.threadRegistry.getAttachments(threadId),
        tokenCeiling: ctx.tokenCeiling,
        log: true, // once-per-send lifecycle log (display memo must stay silent)
        historyTurns: this.turnsOf(deps, threadId),
        historyChapters: this.chaptersOf(deps, threadId),
      });

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
            this.updateTurnInThread(deps, threadId, assistantTurnId, {
              meta: {
                model: status.model || ctx.model.name,
                isStreaming: true,
                streamState: status.state,
                latencyMs: status.elapsedMs,
              },
            });
            deps.triggerReRender();
          },
          onChunk: (_cleanDelta, accumulatedClean) => {
            streamedContent = accumulatedClean;
            deps.setStreamPhase('streaming');
            this.updateTurnInThread(deps, threadId, assistantTurnId, {
              content: accumulatedClean,
              meta: {
                model: ctx.model.name,
                isStreaming: true,
                streamState: 'writing',
              },
            });
            deps.triggerReRender();
          },
          onTopicShift: (shift) => {
            if (this.isActiveThread(deps, threadId)) {
              deps.segmentation.declareNewChapter(
                shift.title,
                deps.timeline.count(),
                shift.subtitle,
                shift.description,
                shift.summary
              );
            } else {
              deps.threadRegistry.declareChapterInactive(
                threadId,
                shift.title,
                this.turnsOf(deps, threadId).length,
                shift.subtitle,
                shift.description,
                shift.summary
              );
            }
            deps.triggerReRender();
          },
          onArtifact: (u) => {
            const code = u.id || u.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30);
            const existing = deps.artifacts.getArtifact(code) || deps.artifacts.getArtifact(u.id);
            let artifactId = existing?.id || u.id || '';

            if (existing) {
              deps.versioning.recordRevision(
                existing.id,
                u.content.body,
                `Update from chat: ${u.content.description}`
              );
            } else {
              const now = Date.now();
              const artTitle = u.title || 'Extracted note';
              const artSubtitle = u.content.subtitle || '';
              const artDesc = u.content.description || '';
              const artSumm = u.content.summary || '';
              const artContent = u.content.body || `# ${artTitle}`;
              const artColor = getMellowPastelColor(code);

              const newArtifact: Artifact = {
                id: u.id || `art-${now}`,
                workspaceId: ctx.projectId,
                code,
                title: artTitle,
                type: u.type === 'chapter' ? 'chapter' : 'document',
                category: u.type === 'chapter' ? 'chapter' : 'note',
                color: artColor,
                isHighConcept: false,
                current: {
                  subtitle: artSubtitle,
                  description: artDesc,
                  summary: artSumm,
                  body: artContent,
                },
                tags: ['chat-extracted', u.type || 'note'],
                createdAt: now,
                updatedAt: now,
                graph: {
                  is_high_concept: false,
                  x: 300,
                  y: 200,
                },
              };
              const saved = deps.artifacts.upsertArtifact({
                ...newArtifact,
                yamlDocument: serializeArtifactToYamlDoc(newArtifact),
              });
              artifactId = saved.id;
            }
            // Attach it to this chat, welded to the turn that produced it. Idempotent:
            // re-extraction never moves the anchor nor resets a lowered granularity.
            if (artifactId) {
              const assistantTurnIndex = this.turnsOf(deps, threadId).findIndex(
                (t) => t.id === assistantTurnId
              );
              deps.threadRegistry.attachArtifact(
                threadId,
                artifactId,
                'full',
                assistantTurnIndex >= 0 ? assistantTurnIndex : null,
                assistantTurnId
              );
            }
            deps.triggerReRender();
          },
        }
      );

      const extractedList: ExtractedArtifact[] = result.artifacts.map((u) => ({
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

      const isInterrupted = controller.signal.aborted;
      const estPrompt =
        result.telemetry?.inputTokens ??
        Math.max(1, estimateTokens(compiled.compiledPrompt || ''));
      const estCand =
        result.telemetry?.outputTokens ??
        Math.max(1, estimateTokens(result.cleanReply || streamedContent || ''));
      const totalTok = result.telemetry?.totalTokens ?? (estPrompt + estCand);

      this.updateTurnInThread(deps, threadId, assistantTurnId, {
        content:
          result.cleanReply ||
          streamedContent ||
          (isInterrupted
            ? ''
            : extractedList.length > 0
              ? `Extracted ${extractedList.length} note${extractedList.length === 1 ? '' : 's'} — no prose reply came back.`
              : 'No reply came back. Try again.'),
        extractedArtifacts: extractedList,
        meta: {
          model: result.telemetry?.model || ctx.model.name,
          inputTokens: estPrompt,
          outputTokens: estCand,
          totalTokens: totalTok,
          latencyMs: result.telemetry?.latencyMs,
          timeToFirstChunkMs: result.telemetry?.timeToFirstChunkMs,
          isFallback: result.telemetry?.isFallback ?? true,
          isStreaming: false,
          streamState: isInterrupted ? 'interrupted' : 'completed',
        },
      });
      deps.threadRegistry.patch(threadId, {
        lastOutcome: isInterrupted ? 'interrupted' : 'ok',
        lastActivityAt: Date.now(),
      });
      deps.triggerReRender();
      logger.info('App', `Turn completed${isInterrupted ? ' (interrupted)' : ''}`, {
        threadId,
        model: result.telemetry?.model || ctx.model.name,
        totalTokens: totalTok,
        artifacts: extractedList.length,
        topicShifts: result.topicShift ? 1 : 0,
      });
      if (!isInterrupted) this.maybeRetitle(chain, threadId);
    } catch (err: any) {
      if (err.name === 'AbortError' || controller.signal.aborted) {
        const estPrompt = Math.max(1, compiled?.telemetry?.tokenBreakdown?.totalTokens || 120);
        const estCand = Math.max(1, estimateTokens(streamedContent || ''));
        this.updateTurnInThread(deps, threadId, assistantTurnId, {
          content: streamedContent || '',
          meta: {
            model: ctx.model.name,
            isStreaming: false,
            streamState: 'interrupted',
            inputTokens: estPrompt,
            outputTokens: estCand,
            totalTokens: estPrompt + estCand,
            isFallback: true,
          },
        });
        deps.threadRegistry.patch(threadId, {
          lastOutcome: 'interrupted',
          lastActivityAt: Date.now(),
        });
        logger.info('App', 'Turn interrupted by user', {
          threadId,
          inputTokens: estPrompt,
          partialTokens: estCand,
        });
      } else {
        logger.error('App', 'Streaming turn failed', err);
        this.updateTurnInThread(deps, threadId, assistantTurnId, {
          content: streamedContent || 'Error communicating with reasoning engine. Please try again.',
          meta: {
            model: ctx.model.name,
            isStreaming: false,
            streamState: 'error',
          },
        });
        deps.threadRegistry.patch(threadId, { lastOutcome: 'error', lastActivityAt: Date.now() });
      }
      deps.triggerReRender();
    } finally {
      this.jobAbort = null;
    }
  }

  private async runJob(chain: QueueChain, job: QueueJob) {
    this.activeJob = job;
    chain.deps.triggerReRender();
    try {
      await this.executeTurn(chain, job);
    } catch (err) {
      logger.error('App', 'Queued job failed unexpectedly', err);
    } finally {
      this.activeJob = null;
      this.jobAbort = null;
      chain.deps.setStreamingStatus(null);
      chain.deps.setStreamPhase(null);
      chain.deps.triggerReRender();
      // Finished while the user was elsewhere → brightness bump until opened.
      chain.deps.markThreadUnread(job.threadId);
      const next = this.queue.shift();
      if (next) void this.runJob(chain, next);
      else this.chain = null;
    }
  }

  private enqueueJob(job: QueueJob) {
    this.queue.push(job);
    if (!this.activeJob) {
      // Chain start: snapshot deps + render context for the whole chain. Do not
      // re-read getDeps() inside the chain — a chain spans renders.
      const deps = this.getDeps();
      const chain: QueueChain = { deps, ctx: deps.getContext() };
      this.chain = chain;
      const next = this.queue.shift();
      if (next) void this.runJob(chain, next);
    } else {
      this.getDeps().triggerReRender();
    }
  }
}