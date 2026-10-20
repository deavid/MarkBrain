import React from 'react';
import { AmbientTelemetryData } from './ambientTelemetry';

/**
 * The 5px context rail (12_PLAN_OF_RECORD.md §3).
 *
 * It maps the ACTUAL payload: one segment per real part, in payload order
 * (system → attachments in substrate order → chapters in chronological order),
 * each wearing its own granularity/state colour from the one palette.
 *
 * Height is David's cube-root law: `min(100, cbrt(totalTokens / 1M) * 100)%`,
 * so the bar never sits at 100% unless the payload really is a million tokens.
 * The segments subdivide THAT filled height proportionally to their real
 * token share (a 2px floor keeps a Title cut visible as a crisp tick).
 *
 * Zero-footprint peripheral layer (02_UI_REFACTOR_PLAN.md Layer A): absolute
 * right edge, never participates in the main flex layout — an in-flow h-full
 * sibling here collapses the chat viewport to 0px.
 */
interface EdgeHeatStripProps {
  telemetry: AmbientTelemetryData;
}

export const EdgeHeatStrip: React.FC<EdgeHeatStripProps> = ({ telemetry }) => {
  const total = Math.max(telemetry.totalTokens, 1);
  const segments = telemetry.segments.filter((s) => s.tokens > 0);

  return (
    <div
      className="absolute right-0 top-0 w-[5px] h-full flex flex-col justify-start bg-surface-0 z-30"
      data-testid="edge-heat-strip"
      data-rail-height-pct={telemetry.railHeightPct.toFixed(2)}
      title={`Payload rail: ${telemetry.totalTokens.toLocaleString()} tok · ${segments.length} segments in send order`}
    >
      <div
        className="w-full flex flex-col overflow-hidden transition-all duration-300 "
        style={{ height: `${telemetry.railHeightPct}%` }}
      >
        {segments.map((seg) => {
          const sharePct = (seg.tokens / total) * 100;
          return (
            <div
              key={seg.id}
              data-segment-id={seg.id}
              data-segment-kind={seg.kind}
              data-segment-state={seg.state}
              title={`${seg.label}: ${seg.tokens} tok`}
              className="w-full transition-colors"
              style={{
                height: `${sharePct}%`,
                backgroundColor: seg.hex,
                minHeight: '2px',
                flexShrink: 0,
              }}
            />
          );
        })}
      </div>
    </div>
  );
};
