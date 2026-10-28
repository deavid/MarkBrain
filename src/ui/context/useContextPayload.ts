import { useMemo } from 'react';
import type { DomainContextValue } from '../../domains/DomainRegistry';
import type { ChatAttachment, ChatCapabilities } from '../../domains/06-chat-threads';import type { AttachmentVisualState } from '../../domains/granularity';
import { ATTACHMENT_STATE_PALETTE } from '../../domains/granularity';
import {
  AmbientTelemetryData,
  EdgeRailSegment,
  MAX_CONTEXT_TOKENS,
  SYSTEM_RAIL_HEX,
  computeRailHeightPct,
} from './ambientTelemetry';

type WorkspaceContainer = NonNullable<ReturnType<DomainContextValue['workspace']['getProject']>>;

export interface ContextPayloadParams {
  compiler: DomainContextValue['compiler'];
  currentContainer: WorkspaceContainer | null | undefined;
  /** The ACTIVE chat's attachments — the only artifacts this payload carries. */
  attachments: ChatAttachment[];
  /** Bumped whenever turns/chapters/artifacts mutate, to force a recompile. */
  tick: number;
  /**
   * Resolved chat capabilities (DEFAULT ← project ← thread) for the active
   * chat. The mirror must show what the REAL send compiles — a preview built
   * from defaults would lie the moment a toggle is off.
   */
  capabilities?: ChatCapabilities;
}

/** Compiles the payload for the active chat and derives the ambient numbers. */
export function useContextPayload(params: ContextPayloadParams) {
  const { compiler, currentContainer, attachments, tick, capabilities } = params;

  // A cheap stable key: the attachment array is rebuilt on every render, but
  // the payload only changes when membership or a granularity does.
  const attachmentKey = attachments
    .map((a) => `${a.artifactId}:${a.granularity}`)
    .join('|');

  const compiledContext = useMemo(
    () =>
      compiler.compile({
        attachments,
        tokenCeiling: currentContainer?.tokenCeiling || MAX_CONTEXT_TOKENS,
        capabilities,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [compiler, attachmentKey, currentContainer?.tokenCeiling, tick, capabilities]
  );

  const ambientTelemetry: AmbientTelemetryData = useMemo(() => {
    const tb = compiledContext.telemetry.tokenBreakdown;
    const ceiling = currentContainer?.tokenCeiling || MAX_CONTEXT_TOKENS;
    const totalTokens = tb.totalTokens;

    const segments: EdgeRailSegment[] = [];
    if (tb.systemTokens > 0) {
      segments.push({
        id: 'system',
        kind: 'system',
        label: 'System prompt',
        tokens: tb.systemTokens,
        state: 'system',
        hex: SYSTEM_RAIL_HEX,
      });
    }
    for (const entry of compiledContext.telemetry.attachmentBreakdown ?? []) {
      const state: AttachmentVisualState = entry.staged ? 'staged' : entry.granularity;
      segments.push({
        id: `att-${entry.artifactId}`,
        kind: 'attachment',
        label: `${entry.title} (${entry.staged ? 'staged · ' : ''}${entry.granularity})`,
        tokens: entry.tokens,
        state,
        hex: ATTACHMENT_STATE_PALETTE[state].hex,
      });
    }
    for (const entry of compiledContext.telemetry.chapterBreakdown ?? []) {
      segments.push({
        id: `chap-${entry.chapterId}`,
        kind: 'chapter',
        label: `${entry.title} (${entry.granularity})`,
        tokens: entry.tokens,
        state: entry.granularity,
        hex: ATTACHMENT_STATE_PALETTE[entry.granularity].hex,
      });
    }

    return {
      totalTokens,
      ceiling,
      saturationRatio: Math.min(1.0, totalTokens / Math.max(1, ceiling)),
      railHeightPct: computeRailHeightPct(totalTokens),
      segments,
    };
  }, [compiledContext, currentContainer?.tokenCeiling]);

  return { compiledContext, ambientTelemetry };
}
