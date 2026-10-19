/**
 * Serial send-queue / thread-turn orchestration.
 *
 * Extracted verbatim from App.tsx (the "Serial generation queue" section) —
 * pure orchestration, ZERO behavior change. One stream at a time (Gemini
 * quota + serial by design): sends in other threads enqueue; queued sends
 * within one thread buffer-append (each job = one user turn + one assistant
 * turn when it starts).
 *
 * Dependencies arrive via a getter injected at construction:
 *   - `deps` are re-published by App on every render; the queue SNAPS them
 *     (together with `getContext()`) when a chain starts, so an entire
 *     drain chain runs against the same closure values the inline
 *     implementation captured in render scope.
 *   - `getContext()` is read only at chain start (model / project info /
 *     compile options for that send).
 *
 * React seam: streamPhase/streamingStatus useState + the re-render tick
 * stay in App (presentation); the queue drives them through the injected
 * `setStreamingStatus` / `setStreamPhase` / `triggerReRender` callbacks.
 * Fetch sites (title meta-call, stop-cancel ping) and window.confirm also
 * stay in App.tsx (injected as callbacks) so nothing outside this new
 * directory moves.
 */
import type { DomainContextValue } from '../domains/DomainRegistry';
import {
  getMellowPastelColor,
  type Artifact,
  type ModelOption,
  type ResolutionTier,
} from '../types';
import { serializeArtifactToYamlDoc } from '../utils/yamlArtifactParser';
import { logger } from '../utils/logger';
import { placeholderTitle, sampleTurnsForTitle, titlePipelineStep } from '../domains/06-chat-threads';

/** One queued unit: a new send (user + assistant turn) or an assistant retry. */
export interface QueueJob {
  id: string;
  threadId: string;
  mode: 'new' | 'retry';
  text?: string;
  turnId?: string; // retry target (assistant turn to regenerate)
}

/**
 * App render values snapshotted when a queue chain starts. The inline
 * implementation read these from the render closure of the send that began
 * the chain; the chain kept that closure for every subsequent job.
 */
export interface TurnSendContext {
  model: ModelOption;
  projectId: string;
  projectTitle: string;
  focalIds: string[];
  opticalMode: 'autofocus' | 'manual' | 'myopia';
  tokenCeiling: number;
  tierOverrides: Record<string, ResolutionTier>;
}

/** React glue + fetch/confirm call sites that remain owned by App.tsx. */
export interface SendQueueDeps
  extends Pick<
    DomainContextValue,
    'threadRegistry' | 'timeline' | 'segmentation' | 'artifacts' | 'versioning' | 'compiler' | 'stream'
  > {
  triggerReRender: () => void;
  setStreamingStatus: (status: string | null) => void;
  setStreamPhase: (phase: 'waiting' | 'streaming' | null) => void;
  markThreadUnread: (threadId: string) => void;
  /** POST /api/title-thread (fetch stays in App). Resolves to the title or null. */
  requestAutoTitle: (
    messages: Array<{ role: string; content: string }>,
    version: number
  ) => Promise<string | null>;
  /** POST /api/chat/cancel fire-and-forget (fetch stays in App). */
  postChatCancel: (reason: string) => void;
  /** window.confirm (stays in App) for the archived-thread continue prompt. */
  confirm: (message: string) => boolean;
  /** Render-scope snapshot for a chain-starting enqueue (read at enqueue time). */
  getContext: () => TurnSendContext;
}

/** Deps + context captured at chain start — mirrors the old render closure. */
interface QueueChain {
  deps: SendQueueDeps;
  ctx: TurnSendContext;
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

  // ── Read API for App's derived/rendered state ──────────────────────────────

  /** Live pending jobs (same object identity semantics as the old queueRef). */
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

  // ── Public entry points (App keeps thin same-named wrappers) ───────────────

  handleSendMessage(text: string): void {
    const deps = this.getDeps();
    const threadId = deps.threadRegistry.getActiveThreadId();
    if (!threadId) return;
    const thread = deps.threadRegistry.getThread(threadId);
    if (thread?.lifecycle === 'archived') {
      // Archived threads are readable; continuing one requires unarchiving.
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

  /** Cancel this thread's PENDING jobs (never touches an in-flight stream). */
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
      // Nothing ever ran — drop the speculative placeholder title/preview.
      deps.threadRegistry.patch(threadId, { title: 'New thread', preview: '' });
    }
    logger.action('App', 'Cancelled queued messages', { threadId, removed });
    deps.triggerReRender();
  }

  /** Regenerate the last assistant turn of the active thread (error/interrupted). */
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

