import { IArtifactDocumentDomain } from '../01-artifact-document';
import type { UniversalArtifactDocument } from '../01-artifact-document';
import {
  IChapterSegmentationDomain,
  ChapterPartition,
  isChapterOngoing,
  resolveChapterSendGranularity,
  sliceChapterTurns,
} from '../02-chapter-segmentation';
import { IDialogueTimelineDomain, Turn } from '../01-dialogue-timeline';
import type { ChatAttachment } from '../06-chat-threads';
import { Granularity, cutIncludes } from '../granularity';
import { logger } from '../../utils/logger';
import { estimateTokens } from '../../utils/estimateTokens';
import { MAX_CONTEXT_TOKENS } from '../../utils/contextWindow';

/**
 * Context compiler: assembles `<knowledge_substrate>` (attached artifacts at their cut)
 * and `<conversation_chapters>` (chapters at their cut, in chronological order).
 * Only explicitly attached artifacts enter the payload — no proximity or graph heuristics.
 */
export interface OpticalCompilerOptions {
  /** The target chat's attachments, in attach order. Empty = no artifacts sent. */
  attachments: ChatAttachment[];
  tokenCeiling?: number;
  /**
   * Thread-aware compile: compile against an EXPLICIT turn list instead of
   * the live timeline domain. Used by the serial generation queue to build
   * context for a background thread without touching the visible one.
   * Chapter indices are interpreted against this list.
   */
  historyTurns?: Turn[];
  /** Chapters for the compile (defaults to the segmentation domain). Pair with historyTurns. */
  historyChapters?: ChapterPartition[];
  /**
   * Emit the compile lifecycle log + ceiling warn. Default FALSE because
   * compile() also runs from the display memo on every stream-chunk render
   * (instrumentation law: never log hot loops — see logger.ts header).
   * Pass `log: true` only at the once-per-send call site.
   */
  log?: boolean;
}

export interface AttachmentBreakdownEntry {
  artifactId: string;
  title: string;
  granularity: Granularity;
  tokens: number;
  staged: boolean;
  turnIndex: number | null;
  turnId?: string | null;
}

export interface ChapterBreakdownEntry {
  chapterId: string;
  title: string;
  granularity: Granularity;
  tokens: number;
}

export interface ContextTelemetry {
  tokenBreakdown: {
    systemTokens: number;
    substrateTokens: number;
    historyTokens: number;
    totalTokens: number;
  };
  granularityDistribution: Record<Granularity, number>;
  /** Per-artifact token estimates measured on the exact assembled XML (`Σentries === substrateTokens`). */
  attachmentBreakdown: AttachmentBreakdownEntry[];
  /** Per-chapter token estimates measured on the exact assembled XML (`Σentries === historyTokens`). */
  chapterBreakdown: ChapterBreakdownEntry[];
}

export interface CompiledContextPayload {
  compiledPrompt: string;
  systemInstruction: string;
  telemetry: ContextTelemetry;
}

export interface IOpticalCompilerDomain {
  compile(options: OpticalCompilerOptions): CompiledContextPayload;
}

export function artifactXml(art: UniversalArtifactDocument, granularity: Granularity): string {
  const lines: string[] = [];
  const withDescription = cutIncludes(granularity, 'description') && Boolean(art.current?.description);
  const withSummary = cutIncludes(granularity, 'summary') && Boolean(art.current?.summary);
  const withBody = cutIncludes(granularity, 'body') && Boolean(art.current?.body);

  // The title cut carries title + subtitle: a bare name tells a reader nothing,
  // and the hook is what lets the model recognise the note it needs to expand.
  const subtitle = (art.current?.subtitle || '').trim();
  lines.push(`  <artifact id="${art.id}" granularity="${granularity}">`);
  lines.push(`    <title>${subtitle ? `${art.title} — ${subtitle}` : art.title}</title>`);
  if (withDescription) lines.push(`    <description>${art.current.description}</description>`);
  if (withSummary) {
    lines.push(`    <summary>`);
    lines.push(`${art.current.summary}`);
    lines.push(`    </summary>`);
  }
  if (withBody) {
    lines.push(`    <content>`);
    lines.push(`${art.current.body}`);
    lines.push(`    </content>`);
  }
  lines.push(`  </artifact>`);
  return lines.join('\n');
}

