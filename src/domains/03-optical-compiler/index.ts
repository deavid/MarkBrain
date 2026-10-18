import { ITopologicalGraphDomain } from '../02-topological-graph';
import { IArtifactDocumentDomain, ResolutionTier } from '../01-artifact-document';
import { IChapterSegmentationDomain, ChapterPartition } from '../02-chapter-segmentation';
import { IDialogueTimelineDomain, Turn } from '../01-dialogue-timeline';
import { logger } from '../../utils/logger';

export interface OpticalCompilerOptions {
  focalIds: string[];
  opticalMode: 'autofocus' | 'manual' | 'myopia';
  tokenCeiling?: number;
  tierOverrides?: Record<string, ResolutionTier>;
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

export interface ContextTelemetry {
  tokenBreakdown: {
    systemTokens: number;
    substrateTokens: number;
    historyTokens: number;
    totalTokens: number;
  };
  nodeDistribution: {
    tier3Count: number;
    tier2Count: number;
    tier1Count: number;
    tier0Count: number;
    culledCount: number;
  };
}

/** Why an artifact received its compiled tier (surfaced in the UI). */
export type TierReason =
  | 'pin' // explicitly pinned focal artifact
  | 'fallback' // compiler default focal (nothing pinned / no active chapter)
  | 'override' // manual tier override
  | 'ancestor' // ancestor backbone (minimum Tier 1)
  | 'radius' // automatic depth-of-field by distance
  | 'culled'; // outside the focus radius

export interface CompiledOpticalPayload {
  compiledPrompt: string;
  systemInstruction: string;
  telemetry: ContextTelemetry;
  nodeTiers: Record<string, { tier: ResolutionTier | 'culled'; distance: number; reason: TierReason }>;
}

export interface IOpticalCompilerDomain {
  compile(options: OpticalCompilerOptions): CompiledOpticalPayload;
}

export class OpticalCompilerDomain implements IOpticalCompilerDomain {
  constructor(
    private graph: ITopologicalGraphDomain,
    private artifacts: IArtifactDocumentDomain,
    private segmentation: IChapterSegmentationDomain,
    private timeline: IDialogueTimelineDomain
  ) {}

