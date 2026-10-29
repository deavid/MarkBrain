/**
 * The read-aloud transport: one place that knows what the TTS is doing —
 * which message, loading/playing, and the timeline — so the sidebar card can
 * be the reproduction panel (volume + track head) while ChatView keeps owning
 * the message semantics.
 *
 * Playback engine: WebAudio (decodeAudioData + AudioBufferSource), NOT the
 * <audio> media element. Rationale (live 2026-10-30, David's Firefox): the
 * media element's platform decoder silently gives up partway through a
 * piped-ffmpeg Opus stream — it fast-forwards the position to the end and
 * fires `ended` a few seconds in, with no error and no seek, while
 * decodeAudioData on the SAME bytes decodes 100% on both engines. The
 * BufferSource path also gives us pause/resume/seek for free (context clock
 * + start offset), and the head works everywhere.
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
  /** Seconds; 0 while unknown (metadata not ready). */
  duration: number;
  /** True once the blob is decoded — the WebAudio path is always seekable. */
  seekable: boolean;
  /** Playing but held (source stopped, position kept). */
  paused: boolean;
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

let volume = loadVolume();
let snapshot: TtsTransportSnapshot = {
  messageId: null,
  phase: 'idle',
  currentTime: 0,
  duration: 0,
  seekable: false,
  paused: false,
  volume,
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

// ---------------------------------------------------------------------------
// WebAudio playback engine (see module docstring for why not <audio>).
// ---------------------------------------------------------------------------
let ctx: AudioContext | null = null;
let gainNode: GainNode | null = null;
let audioBuffer: AudioBuffer | null = null;
let source: AudioBufferSourceNode | null = null;
let endedCallback: (() => void) | null = null;
/** Position where the current source started, and when it started. */
let startOffset = 0;
let startedAt = 0;
/** Set when WE stop the source (pause/stop/replace) so onended knows to ignore it. */
let manualStop = false;
let ticker: ReturnType<typeof setInterval> | null = null;

function ensureCtx(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext();
    gainNode = ctx.createGain();
    gainNode.gain.value = volume;
    gainNode.connect(ctx.destination);
  }
  return ctx;
}

/** Current playback position: held offset + wall clock since (re)start. */
function positionNow(): number {
  if (snapshot.paused || !ctx) return startOffset;
  return Math.min(startOffset + (ctx.currentTime - startedAt), snapshot.duration || Infinity);
}

function stopSource(): void {
  if (source) {
    manualStop = true;
    try {
      source.onended = null;
      source.stop();
    } catch {
      /* already stopped */
    }
    source.disconnect();
    source = null;
  }
}

function spawnSource(from: number): void {
  if (!ctx || !audioBuffer || !gainNode) return;
  stopSource();
  startOffset = from;
  startedAt = ctx.currentTime;
  manualStop = false;
  const src = ctx.createBufferSource();
  src.buffer = audioBuffer;
  src.connect(gainNode);
  src.onended = () => {
    if (manualStop) return;
    source = null;
    const cb = endedCallback;
    endedCallback = null;
    if (cb) cb();
  };
  source = src;
  src.start(0, from);
}

function startTicker(): void {
  if (ticker) return;
  ticker = setInterval(() => {
    if (snapshot.phase !== 'playing' || snapshot.paused || !ctx) return;
    patch({ currentTime: positionNow() }, { silent: Date.now() - lastNotify < TICK_MS });
  }, TICK_MS);
}

function stopTicker(): void {
  if (ticker) {
    clearInterval(ticker);
    ticker = null;
  }
}

function resetSnapshot(): void {
  stopSource();
  stopTicker();
  endedCallback = null;
  patch({
    messageId: null,
    phase: 'idle',
    currentTime: 0,
    duration: 0,
    seekable: false,
    paused: false,
  });
}

export const ttsTransport = {
  /** Decode a device-cached blob and play it (WebAudio — see module
   * docstring for why not <audio>). Resolves once decoding succeeded and
   * playback began; rejects on decode failure. `onEnded` fires on NATURAL
   * end only (not on pause/stop/replace). */
  async playDeviceBlob(blob: Blob, messageId: string, onEnded: () => void): Promise<void> {
    const context = ensureCtx();
    if (context.state === 'suspended') await context.resume();
    stopSource();
    endedCallback = null;
    audioBuffer = await context.decodeAudioData(await blob.arrayBuffer());
    patch({
      messageId,
      phase: 'playing',
      paused: false,
      seekable: true,
      duration: audioBuffer.duration,
      currentTime: 0,
    });
    endedCallback = onEnded;
    spawnSource(0);
    startTicker();
  },

  /** The download/prepare click failed before anything played — reset. */
  fail(): void {
    resetSnapshot();
  },

  begin(messageId: string): void {
    patch({ messageId, phase: 'loading', currentTime: 0, duration: 0, seekable: false, paused: false });
  },

  end(): void {
    resetSnapshot();
  },

  /** Hold playback: the source stops, the position stays. */
  pause(): void {
    if (snapshot.phase !== 'playing' || snapshot.paused) return;
    startOffset = positionNow();
    stopSource();
    patch({ paused: true, currentTime: startOffset });
  },

  /** Continue from the held position. */
  resume(): void {
    if (snapshot.phase !== 'playing' || !snapshot.paused) return;
    if (!ctx || !audioBuffer) return;
    patch({ paused: false });
    spawnSource(startOffset);
  },

  /** Fast-forward / scrub — restart the source at the new offset. */
  seek(seconds: number): void {
    if (!snapshot.seekable || !snapshot.duration) return;
    const t = Math.min(snapshot.duration, Math.max(0, seconds));
    startOffset = t;
    if (!snapshot.paused && ctx && audioBuffer) {
      spawnSource(t);
    }
    patch({ currentTime: t });
  },

  setVolumeGain(gain: number): void {
    const clamped = Math.min(1, Math.max(0, gain));
    if (clamped === snapshot.volume) return;
    saveVolume(clamped);
    volume = clamped;
    if (gainNode) gainNode.gain.value = clamped;
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
