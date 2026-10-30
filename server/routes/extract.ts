import type { Express, Request, Response } from 'express';
import { logServer } from '../lib/log';
import { EXTRACT_READ_CHAR_CAP, buildExtractPrompt, readSentinelArtifact } from '../../shared/prompts/prompt';
import { requireModelId } from '../lib/models';
import { aiForRequest, sendVaultError, VaultLockedError, NoKeyError } from '../lib/accountVault';
import { isOpenRouterModel } from '../providers/openrouter';
import { recordCallStart, recordCallEnd } from '../lib/callRecorder';

export function registerExtractRoutes(app: Express): void {
app.post('/api/extract-artifact-from-file', async (req: Request, res: Response) => {
  try {
    const {
      content,
      filename = 'document.md',
      projectTitle = 'Project',
      fileType = 'doc',
      previousError,
      previousOutput,
      model,
    } = req.body;
    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Content is required' });
    }

    const extractModel = requireModelId(model, 'extract');
    const ai = aiForRequest(req, 'extract', extractModel);

    if (ai) {
      if (content.length > EXTRACT_READ_CHAR_CAP) {
        logServer('warn', 'API:EXTRACT', `Import source is ${content.length} chars, the model only reads the first ${EXTRACT_READ_CHAR_CAP} of it (${filename})`);
      }
      const prompt = buildExtractPrompt({
        content,
        filename,
        projectTitle,
        fileType,
        previousError,
        previousOutput,
      });

      const callLogId = recordCallStart({
        userId: req.user?.id ?? null,
        kind: 'extract',
        provider: isOpenRouterModel(extractModel) ? 'openrouter' : 'gemini',
        model: extractModel,
        request: { endpoint: '/api/extract-artifact-from-file', model: extractModel, compiledPrompt: prompt, params: { temperature: 0.2 } },
      });
      let raw = '';
      try {
        const response = await ai.models.generateContent({
          model: extractModel,
          contents: prompt,
          config: { temperature: 0.2 },
        });
        raw = response.text || '';
        recordCallEnd(callLogId, { status: 'ok', responseText: raw });
      } catch (err) {
        recordCallEnd(callLogId, { status: 'error', error: err instanceof Error ? err.message : String(err).slice(0, 500) });
        throw err;
      }
      const read = readSentinelArtifact(raw, filename.replace(/\.[^/.]+$/, ''));
      if (!read.hasLayers) {
        // Hand the raw text back so the client's Retry is failure-aware.
        logServer('warn', 'API:EXTRACT', 'Model output carried no sentinel layers — returning raw for retry');
        return res.status(502).json({
          error: 'Model output did not contain === SECTION === blocks',
          raw: raw.slice(0, 20000),
        });
      }

      const parsed = {
        title: read.title,
        code: read.code,
        type: read.type,
        category: read.type,
        subtitle: read.subtitle,
        description: read.description,
        summary: read.summary,
        tags: read.tags,
        graph: {
          parent: read.parent,
          children: [],
          relationships: read.relationships,
          is_high_concept: read.isHighConcept,
        },
        // The body is the file, not the model's retelling of it. This splice is
        // what makes "full" verbatim by construction and removes both failure
        // modes: the model condensing a long document, and the old 24k-char cut.
        content,
      };
      return res.json({
        artifact: parsed,
      });
    }

    const lines = content.split('\n');
    let title = filename.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');
    for (const l of lines) {
      const hMatch = l.match(/^#+\s+(.+)$/);
      if (hMatch) {
        title = hMatch[1].trim();
        break;
      }
    }
    const code = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30);
    const nonHeaders = lines.filter((l: string) => l.trim().length > 0 && !l.startsWith('#'));
    const subtitle = nonHeaders[0]?.slice(0, 200) || `Imported document: ${title}.`;
    const description = nonHeaders.slice(0, 3).join(' ').slice(0, 900) || `Imported document: ${title}.`;
    const summary = nonHeaders.slice(0, 10).join(' ').slice(0, 3000) || 'Imported note summary.';

    const rawTokens = (title + ' ' + description).toLowerCase().match(/[a-z]{4,}/g) || [];
    const uniqueTokens = Array.from(new Set(rawTokens)).slice(0, 5);
    const tags = ['imported-doc', 'google-docs', ...uniqueTokens];

    return res.json({
      artifact: {
        title,
        code,
        type: 'note',
        category: 'note',
        subtitle,
        description,
        summary,
        tags,
        graph: {
          parent: null,
          children: [],
          relationships: [],
          is_high_concept: false,
        },
        content,
      },
    });
  } catch (err: unknown) {
    if (err instanceof VaultLockedError || err instanceof NoKeyError) return sendVaultError(res, err);
    logServer('error', 'API:EXTRACT', `Error in /api/extract-artifact-from-file: ${err instanceof Error ? err.message : err}`, err);
    const errorMessage = err instanceof Error ? err.message : 'Extraction error';
    res.status(500).json({ error: errorMessage });
  }
});
}
