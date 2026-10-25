import type { Express, Request, Response } from 'express';
import { logServer } from '../lib/log';
import { requireModelId } from '../lib/models';
import { aiForRequest, sendVaultError, VaultLockedError, NoKeyError } from '../lib/accountVault';

export function registerTtsRoutes(app: Express): void {
app.post('/api/tts', async (req: Request, res: Response) => {
  try {
    const { text, voice = 'Kore', model } = req.body;
    const ttsModel = requireModelId(model, 'tts');
    if (!text || text.trim().length === 0) {
      return res.status(400).json({ error: 'Text is required for TTS' });
    }

    const ai = aiForRequest(req, 'tts', ttsModel);
    const cleanSpokenText = text
      .replace(/```[\s\S]*?```/g, ' [code specification block omitted] ')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
      .replace(/[#*_~]/g, '')
      .slice(0, 1500); // keep spoken segment crisp

    if (ai) {
      const allowedVoices = ['Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr'];
      const chosenVoice = allowedVoices.includes(voice) ? voice : 'Kore';

      const response = await ai.models.generateContent({
        model: ttsModel,
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: cleanSpokenText,
                speechMetadata: {
                  style: 'Articulate, calm, natural',
                },
              },
            ],
          },
        ],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: chosenVoice },
            },
          },
        },
      });

      const inlineData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData;
      if (inlineData?.data) {
        return res.json({
          audioData: inlineData.data,
          mimeType: inlineData.mimeType || 'audio/wav',
          cleanSpokenText,
        });
      }
    }

    res.json({
      fallback: true,
      cleanSpokenText,
    });
  } catch (err: unknown) {
    if (err instanceof VaultLockedError || err instanceof NoKeyError) return sendVaultError(res, err);
    logServer('error', 'API:TTS', `Error in /api/tts: ${err instanceof Error ? err.message : err}`, err);
    const cleanSpokenText = (req.body.text || '')
      .replace(/```[\s\S]*?```/g, '')
      .slice(0, 1000);
    res.json({ fallback: true, cleanSpokenText });
  }
});
}
