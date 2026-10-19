import { useMemo } from 'react';
import type { DomainContextValue } from '../../domains/DomainRegistry';
import type { ResolutionTier } from '../../types';
import { AmbientTelemetryData } from './ambientTelemetry';

type WorkspaceContainer = NonNullable<ReturnType<DomainContextValue['workspace']['getProject']>>;

export interface OpticalContextParams {
  compiler: DomainContextValue['compiler'];
  currentContainer: WorkspaceContainer | null | undefined;
  focalArtifactIds: string[];
  manualTierOverrides: Record<string, ResolutionTier>;
  opticalMode: 'autofocus' | 'manual' | 'myopia';
  tick: number;
}

// Optical Context compilation + ambient telemetry payload.
// Moved verbatim from App.tsx — same memo deps, same inputs, zero logic change.
export function useOpticalContext(params: OpticalContextParams) {
  const {
    compiler,
    currentContainer,
    focalArtifactIds,
    manualTierOverrides,
    opticalMode,
    tick,
  } = params;

  // Compile Optical Context through compiler domain.
  // NOTE: focalIds = explicitly pinned artifacts ONLY. The selected/viewed
  // artifact is deliberately NOT injected here — selection only ever differs
  // from pins while the detail modal is open (chat cannot happen then), and
  // injecting it made "Current: Tier" and in-context state appear stuck no
  // matter what pin/tier/Auto the user clicked.
  const compiledContext = useMemo(() => {
    return compiler.compile({
      focalIds: focalArtifactIds,
      opticalMode,
      tokenCeiling: currentContainer?.tokenCeiling || 32000,
      tierOverrides: manualTierOverrides,
    });
  }, [compiler, focalArtifactIds, opticalMode, currentContainer?.tokenCeiling, manualTierOverrides, tick]);

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
      opticalMode,
      saturationRatio: Math.min(1.0, tb.totalTokens / ceiling),
    };
  }, [compiledContext, currentContainer?.tokenCeiling, opticalMode]);

  return { compiledContext, ambientTelemetry };
}
