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
import { aiForRequest, sendVaultError, VaultLockedError, NoKeyError } from '../lib/accountVault';
import {
  computeTtsCacheKey,
  getCachedTtsAudio,
  encodePcmToOgg,
  storeCachedTtsAudio,
} from '../lib/ttsCache';
import { cleanTtsText, clampTtsVoice } from '../../src/prompts/lanes';

const ALLOWED_VOICES = ['Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr'];

function sendOgg(res: Response, filePath: string, cache: 'HIT' | 'MISS'): void {
  const stat = fs.statSync(filePath);
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
      const ai = aiForRequest(req, 'tts', ttsModel);
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
        return res.json({ fallback: true, cleanSpokenText });
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
        logServer('warn', 'TTS:ENCODE', `Ogg encode unavailable — serving raw PCM JSON (${encErr instanceof Error ? encErr.message : encErr})`);
        return res.json({
          audioData: inlineData.data,
          mimeType: inlineData.mimeType || 'audio/L16;rate=24000',
          cleanSpokenText,
        });
      }
    } catch (err: unknown) {
      if (err instanceof VaultLockedError || err instanceof NoKeyError) return sendVaultError(res, err);
      logServer('error', 'API:TTS', `Error in /api/tts: ${err instanceof Error ? err.message : err}`, err);
      res.json({ fallback: true, cleanSpokenText });
    }
  });
}
