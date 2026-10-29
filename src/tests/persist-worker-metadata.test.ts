/**
 * The persist worker saves when a domain emits. Regression (2026-10-29):
 * the worker subscribed to timeline/artifacts/chapters/graph/threads but
 * NOT the workspace domain — so a project RENAME (projectMetaChanged, the
 * only event a metadata edit emits) sat in RAM and died on refresh.
 */
import { describe, it, expect, vi } from 'vitest';
import { attachPersistWorker } from '../application/persistWorker';
import type { PersistWorkerDeps } from '../application/persistWorker';

function stubDomain() {
  const subs = new Set<() => void>();
  return {
    subscribe: (cb: () => void) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    emit: () => subs.forEach((fn) => fn()),
  };
}

function stubDeps() {
  const domains = [stubDomain(), stubDomain(), stubDomain(), stubDomain(), stubDomain()];
  const persistState = vi.fn();
  const deps = {
    workspace: stubDomain(),
    timeline: domains[0],
    segmentation: domains[1],
    artifacts: domains[2],
    graph: domains[3],
    threadRegistry: domains[4],
    persistState,
  } as unknown as PersistWorkerDeps & { workspace: ReturnType<typeof stubDomain>; persistState: () => void };
  return { deps, workspace: deps.workspace as ReturnType<typeof stubDomain>, persistState };
}

describe('persist worker — workspace domain triggers saves', () => {
  it('a projectMetaChanged emit (a rename) schedules the debounced save', async () => {
    vi.useFakeTimers();
    const noop = () => {};
    vi.stubGlobal('window', { addEventListener: noop, removeEventListener: noop });
    vi.stubGlobal('document', { visibilityState: 'visible', addEventListener: noop, removeEventListener: noop });
    const { deps, workspace, persistState } = stubDeps();
    const cleanup = attachPersistWorker(deps);

    workspace.emit(); // rename / description / color / capabilities
    await vi.advanceTimersByTimeAsync(600); // debounce is 500ms
    expect(persistState).toHaveBeenCalledTimes(1);

    cleanup();

    workspace.emit(); // after teardown: no saves from a dead subscription
    await vi.advanceTimersByTimeAsync(600);
    expect(persistState).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('ignores domain emits while hydratedRef.current is false (hydration / delta merge)', async () => {
    vi.useFakeTimers();
    const noop = () => {};
    vi.stubGlobal('window', { addEventListener: noop, removeEventListener: noop });
    vi.stubGlobal('document', { visibilityState: 'visible', addEventListener: noop, removeEventListener: noop });
    const { deps, workspace, persistState } = stubDeps();
    const hydratedRef = { current: false };
    deps.hydratedRef = hydratedRef;
    const cleanup = attachPersistWorker(deps);

    workspace.emit(); // fired during hydration or mergeDeltaIntoDomains
    hydratedRef.current = true; // hydration finishes BEFORE the 500ms timer would fire
    await vi.advanceTimersByTimeAsync(600);
    expect(persistState).toHaveBeenCalledTimes(0);

    workspace.emit(); // real user mutation after hydration
    await vi.advanceTimersByTimeAsync(600);
    expect(persistState).toHaveBeenCalledTimes(1);

    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('encodePcmToOgg produces a real Opus Ogg buffer at 24 kHz without EPIPE', async () => {
    const { encodePcmToOgg } = await import('../../server/lib/ttsCache');
    // 1 second of 24 kHz 16-bit mono silence (48,000 bytes)
    const pcm = Buffer.alloc(24000 * 2, 0);
    const ogg = await encodePcmToOgg(pcm, 24000);
    expect(ogg.subarray(0, 4).toString('ascii')).toBe('OggS');
    expect(ogg.length).toBeGreaterThan(64);
    expect(ogg.length).toBeLessThan(pcm.length);
  });

  it('trimPcmEdges removes the leading clicks and the trailing clipped-noise burst', async () => {
    const { trimPcmEdges } = await import('../../server/lib/ttsCache');
    const sr = 24000;
    const ms = (n: number) => Buffer.from(
      Array.from({ length: Math.floor(sr * n / 1000) }, () => 0).flatMap(() => [])
    );
    // Build: 30ms click (spike) + 500ms silence + 1s "speech" (440Hz sine,
    // RMS well above threshold, peak ~20k — never clipping) + 120ms
    // full-scale noise + 100ms silence.
    const parts: Buffer[] = [];
    const click = Buffer.alloc(sr * 30 / 1000 * 2);
    click.writeInt16LE(20000, 0);
    click.writeInt16LE(-18000, 400);
    parts.push(click, Buffer.alloc(sr * 500 / 1000 * 2));
    const speech = Buffer.alloc(sr * 1000 / 1000 * 2);
    for (let i = 0; i < sr; i++) speech.writeInt16LE(Math.round(Math.sin(i * 440 * 2 * Math.PI / sr) * 12000), i * 2);
    parts.push(speech);
    const noise = Buffer.alloc(sr * 120 / 1000 * 2);
    for (let i = 0; i < noise.length / 2; i++) noise.writeInt16LE(((i * 7919) % 65536) - 32768, i * 2);
    parts.push(noise, Buffer.alloc(sr * 100 / 1000 * 2));
    const pcm = Buffer.concat(parts);

    const out = trimPcmEdges(pcm, sr);
    // Expect: 100ms head pad + speech (with guards) + 400ms tail pad — the
    // click (pre-speech) and the noise (post-speech) must be gone.
    const outLen = out.length;
    expect(outLen).toBeGreaterThan(sr * 0.9 * 2);
    expect(outLen).toBeLessThan(sr * 1.8 * 2);
    // No clipped samples survive in the output.
    const words = new Int16Array(out.buffer, out.byteOffset, out.length / 2);
    let clipped = 0;
    for (let i = 0; i < words.length; i++) if (Math.abs(words[i]) >= 31000) clipped++;
    expect(clipped).toBe(0);
    // The head 100ms is the silence pad.
    const head = new Int16Array(out.buffer, out.byteOffset, sr / 10);
    expect(head.every((v) => v === 0)).toBe(true);
  });
});
