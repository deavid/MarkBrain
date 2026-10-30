/**
 * The BYOK flag (NOT VERIFIED — design-docs/16).
 *
 * `VITE_BYOK=1` bakes in at build time (vite.config.ts define). Flag OFF means
 * the feature does not exist: key slots must read as EMPTY and writes are
 * ignored — even when `markbrain:keys:*` leftovers from earlier testing are
 * still sitting in localStorage. Otherwise a hidden leftover key would keep
 * signing requests while the UI says "the server owner's key" is in use, and
 * with the Keys UI hidden there would be no way to see or clear it.
 *
 * Read through a function (not a constant) so tests can exercise both sides —
 * a define()'d literal cannot be flipped at test runtime.
 *
 * SHIPPED WITH A TEST SEAM (named, not hidden): setByokEnabledForTests flips
 * the flag for the whole page — only tests may call it.
 */
let enabled: boolean = import.meta.env.VITE_BYOK === '1';

export function byokEnabled(): boolean {
  return enabled;
}

/** Test seam only — flips the flag without a rebuild. */
export function setByokEnabledForTests(v: boolean): void {
  enabled = v;
}
