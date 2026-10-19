import { useMemo } from 'react';
import type { DomainContextValue } from '../../domains/DomainRegistry';
import type { ChatAttachment } from '../../domains/06-chat-threads';
import { AmbientTelemetryData } from './ambientTelemetry';

type WorkspaceContainer = NonNullable<ReturnType<DomainContextValue['workspace']['getProject']>>;

export interface ContextPayloadParams {
  compiler: DomainContextValue['compiler'];
  currentContainer: WorkspaceContainer | null | undefined;
  /** The ACTIVE chat's attachments — the only artifacts this payload carries. */
  attachments: ChatAttachment[];
  /** Bumped whenever turns/chapters/artifacts mutate, to force a recompile. */
  tick: number;
}

/**
 * Compiles the payload for the active chat and derives the ambient numbers.
 *
 * Inputs are exactly: this chat's attachments (each at its granularity) and
 * its chapters (each at its granularity, live domains). Nothing is guessed
 * from the library — see design-docs/09_CHAT_ARTIFACTS_PAYLOAD.md §1c.
 */
export function useContextPayload(params: ContextPayloadParams) {
  const { compiler, currentContainer, attachments, tick } = params;

  // A cheap stable key: the attachment array is rebuilt on every render, but
  // the payload only changes when membership or a granularity does.
  const attachmentKey = attachments
    .map((a) => `${a.artifactId}:${a.granularity}`)
    .join('|');

  const compiledContext = useMemo(
    () =>
      compiler.compile({
        attachments,
        tokenCeiling: currentContainer?.tokenCeiling || 32000,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [compiler, attachmentKey, currentContainer?.tokenCeiling, tick]
  );

  // Telemetry payload for SaturationOrb and EdgeHeatStrip
  const ambientTelemetry: AmbientTelemetryData = useMemo(() => {
    const tb = compiledContext.telemetry.tokenBreakdown;
    const ceiling = currentContainer?.tokenCeiling || 32000;
    return {
      activeChapterTokens: Math.round(tb.historyTokens * 0.7),
      olderChaptersTokens: Math.round(tb.historyTokens * 0.3),
      systemPromptTokens: tb.systemTokens,
      substrateTokens: tb.substrateTokens,
      totalTokens: tb.totalTokens,
      ceiling,
      saturationRatio: Math.min(1.0, tb.totalTokens / ceiling),
    };
  }, [compiledContext, currentContainer?.tokenCeiling]);

  return { compiledContext, ambientTelemetry };
}