  compile(options: OpticalCompilerOptions): CompiledOpticalPayload {
    const mode = options.opticalMode || 'autofocus';
    const ceiling = options.tokenCeiling || 32000;
    const allArtifacts = this.artifacts.listArtifacts();
    const allDocIds = allArtifacts.map((a) => a.id);

    // 1. Identify Focal Points
    // historyChapters overrides both the chapter list and the focal lookup
    // (background-thread jobs must not read the active thread's chapters).
    const chapterList = options.historyChapters ?? this.segmentation.listChapters();
    const activeChapter = options.historyChapters
      ? chapterList.find((c) => c.status === 'active') ??
        chapterList[chapterList.length - 1] ??
        null
      : this.segmentation.getActiveChapter();
    const effectiveFocalIds =
      options.focalIds.length > 0
        ? options.focalIds
        : activeChapter
        ? [activeChapter.id]
        : allDocIds.slice(0, 1);

    // 2. Compute Distances
    const distances = this.graph.computeDistancesFromFocal(effectiveFocalIds, allDocIds);

    // 3. Assign Raw Tiers (each with provenance so the UI can explain WHY)
    const nodeTiers: Record<
      string,
      { tier: ResolutionTier | 'culled'; distance: number; reason: TierReason }
    > = {};
    // 'pin' = user pinned it; 'fallback' = compiler's default focal point
    const focalReason = (id: string): TierReason =>
      options.focalIds.includes(id) ? 'pin' : 'fallback';
    const ancestors = new Set<string>();
    effectiveFocalIds.forEach((fid) => {
      this.graph.getAncestors(fid).forEach((a) => ancestors.add(a));
    });

    for (const art of allArtifacts) {
      const dist = distances[art.id] ?? Infinity;

      // Check manual override
      if (options.tierOverrides && options.tierOverrides[art.id] !== undefined) {
        nodeTiers[art.id] = { tier: options.tierOverrides[art.id], distance: dist, reason: 'override' };
        continue;
      }

      if (mode === 'myopia') {
        if (effectiveFocalIds.includes(art.id)) {
          nodeTiers[art.id] = { tier: 2, distance: 0, reason: focalReason(art.id) };
        } else if (dist <= 2) {
          nodeTiers[art.id] = { tier: 1, distance: dist, reason: 'radius' };
        } else if (dist === 3) {
          nodeTiers[art.id] = { tier: 0, distance: dist, reason: 'radius' };
        } else {
          nodeTiers[art.id] = { tier: 'culled', distance: dist, reason: 'culled' };
        }
        continue;
      }

      // Standard Optics
      if (effectiveFocalIds.includes(art.id)) {
        nodeTiers[art.id] = { tier: 3, distance: 0, reason: focalReason(art.id) };
      } else if (dist === 1) {
        nodeTiers[art.id] = { tier: 2, distance: 1, reason: 'radius' };
      } else if (dist === 2) {
        nodeTiers[art.id] = { tier: 1, distance: 2, reason: 'radius' };
      } else if (dist === 3) {
        nodeTiers[art.id] = { tier: 0, distance: 3, reason: 'radius' };
      } else {
        nodeTiers[art.id] = { tier: 'culled', distance: dist, reason: 'culled' };
      }

      // Ancestor backbone preservation
      if (ancestors.has(art.id)) {
        const cur = nodeTiers[art.id].tier;
        if (cur === 'culled' || cur === 0) {
          nodeTiers[art.id] = { tier: 1, distance: dist, reason: 'ancestor' };
        }
      }
    }

    // 4. Build Substrate XML
    const substrateParts: string[] = [];
    let substrateTokens = 0;

    for (const art of allArtifacts) {
      const tInfo = nodeTiers[art.id];
      if (!tInfo || tInfo.tier === 'culled') continue;

      const isFocal = effectiveFocalIds.includes(art.id);
      let xml = '';
      if (tInfo.tier === 3) {
        xml = `  <artifact id="${art.id}" type="document" tier="3"${isFocal ? ' focus="true"' : ''}>\n    <title>${art.title}</title>\n    <content>\n${art.current.t3_body}\n    </content>\n  </artifact>`;
      } else if (tInfo.tier === 2) {
        xml = `  <artifact id="${art.id}" type="document" tier="2" distance="${tInfo.distance}">\n    <title>${art.title}</title>\n    <summary>\n${art.current.t2_summary}\n    </summary>\n  </artifact>`;
      } else if (tInfo.tier === 1) {
        xml = `  <artifact id="${art.id}" type="document" tier="1" distance="${tInfo.distance}">\n    <title>${art.title}</title>\n    <abstract>${art.current.t1_abstract}</abstract>\n  </artifact>`;
      } else {
        xml = `  <artifact id="${art.id}" type="document" tier="0" title="${art.title}" distance="${tInfo.distance}" />`;
      }

      substrateParts.push(xml);
      substrateTokens += Math.ceil(xml.length / 4);
    }

    // 5. Build Chapters & Timeline XML
    const chapters = chapterList;
    const historyParts: string[] = [];
    let historyTokens = 0;

    chapters.forEach((chap, cIdx) => {
      const isLast = cIdx === chapters.length - 1;
      const isOngoing = chap.status === 'active' || isLast;
      const turns = options.historyTurns
        ? options.historyTurns.slice(chap.startIndex, chap.endIndex)
        : this.timeline.getTurnSlice(chap.startIndex, chap.endIndex);

      if (isOngoing) {
        // Full verbatim turns for active chapter
        const turnsXml = turns
          .map((t) => `      <turn role="${t.role}">\n${t.content}\n      </turn>`)
          .join('\n');
        const xml = `  <chapter id="${chap.id}" tier="3" status="active">\n    <title>${chap.title}</title>\n    <turns>\n${turnsXml}\n    </turns>\n  </chapter>`;
        historyParts.push(xml);
        historyTokens += Math.ceil(xml.length / 4);
      } else {
        // Closed chapters compressed to Tier 2 summary
        const summ = chap.summary || `Recap of ${chap.title}.`;
        const xml = `  <chapter id="${chap.id}" tier="2" status="completed">\n    <title>${chap.title}</title>\n    <summary>\n${summ}\n    </summary>\n  </chapter>`;
        historyParts.push(xml);
        historyTokens += Math.ceil(xml.length / 4);
      }
    });

    const substrateBlock = `<knowledge_substrate>\n${substrateParts.join('\n\n')}\n</knowledge_substrate>`;
    const historyBlock = `<conversation_chapters>\n${historyParts.join('\n\n')}\n</conversation_chapters>`;

    const compiledPrompt = `${substrateBlock}\n\n${historyBlock}`;
    const systemInstruction = `You are MarkBrain, a thinking partner for a brain that overflows with ideas. Collect thoughts before they evaporate, keep them organized, and keep the forest in view. Talk WITH the user — direct, plain-spoken, no corporate filler.
Ground your thinking directly in the provided notes and conversation chapters.
Emit functional XML tags when appropriate:
- <topic_shift title="New Chapter Title" abstract="1-sentence essence" summary="Key points of this shift" />
- <artifact_upsert id="unique_id" title="Note Title" type="document"><abstract>...</abstract><summary>...</summary><content>...</content></artifact_upsert>
- <link source="id1" target="id2" kind="relates_to|refines|parent_of|child_of|born_from" />`;

    const systemTokens = Math.ceil(systemInstruction.length / 4);
    const totalTokens = systemTokens + substrateTokens + historyTokens;

    // Node distribution calculation
    const counts = { tier3Count: 0, tier2Count: 0, tier1Count: 0, tier0Count: 0, culledCount: 0 };
    Object.values(nodeTiers).forEach((t) => {
      if (t.tier === 3) counts.tier3Count++;
      else if (t.tier === 2) counts.tier2Count++;
      else if (t.tier === 1) counts.tier1Count++;
      else if (t.tier === 0) counts.tier0Count++;
      else counts.culledCount++;
    });

    if (options.log) {
      logger.info('Compiler', `Compiled context: ${totalTokens} tokens (ceiling ${ceiling})`, counts);
      if (totalTokens > ceiling) {
        logger.warn('Compiler', `Compiled prompt exceeds token ceiling (${totalTokens} > ${ceiling}) — no degradation path exists yet`, counts);
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
        nodeDistribution: counts,
      },
      nodeTiers,
    };
  }
}
