import { IArtifactDocumentDomain } from '../01-artifact-document';
import type { UniversalArtifactDocument } from '../01-artifact-document';
import { STALE_LAYERS_NOTICE } from '../01-artifact-document/ArtifactDocumentDomain';
import {
  IChapterSegmentationDomain,
  ChapterPartition,
  isChapterOngoing,
  resolveChapterSendGranularity,
  sliceChapterTurns,
} from '../02-chapter-segmentation';
import { IDialogueTimelineDomain, Turn } from '../01-dialogue-timeline';
import type { ChatAttachment, ChatCapabilities } from '../06-chat-threads';
import { DEFAULT_CHAT_CAPABILITIES } from '../06-chat-threads';
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
   * Which functional blocks the model is taught (Package 2 §2.3). A block
   * whose capability is OFF is NOT in the system instruction at all — the
   * schema for it is never mentioned, so small models cannot fire it.
   * Defaults to DEFAULT_CHAT_CAPABILITIES when absent.
   */
  capabilities?: ChatCapabilities;
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

/**
 * How a note is NAMED when it is sent: a filename, not an identifier.
 *
 * The old payload carried the internal id (`art-1792614286498-4845`). Nothing
 * told the model what that was, so it read it as the note's name and wrote
 * replies like "…the sprawling procedural dream (art-1792614286498-4845,
 * art-1792614209332-9472)". A machine id is a database key; a reader — human or
 * model — needs a handle. The title, slugified, IS that handle: it is what the
 * model would call the note anyway, and it is stable in what the user sees.
 *
 * Falls back to the note's `code` (the kebab handle the import sentinel already
 * produces) when a title slugifies to nothing — a title of pure punctuation or
 * of script outside a-z. `-2`, `-3` disambiguation is applied per payload by
 * `uniqueFileName`, because two notes may legitimately share a title.
 */
export function artifactFileName(art: Pick<UniversalArtifactDocument, 'code' | 'title'>): string {
  const slug = (candidate: string) =>
    candidate
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60)
      .replace(/-+$/g, '');
  return `${slug(art.title || '') || slug(art.code || '') || 'note'}.md`;
}


/**
 * A slug that reads as a handle, never a database key. Chapters use the same
 * rule as notes so the payload has ONE way of naming things.
 */
export function slugHandle(text: string): string {
  return (
    (text || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60)
      .replace(/-+$/g, '') || 'untitled'
  );
}

/** Indent every non-blank line so nested text lines up with its own tag. */
function indentBlock(text: string | undefined, pad: string): string {
  return (text || '')
    .split('\n')
    .map((l) => (l.trim() ? pad + l : l))
    .join('\n');
}

