import { StreamProtocolEvents, ExtractedTopicShift, ExtractedArtifactUpsert, ExtractedLink } from './types';
import { RelationKind } from '../02-topological-graph';

export interface IStreamProtocolDomain {
  demuxChunk(chunk: string): string;
  demuxFullTurn(rawText: string): {
    cleanText: string;
    topicShift?: ExtractedTopicShift;
    artifactUpserts: ExtractedArtifactUpsert[];
    links: ExtractedLink[];
  };
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
      } catch {
        // ignore
      }
    }

    // 2. Parse <link ... />
    const linkRegex = /<link\s+source=["']([^"']+)["']\s+target=["']([^"']+)["']\s+kind=["']([^"']+)["']\s*\/?>/gi;
    let linkMatch: RegExpExecArray | null;
    while ((linkMatch = linkRegex.exec(clean)) !== null) {
      const kind = linkMatch[3] as RelationKind;
      const link: ExtractedLink = {
        source: linkMatch[1],
        target: linkMatch[2],
        kind: ['parent_of', 'child_of', 'relates_to', 'refines', 'born_from'].includes(kind)
          ? kind
          : 'relates_to',
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

      const title = titleAttr ? titleAttr[1] : (idAttr ? idAttr[1] : 'Synthesized Spec');
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

      const title = titleMatch ? titleMatch[1].trim() : 'Synthesized Artifact';
      const type = (typeMatch ? typeMatch[1].trim() : 'document') as any;
      const abstractText = abstractMatch ? abstractMatch[1].trim() : 'Synthesized artifact.';

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
}

export * from './types';
