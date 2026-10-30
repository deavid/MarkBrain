/**
 * It picks one of the twelve mellow dark pastel colors, deterministically,
 * from a seed (artifact id, code, or chapter id).
 *
 * LIVES IN SHARED as of Phase 3: the turn-commit planner (shared/turnCommit)
 * needs deterministic colors for chat-extracted notes, and shared/ must never
 * import from src/. This is the single source; src/utils/pastelColor.ts
 * re-exports it so every existing import path is unchanged.
 */
export const MELLOW_DARK_PASTELS = [
  '#4a3f6b',
  '#2d5a6c',
  '#3d6350',
  '#6e4c38',
  '#594263',
  '#2f5266',
  '#634b52',
  '#425e70',
  '#545938',
  '#3a5959',
  '#5f4359',
  '#4d5366',
];

export function getMellowPastelColor(seed: string | number): string {
  if (typeof seed === 'number') {
    return MELLOW_DARK_PASTELS[Math.abs(seed) % MELLOW_DARK_PASTELS.length];
  }
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  return MELLOW_DARK_PASTELS[Math.abs(hash) % MELLOW_DARK_PASTELS.length];
}
