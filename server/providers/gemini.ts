import { GoogleGenAI } from '@google/genai';
import { logServer } from '../lib/log';

const apiKey = process.env.GEMINI_API_KEY;
export let ai: GoogleGenAI | null = null;
if (apiKey) {
  ai = new GoogleGenAI();
  logServer('success', 'GEMINI:INIT', `Gemini SDK initialized successfully with API key (length: ${apiKey.length})`);
} else {
  logServer('warn', 'GEMINI:INIT', 'GEMINI_API_KEY not found in environment; running in local synthesis fallback mode');
}

export async function streamFromModel(
  modelName: string,
  contents: string,
  systemInstruction: string,
  reqId: number
) {
  logServer('info', 'GEMINI:STREAM_CALL', `#${reqId} Calling ai.models.generateContentStream(${modelName})`);
  return await ai!.models.generateContentStream({
    model: modelName,
    contents,
    config: {
      systemInstruction,
      temperature: 0.7,
    },
  });
}
