/**
 * The read-aloud transport: one place that knows what the TTS is doing —
 * which message, loading/playing, and the timeline — so the sidebar card can
 * be the reproduction panel (volume + track head) while ChatView keeps owning
 * the audio element and its message semantics.
 *
 * The volume travels on the app's cube-root curve, inverted for input:
 * `position = cbrt(gain)`. The slider reads fuller than the sound (the same
 * law as the rail fill), and the quiet end — where a volume control is
 * actually used — owns most of the travel.
 */

export type TtsPhase = 'idle' | 'loading' | 'playing';

export interface TtsTransportSnapshot {
  messageId: string | null;
  phase: TtsPhase;
  currentTime: number;
  /** Seconds; 0 while unknown (metadata not ready) or for browser speech. */
  duration: number;
  /** True only for the API audio path — browser speech has no timeline. */
  seekable: boolean;
  /** The gain actually applied, 0..1. */
  volume: number;
}

const VOLUME_KEY = 'markbrain:ttsVolume';
const TICK_MS = 120;

/** Slider position (0..100) → applied gain: the cbrt meter inverted (gain = p³). */
export function sliderToGain(position: number): number {
  const p = Math.min(100, Math.max(0, position)) / 100;
  return p * p * p;
}

/** Applied gain → slider position: literally `cbrt(gain)`, the rail's curve. */
export function gainToSlider(gain: number): number {
  const g = Math.min(1, Math.max(0, gain));
  return Math.cbrt(g) * 100;
}

function loadVolume(): number {
  try {
    const raw = window.localStorage.getItem(VOLUME_KEY);
    if (raw === null) return 1;
    const n = Number(raw);
    return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 1;
  } catch {
    return 1; // no window (SSR/test) or storage disabled: browser default
  }
}

function saveVolume(gain: number): void {
  try {
    window.localStorage.setItem(VOLUME_KEY, String(gain));
  } catch {
    // Private mode / storage disabled — the in-memory choice still applies
    // for this session, which is better than dropping the drag.
  }
}

let audio: HTMLAudioElement | null = null;
let snapshot: TtsTransportSnapshot = {
  messageId: null,
  phase: 'idle',
  currentTime: 0,
  duration: 0,
  seekable: false,
  volume: loadVolume(),
};
const listeners = new Set<() => void>();
let lastNotify = 0;

function notify(): void {
  lastNotify = Date.now();
  listeners.forEach((fn) => fn());
}

function patch(partial: Partial<TtsTransportSnapshot>, opts: { silent?: boolean } = {}): void {
  snapshot = { ...snapshot, ...partial };
  if (!opts.silent) notify();
}

export function getTtsSnapshot(): TtsTransportSnapshot {
  return snapshot;
}

export function subscribeTts(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function onMetadata(): void {
  if (!audio || !Number.isFinite(audio.duration)) return;
  patch({ seekable: true, duration: audio.duration }, { silent: true });
}

function onTick(): void {
  if (!audio) return;
  const silent = Date.now() - lastNotify < TICK_MS;
  snapshot = {
    ...snapshot,
    currentTime: audio.currentTime,
    duration: Number.isFinite(audio.duration) ? audio.duration : snapshot.duration,
  };
  if (!silent) notify();
}

export const ttsTransport = {
  /** Claim the live audio element: volume applied now, timeline mirrored after. */
  setAudio(el: HTMLAudioElement | null): void {
    if (audio === el) return;
    if (audio) {
      audio.removeEventListener('loadedmetadata', onMetadata);
      audio.removeEventListener('durationchange', onMetadata);
      audio.removeEventListener('timeupdate', onTick);
    }
    audio = el;
    if (audio) {
      audio.volume = snapshot.volume;
      audio.addEventListener('loadedmetadata', onMetadata);
      audio.addEventListener('durationchange', onMetadata);
      audio.addEventListener('timeupdate', onTick);
      onMetadata();
    }
  },

  begin(messageId: string): void {
    patch({ messageId, phase: 'loading', currentTime: 0, duration: 0, seekable: false });
  },

  playing(opts: { duration?: number; seekable: boolean }): void {
    patch({
      phase: 'playing',
      duration: opts.duration && Number.isFinite(opts.duration) ? opts.duration : 0,
      seekable: opts.seekable,
      currentTime: 0,
    });
  },

  end(): void {
    ttsTransport.setAudio(null);
    patch({
      messageId: null,
      phase: 'idle',
      currentTime: 0,
      duration: 0,
      seekable: false,
    });
  },

  /** Fast-forward / scrub. Only the API audio path has a timeline. */
  seek(seconds: number): void {
    if (!audio || !snapshot.seekable || !snapshot.duration) return;
    const t = Math.min(snapshot.duration, Math.max(0, seconds));
    audio.currentTime = t;
    patch({ currentTime: t });
  },

  setVolumeGain(gain: number): void {
    const clamped = Math.min(1, Math.max(0, gain));
    if (clamped === snapshot.volume) return;
    saveVolume(clamped);
    if (audio) audio.volume = clamped;
    patch({ volume: clamped });
  },
};

/** Unity is 0 dB, silence is -∞ — gain is a ratio, a percentage never said loudness. */
export function formatGainDb(gain: number): string {
  if (!Number.isFinite(gain) || gain <= 0) return '-∞ dB';
  return `${(20 * Math.log10(gain)).toFixed(1)} dB`;
}

/** `m:ss` for the track head's ends. */
export function formatTtsTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
