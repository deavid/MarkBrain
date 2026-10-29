/**
 * VPS TTS disk cache (design-docs/21F Part B).
 *
 * Gemini TTS answers raw 24kHz s16le mono PCM (~48 KB/s). We re-encode to
 * mono 22,050 Hz Ogg Vorbis (`-qscale:a -1`, ~1/12th the size) through
 * ffmpeg, store `data/tts-cache/<sha256>.ogg` atomically (tmp + rename), and
 * record metadata in the `tts_cache` table. Second listen = 0 quota, ms of
 * transfer. If the local ffmpeg build lacks libvorbis we retry with libopus;
 * if ffmpeg is absent entirely, `encodePcmToOgg` throws and the route falls
 * back to raw PCM JSON (honest degradation, never a 500).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { getDb } from '../db';

export function computeTtsCacheKey(model: string, voice: string, cleanedText: string): string {
  // 'v3' — unclamped text + edge-trimmed encodes (clicks / clipped tail
  // removed, 400ms tail room); the salt orphans older entries so they
  // regenerate clean.
  return crypto.createHash('sha256').update(`v3|${model}|${voice}|${cleanedText}`).digest('hex');
}

export function ttsCacheDir(): string {
  const dir = process.env.MARKBRAIN_TTS_CACHE_DIR || path.resolve(process.cwd(), 'data', 'tts-cache');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export interface CachedTts {
  filePath: string;
  contentType: 'audio/ogg';
}

/** SQLite + filesystem lookup. Updates last_accessed_at on hit. */
export function getCachedTtsAudio(cacheKey: string): CachedTts | null {
  try {
    const row = getDb()
      .prepare('SELECT file_path FROM tts_cache WHERE cache_key = ?')
      .get(cacheKey) as { file_path: string } | undefined;
    if (!row) return null;
    if (!fs.existsSync(row.file_path)) {
      getDb().prepare('DELETE FROM tts_cache WHERE cache_key = ?').run(cacheKey);
      return null;
    }
    getDb().prepare('UPDATE tts_cache SET last_accessed_at = ? WHERE cache_key = ?').run(Date.now(), cacheKey);
    return { filePath: row.file_path, contentType: 'audio/ogg' };
  } catch {
    return null;
  }
}

function runFfmpeg(pcmBuffer: Buffer, args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    const errChunks: Buffer[] = [];
    child.stdout.on('data', (c: Buffer) => out.push(c));
    child.stderr.on('data', (c: Buffer) => errChunks.push(c));
    child.on('error', (err) => reject(err)); // ENOENT when ffmpeg is absent
    // If ffmpeg exits early (bad args / codec error) before draining stdin,
    // Node emits EPIPE on child.stdin — swallow it here so the close handler
    // reports the real stderr instead of crashing the server process.
    child.stdin.on('error', () => {});
    child.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(out));
      else reject(new Error(`ffmpeg exited ${code}: ${Buffer.concat(errChunks).toString('utf8').slice(0, 300)}`));
    });
    child.stdin.write(pcmBuffer);
    child.stdin.end();
  });
}

/**
 * Gemini TTS PCM carries production artifacts (measured on 3 live files,
 * 2026-10-30): 1-3 click transients (peaks ~0.7 FS) inside the pre-speech
 * silence, and a ~120 ms burst of FULL-SCALE clipped white noise after the
 * speech ends. Both are audible: a click on play, static at the end.
 *
 * Trim both by scanning 10 ms windows: the head cuts to the first SUSTAINED
 * speech energy (5 consecutive windows above threshold — a lone click window
 * does not qualify) minus a 20 ms guard; the tail walks backwards past any
 * full-scale noise and trailing silence to the last speech window, then keeps
 * every quiet window up to the noise burst's onset. The head gets 100 ms of
 * digital silence; the TAIL gets 400 ms — speech that hard-stops reads as a
 * cut. (Punctuation hacks — trailing '…' — gamble on the model not SAYING
 * the dots; digital silence is guaranteed.) A file with no detectable speech
 * returns untouched.
 */
