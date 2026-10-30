/**
 * VPS TTS route (design-docs/21F Part B §3): cache-first Ogg.
 *
 * HIT  → stream the cached .ogg, zero Gemini quota, `X-Tts-Cache: HIT`.
 * MISS → Gemini PCM → ffmpeg Ogg → disk → `X-Tts-Cache: MISS`.
 * No ffmpeg / encode failure → legacy JSON PCM fallback (never a 500).
 */
import fs from 'node:fs';
import type { Express, Request, Response } from 'express';
import { logServer } from '../lib/log';
import { requireModelId } from '../lib/models';
import { geminiAiForRequest, sendVaultError, VaultLockedError, NoKeyError } from '../lib/accountVault';
import {
  computeTtsCacheKey,
  getCachedTtsAudio,
  encodePcmToOgg,
  storeCachedTtsAudio,
} from '../lib/ttsCache';
import { cleanTtsText, clampTtsVoice } from '../../shared/prompts/lanes';

const ALLOWED_VOICES = ['Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr'];

/** s16le mono PCM (base64) → a real RIFF/WAV file (base64), 24 kHz. */
function pcmBase64ToWavBase64(pcmB64: string, sampleRate = 24000): string {
  const pcm = Buffer.from(pcmB64, 'base64');
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate (16-bit mono)
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]).toString('base64');
}

function sendOgg(res: Response, filePath: string, cache: 'HIT' | 'MISS'): void {  const stat = fs.statSync(filePath);
  res.setHeader('Content-Type', 'audio/ogg');
  res.setHeader('Content-Length', String(stat.size));
  res.setHeader('X-Tts-Cache', cache);
  fs.createReadStream(filePath).pipe(res);
}

export function registerTtsRoutes(app: Express): void {
  app.post('/api/tts', async (req: Request, res: Response) => {
    const cleanSpokenText = cleanTtsText(String(req.body?.text ?? ''));
    try {
      const { text, voice = 'Kore', model } = req.body;
      if (!text || text.trim().length === 0) {
        return res.status(400).json({ error: 'Text is required for TTS' });
      }
      const ttsModel = requireModelId(model, 'tts');
      const chosenVoice = ALLOWED_VOICES.includes(voice) ? clampTtsVoice(voice) : 'Kore';
      const cacheKey = computeTtsCacheKey(ttsModel, chosenVoice, cleanSpokenText);

      // 1. Disk cache — zero quota.
      const hit = getCachedTtsAudio(cacheKey);
      if (hit) {
        logServer('info', 'TTS:CACHE', `TTS cache HIT (${cacheKey.slice(0, 8)})`);
        return sendOgg(res, hit.filePath, 'HIT');
      }

      // 2. Upstream generate (per-user vault key; 428 when locked).
      const ai = geminiAiForRequest(req, 'tts', ttsModel);
      const response = await ai.models.generateContent({
        model: ttsModel,
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: cleanSpokenText,
                speechMetadata: { style: 'Articulate, calm, natural' },
              },
            ],
          },
        ],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: chosenVoice } } },
        },
      });

      const inlineData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData;
      if (!inlineData?.data) {
        return res.status(502).json({ error: 'The TTS provider returned no audio for this request.' });
      }

      // 3. Re-encode → cache → serve Ogg. Fallback: raw PCM JSON (no ffmpeg).
      try {
        const pcm = Buffer.from(inlineData.data, 'base64');
        const ogg = await encodePcmToOgg(pcm, 24000);
        storeCachedTtsAudio(cacheKey, ttsModel, chosenVoice, ogg);
        logServer('info', 'TTS:CACHE', `TTS cache MISS → stored (${cacheKey.slice(0, 8)}, ${ogg.length}B)`);
        res.setHeader('Content-Type', 'audio/ogg');
        res.setHeader('Content-Length', String(ogg.length));
        res.setHeader('X-Tts-Cache', 'MISS');
        return res.end(ogg);
      } catch (encErr) {
        logServer('warn', 'TTS:ENCODE', `Ogg encode unavailable — serving WAV (${encErr instanceof Error ? encErr.message : encErr})`);
        // Headerless PCM plays 2 seconds of garbage in a browser <audio>. Wrap
        // it in a real RIFF/WAV container so the client caches a valid file.
        return res.json({
          audioData: pcmBase64ToWavBase64(inlineData.data),
          mimeType: 'audio/wav',
          cleanSpokenText,
        });
      }
    } catch (err: unknown) {
      if (err instanceof VaultLockedError || err instanceof NoKeyError) return sendVaultError(res, err);
      logServer('error', 'API:TTS', `Error in /api/tts: ${err instanceof Error ? err.message : err}`, err);
      const status =
        typeof (err as { status?: unknown })?.status === 'number' &&
        (err as { status: number }).status >= 400 &&
        (err as { status: number }).status < 600
          ? (err as { status: number }).status
          : 502;
      const raw = err instanceof Error ? err.message : 'TTS request failed';
      const isQuota = status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(raw);
      return res.status(isQuota ? 429 : status).json({
        error: isQuota
          ? 'TTS quota exhausted for the active API key (429). Switch to a key with TTS quota in Model Settings → Keys, or wait for the quota window to reset.'
          : raw,
      });
    }
  });
}
