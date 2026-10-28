/**
 * The red banner: the only path from "the cloud save failed" to "the user
 * knows". The console keeps the specifics; the notice carries one sentence and
 * dies on its own.
 *
 * Two things are tested here: the store's behavior (dedupe, TTL, cap) and the
 * WIRING — a channel nobody reports into is worse than no channel, because it
 * looks like coverage.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  NOTICE_TTL_MS,
  dismissCritical,
  getCriticalNotices,
  notifyCritical,
  resetCriticalNotices,
  subscribeCriticalNotices,
} from '../utils/criticalNotifications';
import { persistProjectSnapshot } from '../application/persistWorker';
import type { PersistDeps } from '../application/persistWorker';
import { loadProjectSnapshotIntoDomains } from '../application/snapshotLoader';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

describe('critical notifications', () => {
  beforeEach(() => {
    resetCriticalNotices();
    vi.useFakeTimers();
  });
  afterEach(() => {
    resetCriticalNotices();
    vi.useRealTimers();
  });

  it('turns a failure into exactly one visible notice', () => {
    notifyCritical('Could not save to the cloud.');
    const notices = getCriticalNotices();
    expect(notices).toHaveLength(1);
    expect(notices[0].message).toBe('Could not save to the cloud.');
    expect(notices[0].at).toBeGreaterThan(0);
  });

  it('refreshes the clock instead of stacking the same failure', () => {
    notifyCritical('Could not save to the cloud.');
    const first = getCriticalNotices()[0];
    vi.advanceTimersByTime(1000);
    notifyCritical('Could not save to the cloud.');
    const again = getCriticalNotices();
    expect(again).toHaveLength(1);
    expect(again[0].id).toBe(first.id);
    expect(again[0].at).toBeGreaterThanOrEqual(first.at);
  });

  it('is ephemeral: it leaves on its own, with nobody dismissing it', () => {
    notifyCritical('Could not save to the cloud.');
    vi.advanceTimersByTime(NOTICE_TTL_MS - 1);
    expect(getCriticalNotices()).toHaveLength(1);
    vi.advanceTimersByTime(2);
    expect(getCriticalNotices()).toHaveLength(0);
  });

  it('notifies subscribers on arrival and on dismissal', () => {
    const seen: number[] = [];
    const unsubscribe = subscribeCriticalNotices(() => seen.push(getCriticalNotices().length));
    notifyCritical('Could not load this project.');
    dismissCritical(getCriticalNotices()[0].id);
    unsubscribe();
    notifyCritical('After unsubscribe');
    expect(seen).toEqual([1, 0]);
    expect(getCriticalNotices()).toHaveLength(1);
  });

  it('never stacks a wall of banners', () => {
    for (let i = 0; i < 5; i++) notifyCritical(`Failure ${i}`);
    expect(getCriticalNotices()).toHaveLength(3);
    expect(getCriticalNotices().map((n) => n.message)).toEqual([
      'Failure 2',
      'Failure 3',
      'Failure 4',
    ]);
  });

  it('ignores empty messages — a notice is a sentence or it is nothing', () => {
    notifyCritical('   ');
    expect(getCriticalNotices()).toHaveLength(0);
  });

  it('is reported into by the two failures that silently eat work', () => {
    // A failed SAVE and a failed LOAD. Both used to be console-only.
    const persist = read('src/application/persistWorker.ts');
    expect(persist).toContain(
      "notifyCritical('Could not save to the cloud — changes made now may be lost when you reload.')"
    );
    expect(persist).toContain("logger.error('DomainRegistry', 'Persistence failed', err)");

    const loader = read('src/application/snapshotLoader.ts');
    expect(loader).toContain("notifyCritical('Could not load this project from the cloud");

    // …and the banner is actually mounted, on every branch that can show a project.
    const app = read('src/App.tsx');
    expect(app.match(/<CriticalNotifications \/>/g)?.length).toBe(3);
  });

  it('carries no error object: the console owns the specifics', () => {
    // The store's only entry point takes a string. If a stack ever needs a
    // home, it goes to logger.error — never into the banner.
    expect(notifyCritical.length).toBe(1);
  });
});

/**
 * The wiring, driven for real: the app layer's two data paths, with the
 * failures that used to be console-only. This is the half a source-string
 * assertion cannot prove — that the catch actually runs and the banner actually
 * gets a message.
 */
describe('the app layer reports its failures', () => {
  beforeEach(() => resetCriticalNotices());
  afterEach(() => resetCriticalNotices());

  const persistDeps = (saveProjectSnapshot: PersistDeps['saveProjectSnapshot']) =>
    ({
      workspace: {
        getActiveProjectId: () => 'p1',
        getProject: () => ({ metadata: { name: 'P', codeName: 'P', description: '', color: '#000' } }),
      },
      timeline: { getTurns: () => [] },
      segmentation: { listChapters: () => [] },
      artifacts: { listArtifacts: () => [] },
      graph: { listEdges: () => [] },
      // Package 1: revisions ride the snapshot payload.
      versioning: { getAllRevisions: () => ({}) },
      threadRegistry: {
        compose: () => ({ turns: [], chapters: [], threads: [], folders: [], activeThreadId: 'th1' }),
      },
      hydratedRef: { current: true },
      saveProjectSnapshot,
      isCaptureMode: () => false,
    }) as unknown as PersistDeps;

  it('a failed save raises exactly one notice, in the user’s words', async () => {
    await persistProjectSnapshot(
      persistDeps(() => Promise.reject(new Error('the save of p1 did not settle within 15000ms')))
    );
    expect(getCriticalNotices().map((n) => n.message)).toEqual([
      'Could not save to the cloud — changes made now may be lost when you reload.',
    ]);
  });

  it('a failed load says nothing was overwritten, because nothing was', async () => {
    const deps = {
      activeProjectId: 'p1',
      loadProjectSnapshot: () => Promise.reject(new Error('unavailable')),
      threadRegistry: {},
      timeline: {},
      segmentation: {},
      artifacts: {},
      graph: {},
      hydratedRef: { current: false },
    };
    loadProjectSnapshotIntoDomains(deps as never);
    await new Promise((r) => setTimeout(r, 0)); // the loader is fire-and-forget
    expect(getCriticalNotices().map((n) => n.message)).toEqual([
      'Could not load this project from the cloud — nothing was overwritten. Reload to try again.',
    ]);
  });

  it('a save that succeeds, and a save blocked before hydration, stay quiet', async () => {
    await persistProjectSnapshot(persistDeps(() => Promise.resolve()));
    expect(getCriticalNotices()).toHaveLength(0);

    const blocked = persistDeps(() => Promise.resolve());
    (blocked as unknown as { hydratedRef: { current: boolean } }).hydratedRef.current = false;
    await persistProjectSnapshot(blocked);
    expect(getCriticalNotices()).toHaveLength(0); // expected on boot: a warn, not a banner
  });

  it('a crash while assembling the payload is reported, and not blamed on the cloud', async () => {
    const broken = persistDeps(() => Promise.resolve());
    (broken as unknown as { timeline: { getTurns: () => never } }).timeline = {
      getTurns: () => {
        throw new Error('client bug');
      },
    };
    await persistProjectSnapshot(broken);
    const notices = getCriticalNotices();
    expect(notices).toHaveLength(1);
    expect(notices[0].message).toBe(
      'Could not save your work — changes made now may be lost when you reload.'
    );
    expect(notices[0].message).not.toMatch(/cloud/);
  });
});
