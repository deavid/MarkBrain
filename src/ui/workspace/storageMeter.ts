/**
 * It computes the sidebar storage readout for David: how much device storage
 * the workspace uses against a SAFE budget, and how loud that should be —
 * and nothing else. (design-docs/31 §4.2)
 *
 * The budget is deliberately NOT the browser's raw quota: Chromium reports up
 * to ~60% of the physical disk (hundreds of GB), which reads 0.0% forever.
 * The honest ceiling for a full-mirror workspace is the smaller of:
 *   - 100 MiB of workspace data (David's chosen safe working set), or
 *   - half the browser-reported quota (mobile browsers get evict-happy).
 */

export const SAFE_WORKING_SET_BYTES = 100 * 1024 * 1024; // 100 MiB

export type StorageMeterLevel = 'quiet' | 'amber' | 'loud';

export interface StorageMeter {
  /** Bytes this origin currently occupies on the device (all MarkBrain stores). */
  usageBytes: number;
  /** The safe ceiling this percent is measured against. */
  budgetBytes: number;
  /** 0..100, capped. */
  pct: number;
  level: StorageMeterLevel;
}

/**
 * Reads a `navigator.storage.estimate()` result into a meter. Returns null
 * when the browser gave us nothing usable — the UI then renders nothing
 * instead of inventing numbers.
 */
export function computeStorageMeter(
  usageBytes: number | null | undefined,
  quotaBytes: number | null | undefined
): StorageMeter | null {
  if (typeof usageBytes !== 'number' || !Number.isFinite(usageBytes) || usageBytes < 0) {
    return null;
  }
  const quotaHalf =
    typeof quotaBytes === 'number' && Number.isFinite(quotaBytes) && quotaBytes > 0
      ? quotaBytes / 2
      : Infinity;
  const budgetBytes = Math.min(SAFE_WORKING_SET_BYTES, quotaHalf);
  const raw = (usageBytes / budgetBytes) * 100;
  const pct = Math.max(0, Math.min(100, Math.round(raw)));
  const level: StorageMeterLevel = pct >= 80 ? 'loud' : pct >= 50 ? 'amber' : 'quiet';
  return { usageBytes, budgetBytes, pct, level };
}

/** One-decimal human bytes, e.g. `512 KB`, `14.2 MB`, `1.5 GB`. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${trim1(bytes / (1024 * 1024 * 1024))} GB`;
  }
  if (bytes >= 1024 * 1024) {
    return `${trim1(bytes / (1024 * 1024))} MB`;
  }
  return `${trim1(bytes / 1024)} KB`;
}

function trim1(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}
