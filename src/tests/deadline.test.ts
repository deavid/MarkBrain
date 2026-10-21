/**
 * The watchdog: an operation that never settles must still fail loudly.
 *
 * `withDeadline` itself is trivial; what is worth testing is that the app's
 * two data paths use it, because the failure it guards against is INVISIBLE by
 * construction — a Firestore write stuck in its retry loop (quota exhausted)
 * never rejects, so without a deadline nothing downstream ever runs.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DeadlineError, withDeadline } from '../utils/deadline';

describe('withDeadline', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('passes a settled value straight through', async () => {
    await expect(withDeadline(Promise.resolve('landed'), 1000, 'the save')).resolves.toBe('landed');
  });

  it('passes a real failure through untouched — the deadline is not a mask', async () => {
    const boom = new Error('permission-denied');
    await expect(withDeadline(Promise.reject(boom), 1000, 'the save')).rejects.toBe(boom);
  });

  it('fails an operation that never settles', async () => {
    const hung = withDeadline(new Promise<never>(() => {}), 15_000, 'the save of p1');
    const assertion = expect(hung).rejects.toBeInstanceOf(DeadlineError);
    await vi.advanceTimersByTimeAsync(15_001);
    await assertion;
    await expect(hung).rejects.toThrow(/the save of p1 did not settle within 15000ms/);
  });

  it('leaves no timer behind when the operation wins the race', async () => {
    await withDeadline(Promise.resolve(1), 15_000, 'the save');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('handles a late rejection, so a stuck write cannot crash the app twice', async () => {
    let rejectLate: (e: unknown) => void = () => {};
    const late = new Promise<never>((_, reject) => {
      rejectLate = reject;
    });
    const hung = withDeadline(late, 1000, 'the save');
    const assertion = expect(hung).rejects.toBeInstanceOf(DeadlineError);
    await vi.advanceTimersByTimeAsync(1001);
    await assertion;
    // The write the deadline gave up on rejects afterwards — attached handler,
    // so this is not an unhandled rejection.
    rejectLate(new Error('resource-exhausted, eventually'));
    await vi.advanceTimersByTimeAsync(10);
    expect(vi.getTimerCount()).toBe(0);
  });
});
