import type { Express, Request, Response } from 'express';
import { logServer } from '../lib/log';
import { requireModelId } from '../lib/models';
import { aiForRequest, sendVaultError, VaultLockedError, NoKeyError } from '../lib/accountVault';
import { buildTitlePrompt, cleanupTitle } from '../../src/prompts/lanes';
import { isOpenRouterModel } from '../providers/openrouter';
import { recordCallStart, recordCallEnd } from '../lib/callRecorder';

export function registerTitleRoutes(app: Express): void {
// API: Thread title generation (best-effort meta call for the staged titling
// pipeline — stage 1 after the 1st reply, stage 2 after ~3rd). Always answers
// 200; on any failure returns { title: null } so the client keeps its current
// title (titles never block the chat UX). English-only by product decision.
app.post('/api/title-thread', async (req: Request, res: Response) => {
  try {
    const { messages = [], version = 1, model } = req.body;
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.json({ title: null });
    }
    const titleModel = requireModelId(model, 'title');
    let ai;
    try {
      ai = aiForRequest(req, 'title', titleModel);
    } catch (err) {
      // Locked vault / no key are real answers on this lane too (§7).
      if (err instanceof VaultLockedError || err instanceof NoKeyError) return sendVaultError(res, err);
      return res.json({ title: null });
    }

    const prompt = buildTitlePrompt(messages, version);

    const callLogId = recordCallStart({
      userId: req.user?.id ?? null,
      kind: 'title',
      provider: isOpenRouterModel(titleModel) ? 'openrouter' : 'gemini',
      model: titleModel,
      request: { endpoint: '/api/title-thread', model: titleModel, compiledPrompt: prompt, params: { temperature: 0.4 } },
    });
    let responseText = '';
    try {
      const response = await ai.models.generateContent({
        model: titleModel,
        contents: prompt,
        config: { temperature: 0.4 },
      });
      responseText = response.text || '';
      recordCallEnd(callLogId, { status: 'ok', responseText });
    } catch (err) {
      recordCallEnd(callLogId, { status: 'error', error: err instanceof Error ? err.message : String(err).slice(0, 500) });
      throw err;
    }

    const title = cleanupTitle(responseText || '');

    logServer('info', 'API:TITLE', `Thread title v${version} -> "${title}"`);
    res.json({ title });
  } catch (err: unknown) {
    if (err instanceof VaultLockedError || err instanceof NoKeyError) return sendVaultError(res, err);
    // Best-effort: never fail the pipeline call with a 5xx — client keeps old title.
    logServer('warn', 'API:TITLE', `title-thread failed: ${err instanceof Error ? err.message : err}`);
    res.json({ title: null });
  }
});
}
