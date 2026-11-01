/**
 * It renders the small sidebar storage readout — usage vs the safe working
 * budget — and samples the browser's own estimate; quiet below 50%, amber at
 * 50%, loud at 80%. Renders NOTHING when the browser offers no estimate
 * (private mode, SSR). (design-docs/31 §4.2)
 */
import React, { useEffect, useState } from 'react';
import { Database } from 'lucide-react';
import {
  computeStorageMeter,
  formatBytes,
  type StorageMeter,
} from './storageMeter';

const RESAMPLE_MS = 60_000;

async function readEstimate(): Promise<StorageMeter | null> {
  try {
    const est = await navigator.storage?.estimate?.();
    if (!est) return null;
    return computeStorageMeter(est.usage ?? null, est.quota ?? null);
  } catch {
    return null; // private mode / storage disabled — show nothing
  }
}

export const StorageMeterRow: React.FC<{
  /** Test/SSR seam: a precomputed meter bypasses the browser estimate. */
  meter?: StorageMeter | null;
}> = ({ meter: injected }) => {
  const [meter, setMeter] = useState<StorageMeter | null>(injected ?? null);

  useEffect(() => {
    if (injected !== undefined) return;
    let alive = true;
    const tick = async () => {
      const next = await readEstimate();
      if (alive) setMeter(next);
    };
    void tick();
    const t = window.setInterval(tick, RESAMPLE_MS);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [injected]);

  if (!meter) return null;
  const { level } = meter;

  const colors = {
    quiet: { text: 'text-[#6b82a3]', icon: 'text-[#52749e]' },
    amber: { text: 'text-[#c9a978]', icon: 'text-[#c9a978]' },
    loud: { text: 'text-[#ff8b96]', icon: 'text-[#ff8b96]' },
  }[level];

  return (
    <div
      data-testid="storage-meter"
      data-level={level}
      className="w-full flex items-center justify-between px-2 py-1 rounded-lg bg-surface-2"
      title={
        `Local device storage used by this workspace (chats, notes, audio cache, logs): ` +
        `${formatBytes(meter.usageBytes)} of a safe ${formatBytes(meter.budgetBytes)} budget ` +
        `(100 MB of workspace data, or half of what this browser allows — whichever is smaller). ` +
        `Getting loud here means it's time to archive old chats and notes.`
      }
    >
      <div className="flex items-center gap-2">
        <Database className={`w-3.5 h-3.5 ${colors.icon}`} />
        <span className={`text-10 font-mono ${colors.text}`}>Device storage</span>
      </div>
      <span className={`text-10 font-mono ${colors.text}`}>
        {formatBytes(meter.usageBytes)} · {meter.pct}%
      </span>
    </div>
  );
};
