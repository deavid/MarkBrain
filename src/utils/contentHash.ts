// Normalized content hash for import duplicate detection (Phase 2).
// Not cryptographic — FNV-1a over whitespace-collapsed text is plenty for
// "did we already import this body?" and stays dependency-free.

/** Trim + collapse all whitespace runs to single spaces. */
export function normalizedBody(text: string): string {
  return (text || '').trim().replace(/\s+/g, ' ');
}

/** FNV-1a 32-bit hex hash of the normalized body. */
export function contentHash(text: string): string {
  const norm = normalizedBody(text);
  let h = 0x811c9dc5;
  for (let i = 0; i < norm.length; i++) {
    h ^= norm.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}