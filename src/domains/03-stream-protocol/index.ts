import {
  StreamProtocolEvents,
  ExtractedTopicShift,
  ExtractedArtifactUpsert,
  ExtractedLink,
  ExtractedUnlink,
  StreamStatusPayload,
  BackendTelemetry,
  StreamTurnResult,
} from '../../../shared/stream/types';
import {
  demuxChunk as demuxChunkPure,
  demuxFullTurn as demuxFullTurnPure,
} from '../../../shared/stream/demuxer';
import { logger } from '../../utils/logger';
import { chatStream } from '../../gateway/api';
import { estimateTokens } from '../../utils/estimateTokens';

export interface IStreamProtocolDomain {
  demuxChunk(chunk: string): string;
  demuxFullTurn(rawText: string): {
    cleanText: string;
    topicShift?: ExtractedTopicShift;
    artifactUpserts: ExtractedArtifactUpsert[];
    links: ExtractedLink[];
    unlinks: ExtractedUnlink[];
  };
  executeStreamingTurn(
    payload: {
      model?: string;
      messages?: any[];
      contextPayload?: string;
      currentTopic?: string;
      chapterSummaries?: any[];
      projectTitle?: string;
      compiledPrompt?: string;
      systemInstruction?: string;
    },
    callbacks?: {
      signal?: AbortSignal;
      onStatus?: (status: StreamStatusPayload) => void;
      onChunk?: (cleanDelta: string, accumulatedClean: string) => void;
      /**
       * The model's thinking stream (David 2026-10-30), as a LIVE preview
       * only: (delta, accumulated). Reasoning never reaches the turn result,
       * the planner, or chat storage.
       */
      onReasoning?: (delta: string, accumulated: string) => void;
      /** The flight-recorder row id arrived (inspector linkage, David 2026-10-30). */
      onCallId?: (callId: string) => void;
      onArtifact?: (artifact: ExtractedArtifactUpsert) => void;
      onTopicShift?: (shift: ExtractedTopicShift) => void;
      onTelemetry?: (telemetry: BackendTelemetry) => void;
    }
  ): Promise<StreamTurnResult>;
  subscribe<K extends keyof StreamProtocolEvents>(event: K, handler: StreamProtocolEvents[K]): () => void;
}

export class StreamProtocolDomain implements IStreamProtocolDomain {
  private handlers: { [K in keyof StreamProtocolEvents]?: Set<any> } = {};

  subscribe<K extends keyof StreamProtocolEvents>(event: K, handler: StreamProtocolEvents[K]): () => void {
    if (!this.handlers[event]) this.handlers[event] = new Set();
    this.handlers[event]!.add(handler);
    return () => this.handlers[event]!.delete(handler);
  }

  demuxChunk(chunk: string): string {
    const clean = demuxChunkPure(chunk);
    if (clean) {
      this.handlers.onProseChunk?.forEach((fn) => fn(clean));
    }
    return clean;
  }

  demuxFullTurn(rawText: string) {
    // Parsing is the shared pure demuxer (shared/stream/demuxer.ts) — the same
    // code the server job runner runs. This method only re-fires the event
    // handlers, in the same order the inline parser used to: topic shift
    // first, then links, then artifact upserts. Unlinks never had a handler.
    const parsed = demuxFullTurnPure(rawText, {
      onLegacyParseError: (e) =>
        logger.warn('Stream', 'Legacy topic_shift JSON parse failed — shift ignored', e),
    });
    if (parsed.topicShift) {
      this.handlers.onTopicShiftDetected?.forEach((fn) => fn(parsed.topicShift!));
    }
    for (const link of parsed.links) {
      this.handlers.onLinkDetected?.forEach((fn) => fn(link));
    }
    for (const up of parsed.artifactUpserts) {
      this.handlers.onArtifactUpsertDetected?.forEach((fn) => fn(up));
    }
    return parsed;
  }