  // ── Thread-aware turn routing ──────────────────────────────────────────────
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
    extractedArtifacts?: any[],
    meta?: any
  ) {
    if (this.isActiveThread(deps, threadId)) {
      return deps.timeline.appendTurn(role, content, extractedArtifacts, meta);
    }
    const turn = deps.threadRegistry.appendInactiveTurn(threadId, role, content, extractedArtifacts, meta);
    if (!turn) throw new Error(`appendInactiveTurn failed for thread ${threadId}`);
    return turn;
  }

  private updateTurnInThread(deps: SendQueueDeps, threadId: string, turnId: string, partial: any) {
    if (this.isActiveThread(deps, threadId)) deps.timeline.updateTurn(turnId, partial);
    else deps.threadRegistry.updateInactiveTurn(threadId, turnId, partial);
  }

  // Stage-0 title: truncated first message, set at send time (instant sidebar
  // feedback even while the job sits in the queue). No LLM involved.
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

  // Staged titling pipeline — fires after a successful assistant reply:
  // stage1 after the 1st, stage2 once after the 3rd. Fire-and-forget meta
  // call; failures keep the current title (titles never block the UX).
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

  // Execute ONE job (new send or retry) against its thread — active thread via
  // live domains, background threads via the registry cache.
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
      this.updateTurnInThread(deps, threadId, assistantTurnId, {
        content: '',
        extractedArtifacts: [],
        meta: { model: ctx.model.name, isStreaming: true, streamState: 'connecting' },
      });
    } else {
      this.appendTurnToThread(deps, threadId, 'user', job.text!);
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
      // Compile against THIS thread's turns/chapters (historyTurns override) —
      // background jobs must never leak the visible thread's context.
      compiled = deps.compiler.compile({
        focalIds: ctx.focalIds,
        opticalMode: ctx.opticalMode,
        tokenCeiling: ctx.tokenCeiling,
        tierOverrides: ctx.tierOverrides,
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
                durationMs: status.elapsedMs,
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
              deps.segmentation.declareNewChapter(shift.title, deps.timeline.count(), shift.abstract);
            } else {
              deps.threadRegistry.declareChapterInactive(
                threadId,
                shift.title,
                this.turnsOf(deps, threadId).length,
                shift.abstract
              );
            }
            deps.triggerReRender();
          },
          onArtifact: (u) => {
            const code = u.id || u.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30);
            const existing = deps.artifacts.getArtifact(code) || deps.artifacts.getArtifact(u.id);

            if (existing) {
              deps.versioning.recordRevision(
                existing.id,
                u.content.t3_body,
                `Update from chat: ${u.content.t1_abstract}`
              );
            } else {
              const now = Date.now();
              const artTitle = u.title || 'Extracted note';
              const artDesc = u.content.t1_abstract || 'Extracted note.';
              const artSumm = u.content.t2_summary || artDesc;
              const artContent = u.content.t3_body || `# ${artTitle}\n\nExtracted note.`;
              const artColor = getMellowPastelColor(code);

              const newArtifact: Artifact = {
                id: u.id || `art-${now}`,
                workspaceId: ctx.projectId,
                code,
                title: artTitle,
                type: u.type === 'chapter' ? 'chapter' : 'document',
                category: 'note',
                color: artColor,
                isHighConcept: false,
                current: {
                  t0_label: artTitle,
                  t1_abstract: artDesc,
                  t2_summary: artSumm,
                  t3_body: artContent,
                },
                tags: ['chat-extracted', u.type || 'note'],
                createdAt: now,
                updatedAt: now,
                graph: {
                  is_high_concept: false,
                  x: 300,
                  y: 200,
                },
                resolution: 'full',
              };
              deps.artifacts.upsertArtifact({
                ...newArtifact,
                yamlDocument: serializeArtifactToYamlDoc(newArtifact),
              });
            }
            deps.triggerReRender();
          },
        }
      );

      // Finalize assistant turn with clean reply, extracted artifacts, and real Gemini API telemetry
      const extractedList = result.artifacts.map((u) => ({
        title: u.title,
        type: u.type,
        abstract: u.content.t1_abstract,
        summary: u.content.t2_summary,
        content: u.content.t3_body,
        highConcept: false,
      }));

      const isInterrupted = controller.signal.aborted;
      const estPrompt =
        result.telemetry?.promptTokens ??
        Math.max(1, Math.ceil((compiled.compiledPrompt?.length || 0) / 4));
      const estCand =
        result.telemetry?.candidatesTokens ??
        Math.max(1, Math.ceil(((result.cleanReply || streamedContent)?.length || 0) / 4));
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
          promptTokens: estPrompt,
          candidatesTokens: estCand,
          totalTokens: totalTok,
          inputTokens: estPrompt,
          outputTokens: estCand,
          durationMs: result.telemetry?.durationMs,
          timeToFirstChunkMs: result.telemetry?.timeToFirstChunkMs,
          rawMetadata: result.telemetry?.rawMetadata,
          isStreaming: false,
          streamState: isInterrupted ? 'interrupted' : 'completed',
          interrupted: isInterrupted,
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
        const estPrompt = Math.max(
          1,
          Math.ceil(compiled?.telemetry?.tokenBreakdown?.totalTokens || 120)
        );
        const estCand = Math.max(1, Math.ceil((streamedContent?.length || 0) / 4));
        this.updateTurnInThread(deps, threadId, assistantTurnId, {
          content: streamedContent || '',
          meta: {
            model: ctx.model.name,
            isStreaming: false,
            streamState: 'interrupted',
            interrupted: true,
            promptTokens: estPrompt,
            candidatesTokens: estCand,
            totalTokens: estPrompt + estCand,
            inputTokens: estPrompt,
            outputTokens: estCand,
          },
        });
        deps.threadRegistry.patch(threadId, {
          lastOutcome: 'interrupted',
          lastActivityAt: Date.now(),
        });
        logger.info('App', 'Turn interrupted by user', {
          threadId,
          promptTokens: estPrompt,
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

  // Serial queue runner: one job at a time; on completion promote the next.
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
      // Chain start: snapshot deps + render context (the old code used the
      // render closure of the send that started the chain for its whole life).
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