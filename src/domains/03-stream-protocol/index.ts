import {
  StreamProtocolEvents,
  ExtractedTopicShift,
  ExtractedArtifactUpsert,
  ExtractedLink,
  StreamStatusPayload,
  BackendTelemetry,
  StreamTurnResult,
} from './types';
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
    // Strips any in-flight XML tags from immediate visual chat text
    const clean = chunk
      .replace(/<topic_shift[\s\S]*?\/>/gi, '')
      .replace(/<link[\s\S]*?\/>/gi, '')
      .replace(/<artifact_upsert[\s\S]*?<\/artifact_upsert>/gi, '');
    if (clean) {
      this.handlers.onProseChunk?.forEach((fn) => fn(clean));
    }
    return clean;
  }

  demuxFullTurn(rawText: string) {
    let clean = rawText;
    const artifactUpserts: ExtractedArtifactUpsert[] = [];
    const links: ExtractedLink[] = [];
    let topicShift: ExtractedTopicShift | undefined;

    // 1. Parse <topic_shift ... />
    const topicShiftRegex = /<topic_shift\s+([^>]*?)\/?>/gi;
    let match = topicShiftRegex.exec(clean);
    if (match) {
      const attrsStr = match[1];
      const titleMatch = /title=["']([^"']+)["']/i.exec(attrsStr);
      const abstractMatch = /abstract=["']([^"']+)["']/i.exec(attrsStr);
      const summaryMatch = /summary=["']([^"']+)["']/i.exec(attrsStr);

      if (titleMatch) {
        topicShift = {
          title: titleMatch[1],
          abstract: abstractMatch ? abstractMatch[1] : undefined,
          summary: summaryMatch ? summaryMatch[1] : undefined,
        };
        this.handlers.onTopicShiftDetected?.forEach((fn) => fn(topicShift!));
      }
    }

    // Legacy JSON topic_shift support
    const legacyTopicShift = /```topic_shift\s*(\{[\s\S]*?\})\s*```/gi;
    let legacyMatch = legacyTopicShift.exec(clean);
    if (legacyMatch && !topicShift) {
      try {
        const parsed = JSON.parse(legacyMatch[1]);
        if (parsed.newChapterTitle || parsed.shiftDetected) {
          topicShift = {
            title: parsed.newChapterTitle || 'New Chapter',
            summary: parsed.reason,
          };
          this.handlers.onTopicShiftDetected?.forEach((fn) => fn(topicShift!));
        }
      } catch (e) {
        logger.warn('Stream', 'Legacy topic_shift JSON parse failed — shift ignored', e);
      }
    }

    // 2. Parse <link ... /> — edge vocabulary is OPEN (01 §4.8): unknown kinds
    // survive the round-trip untouched instead of being laundered to 'relates_to'.
    const linkRegex = /<link\s+source=["']([^"']+)["']\s+target=["']([^"']+)["']\s+kind=["']([^"']+)["']\s*\/?>/gi;
    let linkMatch: RegExpExecArray | null;
    while ((linkMatch = linkRegex.exec(clean)) !== null) {
      const link: ExtractedLink = {
        source: linkMatch[1],
        target: linkMatch[2],
        kind: linkMatch[3],
      };
      links.push(link);
      this.handlers.onLinkDetected?.forEach((fn) => fn(link));
    }

    // 3. Parse <artifact_upsert> or <artifact> tags (attributes in any order)
    const upsertRegex = /<(?:artifact_upsert|artifact)\b([^>]*)>([\s\S]*?)<\/(?:artifact_upsert|artifact)>/gi;
    let upsertMatch: RegExpExecArray | null;
    while ((upsertMatch = upsertRegex.exec(clean)) !== null) {
      const attrs = upsertMatch[1];
      const inner = upsertMatch[2];
      const titleAttr = /title=["']([^"']+)["']/i.exec(attrs);
      const idAttr = /id=["']([^"']+)["']/i.exec(attrs);
      const typeAttr = /type=["']([^"']+)["']/i.exec(attrs);

      const title = titleAttr ? titleAttr[1] : (idAttr ? idAttr[1] : 'Extracted note');
      const id = idAttr ? idAttr[1] : `art-${Date.now()}-${artifactUpserts.length}`;
      const type = (typeAttr ? typeAttr[1] : 'document') as any;

      const absMatch = /<abstract>([\s\S]*?)<\/abstract>/i.exec(inner);
      const sumMatch = /<summary>([\s\S]*?)<\/summary>/i.exec(inner);
      const bodyMatch = /<content>([\s\S]*?)<\/content>/i.exec(inner);

      const abstractText = absMatch ? absMatch[1].trim() : (sumMatch ? sumMatch[1].trim() : title);
      const summaryText = sumMatch ? sumMatch[1].trim() : abstractText;
      const bodyText = bodyMatch ? bodyMatch[1].trim() : inner.trim();

      const up: ExtractedArtifactUpsert = {
        id,
        title,
        type: type === 'chapter' ? 'chapter' : 'document',
        content: {
          t0_label: title,
          t1_abstract: abstractText,
          t2_summary: summaryText,
          t3_body: bodyText,
        },
      };
      artifactUpserts.push(up);
      this.handlers.onArtifactUpsertDetected?.forEach((fn) => fn(up));
    }

    // 4. Parse ```artifact ... ``` blocks
    const codeBlockRegex = /```artifact\s*([\s\S]*?)```/gi;
    let cbMatch: RegExpExecArray | null;
    while ((cbMatch = codeBlockRegex.exec(clean)) !== null) {
      const block = cbMatch[1];
      const titleMatch = block.match(/title:\s*(.*)/i);
      const typeMatch = block.match(/type:\s*(.*)/i);
      const abstractMatch = block.match(/abstract:\s*(.*)/i);

      const bodyText = block
        .replace(/title:.*\n/i, '')
        .replace(/type:.*\n/i, '')
        .replace(/abstract:.*\n/i, '')
        .replace(/highConcept:.*\n/i, '')
        .trim();

      const title = titleMatch ? titleMatch[1].trim() : 'Extracted note';
      const type = (typeMatch ? typeMatch[1].trim() : 'document') as any;
      const abstractText = abstractMatch ? abstractMatch[1].trim() : 'Extracted note.';

      const up: ExtractedArtifactUpsert = {
        id: `art-${Date.now()}-${artifactUpserts.length}`,
        title,
        type: type === 'chapter' ? 'chapter' : 'document',
        content: {
          t0_label: title,
          t1_abstract: abstractText,
          t2_summary: abstractText,
          t3_body: bodyText || block,
        },
      };
      artifactUpserts.push(up);
      this.handlers.onArtifactUpsertDetected?.forEach((fn) => fn(up));
    }

    // Strip tags cleanly
    clean = clean
      .replace(/<topic_shift[\s\S]*?\/>/gi, '')
      .replace(/```topic_shift[\s\S]*?```/gi, '')
      .replace(/<link[\s\S]*?\/>/gi, '')
      .replace(/<(?:artifact_upsert|artifact)\b[^>]*>[\s\S]*?<\/(?:artifact_upsert|artifact)>/gi, '')
      .replace(/```artifact\s*[\s\S]*?```/gi, '')
      .trim();

    return {
      cleanText: clean,
      topicShift,
      artifactUpserts,
      links,
    };
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
      onArtifact?: (artifact: ExtractedArtifactUpsert) => void;
      onTopicShift?: (shift: ExtractedTopicShift) => void;
      onTelemetry?: (telemetry: BackendTelemetry) => void;
    } = {}
  ): Promise<StreamTurnResult> {
    let accumulatedRaw = '';
    let accumulatedClean = '';
    let finalResult: StreamTurnResult | null = null;

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

        try {
          const data = rawData ? JSON.parse(rawData) : {};
          if (eventName === 'status') {
            callbacks.onStatus?.(data);
            this.handlers.onStatusChanged?.forEach((fn) => fn(data));
          } else if (eventName === 'chunk') {
            accumulatedRaw += data.delta || '';
            const cleanDelta = this.demuxChunk(data.delta || '');
            if (cleanDelta) {
              accumulatedClean += cleanDelta;
              callbacks.onChunk?.(cleanDelta, accumulatedClean);
            }
          } else if (eventName === 'complete') {
            // Client demux is the SOLE parser — server sends raw text + telemetry only.
            const parsed = this.demuxFullTurn(data.rawReply || accumulatedRaw);
            finalResult = {
              cleanReply: parsed.cleanText,
              rawReply: data.rawReply || accumulatedRaw,
              artifacts: parsed.artifactUpserts,
              topicShift: parsed.topicShift,
              telemetry: data.telemetry,
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
            throw new Error(data.error || 'Stream error from server');
          }
        } catch (err) {
          logger.warn('Stream', 'Error processing SSE chunk — stream continues', err);
        }
      }
    }

    if (finalResult) {
      return finalResult;
    }

    const demuxed = this.demuxFullTurn(accumulatedRaw);
    return {
      cleanReply: demuxed.cleanText,
      rawReply: accumulatedRaw,
      artifacts: demuxed.artifactUpserts,
      topicShift: demuxed.topicShift,
    };
    } catch (err: any) {
      if (err.name === 'AbortError' || callbacks.signal?.aborted) {
        const demuxed = this.demuxFullTurn(accumulatedRaw);
        const estPrompt = Math.max(1, estimateTokens(payload.compiledPrompt || ''));
        const estCand = Math.max(1, estimateTokens(accumulatedRaw));
        return {
          cleanReply: accumulatedClean || demuxed.cleanText,
          rawReply: accumulatedRaw,
          artifacts: demuxed.artifactUpserts,
          topicShift: demuxed.topicShift,
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

export * from './types';
