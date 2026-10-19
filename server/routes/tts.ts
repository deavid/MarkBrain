import type { Express, Request, Response } from 'express';
import { ai } from '../providers/gemini';
import { logServer } from '../lib/log';

export function registerTtsRoutes(app: Express): void {
// API: Text-to-Speech (TTS) using gemini-3.8-flash-lite-tts
app.post('/api/tts', async (req: Request, res: Response) => {
  try {
    const { text, voice = 'Kore' } = req.body;
    if (!text || text.trim().length === 0) {
      return res.status(400).json({ error: 'Text is required for TTS' });
    }

    // Clean markdown code blocks / markdown links to make spoken audio fluid
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
        model: 'gemini-3.8-flash-lite-tts',
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

    // Fallback indicator so client can use Web Speech API
    res.json({
      fallback: true,
      cleanSpokenText,
    });
  } catch (err: unknown) {
    logServer('error', 'API:TTS', `Error in /api/tts: ${err instanceof Error ? err.message : err}`, err);
    // Return fallback: true so client seamlessly plays via Web Speech API
    const cleanSpokenText = (req.body.text || '')
      .replace(/```[\s\S]*?```/g, '')
      .slice(0, 1000);
    res.json({ fallback: true, cleanSpokenText });
  }
});
}