/** Give a payload's filenames a unique suffix so one name means one note. */
export function uniqueFileName(base: string, used: Set<string>): string {
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  const stem = base.replace(/\.md$/i, '');
  for (let n = 2; ; n++) {
    const candidate = `${stem}-${n}.md`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
}

/** The base persona + grounding law: present on EVERY turn, capability or not. */
const BASE_PERSONA = `You are MarkBrain, a thinking partner for a brain that overflows with ideas. Collect thoughts before they evaporate, keep them organized, and keep the forest in view. Talk WITH the user, direct, plain-spoken, no corporate filler.
Ground your thinking in the notes and chapters provided.
Notes arrive at the compaction level the user chose (title, description, summary, full). A layer that is missing was compacted on purpose: do not ask for it unless you genuinely cannot answer without it.
Each note is named by its \`file\`, a kebab-case filename like \`early-sprawling-dream.md\`, and each chapter by its \`name\`, a kebab-case handle built from the chapter's own title. Those, and the \`<title>\`s, are how you refer to things — write them as a reader would say them. There are no other identifiers in what you are sent: never invent one, and never quote something that looks like a database key.`;

/** The book-report rule is a style law, not a capability — it always rides along. */
const STYLE_LAW = `Never open a layer with "This document outlines", "This note describes", "The user and AI discuss" or any other book report: name the thing and state what is in it.`;

const TOPIC_SHIFT_BLOCK = `Emit these functional blocks in your reply when appropriate. Never emit JSON.

1. When the conversation shifts to a substantially new topic:
<topic_shift title="New Chapter Title" subtitle="One or two sentences stating what this chapter is about and its main takeaway, directly" />
Topic changes are rare — only emit this when the conversation truly moves to a substantially different subject; do not emit on ordinary follow-ups.`;

const ARTIFACT_UPSERT_BLOCK = `2. When an idea crystallizes into a durable note, emit an artifact_upsert carrying all four layers. They are read together in this order, so each one continues where the previous stopped and never re-introduces the note. Its \`file\` is the note's name: the same kebab-case filename you would see on an attached note, and the same note updates in place if the name is one you were sent:
<artifact_upsert file="kebab-case-slug.md" title="Short Note Title" type="document">
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
</artifact_upsert>`;

const LINK_BLOCK = `3. To link two notes in the graph:
<link source="file1.md" target="file2.md" kind="relates_to|refines|parent_of|child_of|born_from" />`;

/**
 * The system instruction assembles from capability blocks (Package 2 §2.3):
 * each functional block appears ONLY when its capability is ON, and when all
 * are off none of the schema words appear at all.
 */
export function buildSystemInstruction(capabilities: ChatCapabilities): string {
  const blocks: string[] = [];
  if (capabilities.autoChapter) blocks.push(TOPIC_SHIFT_BLOCK);
  if (capabilities.writeArtifacts) blocks.push(ARTIFACT_UPSERT_BLOCK);
  if (capabilities.graphLinks) blocks.push(LINK_BLOCK);
  const functional = blocks.length
    ? `${blocks.join('\n\n')}\n\n`
    : '';
  return `${BASE_PERSONA}\n${functional}${STYLE_LAW}`;
}

export function artifactXml(
  art: UniversalArtifactDocument,
  granularity: Granularity,
  /** The name this note carries in this payload; defaults to the title slug. */
  fileName?: string
): string {
  const lines: string[] = [];
  // Stale-layer guard (Package 1 §1.6): a manual body edit leaves the
  // description/summary layers behind. At `full` the body is present, so the
  // lying layers are dropped entirely; at the shorter cuts they still travel
  // but the notice tells the model to read the body for the truth.
  const stale = typeof art.layersStaleAt === 'number';
  const withDescription =
    cutIncludes(granularity, 'description') &&
    Boolean(art.current?.description) &&
    !(stale && granularity === 'full');
  const withSummary =
    cutIncludes(granularity, 'summary') &&
    Boolean(art.current?.summary) &&
    !(stale && granularity === 'full');
  const withBody = cutIncludes(granularity, 'body') && Boolean(art.current?.body);

  // The title cut carries title + subtitle: a bare name tells a reader nothing,
  // and the hook is what lets the model recognise the note it needs to expand.
  const subtitle = (art.current?.subtitle || '').trim();
  const file = fileName ?? artifactFileName(art);
  // `file`, never the internal id: the model has no schema for a database key
  // and reads one as a name. See artifactFileName above.
  lines.push(`  <artifact file="${file}" granularity="${granularity}">`);
  lines.push(`    <title>${subtitle ? `${art.title} — ${subtitle}` : art.title}</title>`);
  if (withDescription) lines.push(`    <description>${art.current.description}</description>`);
  if (withSummary) {
    lines.push(`    <summary>`);
    lines.push(indentBlock(art.current.summary, '      '));
    lines.push(`    </summary>`);
  }
  if (withBody) {
    lines.push(`    <content>`);
    lines.push(indentBlock(art.current.body, '      '));
    lines.push(`    </content>`);
  }
  if (stale && (granularity === 'description' || granularity === 'summary')) {
    lines.push(`    <notice>${STALE_LAYERS_NOTICE}</notice>`);
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
  // `name`, never the internal id — same law as artifacts (§21). `chap-fx-1`
  // is a row key; a reader gets a handle made of the chapter's own title.
  lines.push(`  <chapter name="${slugHandle(chap.title)}" granularity="${granularity}" status="${chap.status}">`);
  lines.push(`    <title>${chapSubtitle ? `${chap.title} — ${chapSubtitle}` : chap.title}</title>`);
  if (withDescription) lines.push(`    <description>${chap.description}</description>`);
  if (withSummary) {
    lines.push(`    <summary>`);
    lines.push(indentBlock(chap.summary, '      '));
    lines.push(`    </summary>`);
  }
  if (withTurns) {
    const turnsXml = turns
      .map(
        (t) =>
          `      <turn role="${t.role}">\n${indentBlock(t.content, '        ')}\n      </turn>`
      )
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
    // Two notes may share a title; a filename must still name exactly one.
    const usedFileNames = new Set<string>();
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
      const xml = artifactXml(art, granularity, uniqueFileName(artifactFileName(art), usedFileNames));
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
    const capabilities = options.capabilities ?? DEFAULT_CHAT_CAPABILITIES;
    const systemInstruction = buildSystemInstruction(capabilities);

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
