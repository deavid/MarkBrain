import type { Express, Request, Response } from 'express';
import { ai } from '../providers/gemini';
import { logServer } from '../lib/log';
import { requireModelId } from '../lib/models';

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
    if (!ai) {
      return res.json({ title: null });
    }
    const titleModel = requireModelId(model, 'title');

    const transcript = messages
      .map((m: { role: string; content: string }) => `${m.role}: ${String(m.content || '').slice(0, 400)}`)
      .join('\n')
      .slice(0, 3000);

    const stageHint =
      Number(version) >= 2
        ? 'More of the conversation is now known — pick the concrete topic that emerged, not just the opening question.'
        : 'This is early in the conversation — capture the apparent topic from what is here.';

    const prompt = `Give this conversation a title.

${stageHint}
Rules:
- 2 to 6 words
- Title Case
- Concrete topic (what it is about), not a vague label
- English only
- No quotes, no colon, no trailing period, no "Chat about" / "Discussion of" prefixes

Conversation:
${transcript}

Title:`;

    const response = await ai.models.generateContent({
      model: titleModel,
      contents: prompt,
      config: { temperature: 0.4 },
    });

    let title =
      (response.text || '')
        .trim()
        .split('\n')[0]
        .replace(/^["'“”«»]+/, '')
        .replace(/["'“”«».!]+$/, '')
        .trim()
        .slice(0, 60);
    if (!title) title = null as any;

    logServer('info', 'API:TITLE', `Thread title v${version} -> "${title}"`);
    res.json({ title });
  } catch (err: unknown) {
    // Best-effort: never fail the pipeline call with a 5xx — client keeps old title.
    logServer('warn', 'API:TITLE', `title-thread failed: ${err instanceof Error ? err.message : err}`);
    res.json({ title: null });
  }
});
}
