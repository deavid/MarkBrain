export interface AmbientTelemetryData {
  totalTokens: number;
  ceiling: number;
  saturationRatio: number;
  activeChapterTokens: number;
  olderChaptersTokens: number;
  substrateTokens: number;
}

export function computeAmbientColor(ratio: number): { hex: string; glow: string; textClass: string } {
  if (ratio > 0.85) {
    return { hex: '#e05a66', glow: 'rgba(224, 90, 102, 0.4)', textClass: 'text-[#e05a66]' };
  }
  if (ratio > 0.5) {
    return { hex: '#e0b96c', glow: 'rgba(224, 185, 108, 0.4)', textClass: 'text-[#e0b96c]' };
  }
  return { hex: '#5ad49b', glow: 'rgba(90, 212, 155, 0.4)', textClass: 'text-[#5ad49b]' };
}
