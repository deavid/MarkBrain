import React from 'react';
import { AmbientTelemetryData, computeAmbientColor } from './ambientTelemetry';

interface SaturationOrbProps {
  telemetry: AmbientTelemetryData;
  onClick?: () => void;
}

export const SaturationOrb: React.FC<SaturationOrbProps> = ({ telemetry, onClick }) => {
  const color = computeAmbientColor(telemetry.saturationRatio);
  const tokenLabel = telemetry.totalTokens < 1000 ? `${telemetry.totalTokens}` : `${Math.round(telemetry.totalTokens / 1000)}k`;

  return (
    <div
      onClick={onClick}
      className="absolute top-3 right-4 z-30 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#0d1421]/90 backdrop-blur-md border border-[#162235] shadow-lg pointer-events-auto cursor-pointer transition-all hover:border-[#223552]"
      title={`${telemetry.totalTokens.toLocaleString()} tokens of ${telemetry.ceiling.toLocaleString()} — tap to see what the LLM will see`}
    >
      <div
        className="w-2.5 h-2.5 rounded-full transition-colors"
        style={{
          backgroundColor: color.hex,
          boxShadow: `0 0 6px ${color.glow}`,
        }}
      />
      <span className="text-[10px] font-mono text-[#8ab1e0]">
        {tokenLabel}
      </span>
    </div>
  );
};
