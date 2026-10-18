/**
 * Storage-boundary sanitizer.
 *
 * Firestore's setDoc() REJECTS `undefined` field values when
 * `ignoreUndefinedProperties` is false (the default), and one poisoned
 * document makes every snapshot save fail — silently, because we catch
 * and log the error. The session then looks fine and everything written
 * since the last good save vanishes on reload.
 *
 * JSON semantics are what a document store expects:
 *   - object keys with undefined values are dropped
 *   - undefined array elements become null
 *
 * Call this once at the storage boundary (before setDoc / IndexedDB put),
 * not on individual code paths — future producers of `undefined` are then
 * harmless by construction.
 */
export function sanitizeForStorage<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}