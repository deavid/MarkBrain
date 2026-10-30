import { estimateTokens } from './estimateTokens';

export interface TokenColorInfo {
  tier: '16k' | '32k' | '64k' | '128k' | '256k' | '512k';
  name: string;
  colorName: string;
  hex: string;
  glowHex: string;
  badgeBg: string;
  textClass: string;
  bgClass: string;
  barColor: string;
  description: string;
}

/**
 * A bucketed size scale for token counts: 16k blue → 32k cyan → 64k green →
 * 128k yellow → 256k orange → 512k red.
 *
 * This is NOT the attachment palette (domains/granularity.ts), and it must not be
 * reused for anything that carries attachment state — two colour languages on one
 * row is what makes a screen unreadable.
 */
export function getTokenColor(tokens: number): TokenColorInfo {
  if (tokens <= 16000) {
    return {
      tier: '16k',
      name: '≤ 16k (Ultra-Lean Blue)',
      colorName: 'blue',
      hex: '#3b82f6',
      glowHex: 'rgba(59, 130, 246, 0.25)',
      badgeBg: 'bg-surface-2',
      textClass: 'text-[#8ab1e0]',
      bgClass: 'bg-surface-2/70',
      barColor: '#3b82f6',
      description: 'Micro context footprint, minimal latency and low compute cost.',
    };
  } else if (tokens <= 32000) {
    return {
      tier: '32k',
      name: '16k – 32k (Streamlined Cyan)',
      colorName: 'cyan',
      hex: '#06b6d4',
      glowHex: 'rgba(6, 180, 212, 0.25)',
      badgeBg: 'bg-surface-3',
      textClass: 'text-[#7ec6cf]',
      bgClass: 'bg-surface-3/70',
      barColor: '#06b6d4',
      description: 'Optimal engineering balance with clear boundary focus.',
    };
  } else if (tokens <= 64000) {
    return {
      tier: '64k',
      name: '32k – 64k (Balanced Green)',
      colorName: 'green',
      hex: '#10b981',
      glowHex: 'rgba(16, 185, 129, 0.25)',
      badgeBg: 'bg-surface-3',
      textClass: 'text-[#88c9a0]',
      bgClass: 'bg-surface-3/70',
      barColor: '#10b981',
      description: 'Moderate context depth, retaining multi-component contracts.',
    };
  } else if (tokens <= 128000) {
    return {
      tier: '128k',
      name: '64k – 128k (Dense Yellow)',
      colorName: 'yellow',
      hex: '#eab308',
      glowHex: 'rgba(234, 179, 8, 0.25)',
      badgeBg: 'bg-surface-3',
      textClass: 'text-[#e0b96c]',
      bgClass: 'bg-surface-3/70',
      barColor: '#eab308',
      description: 'Lots of memory — consider summarizing older chapters.',
    };
  } else if (tokens <= 256000) {
    return {
      tier: '256k',
      name: '128k – 256k (Heavy Orange)',
      colorName: 'orange',
      hex: '#f97316',
      glowHex: 'rgba(249, 115, 22, 0.25)',
      badgeBg: 'bg-surface-2',
      textClass: 'text-[#e89468]',
      bgClass: 'bg-surface-2/70',
      barColor: '#f97316',
      description: 'High overhead. Recommend lowering artifact depth or compressing chapters.',
    };
  } else {
    return {
      tier: '512k',
      name: '256k – 512k+ (Max Red)',
      colorName: 'red',
      hex: '#ef4444',
      glowHex: 'rgba(239, 68, 68, 0.3)',
      badgeBg: 'bg-surface-2',
      textClass: 'text-[#f07a84]',
      bgClass: 'bg-surface-2/70',
      barColor: '#ef4444',
      description: 'Near boundary limit. High token consumption per turn.',
    };
  }
}

export { estimateTokens };