export function trimPcmEdges(pcm: Buffer, sampleRate = 24000): Buffer {
  // Int16Array needs a 2-byte-aligned view; a subarray could hand us odd offsets.
  if (pcm.byteOffset % 2 !== 0) pcm = Buffer.from(pcm);
  const bytesPerWin = sampleRate / 100 * 2; // 10 ms of s16le mono
  const n = Math.floor(pcm.length / bytesPerWin);
  if (n < 5) return pcm;

  const window = (i: number): Int16Array =>
    new Int16Array(pcm.buffer, pcm.byteOffset + i * bytesPerWin, bytesPerWin / 2);
  const rms = (i: number): number => {
    const w = window(i);
    let sum = 0;
    for (let j = 0; j < w.length; j++) sum += w[j] * w[j];
    return Math.sqrt(sum / w.length);
  };
  const peak = (i: number): number => {
    const w = window(i);
    let p = 0;
    for (let j = 0; j < w.length; j++) p = Math.max(p, Math.abs(w[j]));
    return p;
  };

  const SPEECH_RMS = 800;      // ≈ -32 dBFS — real voice, not room tone
  const CLIPPED_PEAK = 31000;  // full-scale noise burst marker

  // Head: first run of 5 consecutive speech windows (a click is 1-2).
  let start = 0;
  outer: for (let i = 0; i < n - 5; i++) {
    for (let j = 0; j < 5; j++) {
      if (rms(i + j) < SPEECH_RMS) continue outer;
    }
    start = i;
    break;
  }
  // Tail: walk back past clipped noise and silence to the last speech window.
  let end = n - 1;
  while (end > start && (peak(end) >= CLIPPED_PEAK || rms(end) < SPEECH_RMS)) end--;
  // Then keep every quiet window after it — but stop dead at the noise
  // burst's first clipped window (never re-include what we walked past).
  let toWin = n;
  for (let i = end + 1; i < n; i++) {
    if (peak(i) >= CLIPPED_PEAK) {
      toWin = i;
      break;
    }
  }

  const from = Math.max(0, (start - 2) * bytesPerWin);           // 20 ms guard
  const to = Math.min(pcm.length, toWin * bytesPerWin);
  if (to - from < bytesPerWin * 5) return pcm;                   // nothing left

  const padHead = Buffer.alloc(sampleRate / 10 * 2, 0);          // 100 ms
  const padTail = Buffer.alloc(sampleRate / 10 * 4, 0);          // 400 ms
  return Buffer.concat([padHead, pcm.subarray(from, to), padTail]);
}

/** Raw s16le PCM → mono Ogg. Opus 16k VBR @ 24 kHz first (Opus requires
 *  8/12/16/24/48 kHz — 22050 Hz is rejected by libopus), Vorbis @ 22,050 Hz
 *  fallback for ffmpeg builds without libopus. Same .ogg container either way.
 *  Edge artifacts (leading clicks, trailing clipped noise) are trimmed first. */
export async function encodePcmToOgg(pcmBuffer: Buffer, sampleRate = 24000): Promise<Buffer> {
  const trimmed = trimPcmEdges(pcmBuffer, sampleRate);
  const inputArgs = [
    '-hide_banner',
    '-loglevel', 'error',
    '-f', 's16le',
    '-ar', String(sampleRate),
    '-ac', '1',
    '-i', 'pipe:0',
    '-ac', '1',
  ];
  try {
    return await runFfmpeg(pcmBuffer, [
      ...inputArgs,
      '-ar', '24000',
      '-c:a', 'libopus',
      '-b:a', '16k',
      '-vbr', 'on',
      '-f', 'ogg',
      'pipe:1',
    ]);
  } catch (opusErr) {
    try {
      return await runFfmpeg(pcmBuffer, [
        ...inputArgs,
        '-ar', '22050',
        '-c:a', 'libvorbis',
        '-qscale:a', '-1',
        '-f', 'ogg',
        'pipe:1',
      ]);
    } catch {
      throw opusErr; // surface the original: libopus missing was the first signal
    }
  }
}