export function estimateArtifactCutTokens(
  art: UniversalArtifactDocument,
  granularity: Granularity
): number {
  return estimateTokens(artifactXml(art, granularity));
}

export function chapterXml(
  chap: ChapterPartition,
  granularity: Granularity,
  turns: Turn[]
): string {
  const lines: string[] = [];
  const withDescription = cutIncludes(granularity, 'description') && Boolean(chap.description);
  const withSummary = cutIncludes(granularity, 'summary') && Boolean(chap.summary);
  const withTurns = cutIncludes(granularity, 'body');

  const chapSubtitle = (chap.subtitle || '').trim();
  lines.push(`  <chapter id="${chap.id}" granularity="${granularity}" status="${chap.status}">`);
  lines.push(`    <title>${chapSubtitle ? `${chap.title} — ${chapSubtitle}` : chap.title}</title>`);
  if (withDescription) lines.push(`    <description>${chap.description}</description>`);
  if (withSummary) {
    lines.push(`    <summary>`);
    lines.push(`${chap.summary}`);
    lines.push(`    </summary>`);
  }
  if (withTurns) {
    const turnsXml = turns
      .map((t) => `      <turn role="${t.role}">\n${t.content}\n      </turn>`)
      .join('\n');
    lines.push(`    <turns>`);
    lines.push(turnsXml);
    lines.push(`    </turns>`);
  }
  lines.push(`  </chapter>`);
  return lines.join('\n');
}

export function estimateChapterCutTokens(
  chap: ChapterPartition,
  granularity: Granularity,
  turns: Turn[]
): number {
  const includedTurns = cutIncludes(granularity, 'body') ? turns : [];
  return estimateTokens(chapterXml(chap, granularity, includedTurns));
}

export class OpticalCompilerDomain implements IOpticalCompilerDomain {
  constructor(
    private artifacts: IArtifactDocumentDomain,
    private segmentation: IChapterSegmentationDomain,
    private timeline: IDialogueTimelineDomain
  ) {}

