import React from 'react';
import { AmbientTelemetryData } from './ambientTelemetry';

interface EdgeHeatStripProps {
  telemetry: AmbientTelemetryData;
}

export const EdgeHeatStrip: React.FC<EdgeHeatStripProps> = ({ telemetry }) => {
  const total = Math.max(telemetry.totalTokens, 1);
  const activePct = Math.max(10, Math.min(70, (telemetry.activeChapterTokens / total) * 100));
  const olderPct = Math.max(15, Math.min(60, (telemetry.olderChaptersTokens / total) * 100));

  // Zero-footprint peripheral layer (design-docs/02_UI_REFACTOR_PLAN.md Layer A):
  // absolute right edge, must never participate in the main flex layout —
  // an in-flow h-full sibling here collapses the chat viewport to 0px.
  return (
    <div
      className="absolute right-0 top-0 w-[5px] h-full flex flex-col bg-[#0b1018] border-l border-[#080d15] z-30"
      title="Edge telemetry: red = active chapter tokens, yellow = older chapter tokens, blue = system + notes"
    >
      {/* Red = Detail / Tier 3 (Focus) */}
      <div
        className="w-full bg-[#e05a66] transition-all duration-300"
        style={{ height: `${activePct}%` }}
      />
      {/* Yellow = Summary / Tier 2 */}
      <div
        className="w-full bg-[#e0b96c] transition-all duration-300"
        style={{ height: `${olderPct}%` }}
      />
      {/* Blue = Title / Tier 0 */}
      <div className="w-full bg-[#5d87b8] flex-1 transition-all duration-300" />
    </div>
  );
};
