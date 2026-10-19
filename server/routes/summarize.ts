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
        summary: `Empty chapter on ${title || 'Topic'}`,
        keyPoints: [],
      });
    }

    const conversationTranscript = messages
      .map((m: { role: string; content: string }) => `${m.role}: ${m.content}`)
      .join('\n');

    let summaryText = '';
    let keyPoints: string[] = [];

    if (ai) {
      const prompt = `Summarize the following conversation chapter titled "${title}".
Provide:
1. A short summary (2-3 sentences) capturing what was actually discussed and decided.
2. Up to 4 key points worth remembering from this stretch of conversation.

Output format:
SUMMARY: [summary]
KEY POINTS:
- [point 1]
- [point 2]

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
      const summaryMatch = raw.match(/SUMMARY:\s*([\s\S]*?)(?=KEY POINTS:|$)/i);
      summaryText = summaryMatch ? summaryMatch[1].trim() : raw.slice(0, 300);

      const bulletMatches = raw.match(/- (.*)/g);
      if (bulletMatches) {
        keyPoints = bulletMatches.map((b) => b.replace(/^- \s*/, '').trim());
      }
    } else {
      summaryText = `Chapter: ${title}.`;
      keyPoints = [
        'No API key set — this summary is a placeholder, not a real one.',
      ];
    }

    res.json({
      summary: summaryText,
      keyPoints,
      tokens: estimateTokens(summaryText + keyPoints.join(' ')),
    });
  } catch (err: unknown) {
    logServer('error', 'API:SUMMARIZE', `Error in /api/summarize-chapter: ${err instanceof Error ? err.message : err}`, err);
    const errorMessage = err instanceof Error ? err.message : 'Summarization error';
    res.status(500).json({ error: errorMessage });
  }
});
}