  compile(options: OpticalCompilerOptions): CompiledContextPayload {
    const ceiling = options.tokenCeiling || MAX_CONTEXT_TOKENS;
    const chapters = options.historyChapters ?? this.segmentation.listChapters();

    const substrateParts: string[] = [];
    let substrateTokens = 0;
    const attachmentBreakdown: AttachmentBreakdownEntry[] = [];
    const distribution: Record<Granularity, number> = {
      title: 0,
      description: 0,
      summary: 0,
      full: 0,
    };

    for (const attachment of options.attachments || []) {
      const art = this.artifacts.getArtifact(attachment.artifactId);
      if (!art) continue; // dangling attachment (artifact deleted) — silently skipped
      const granularity = attachment.granularity;
      const xml = artifactXml(art, granularity);
      substrateParts.push(xml);
      const tokens = estimateTokens(xml);
      substrateTokens += tokens;
      distribution[granularity]++;
      const turnIndex = attachment.turnIndex === null ? null : (attachment.turnIndex ?? 0);
      attachmentBreakdown.push({
        artifactId: art.id,
        title: art.title,
        granularity,
        tokens,
        staged: turnIndex === null,
        turnIndex,
        turnId: attachment.turnId ?? null,
      });
    }

    const historyParts: string[] = [];
    let historyTokens = 0;
    const chapterBreakdown: ChapterBreakdownEntry[] = [];

    chapters.forEach((chap, cIdx) => {
      const ongoing = isChapterOngoing(chapters, cIdx);
      const granularity = resolveChapterSendGranularity(chapters, cIdx);
      const turns = cutIncludes(granularity, 'body')
        ? options.historyTurns
          ? sliceChapterTurns(options.historyTurns, chap, ongoing)
          : this.timeline.getTurnSlice(chap.startIndex, ongoing ? undefined : chap.endIndex)
        : [];
      const xml = chapterXml(chap, granularity, turns);
      historyParts.push(xml);
      const chapterTokens = estimateTokens(xml);
      historyTokens += chapterTokens;
      distribution[granularity]++;
      chapterBreakdown.push({
        chapterId: chap.id,
        title: chap.title,
        granularity,
        tokens: chapterTokens,
      });
    });

    const substrateBlock = `<knowledge_substrate>\n${substrateParts.join('\n\n')}\n</knowledge_substrate>`;
    const historyBlock = `<conversation_chapters>\n${historyParts.join('\n\n')}\n</conversation_chapters>`;

    const compiledPrompt = `${substrateBlock}\n\n${historyBlock}`;
    const systemInstruction = `You are MarkBrain, a thinking partner for a brain that overflows with ideas. Collect thoughts before they evaporate, keep them organized, and keep the forest in view. Talk WITH the user, direct, plain-spoken, no corporate filler.
Ground your thinking in the notes and chapters provided.
Notes arrive at the compaction level the user chose (title, description, summary, full). A layer that is missing was compacted on purpose: do not ask for it unless you genuinely cannot answer without it.
Emit these functional blocks in your reply when appropriate. Never emit JSON.

1. When the conversation shifts to a substantially new topic:
<topic_shift title="New Chapter Title" subtitle="One or two sentences stating what this chapter is about and its main takeaway, directly" />

2. When an idea crystallizes into a durable note, emit an artifact_upsert carrying all four layers. They are read together in this order, so each one continues where the previous stopped and never re-introduces the note:
<artifact_upsert id="kebab-case-slug" title="Short Note Title" type="document">
<subtitle>
One or two sentences (~40 tokens): what this note is and its single main takeaway. This is what a human reads next to the title in a list of fifty notes.
</subtitle>
<description>
Two or three dense paragraphs (~200 tokens) continuing from the subtitle: the core thesis, the main pillars, and the conclusions reached. State facts, decisions and rules directly.
</description>
<summary>
A multi-section digest (~800 to 1500 tokens for a substantial note) continuing from the description: walk every major section with Markdown headings and bullets, and extract the concrete rules, numbers, mechanics, rejected alternatives and open questions, so a reader at this level rarely needs the full note.
</summary>
<content>
The complete Markdown note body.
</content>
</artifact_upsert>

3. To link two notes in the graph:
<link source="id1" target="id2" kind="relates_to|refines|parent_of|child_of|born_from" />

Never open a layer with "This document outlines", "This note describes", "The user and AI discuss" or any other book report: name the thing and state what is in it.`;

    const systemTokens = estimateTokens(systemInstruction);
    const totalTokens = systemTokens + substrateTokens + historyTokens;

    if (options.log) {
      logger.info(
        'Compiler',
        `Compiled context: ${totalTokens} tokens (ceiling ${ceiling}, ${attachmentBreakdown.length} attached, ${chapterBreakdown.length} chapters)`,
        distribution
      );
      if (totalTokens > ceiling) {
        logger.warn(
          'Compiler',
          `Compiled prompt exceeds token ceiling (${totalTokens} > ${ceiling}) — no degradation path exists yet`,
          distribution
        );
      }
    }

    return {
      compiledPrompt,
      systemInstruction,
      telemetry: {
        tokenBreakdown: {
          systemTokens,
          substrateTokens,
          historyTokens,
          totalTokens,
        },
        granularityDistribution: distribution,
        attachmentBreakdown,
        chapterBreakdown,
      },
    };
  }
}
