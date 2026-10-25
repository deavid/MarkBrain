import type { Express, Request, Response } from 'express';
import { logServer } from '../lib/log';
import { estimateTokens } from '../lib/tokens';
import { buildSummarizePrompt } from '../lib/prompt';
import { parseSentinelBlocks } from '../../src/utils/sentinelParser';
import { requireModelId } from '../lib/models';
import { aiForRequest, sendVaultError, VaultLockedError, NoKeyError } from '../lib/accountVault';

export function registerSummarizeRoutes(app: Express): void {
app.post('/api/summarize-chapter', async (req: Request, res: Response) => {
  try {
    const { title, messages = [], steeringPrompt, model } = req.body;
    const summarizeModel = requireModelId(model, 'summarize');

    if (!messages || messages.length === 0) {
      return res.json({
        subtitle: `An empty chapter${title ? ` titled "${title}"` : ''}.`,
        description: '',
        summary: '',
      });
    }

    let subtitleText = '';
    let descriptionText = '';
    let summaryText = '';

    const ai = aiForRequest(req, 'summarize', summarizeModel);
    if (ai) {
      const prompt = buildSummarizePrompt({ title, messages, steeringPrompt });

      // Hard server-side deadline. Without it a slow model call holds the socket
      // open indefinitely and the client only finds out when a navigation kills
      // the fetch. Within 12s the answer is always one of two things: real text,
      // or an honest error the chapter chrome shows next to a Retry.
      const response = await Promise.race([
        ai.models.generateContent({
          model: summarizeModel,
          contents: prompt,
          config: {
            temperature: 0.3,
          },
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('model call exceeded 12s')), 12_000)
        ),
      ]);

      const raw = response.text || '';
      const blocks = parseSentinelBlocks(raw);
      subtitleText = blocks.subtitle || '';
      descriptionText = blocks.description || '';
      summaryText = blocks.summary || '';
      // Failure-tolerant: a model that ignored the sentinels still gets read
      // rather than losing the whole call, and the chapter shows what landed.
      if (!subtitleText && !descriptionText && !summaryText) {
        const descMatch = raw.match(/DESCRIPTION:\s*([\s\S]*?)(?=SUMMARY:|$)/i);
        const summaryMatch = raw.match(/SUMMARY:\s*([\s\S]*)$/i);
        descriptionText = descMatch ? descMatch[1].trim() : '';
        summaryText = summaryMatch ? summaryMatch[1].trim() : raw.trim().slice(0, 4000);
      }
    } else {
      subtitleText = `Chapter: ${title}.`;
      descriptionText = 'No API key set, so this recap is a placeholder, not a real one.';
      summaryText = '';
    }

    res.json({
      subtitle: subtitleText,
      description: descriptionText,
      summary: summaryText,
      tokens: estimateTokens(subtitleText + descriptionText + summaryText),
    });
  } catch (err: unknown) {
    if (err instanceof VaultLockedError || err instanceof NoKeyError) return sendVaultError(res, err);
    const errorMessage = err instanceof Error ? err.message : 'Summarization error';
    // A deadline breach is not a crash: answer 504 so the client stops waiting
    // and the chapter shows its Retry instead of a socket that never returns.
    if (/exceeded \d+s/.test(errorMessage)) {
      logServer('warn', 'API:SUMMARIZE', `Timed out: ${errorMessage}`);
      return res.status(504).json({ error: errorMessage });
    }
    logServer('error', 'API:SUMMARIZE', `Error in /api/summarize-chapter: ${errorMessage}`, err);
    res.status(500).json({ error: errorMessage });
  }
});
}
