import { IArtifactDocumentDomain } from '../01-artifact-document';
import type { UniversalArtifactDocument } from '../01-artifact-document';
import {
  IChapterSegmentationDomain,
  ChapterPartition,
  isChapterOngoing,
  resolveChapterGranularity,
  sliceChapterTurns,
} from '../02-chapter-segmentation';
import { IDialogueTimelineDomain, Turn } from '../01-dialogue-timeline';
import type { ChatAttachment } from '../06-chat-threads';
import { Granularity, cutIncludes } from '../granularity';
import { logger } from '../../utils/logger';
import { estimateTokens } from '../../utils/estimateTokens';

/**
 * The Context Compiler — one turn does everything: it takes the chat's
 * attachments (each at its own granularity) and the chat's chapters (each at
 * its own granularity) and emits the exact text the model receives.
 *
 * There is no distance, no radius, no focal point, no culling and no ancestor
 * backbone. An artifact reaches the model only because a chat attached it;
 * a chapter is always in, at a size the user picked (floor: title).
 * (Focus was eradicated — design-docs/TERMINOLOGY.md §Eradicated.)
 *
 * Granularity is a CUT, not a substitution: each level contains the shorter
 * ones plus one layer (`../granularity`).
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

/** One attachment as compiled into <knowledge_substrate> — mirror reads these. */
export interface AttachmentBreakdownEntry {
  artifactId: string;
  title: string;
  granularity: Granularity;
  tokens: number;
}

/** One chapter as compiled into <conversation_chapters> — mirror reads these. */
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
  /** How many rows (artifacts + chapters) sit at each granularity. */
  granularityDistribution: Record<Granularity, number>;
  /**
   * One entry per artifact INCLUDED in <knowledge_substrate>, in attach order.
   * `tokens` is the estimate of that artifact's actual assembled XML (the very
   * text pushed into substrateParts), via the shared estimateTokens — so the
   * mirror can display the compiler's numbers instead of re-deriving them.
   *
   * Rounding tolerance: entries and substrateTokens both ceil per artifact over
   * the same strings, so Σentries === substrateTokens exactly today. If
   * substrate were ever estimated as one whole block instead, the sum could
   * drift by <1 token per artifact.
   */
  attachmentBreakdown: AttachmentBreakdownEntry[];
  /**
   * One entry per chapter INCLUDED in <conversation_chapters>, in send order.
   * Same single-source rule as above: Σentries === historyTokens today.
   */
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

/** One line of the cut, indented for the substrate block. */
function artifactXml(art: UniversalArtifactDocument, granularity: Granularity): string {
  const lines: string[] = [];
  const withDescription = cutIncludes(granularity, 'description') && Boolean(art.current?.description);
  const withSummary = cutIncludes(granularity, 'summary') && Boolean(art.current?.summary);
  const withBody = cutIncludes(granularity, 'body') && Boolean(art.current?.body);

  lines.push(`  <artifact id="${art.id}" granularity="${granularity}">`);
  lines.push(`    <title>${art.title}</title>`);
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

/** One chapter of the cut — same shape rule as artifacts. */
function chapterXml(
  chap: ChapterPartition,
  granularity: Granularity,
  turns: Turn[]
): string {
  const lines: string[] = [];
  const withDescription = cutIncludes(granularity, 'description') && Boolean(chap.description);
  const withSummary = cutIncludes(granularity, 'summary') && Boolean(chap.summary);
  const withTurns = cutIncludes(granularity, 'body');

  lines.push(`  <chapter id="${chap.id}" granularity="${granularity}" status="${chap.status}">`);
  lines.push(`    <title>${chap.title}</title>`);
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

export class OpticalCompilerDomain implements IOpticalCompilerDomain {
  constructor(
    private artifacts: IArtifactDocumentDomain,
    private segmentation: IChapterSegmentationDomain,
    private timeline: IDialogueTimelineDomain
  ) {}

  compile(options: OpticalCompilerOptions): CompiledContextPayload {
    const ceiling = options.tokenCeiling || 32000;
    const chapters = options.historyChapters ?? this.segmentation.listChapters();

    // 1. Attachments — exactly what this chat attached, at its own granularity.
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
      attachmentBreakdown.push({
        artifactId: art.id,
        title: art.title,
        granularity,
        tokens,
      });
    }

    // 2. Chapters — always in, each at its own granularity, chat order.
    const historyParts: string[] = [];
    let historyTokens = 0;
    const chapterBreakdown: ChapterBreakdownEntry[] = [];

    chapters.forEach((chap, cIdx) => {
      const ongoing = isChapterOngoing(chapters, cIdx);
      const granularity = resolveChapterGranularity(chap, ongoing);
      // Only read turns when the cut actually includes them.
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
    const systemInstruction = `You are MarkBrain, a thinking partner for a brain that overflows with ideas. Collect thoughts before they evaporate, keep them organized, and keep the forest in view. Talk WITH the user — direct, plain-spoken, no corporate filler.
Ground your thinking directly in the provided notes and conversation chapters.
Notes arrive at the size the user chose; an artifact without a <description>, <summary> or <content> was cut short on purpose — do not ask for the rest.
Emit functional XML tags when appropriate:
- <topic_shift title="New Chapter Title" description="1-2 sentences: what this chapter is about" />
- <artifact_upsert id="unique_id" title="Note Title" type="document"><description>...</description><summary>...</summary><content>...</content></artifact_upsert>
- <link source="id1" target="id2" kind="relates_to|refines|parent_of|child_of|born_from" />`;

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
