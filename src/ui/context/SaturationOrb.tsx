import React from 'react';
import { AmbientTelemetryData, computeAmbientColor } from './ambientTelemetry';

interface SaturationOrbProps {
  telemetry: AmbientTelemetryData;
  onClick?: () => void;
}

/**
 * The saturation orb — the one route into the mirror. It is a real <button> so
 * it works from the keyboard and reaches screen readers; do not turn it back
 * into a div with onClick.
 */
export const SaturationOrb: React.FC<SaturationOrbProps> = ({ telemetry, onClick }) => {
  const color = computeAmbientColor(telemetry.saturationRatio);
  const tokenLabel =
    telemetry.totalTokens < 1000
      ? `${telemetry.totalTokens}`
      : `${Math.round(telemetry.totalTokens / 1000)}k`;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${telemetry.totalTokens.toLocaleString()} tokens of ${telemetry.ceiling.toLocaleString()} — open the mirror to see what the LLM will see`}
      className="absolute top-3 right-4 z-30 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-3/95 backdrop-blur-md shadow-pop pointer-events-auto cursor-pointer transition-all hover:bg-surface-4"
      title={`${telemetry.totalTokens.toLocaleString()} tokens of ${telemetry.ceiling.toLocaleString()} — tap to see what the LLM will see`}
    >
      <div
        className="w-2.5 h-2.5 rounded-full transition-colors"
        style={{
          backgroundColor: color.hex,
          boxShadow: `0 0 6px ${color.glow}`,
        }}
      />
      <span className="text-10 font-mono text-[#8ab1e0]">{tokenLabel}</span>
    </button>
  );
};
