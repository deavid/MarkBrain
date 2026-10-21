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
