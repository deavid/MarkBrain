/**
 * Read-aloud transport: the cbrt volume law, the timeline mirror, and the
 * lifecycle the sidebar card and ChatView share. Volume is the rail's curve
 * inverted for input (position = cbrt(gain)), so the slider reads fuller than
 * the sound and the quiet end owns the travel.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  formatGainDb,
  formatTtsTime,
  gainToSlider,
  getTtsSnapshot,
  sliderToGain,
  subscribeTts,
  ttsTransport,
} from '../ui/context/ttsTransport';

function fakeAudio(duration = 10) {
  return {
    volume: 1,
    currentTime: 0,
    duration,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as HTMLAudioElement;
}

describe('volume rides the cube-root curve, inverted for input', () => {
  it('position = cbrt(gain): the meter reads fuller than the sound', () => {
    expect(sliderToGain(100)).toBeCloseTo(1, 10);
    expect(sliderToGain(50)).toBeCloseTo(0.125, 10); // half the travel → an eighth of the gain
    expect(gainToSlider(0.125)).toBeCloseTo(50, 6);
    expect(gainToSlider(1)).toBeCloseTo(100, 6);
    for (const gain of [0, 0.001, 0.125, 0.5, 0.729, 1]) {
      expect(sliderToGain(gainToSlider(gain))).toBeCloseTo(gain, 9);
    }
  });

  it('is monotonic and clamps nonsense', () => {
    expect(sliderToGain(80)).toBeGreaterThan(sliderToGain(30));
    expect(sliderToGain(150)).toBe(1);
    expect(sliderToGain(-10)).toBe(0);
    expect(gainToSlider(5)).toBeCloseTo(100, 6);
    expect(gainToSlider(-1)).toBe(0);
  });

  it('clamps, persists the gain, notifies, and drives a claimed element', () => {
    const fake = fakeAudio();
    ttsTransport.setVolumeGain(0.5);
    const seen = vi.fn();
    const off = subscribeTts(seen);
    ttsTransport.setVolumeGain(5); // clamped to 1
    expect(getTtsSnapshot().volume).toBe(1);
    expect(seen).toHaveBeenCalledTimes(1);
    ttsTransport.setVolumeGain(1); // no change → no notification
    expect(seen).toHaveBeenCalledTimes(1);
    off();

    ttsTransport.setVolumeGain(0.3);
    ttsTransport.setAudio(fake); // claiming an element applies the current gain
    expect(fake.volume).toBeCloseTo(0.3, 6);
    ttsTransport.setVolumeGain(0.8); // live re-gain while claimed
    expect(fake.volume).toBeCloseTo(0.8, 6);
    ttsTransport.end();
    ttsTransport.setVolumeGain(1);
  });
});

describe('the transport lifecycle mirrors what the sidebar needs', () => {
  beforeEach(() => {
    ttsTransport.end();
    ttsTransport.setVolumeGain(1);
  });
  afterEach(() => ttsTransport.end());

  it('walks loading → playing → end, and end keeps the volume', () => {
    ttsTransport.setVolumeGain(0.64);
    ttsTransport.begin('m1');
    expect(getTtsSnapshot()).toMatchObject({ messageId: 'm1', phase: 'loading', seekable: false });

    ttsTransport.playing({ seekable: false, duration: 0 }); // browser speech
    expect(getTtsSnapshot()).toMatchObject({ phase: 'playing', seekable: false, duration: 0 });
    ttsTransport.seek(5); // no timeline → no-op, no throw
    expect(getTtsSnapshot().currentTime).toBe(0);

    ttsTransport.end();
    expect(getTtsSnapshot()).toMatchObject({ messageId: null, phase: 'idle', seekable: false });
    expect(getTtsSnapshot().volume).toBeCloseTo(0.64, 6); // volume survives a stop
  });

  it('mirrors a claimed audio element: seek clamps to the track', () => {
    const fake = fakeAudio(12);
    ttsTransport.setAudio(fake);
    ttsTransport.playing({ duration: 12, seekable: true });
    expect(getTtsSnapshot()).toMatchObject({ phase: 'playing', seekable: true, duration: 12 });

    ttsTransport.seek(4);
    expect(fake.currentTime).toBeCloseTo(4, 6);
    expect(getTtsSnapshot().currentTime).toBeCloseTo(4, 6);
    ttsTransport.seek(99); // past the end → clamped
    expect(fake.currentTime).toBeCloseTo(12, 6);
    ttsTransport.seek(-3); // before the start → clamped
    expect(fake.currentTime).toBe(0);
  });

  it('reads volume in dB: unity 0, silence -∞', () => {
    expect(formatGainDb(1)).toBe('0.0 dB');
    expect(formatGainDb(0.5)).toBe('-6.0 dB');
    expect(formatGainDb(0.125)).toBe('-18.1 dB');
    expect(formatGainDb(0)).toBe('-∞ dB');
    expect(formatGainDb(-1)).toBe('-∞ dB');
    expect(formatGainDb(Number.NaN)).toBe('-∞ dB');
    // half the cbrt-slider travel really is -18.1 dB, not "13%"
    expect(formatGainDb(sliderToGain(50))).toBe('-18.1 dB');
  });

  it('formats the track head ends', () => {
    expect(formatTtsTime(65)).toBe('1:05');
    expect(formatTtsTime(0)).toBe('0:00');
    expect(formatTtsTime(Number.NaN)).toBe('0:00');
  });
});

describe('volume persists across reloads', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('reads the stored gain on import and writes on change', async () => {
    const setItem = vi.fn();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: vi.fn(() => '0.5'),
        setItem,
      },
    });
    vi.resetModules();
    const fresh = await import('../ui/context/ttsTransport');
    expect(fresh.getTtsSnapshot().volume).toBeCloseTo(0.5, 6);
    expect(fresh.gainToSlider(fresh.getTtsSnapshot().volume)).toBeCloseTo(
      Math.cbrt(0.5) * 100,
      6
    );
    fresh.ttsTransport.setVolumeGain(0.25);
    expect(setItem).toHaveBeenCalledWith('markbrain:ttsVolume', '0.25');
    fresh.ttsTransport.end();
  });
});