  async executeStreamingTurn(
    payload: {
      model?: string;
      messages?: any[];
      contextPayload?: string;
      currentTopic?: string;
      chapterSummaries?: any[];
      projectTitle?: string;
      compiledPrompt?: string;
      systemInstruction?: string;
    },
    callbacks: {
      signal?: AbortSignal;
      onStatus?: (status: StreamStatusPayload) => void;
      onChunk?: (cleanDelta: string, accumulatedClean: string) => void;
      /**
       * The model's thinking stream (David 2026-10-30), as a LIVE preview
       * only: (delta, accumulated). Reasoning never reaches the turn result,
       * the planner, or chat storage.
       */
      onReasoning?: (delta: string, accumulated: string) => void;
      /** The flight-recorder row id arrived (inspector linkage, David 2026-10-30). */
      onCallId?: (callId: string) => void;
      onArtifact?: (artifact: ExtractedArtifactUpsert) => void;
      onTopicShift?: (shift: ExtractedTopicShift) => void;
      onTelemetry?: (telemetry: BackendTelemetry) => void;
    } = {}
  ): Promise<StreamTurnResult> {
    let accumulatedRaw = '';
    let accumulatedClean = '';
    // Reasoning (David 2026-10-30): a LOCAL accumulation feeding only the
    // onReasoning callback — never accumulatedRaw/accumulatedClean, never
    // the StreamTurnResult, never the planner or turns. EPHEMERAL.
    let accumulatedReasoning = '';
    let finalResult: StreamTurnResult | null = null;
    // A provider failure rides inside an HTTP-200 SSE as status{state:'error'}
    // (the adapter wraps its own fetch) or as an 'error' event. Collecting it
    // here is what stops a rejected request from becoming an empty "success".
    let streamError: string | null = null;
    // Inspector linkage: the adapter's 'call' event names the recorder row.
    let callId: string | null = null;

    try {
      const response = await chatStream(payload, { signal: callbacks.signal });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      if (!response.body) {
        throw new Error('ReadableStream not supported on this platform');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split('\n\n');
      buffer = blocks.pop() || '';

      for (const block of blocks) {
        if (!block.trim()) continue;
        const eventMatch = /^event:\s*(.+)$/m.exec(block);
        const dataMatch = /^data:\s*(.+)$/m.exec(block);
        const eventName = eventMatch ? eventMatch[1].trim() : 'message';
        const rawData = dataMatch ? dataMatch[1].trim() : '';

        let data: any = {};
        try {
          data = rawData ? JSON.parse(rawData) : {};
        } catch (err) {
          logger.warn('Stream', 'Unparseable SSE frame — skipped', err);
          continue;
        }
        {
          if (eventName === 'status') {
            if (data?.state === 'error') {
              streamError = streamError || data.message || 'The provider rejected the request.';
            }
            callbacks.onStatus?.(data);
            this.handlers.onStatusChanged?.forEach((fn) => fn(data));
          } else if (eventName === 'chunk') {
            accumulatedRaw += data.delta || '';
            const cleanDelta = this.demuxChunk(data.delta || '');
            if (cleanDelta) {
              accumulatedClean += cleanDelta;
              callbacks.onChunk?.(cleanDelta, accumulatedClean);
            }
          } else if (eventName === 'call') {
            if (typeof data.callId === 'string') {
              callId = data.callId;
              callbacks.onCallId?.(data.callId);
            }
          } else if (eventName === 'reasoning') {
            // The thinking preview (David 2026-10-30): local accumulation,
            // callback only. Never accumulatedRaw/accumulatedClean.
            accumulatedReasoning += data.delta || '';
            callbacks.onReasoning?.(data.delta || '', accumulatedReasoning);
          } else if (eventName === 'complete') {
            // Client demux is the SOLE parser — server sends raw text + telemetry only.
            const parsed = this.demuxFullTurn(data.rawReply || accumulatedRaw);
            finalResult = {
              cleanReply: parsed.cleanText,
              rawReply: data.rawReply || accumulatedRaw,
              artifacts: parsed.artifactUpserts,
              topicShift: parsed.topicShift,
              telemetry: data.telemetry,
              callId: callId ?? data.callId ?? undefined,
              links: parsed.links,
              unlinks: parsed.unlinks,
            };

            if (finalResult.telemetry) {
              callbacks.onTelemetry?.(finalResult.telemetry);
              this.handlers.onTelemetryReceived?.forEach((fn) => fn(finalResult!.telemetry!));
            }
            if (finalResult.topicShift) {
              callbacks.onTopicShift?.(finalResult.topicShift);
            }
            finalResult.artifacts.forEach((art) => callbacks.onArtifact?.(art));
          } else if (eventName === 'error') {
            streamError = streamError || data.error || 'Stream error from server';
          }
        }
      }
    }

    if (streamError) {
      throw new Error(streamError);
    }

    if (finalResult) {
      return finalResult;
    }

    // No 'complete' event = the attempt did not finish. Partial text, if any,
    // belongs to the draft (store-as-is), never to a committed pair — an
    // unpaired ask must not reach chat storage (design-docs/18).
    throw new Error('The stream ended without a reply.');
    } catch (err: any) {
      if (err.name === 'AbortError' || callbacks.signal?.aborted) {
        const demuxed = this.demuxFullTurn(accumulatedRaw);
        const estPrompt = Math.max(1, estimateTokens(payload.compiledPrompt || ''));
        const estCand = Math.max(1, estimateTokens(accumulatedRaw));
        return {
          cleanReply: accumulatedClean || demuxed.cleanText,
          rawReply: accumulatedRaw,
          callId: callId ?? undefined,
          artifacts: demuxed.artifactUpserts,
          topicShift: demuxed.topicShift,
          links: demuxed.links,
          unlinks: demuxed.unlinks,
          telemetry: {
            model: payload.model || 'gemini-3.5-flash-lite',
            inputTokens: estPrompt,
            outputTokens: estCand,
            totalTokens: estPrompt + estCand,
            latencyMs: 0,
            // Abort-path numbers are estimates by definition.
            isFallback: true,
          },
        };
      }
      throw err;
    }
  }
}

// The wire types and the pure demuxer live in the shared contract layer;
// re-exported so every existing import path is unchanged.
export * from '../../../shared/stream/types';
export { demuxChunk, demuxFullTurn } from '../../../shared/stream/demuxer';
