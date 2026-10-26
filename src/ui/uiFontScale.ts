/**
 * How big the interface text is, as a multiplier on the design size.
 *
 * A reading preference, not project data — it belongs to this browser, so it
 * lives in localStorage alongside the other reading preferences, never in the
 * workspace. 1 is the default and is therefore stored as *absence* of the key.
 *
 * Phones matter most here: the viewport pins `maximum-scale`/`user-scalable`
 * (so pinch-zoom is off), which makes the sidebar the only place to turn the
 * text up. The steps drive a token table in index.css via `data-font-scale`:
 * font sizes scale (small ones hardest, big ones barely), spacing and layout
 * stay at design size. `--ui-scale` carries the number to the px-based rules.
 */
export type UiFontScale = 1 | 1.15 | 1.3 | 1.5;

const KEY = 'markbrain:fontScale';

export const FONT_SCALES: UiFontScale[] = [1, 1.15, 1.3, 1.5];

export function parseUiFontScale(stored: string | null | undefined): UiFontScale {
  const n = Number(stored);
  return (FONT_SCALES as number[]).includes(n) ? (n as UiFontScale) : 1;
}

export function loadUiFontScale(): UiFontScale {
  try {
    return parseUiFontScale(window.localStorage.getItem(KEY));
  } catch {
    return 1;
  }
}

export function saveUiFontScale(scale: UiFontScale): void {
  try {
    if (scale === 1) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, String(scale));
  } catch {
    // Private mode / storage disabled — the in-memory choice still applies
    // for this session, which is better than dropping the click.
  }
}

/** Push the scale onto the document: the data attribute drives the token
 * table in index.css (font sizes only — spacing stays at design size), and
 * --ui-scale carries the same number to the px-based rules (.md-body). */
export function applyUiFontScale(scale: UiFontScale): void {
  if (typeof window === 'undefined') return;
  const root = document.documentElement;
  if (scale === 1) {
    delete root.dataset.fontScale;
  } else {
    root.dataset.fontScale = String(Math.round(scale * 100));
  }
  root.style.setProperty('--ui-scale', String(scale));
}