// ============================================================================
// STREAM PROTOCOL & PARSER (SYSTEM_ARCHITECTURE.md & CONTEXT_COMPILER.md)
// Parses inline structured XML tags from Gemini's single-turn stream.
// ============================================================================

import { MultiResolutionContent, RelationKind } from '../types';

export interface ExtractedTopicShift {
  title: string;
  abstract?: string;
  summary?: string;
}

export interface ExtractedArtifactUpsert {
  id: string;
  title: string;
  type: 'document' | 'chapter';
  content: MultiResolutionContent;
}

export interface ExtractedLink {
  source: string;
  target: string;
  kind: RelationKind;
}

export interface ParsedTurnResult {
  /** Clean conversational text for the user, with functional XML stripped out */
  cleanContent: string;
  topicShift?: ExtractedTopicShift;
  artifactUpserts: ExtractedArtifactUpsert[];
  links: ExtractedLink[];
}

export function parseStreamTurn(rawText: string, currentWorkspaceId: string): ParsedTurnResult {
  let clean = rawText;
  const artifactUpserts: ExtractedArtifactUpsert[] = [];
  const links: ExtractedLink[] = [];
  let topicShift: ExtractedTopicShift | undefined;

  // 1. Parse <topic_shift ... /> or <topic_shift>...</topic_shift>
  const topicShiftSelfClosing = /<topic_shift\s+([^>]*?)\/>/gi;
  let match = topicShiftSelfClosing.exec(clean);
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
    }
  }

  // Also support legacy JSON topic_shift blocks if model emits them
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
      // ignore
    }
  }

  // 2. Parse <link source="..." target="..." kind="..." />
  const linkRegex = /<link\s+source=["']([^"']+)["']\s+target=["']([^"']+)["']\s+kind=["']([^"']+)["']\s*\/?>/gi;
  let linkMatch: RegExpExecArray | null;
  while ((linkMatch = linkRegex.exec(clean)) !== null) {
    const kind = linkMatch[3] as RelationKind;
    links.push({
      source: linkMatch[1],
      target: linkMatch[2],
      kind: ['parent_of', 'child_of', 'relates_to', 'refines', 'born_from'].includes(kind)
        ? kind
        : 'relates_to',
    });
  }

  // 3. Parse <artifact_upsert id="..." title="..." type="...">...</artifact_upsert>
  const upsertRegex = /<artifact_upsert\s+id=["']([^"']+)["']\s+title=["']([^"']+)["'](?:\s+type=["']([^"']+)["'])?[^>]*>([\s\S]*?)<\/artifact_upsert>/gi;
  let upsertMatch: RegExpExecArray | null;
  while ((upsertMatch = upsertRegex.exec(clean)) !== null) {
    const id = upsertMatch[1];
    const title = upsertMatch[2];
    const type = (upsertMatch[3] as any) || 'document';
    const inner = upsertMatch[4];

    const absMatch = /<abstract>([\s\S]*?)<\/abstract>/i.exec(inner);
    const sumMatch = /<summary>([\s\S]*?)<\/summary>/i.exec(inner);
    const bodyMatch = /<content>([\s\S]*?)<\/content>/i.exec(inner);

    const abstractText = absMatch ? absMatch[1].trim() : title;
    const summaryText = sumMatch ? sumMatch[1].trim() : abstractText;
    const bodyText = bodyMatch ? bodyMatch[1].trim() : inner.trim();

    artifactUpserts.push({
      id: id || `art-${Date.now()}`,
      title,
      type: type === 'chapter' ? 'chapter' : 'document',
      content: {
        t0_label: title,
        t1_abstract: abstractText,
        t2_summary: summaryText,
        t3_body: bodyText,
      },
    });
  }

  // Strip XML tags cleanly from cleanContent
  clean = clean
    .replace(/<topic_shift[\s\S]*?\/>/gi, '')
    .replace(/```topic_shift[\s\S]*?```/gi, '')
    .replace(/<link[\s\S]*?\/>/gi, '')
    .replace(/<artifact_upsert[\s\S]*?<\/artifact_upsert>/gi, '')
    .trim();

  return {
    cleanContent: clean,
    topicShift,
    artifactUpserts,
    links,
  };
}
