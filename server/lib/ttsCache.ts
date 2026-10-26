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
  return crypto.createHash('sha256').update(`${model}|${voice}|${cleanedText}`).digest('hex');
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
    child.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(out));
      else reject(new Error(`ffmpeg exited ${code}: ${Buffer.concat(errChunks).toString('utf8').slice(0, 300)}`));
    });
    child.stdin.write(pcmBuffer);
    child.stdin.end();
  });
}

/** Raw s16le PCM → mono 22,050 Hz Ogg Vorbis (libopus fallback). */
export async function encodePcmToOgg(pcmBuffer: Buffer, sampleRate = 24000): Promise<Buffer> {
  const base = [
    '-hide_banner',
    '-loglevel', 'error',
    '-f', 's16le',
    '-ar', String(sampleRate),
    '-ac', '1',
    '-i', 'pipe:0',
    '-ac', '1',
    '-ar', '22050',
  ];
  try {
    return await runFfmpeg(pcmBuffer, [...base, '-c:a', 'libvorbis', '-qscale:a', '-1', '-f', 'ogg', 'pipe:1']);
  } catch (vorbisErr) {
    try {
      return await runFfmpeg(pcmBuffer, [...base, '-c:a', 'libopus', '-b:a', '16k', '-vbr', 'on', '-f', 'ogg', 'pipe:1']);
    } catch {
      throw vorbisErr; // surface the original: libvorbis missing was the first signal
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

function evictTtsCacheOverflow(): void {
  const db = getDb();
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
