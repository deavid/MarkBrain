import React from 'react';
import { AmbientTelemetryData } from './ambientTelemetry';

/**
 * The 5px context rail: the real payload, one segment per real part, in payload
 * order (system → attachments in substrate order → chapters chronologically),
 * each in its own state colour.
 *
 * Two things here are load-bearing:
 *   - the filled stack is `railHeightPct` tall (cube root of 1M tokens), and the
 *     segments subdivide THAT height by real token share, with a 2px floor so a
 *     Title cut still shows as a tick;
 *   - this element is `absolute` and must stay out of the main flex layout.
 *     An in-flow `h-full` sibling here collapses the chat viewport to 0px.
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
