/**
 * A deadline for an operation that may never settle.
 *
 * Why this exists (found live, 2026-10-21): when Firestore's free daily write
 * quota is exhausted, `setDoc` does NOT reject. The client keeps the write in
 * its retry loop with a backoff cap ("Using maximum backoff delay to prevent
 * overloading the backend"), so the promise stays pending forever — which means
 * a `try/catch` around it never runs, the app cannot tell "saved" from "stuck",
 * and the user loses work with no signal at all. The console says plenty; the
 * UI says nothing.
 *
 * The deadline is how a save gets to fail LOUDLY. It does not cancel the
 * underlying operation (Firestore has no per-write abort): the write may still
 * land later, and if it does, it carries exactly the content we already tried
 * to send. We simply stop waiting, and report.
 */

export class DeadlineError extends Error {
  constructor(what: string, ms: number) {
    super(`${what} did not settle within ${ms}ms`);
    this.name = 'DeadlineError';
  }
}

/**
 * Resolves/rejects with `op`, or rejects with a `DeadlineError` after `ms`.
 * The loser of the race is still handled (its rejection handler is attached
 * here), so a late failure can never surface as an unhandled rejection.
 */
export function withDeadline<T>(op: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new DeadlineError(what, ms)), ms);
    op.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}