/**
 * Cache ceiling (audit 26 M4): every distinct text writes a new .ogg forever,
 * which is a slow authenticated disk-fill. Evict least-recently-used entries
 * past a byte budget. Generous defaults: hundreds of hours of speech.
 */
const TTS_CACHE_MAX_BYTES = parseInt(process.env.MARKBRAIN_TTS_CACHE_MAX_BYTES || '', 10) || 500 * 1024 * 1024;
const TTS_CACHE_MAX_FILES = parseInt(process.env.MARKBRAIN_TTS_CACHE_MAX_FILES || '', 10) || 5000;
/** Age ceiling: an entry nobody touched for 30 days is gone, budget or not. */
const TTS_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function evictTtsCacheOverflow(): void {
  const db = getDb();
  // TTL first (runs on every store — a lazy sweep, no timers): entries not
  // accessed for 30 days die even when the byte budget is far from full.
  const ttlCutoff = Date.now() - TTS_CACHE_TTL_MS;
  const expired = db
    .prepare('SELECT cache_key, file_path FROM tts_cache WHERE last_accessed_at < ?')
    .all(ttlCutoff) as { cache_key: string; file_path: string }[];
  for (const v of expired) {
    try {
      fs.unlinkSync(v.file_path);
    } catch {
      /* already gone is fine */
    }
  }
  if (expired.length > 0) {
    const delExpired = db.prepare('DELETE FROM tts_cache WHERE cache_key = ?');
    for (const v of expired) delExpired.run(v.cache_key);
  }

  const totals = db
    .prepare('SELECT COALESCE(SUM(byte_size), 0) AS totalBytes, COUNT(*) AS totalFiles FROM tts_cache')
    .get() as { totalBytes: number; totalFiles: number };
  if (totals.totalBytes <= TTS_CACHE_MAX_BYTES && totals.totalFiles <= TTS_CACHE_MAX_FILES) return;

  // Delete least-recently-used entries until both budgets hold again.
  const victims = db
    .prepare(
      `SELECT cache_key, file_path, byte_size FROM tts_cache
       ORDER BY last_accessed_at ASC, created_at ASC`
    )
    .all() as { cache_key: string; file_path: string; byte_size: number }[];
  const del = db.prepare('DELETE FROM tts_cache WHERE cache_key = ?');
  let bytes = totals.totalBytes;
  let files = totals.totalFiles;
  for (const v of victims) {
    if (bytes <= TTS_CACHE_MAX_BYTES && files <= TTS_CACHE_MAX_FILES) break;
    try {
      fs.unlinkSync(v.file_path);
    } catch {
      /* already gone is fine */
    }
    del.run(v.cache_key);
    bytes -= v.byte_size;
    files -= 1;
  }
}

/** Atomic write: `.tmp` → rename, then upsert the metadata row. */
export function storeCachedTtsAudio(cacheKey: string, model: string, voice: string, oggBuffer: Buffer): string {
  const dir = ttsCacheDir();
  const finalPath = path.join(dir, `${cacheKey}.ogg`);
  const tmpPath = `${finalPath}.tmp`;
  fs.writeFileSync(tmpPath, oggBuffer);
  fs.renameSync(tmpPath, finalPath);
  getDb()
    .prepare(
      `INSERT INTO tts_cache (cache_key, model, voice, file_path, byte_size, created_at, last_accessed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(cache_key) DO UPDATE SET file_path = excluded.file_path,
         byte_size = excluded.byte_size, last_accessed_at = excluded.last_accessed_at`
    )
    .run(cacheKey, model, voice, finalPath, oggBuffer.length, Date.now(), Date.now());
  evictTtsCacheOverflow();
  return finalPath;
}
