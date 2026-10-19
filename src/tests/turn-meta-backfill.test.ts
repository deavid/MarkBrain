/**
 * M2 regression suite — legacy turn meta backfill during snapshot hydration.
 *
 * Pre-collapse turns stored `durationMs` (domain `latencyMs` had no writer)
 * and older writers used `promptTokens`/`candidatesTokens`. ChatView reads
 * `meta.latencyMs` / `inputTokens` / `outputTokens`, so hydrateSnapshot must
 * rename legacy keys into missing canonical targets — across the top-level
 * `turns` AND turns embedded in `threads` entries — with ONE aggregated
 * WARN per load. Existing canonical values are never overwritten.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { hydrateSnapshot } from '../services/stores/hydrate';
import { logger } from '../utils/logger';
import type { ProjectSnapshot } from '../services/stores/projectStore';

const baseSnap = (over: Partial<ProjectSnapshot> = {}): ProjectSnapshot => ({
  projectId: 'p1',
  turns: [],
  chapters: [],
  artifacts: [],
  edges: [],
  updatedAt: 1,
  ...over,
});

const turn = (id: string, meta: Record<string, any> | undefined) => ({
  id,
  role: 'assistant' as const,
  content: 'x',
  timestamp: 1,
  ...(meta !== undefined ? { meta } : {}),
});

describe('hydrateSnapshot — legacy turn meta backfill', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renames durationMs/promptTokens/candidatesTokens into missing canonical targets', () => {
    const out = hydrateSnapshot(
      baseSnap({ turns: [turn('t1', { durationMs: 420, promptTokens: 10, candidatesTokens: 20 })] } as any)
    );
    const meta = (out.turns as any[])[0].meta;
    expect(meta.latencyMs).toBe(420);
    expect(meta.inputTokens).toBe(10);
    expect(meta.outputTokens).toBe(20);
    // legacy keys ride along untouched (no storage rewrite)
    expect(meta.durationMs).toBe(420);
    expect(meta.promptTokens).toBe(10);
    expect(meta.candidatesTokens).toBe(20);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0]?.[1])).toMatch(/Backfilled 1\/1 turns/);
  });

  it('never overwrites canonical values that already exist', () => {
    const out = hydrateSnapshot(
      baseSnap({
        turns: [
          turn('t1', { latencyMs: 100, durationMs: 999, inputTokens: 5, outputTokens: 7, promptTokens: 1, candidatesTokens: 2 }),
        ],
      } as any)
    );
    const meta = (out.turns as any[])[0].meta;
    expect(meta.latencyMs).toBe(100);
    expect(meta.inputTokens).toBe(5);
    expect(meta.outputTokens).toBe(7);
    expect(warnSpy).not.toHaveBeenCalled(); // nothing healed → no warn
  });

  it('heals only the missing targets (partial backfill)', () => {
    const out = hydrateSnapshot(
      baseSnap({ turns: [turn('t1', { latencyMs: 50, candidatesTokens: 33 })] } as any)
    );
    const meta = (out.turns as any[])[0].meta;
    expect(meta.latencyMs).toBe(50); // untouched
    expect(meta.outputTokens).toBe(33); // filled
    expect(meta.inputTokens).toBeUndefined(); // no source → stays missing
  });

  it('copies zero-valued legacy sources (0 is a value, not absence)', () => {
    const out = hydrateSnapshot(baseSnap({ turns: [turn('t1', { durationMs: 0 })] } as any));
    expect((out.turns as any[])[0].meta.latencyMs).toBe(0);
  });

  it('covers top-level turns AND turns embedded in threads with ONE aggregated warn', () => {
    const out = hydrateSnapshot(
      baseSnap({
        turns: [turn('t1', { durationMs: 10 })],
        threads: [
          {
            id: 'thread-a',
            folderId: null,
            title: 'Main',
            titleState: 'auto',
            titleVersion: 2,
            createdAt: 1,
            updatedAt: 1,
            lastActivityAt: 1,
            lifecycle: 'active',
            lastOutcome: 'ok',
            preview: '',
            turns: [turn('t2', { durationMs: 20, promptTokens: 4 })],
          },
        ],
      } as any)
    );
    expect((out.turns as any[])[0].meta.latencyMs).toBe(10);
    const embedded = ((out.threads as any[])[0].turns as any[])[0];
    expect(embedded.meta.latencyMs).toBe(20);
    expect(embedded.meta.inputTokens).toBe(4);

    expect(warnSpy).toHaveBeenCalledTimes(1); // one aggregated warn per load
    expect(String(warnSpy.mock.calls[0]?.[1])).toMatch(/Backfilled 2\/2 turns/);
  });

  it('leaves modern turns and meta-less turns untouched, no warn', () => {
    const modern = turn('t1', { latencyMs: 10, inputTokens: 1, outputTokens: 2 });
    const bare = turn('t2', undefined);
    const out = hydrateSnapshot(baseSnap({ turns: [modern, bare] } as any));
    expect((out.turns as any[])[0]).toBe(modern); // same reference — not rebuilt
    expect((out.turns as any[])[1]).toBe(bare);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('keeps the artifacts backfill behavior intact alongside meta healing', () => {
    const out = hydrateSnapshot(
      baseSnap({
        artifacts: [{ id: 'a1', title: 'Legacy', description: 'flat', summary: 's' }],
        turns: [turn('t1', { durationMs: 5 })],
      } as any)
    );
    const artifactWarns = warnSpy.mock.calls.filter((c: unknown[]) => String(c[1]).includes('artifacts'));
    const turnWarns = warnSpy.mock.calls.filter((c: unknown[]) => String(c[1]).includes('turns'));
    expect(artifactWarns).toHaveLength(1); // existing per-load aggregation preserved
    expect(turnWarns).toHaveLength(1);
    expect((out.artifacts as any)[0].current.t1_abstract).toBe('flat'); // legacy flat → tier mapping intact
  });
});