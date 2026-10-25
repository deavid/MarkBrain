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

    const topicShiftRegex = /<topic_shift\s+([^>]*?)\/?>/gi;
    let match = topicShiftRegex.exec(clean);
    if (match) {
      const attrsStr = match[1];
      const titleMatch = /title=["']([^"']+)["']/i.exec(attrsStr);
      // `description` is the settled word; `abstract` is the legacy attribute
      // some models still emit from older prompts — accepted, never preferred.
      const descriptionMatch =
        /description=["']([^"']+)["']/i.exec(attrsStr) || /abstract=["']([^"']+)["']/i.exec(attrsStr);
      const subtitleMatch = /subtitle=["']([^"']+)["']/i.exec(attrsStr);
      const summaryMatch = /summary=["']([^"']+)["']/i.exec(attrsStr);

      if (titleMatch) {
        topicShift = {
          title: titleMatch[1],
          subtitle: subtitleMatch ? subtitleMatch[1] : undefined,
          description: descriptionMatch ? descriptionMatch[1] : undefined,
          summary: summaryMatch ? summaryMatch[1] : undefined,
        };
        this.handlers.onTopicShiftDetected?.forEach((fn) => fn(topicShift!));
      }
    }

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

    const upsertRegex = /<(?:artifact_upsert|artifact)\b([^>]*)>([\s\S]*?)<\/(?:artifact_upsert|artifact)>/gi;
    let upsertMatch: RegExpExecArray | null;
    while ((upsertMatch = upsertRegex.exec(clean)) !== null) {
      const attrs = upsertMatch[1];
      const inner = upsertMatch[2];
      const titleAttr = /title=["']([^"']+)["']/i.exec(attrs);
      // `file` is the contract we now teach (a filename, e.g. "the-hook.md");
      // `id` is accepted for back-compat with anything already emitting it.
      const fileAttr = /file=["']([^"']+)["']/i.exec(attrs) || /id=["']([^"']+)["']/i.exec(attrs);
      const typeAttr = /type=["']([^"']+)["']/i.exec(attrs);

      // A filename names the note: the extension never belongs in the id.
      const named = fileAttr ? fileAttr[1].replace(/\.md$/i, '') : '';
      const title = titleAttr ? titleAttr[1] : (named || 'Extracted note');
      const id = named || `art-${Date.now()}-${artifactUpserts.length}`;
      const type = (typeAttr ? typeAttr[1] : 'document') as any;

      const descMatch =
        /<description>([\s\S]*?)<\/description>/i.exec(inner) ||
        /<abstract>([\s\S]*?)<\/abstract>/i.exec(inner);
      const subtitleMatch = /<subtitle>([\s\S]*?)<\/subtitle>/i.exec(inner);
      const sumMatch = /<summary>([\s\S]*?)<\/summary>/i.exec(inner);
      const bodyMatch = /<content>([\s\S]*?)<\/content>/i.exec(inner);

      const subtitleText = subtitleMatch ? subtitleMatch[1].trim() : '';
      const descriptionText = descMatch ? descMatch[1].trim() : '';
      // A rung the model did not write stays empty: copying the description into
      // the summary ships the same text twice and calls it a ladder.
      const summaryText = sumMatch ? sumMatch[1].trim() : '';
      const bodyText = bodyMatch ? bodyMatch[1].trim() : inner.trim();

      const up: ExtractedArtifactUpsert = {
        id,
        title,
        type: type === 'chapter' ? 'chapter' : 'document',
        content: {
          subtitle: subtitleText,
          description: descriptionText,
          summary: summaryText,
          body: bodyText,
        },
      };
      artifactUpserts.push(up);
      this.handlers.onArtifactUpsertDetected?.forEach((fn) => fn(up));
    }

    const codeBlockRegex = /```artifact\s*([\s\S]*?)```/gi;
    let cbMatch: RegExpExecArray | null;
    while ((cbMatch = codeBlockRegex.exec(clean)) !== null) {
      const block = cbMatch[1];
      const titleMatch = block.match(/title:\s*(.*)/i);
      const typeMatch = block.match(/type:\s*(.*)/i);
      const subtitleMatch = block.match(/subtitle:\s*(.*)/i);
      const descriptionMatch = block.match(/description:\s*(.*)/i) || block.match(/abstract:\s*(.*)/i);
      const summaryMatch = block.match(/summary:\s*(.*)/i);

      // `summary:` must be stripped from the body too: it is a frontmatter line,
      // and a stray one lands in the note as literal text.
      const bodyText = block
        .replace(/title:.*\n/i, '')
        .replace(/type:.*\n/i, '')
        .replace(/subtitle:.*\n/i, '')
        .replace(/description:.*\n/i, '')
        .replace(/abstract:.*\n/i, '')
        .replace(/summary:.*\n/i, '')
        .replace(/highConcept:.*\n/i, '')
        .trim();

      const title = titleMatch ? titleMatch[1].trim() : 'Extracted note';
      const type = (typeMatch ? typeMatch[1].trim() : 'document') as any;
      const subtitleText = subtitleMatch ? subtitleMatch[1].trim() : '';
      const descriptionText = descriptionMatch ? descriptionMatch[1].trim() : '';
      const summaryText = summaryMatch ? summaryMatch[1].trim() : '';

      const up: ExtractedArtifactUpsert = {
        id: `art-${Date.now()}-${artifactUpserts.length}`,
        title,
        type: type === 'chapter' ? 'chapter' : 'document',
        content: {
          subtitle: subtitleText,
          description: descriptionText,
          summary: summaryText,
          body: bodyText || block,
        },
      };
      artifactUpserts.push(up);
      this.handlers.onArtifactUpsertDetected?.forEach((fn) => fn(up));
    }

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
    // A provider failure rides inside an HTTP-200 SSE as status{state:'error'}
    // (the adapter wraps its own fetch) or as an 'error' event. Collecting it
    // here is what stops a rejected request from becoming an empty "success".
    let streamError: string | null = null;

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

    if (!accumulatedRaw.trim()) {
      // No complete event, no text, no error: the stream died quietly.
      // Returning an empty "success" here is how a failed request once
      // rendered in chat as a model reply of "No reply came back."
      throw new Error('The stream ended without a reply.');
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
