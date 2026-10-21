import React, { useSyncExternalStore } from 'react';
import { Loader2 } from 'lucide-react';
import {
  formatGainDb,
  formatTtsTime,
  gainToSlider,
  getTtsSnapshot,
  sliderToGain,
  subscribeTts,
  ttsTransport,
} from '../context/ttsTransport';

/**
 * Reproduction controls for read-aloud, rendered inside the sidebar's voice
 * card: the volume (on the app's cbrt curve — the slider reads fuller than the
 * sound) and, while something plays, a track head you can drag to fast-forward.
 * Browser speech has no timeline, so its transport says so instead of showing
 * a head that cannot seek.
 */
export const ReadAloudControls: React.FC = () => {
  const state = useSyncExternalStore(subscribeTts, getTtsSnapshot);

  return (
    <div className="px-2.5 pb-1.5 space-y-1.5" data-testid="tts-transport">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-mono uppercase tracking-wider text-ink-mute shrink-0">
          Volume
        </span>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={Math.round(gainToSlider(state.volume))}
          onChange={(e) => ttsTransport.setVolumeGain(sliderToGain(Number(e.target.value)))}
          aria-label="Volume"
          aria-valuetext={formatGainDb(state.volume)}
          className="flex-1 h-6 min-h-[24px] accent-[#5ad49b] cursor-pointer"
        />
        <span
          className="text-[10px] font-mono text-ink-mute tabular-nums w-14 text-right shrink-0"
          data-testid="tts-volume-db"
        >
          {formatGainDb(state.volume)}
        </span>
      </div>

      {state.phase === 'loading' && (
        <div className="flex items-center gap-1.5 text-[10px] font-mono text-ink-mute">
          <Loader2 className="w-3 h-3 animate-spin" />
          Preparing audio…
        </div>
      )}

      {state.phase === 'playing' && state.seekable && state.duration > 0 && (
        <div className="flex items-center gap-2" data-testid="tts-seek">
          <span className="text-[10px] font-mono text-[#7dd3fc] tabular-nums shrink-0">
            {formatTtsTime(state.currentTime)}
          </span>
          <input
            type="range"
            min={0}
            max={state.duration}
            step={0.1}
            value={Math.min(state.currentTime, state.duration)}
            onChange={(e) => ttsTransport.seek(Number(e.target.value))}
            aria-label="Play position"
            title="Drag to fast-forward"
            className="flex-1 h-6 min-h-[24px] accent-[#38bdf8] cursor-pointer"
          />
          <span className="text-[10px] font-mono text-ink-mute tabular-nums shrink-0">
            {formatTtsTime(state.duration)}
          </span>
        </div>
      )}

      {state.phase === 'playing' && !state.seekable && (
        <div className="text-[10px] font-mono text-ink-mute">
          Live · browser speech has no timeline to seek
        </div>
      )}
    </div>
  );
};
