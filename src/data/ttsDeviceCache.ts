/**
 * TTS (read-aloud) — server-cache + device-cache, the two-click law:
 * click 1 → the server generates (quota) or re-serves (disk cache HIT)
 * an Opus .ogg, and the client stores it in the device IndexedDB;
 * click 2 → plays the device blob with ZERO network calls.
 *
 * The device key is the sha-256 of the EXACT text the server spoke
 * (`cleanTtsText`), not the raw markdown turn: markdown artifacts (`*`,
 * backticks, links) change nothing in what is spoken, and hashing the raw
 * text makes the stored entry unreachable on playback.
 */
const DB_NAME = 'markbrain-tts-audio';
const STORE = 'audio';

import { cleanTtsText } from '../prompts/lanes';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

/** sha-256 hex of v5|model|voice|SPOKEN text — the device-side cache key.
 * The spoken text is the markdown-stripped text the server actually turns
 * into audio (cleanTtsText) — hashing the raw turn markdown would make the
 * stored entry unreachable on playback. */
export async function ttsDeviceKey(model: string, voice: string, text: string): Promise<string> {
  const data = new TextEncoder().encode(`v6|${model}|${voice}|${cleanTtsText(text)}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function isCorruptHeaderlessBlob(blob: Blob): boolean {
  // Pre-Opus/pre-WAV entries were stored with mimeType "audio/L16;rate=24000"
  // or empty type. A browser <audio> element cannot play raw L16 PCM and stops
  // after ~2-3 seconds.
  const t = (blob.type || '').toLowerCase();
  return !t || t.includes('l16') || t.includes('pcm');
}

export async function getCachedTtsBlob(key: string): Promise<Blob | null> {
  try {
    const row = await withStore<{ key: string; blob: Blob } | undefined>('readonly', (s) => s.get(key));
    if (!row || isCorruptHeaderlessBlob(row.blob)) return null;
    void withStore('readwrite', (s) => s.put({ key, blob: row.blob, lastAccess: Date.now() })).catch(() => {});
    return row.blob;
  } catch {
    return null; // no IDB (private mode?) — the caller falls back to direct play
  }
}

export async function storeTtsAudio(key: string, blob: Blob): Promise<void> {
  await withStore('readwrite', (s) => s.put({ key, blob, lastAccess: Date.now() }));
}

export async function hasCachedTts(key: string): Promise<boolean> {
  try {
    const row = await withStore<{ key: string; blob: Blob } | undefined>('readonly', (s) => s.get(key));
    return row !== undefined && !isCorruptHeaderlessBlob(row.blob);
  } catch {
    return false;
  }
}
