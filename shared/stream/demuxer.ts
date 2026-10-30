/**
 * The pure XML demuxer — shared by the client StreamProtocolDomain and the
 * server job runner. It knows NOTHING about fetch, SSE, handlers or logging:
 * it parses raw provider text and returns what it found.
 *
 * Extracted verbatim from src/domains/03-stream-protocol/index.ts (the regexes
 * and stripping order are the contract — do not "improve" them). The class's
 * methods delegate here and then fire the event handlers themselves.
 */
import type {
  ExtractedArtifactUpsert,
  ExtractedLink,
  ExtractedTopicShift,
  ExtractedUnlink,
} from './types';

export interface DemuxedTurn {
  cleanText: string;
  topicShift?: ExtractedTopicShift;
  artifactUpserts: ExtractedArtifactUpsert[];
  links: ExtractedLink[];
  unlinks: ExtractedUnlink[];
}

export interface DemuxHooks {
  /** Called when the legacy ```topic_shift JSON block fails to parse. */
  onLegacyParseError?: (err: unknown) => void;
}

/** Strip every sentinel block from a streaming chunk, leaving prose only. */
export function demuxChunk(raw: string): string {
  return raw
    .replace(/<topic_shift[\s\S]*?\/>/gi, '')
    .replace(/<link[\s\S]*?\/>/gi, '')
    .replace(/<unlink[\s\S]*?\/>/gi, '')
    .replace(/<artifact_upsert[\s\S]*?<\/artifact_upsert>/gi, '');
}

export function demuxFullTurn(rawText: string, hooks: DemuxHooks = {}): DemuxedTurn {
  let clean = rawText;
  const artifactUpserts: ExtractedArtifactUpsert[] = [];
  const links: ExtractedLink[] = [];
  const unlinks: ExtractedUnlink[] = [];
  let topicShift: ExtractedTopicShift | undefined;

  // LAST SHIFT WINS (David 2026-10-25): a reply may carry several
  // <topic_shift> sentinels while it walks through sub-topics; the chapter
  // that opens is the one the reply ENDED on. Parse every match, keep the
  // last, fire the handler once.
  const topicShiftRegex = /<topic_shift\s+([^>]*?)\/?>/gi;
  let match: RegExpExecArray | null;
  while ((match = topicShiftRegex.exec(clean)) !== null) {
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
      }
    } catch (e) {
      hooks.onLegacyParseError?.(e);
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
  }

  // UNLINK: break a link the model can see (kind optional — omit to remove
  // every link between the pair, whatever its kind).
  const unlinkRegex = /<unlink\s+source=["']([^"']+)["']\s+target=["']([^"']+)["'](?:\s+kind=["']([^"']+)["'])?\s*\/?>/gi;
  let unlinkMatch: RegExpExecArray | null;
  while ((unlinkMatch = unlinkRegex.exec(clean)) !== null) {
    unlinks.push({
      source: unlinkMatch[1],
      target: unlinkMatch[2],
      kind: unlinkMatch[3] ?? null,
    });
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
  }

  clean = clean
    .replace(/<topic_shift[\s\S]*?\/>/gi, '')
    .replace(/```topic_shift[\s\S]*?```/gi, '')
    .replace(/<link[\s\S]*?\/>/gi, '')
    .replace(/<unlink[\s\S]*?\/>/gi, '')
    .replace(/<(?:artifact_upsert|artifact)\b[^>]*>[\s\S]*?<\/(?:artifact_upsert|artifact)>/gi, '')
    .replace(/```artifact\s*[\s\S]*?```/gi, '')
    .trim();

  return {
    cleanText: clean,
    topicShift,
    artifactUpserts,
    links,
    unlinks,
  };
}
