import type { Express, Request, Response } from 'express';
import { ai } from '../providers/gemini';
import { logServer } from '../lib/log';
import { estimateTokens } from '../lib/tokens';

export function registerSummarizeRoutes(app: Express): void {
// API: Summarize a Chapter
app.post('/api/summarize-chapter', async (req: Request, res: Response) => {
  try {
    const { title, messages = [] } = req.body;

    if (!messages || messages.length === 0) {
      return res.json({
        description: `An empty chapter${title ? ` titled "${title}"` : ''}.`,
        summary: '',
      });
    }

    const conversationTranscript = messages
      .map((m: { role: string; content: string }) => `${m.role}: ${m.content}`)
      .join('\n');

    let descriptionText = '';
    let summaryText = '';

    if (ai) {
      const prompt = `Summarize the following conversation chapter titled "${title}".
The two texts are LAYERS of one recap and are read together — the summary continues the description, it does not restate it.

Provide:
1. DESCRIPTION: 1-2 sentences — what this chapter is about.
2. SUMMARY: several paragraphs — what was actually discussed, decided, and left open. Do not repeat the description.

Output format (exactly):
DESCRIPTION: [1-2 sentences]
SUMMARY: [several paragraphs]

Transcript:
${conversationTranscript}`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.5-flash-lite',
        contents: prompt,
        config: {
          temperature: 0.3,
        },
      });

      const raw = response.text || '';
      const descMatch = raw.match(/DESCRIPTION:\s*([\s\S]*?)(?=SUMMARY:|$)/i);
      const summaryMatch = raw.match(/SUMMARY:\s*([\s\S]*)$/i);
      descriptionText = descMatch ? descMatch[1].trim() : '';
      summaryText = summaryMatch ? summaryMatch[1].trim() : '';
      // Failure-tolerant: if the model ignored the labels, keep its text as the
      // summary rather than losing it, and let the description stay empty.
      if (!summaryText) summaryText = raw.trim().slice(0, 2000);
    } else {
      descriptionText = `Chapter: ${title}.`;
      summaryText = 'No API key set — this recap is a placeholder, not a real one.';
    }

    res.json({
      description: descriptionText,
      summary: summaryText,
      tokens: estimateTokens(descriptionText + summaryText),
    });
  } catch (err: unknown) {
    logServer('error', 'API:SUMMARIZE', `Error in /api/summarize-chapter: ${err instanceof Error ? err.message : err}`, err);
    const errorMessage = err instanceof Error ? err.message : 'Summarization error';
    res.status(500).json({ error: errorMessage });
  }
});
}
