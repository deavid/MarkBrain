/**
 * searchIndex routes — the two API calls the draft-proximity testbed needs.
 *
 *   POST /api/search-index/generate-qa   → LLM Q&A extraction, windowed by the caller
 *   POST /api/search-index/embed         → lane embed model (user slot), L2-normalized
 *
 * Both degrade to deterministic offline fallbacks when GEMINI_API_KEY is
 * absent, so tests and keyless dev boxes still exercise the whole pipeline.
 */
import type { Express, Request, Response } from 'express';
import { aiForRequest, geminiAiForRequest, embedClientForRequest, sendVaultError, VaultLockedError, NoKeyError } from '../lib/accountVault';
import { getIndexStatus } from '../jobs/serverArtifactIndexer';
import { QueryVectorCache } from '../../src/domains/search/queryVectorCache';
import { tokenizeForFts, cosineSimilarity } from '../../src/domains/search/draftSearchEngine';
import { GoogleGenAI } from '@google/genai';
import { OpenRouterClient, isOpenRouterModel } from '../providers/openrouter';
import { resolveServerLaneKey, isVaultUnlocked } from '../lib/accountVault';
import { readSettings } from './account';
import { getDb } from '../db';
import { logServer } from '../lib/log';
import type { GeneratedQaPair } from '../../src/services/searchIndexStore';
import { tryRequireModelId, requireModelId, defaultModelFor } from '../lib/models';
import { recordCallStart, recordCallEnd } from '../lib/callRecorder';

/** gemini-embedding-001 accepts 2,048 input tokens; 6,000 chars ≈ 1,600. */
const EMBED_TEXT_CHAR_CAP = 6000;
const EMBED_MAX_PER_REQUEST = 80;
/**
 * Must equal the cap above. The loop below makes ONE `embedContent` call per
 * chunk, and `embedContent` calls are what the free tier meters (1,000/day).
 * Chunking below the cap is not free: a request of 80 split 50 + 30 is TWO
 * metered calls for content that fits in one.
 */
const EMBED_BATCH_SIZE = EMBED_MAX_PER_REQUEST;
/** The caller windows long documents; the route enforces its own hard ceiling. */
/**
 * Running count of `embedContent` calls since boot.
 *
 * The free tier meters THESE (1,000/day), not HTTP requests — so this is the
 * number to quote when "what spent the quota?" comes up. Logging it per call
 * is what turns the next quota conversation from estimates into facts.
 */
let embedContentCalls = 0;

const QA_MAX_SECTIONS = 12;
const QA_MAX_CHARS = 20000;
const QA_MAX_CHARS_PER_SECTION = 2500;


/**
 * Two budgets, not one — and conflating them is exactly how "it ran out
 * ALREADY?!" happens.
 *
 *   generate-qa  -> gemini-3.5-flash-lite     the LLM text quota (same one chat uses)
 *   embed        -> gemini-embedding-001      the VECTOR quota, separate and far smaller
 *
 * A note costs one LLM window per ~12 sections and then one embedContent call
 * per 80 strings, so indexing burns the embeddings budget far faster than it
 * burns the LLM's. Say which one ran out, in words, or the only visible
 * symptom is a counter that will not move.
 */
function quotaExplanation(
  err: unknown,
  kind: 'llm' | 'embeddings',
  model: string
): { kind: string; model: string; message: string; hint: string } | null {
  const message = err instanceof Error ? err.message : String(err);
  if (!/429|quota|resource.?exhausted/i.test(message)) return null;
  return kind === 'embeddings'
    ? {
        kind,
        model,
        message: `Embeddings quota exhausted (${model})`,
        hint:
          'This is the VECTOR quota, separate from — and much smaller than — the LLM quota ' +
          'that chat and Q&A use. Nothing is stored for this note until it resets.',
      }
    : {
        kind,
        model,
        message: `LLM quota exhausted (${model})`,
        hint:
          'This is the text-generation quota that chat and Q&A share. ' +
          'Nothing is stored for this note until it resets.',
      };
}

interface SectionPayload {
  id: string;
  heading: string;
  text: string;
}

/**
 * The requesting user's embed slot (Model Settings), validated against the
 * catalog. Falls back to the lane default if nothing is set — never env.
 */
function userEmbedModelForSearch(userId: number): string {
  try {
    const { modelSlots } = readSettings(userId);
    const id = modelSlots['embed'];
    return typeof id === 'string' && id ? requireModelId(id, 'embed') : defaultModelFor('embed');
  } catch {
    return defaultModelFor('embed');
  }
}

export function l2Normalize(v: number[]): number[] {
  let sumSq = 0;
  for (let i = 0; i < v.length; i++) sumSq += v[i] * v[i];
  const norm = Math.sqrt(sumSq);
  if (norm < 1e-12) return v;
  return v.map((x) => x / norm);
}

function buildQaPrompt(title: string, subtitle: string | undefined, sections: SectionPayload[]): string {
  const block = sections
    .map((s) => `### ${s.heading}\n${s.text.slice(0, QA_MAX_CHARS_PER_SECTION)}`)
    .join('\n\n---\n\n');

  return `You are building a high-recall search index for the document "${title}".
${subtitle ? `Document subtitle: ${subtitle}` : ''}

Below are sections from the document. For EVERY concrete fact, rule, mechanic, number, visual detail, design philosophy, comparison or decision in these sections, write a Question-and-Answer entry that a human might ask in casual language when trying to recall or work with that detail.

Rules:
- Scale question count to the density of the text: roughly 1 Q&A per 300-600 characters of substantive text. Do not skip small concrete details (colors, timers, numbers, names, thresholds).
- Write the question the way a person types in a chat, not how a document is phrased.
- The answer must be short (1-2 sentences) and must come from the text.
- The KW: line carries everyday synonyms and alternative words so keyword search can bridge vocabulary gaps (e.g. "flashlight, battery, duration").
- Output ONLY repeatable blocks in exactly this format. No markdown fences, no JSON, no preamble:

=== QA ===
SECTION: <exact section heading from the document>
Q: <natural question a human would type>
A: <concise factual answer from the text, 1-2 sentences>
KW: <comma-separated synonyms and related terms>

Document sections:
${block}`;
}

function parseQaPairs(raw: string, fallbackSections: SectionPayload[]): GeneratedQaPair[] {
  const out: GeneratedQaPair[] = [];

  const blockRe = /===\s*QA\s*===([\s\S]*?)(?====\s*QA\s*===|$)/gi;
  const blocks: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(raw)) !== null) blocks.push(m[1]);

  const takeBlock = (text: string, i: number) => {
    const section =
      /SECTION:\s*(.+)/i.exec(text)?.[1]?.trim() ||
      fallbackSections[Math.min(i, fallbackSections.length - 1)]?.heading ||
      'General';
    const question = /(?:^|\n)\s*Q:\s*([\s\S]*?)(?=\n\s*A:|$)/i.exec(text)?.[1]?.trim();
    const answer = /(?:^|\n)\s*A:\s*([\s\S]*?)(?=\n\s*KW:|$)/i.exec(text)?.[1]?.trim();
    if (!question) return;
    const kwLine = /(?:^|\n)\s*KW:\s*([\s\S]*?)$/i.exec(text)?.[1]?.trim() || '';
    out.push({
      id: `qa-${out.length}`,
      sectionHeading: section,
      question: question.replace(/\s+/g, ' ').trim(),
      answer: (answer || '').replace(/\s+/g, ' ').trim(),
      keywords: kwLine
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean)
        .slice(0, 12),
    });
  };

  if (blocks.length > 0) {
    blocks.forEach(takeBlock);
    if (out.length) return out;
  }

  // The model ignored the marker but still wrote Q:/A: pairs.
  const loose = raw.split(/\n(?=\s*(?:SECTION:\s*)?(?:Q:))/i);
  loose.forEach((chunk, i) => takeBlock(chunk, i));
  return out;
}

/** Offline path: one deterministic pair per section so CI still exercises the UI. */
function fallbackQaPairs(sections: SectionPayload[]): GeneratedQaPair[] {
  return sections.map((s, i) => ({
    id: `qa-${i}`,
    sectionHeading: s.heading,
    question: `What does "${s.heading}" cover?`,
    answer: s.text.replace(/\s+/g, ' ').trim().slice(0, 300),
    keywords: Array.from(
      new Set(
        s.heading
          .toLowerCase()
          .split(/[^a-z0-9.]+/)
          .filter((w) => w.length > 3)
      )
    ).slice(0, 8),
  }));
}

/**
 * Offline embeddings: a 768-dim unit vector derived from character trigrams.
 * Not semantic — its only job is to be deterministic, correctly shaped and
 * L2-normalized so the offline path exercises the same scoring code as the
 * real model.
 */
function fallbackEmbedding(text: string): number[] {
  const vec = new Array<number>(768).fill(0);
  const lower = text.toLowerCase();
  for (let i = 0; i < lower.length - 2; i++) {
    const tri = lower.slice(i, i + 3);
    let h = 0x811c9dc5;
    for (let c = 0; c < tri.length; c++) {
      h ^= tri.charCodeAt(c);
      h = Math.imul(h, 0x01000193);
    }
    vec[(h >>> 0) % 768] += 1;
  }
  // NOT `vec.every((x) => x === 0)`: TS 5.5+ infers that predicate as
  // `x is 0`, so inside the branch `vec` narrows to `0[]` and the write below
  // is rejected. The loop above always increments, so only a text too short to
  // form a trigram can leave the vector zero.
  if (lower.length <= 2) vec[0] = 1;
  return l2Normalize(vec);
}

export function registerSearchIndexRoutes(app: Express): void {
  app.post('/api/search-index/generate-qa', async (req: Request, res: Response) => {
    // Resolved before the main try so its catch can name the model — but a
    // bad model is a 400 payload here, never a throw that kills the process.
    const qaResolved = tryRequireModelId(req.body?.model, 'qaGen');
    if ('error' in qaResolved) return res.status(400).json({ error: qaResolved.error });
    const qaModel = qaResolved.id;
    try {
      const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
      const subtitle =
        typeof req.body?.subtitle === 'string' ? req.body.subtitle.trim().slice(0, 400) : undefined;
      const sections: SectionPayload[] = Array.isArray(req.body?.sections)
        ? req.body.sections
            .filter(
              (s: unknown): s is SectionPayload =>
                !!s &&
                typeof (s as SectionPayload).text === 'string' &&
                (s as SectionPayload).text.trim().length > 0
            )
            .slice(0, QA_MAX_SECTIONS)
            .map((s: SectionPayload, i: number) => ({
              id: s.id || `sec-${i}`,
              heading: (s.heading || '').trim().slice(0, 200) || 'General',
              text: s.text.slice(0, QA_MAX_CHARS_PER_SECTION),
            }))
        : [];

      if (sections.length === 0) {
        return res.status(400).json({ error: 'sections[] with non-empty text is required' });
      }
      if (!title) return res.status(400).json({ error: 'title is required' });

      const totalChars = sections.reduce((sum, s) => sum + s.text.length, 0);
      if (totalChars > QA_MAX_CHARS) {
        return res.status(400).json({
          error: `window too large (${totalChars} chars > ${QA_MAX_CHARS}) — split the document into smaller windows`,
        });
      }

      // The OTHER budget. One line per window so "what spent the quota?" has
      // an answer from the log alone — placed before the key check so it fires
      // on the real path, not only the offline one.
      logServer(
        'info',
        'API:SEARCH_QA',
        `generate-qa: ${sections.length} sections -> 1 LLM call [${qaModel}]` +
          `${title ? ` "${title.slice(0, 60)}"` : ''}`
      );

      const ai = aiForRequest(req, 'qaGen', qaModel);

      const qaPrompt = buildQaPrompt(title, subtitle, sections);
      const callLogId = recordCallStart({
        userId: req.user?.id ?? null,
        kind: 'qa',
        model: qaModel,
        request: { endpoint: '/api/search-index/generate-qa', model: qaModel, compiledPrompt: qaPrompt, params: { temperature: 0.2 } },
      });
      let responseText = '';
      try {
        const response = await ai.models.generateContent({
          model: qaModel,
          contents: qaPrompt,
          config: { temperature: 0.2 },
        });
        responseText = response.text || '';
        recordCallEnd(callLogId, { status: 'ok', responseText });
      } catch (err) {
        recordCallEnd(callLogId, { status: 'error', error: err instanceof Error ? err.message : String(err).slice(0, 500) });
        throw err;
      }

      const qaPairs = parseQaPairs(responseText, sections);
      if (qaPairs.length === 0) {
        logServer('warn', 'API:SEARCH_QA', 'Model produced no parseable Q&A — using fallback');
        return res.json({ qaPairs: fallbackQaPairs(sections), offline: true });
      }
      res.json({ qaPairs });
    } catch (err: unknown) {
      if (err instanceof VaultLockedError || err instanceof NoKeyError) return sendVaultError(res, err);
      const message = err instanceof Error ? err.message : 'Q&A extraction error';
      logServer('error', 'API:SEARCH_QA', `Error in /api/search-index/generate-qa: ${message}`, err);
      const quota = quotaExplanation(err, 'llm', qaModel);
      res.status(quota ? 429 : 500).json({ error: message, quota });
    }
  });

  app.post('/api/search-index/embed', async (req: Request, res: Response) => {
    // Same contract as generate-qa: 400 payload, never a process-killing throw.
    const embedResolved = tryRequireModelId(req.body?.model, 'embed');
    if ('error' in embedResolved) return res.status(400).json({ error: embedResolved.error });
    const embedModel = embedResolved.id;
    try {
      // Annotate as string[]: the ternary collapses to `any` (`any | never[]`),
      // which leaves `.map((t) => …)` below with no contextual type — TS7006.
      const texts: string[] = Array.isArray(req.body?.texts)
        ? req.body.texts.filter((t: unknown): t is string => typeof t === 'string' && t.length > 0)
        : [];
      if (texts.length === 0) return res.status(400).json({ error: 'texts[] is required' });
      if (texts.length > EMBED_MAX_PER_REQUEST) {
        return res.status(400).json({
          error: `${texts.length} texts exceeds the ${EMBED_MAX_PER_REQUEST}-per-request cap — batch on the caller`,
        });
      }

      const taskType =
        req.body?.taskType === 'RETRIEVAL_QUERY' ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT';
      const title = typeof req.body?.title === 'string' ? req.body.title.slice(0, 300) : undefined;
      const capped = texts.map((t) => t.slice(0, EMBED_TEXT_CHAR_CAP));

      // Embed works on both providers: the facade picks the right client.
      const ai = embedClientForRequest(req, embedModel);

      const embeddings: number[][] = [];
      const callCount = Math.ceil(capped.length / EMBED_BATCH_SIZE);
      logServer(
        'info',
        'API:SEARCH_EMBED',
        `embed: ${capped.length} texts -> ${callCount} embedContent call(s) [${taskType}]` +
          `${title ? ` "${title.slice(0, 60)}"` : ''}`
      );
      for (let i = 0; i < capped.length; i += EMBED_BATCH_SIZE) {
        const batch = capped.slice(i, i + EMBED_BATCH_SIZE);
        embedContentCalls += 1;
        logServer(
          'info',
          'API:SEARCH_EMBED',
          `embedContent #${embedContentCalls}: ${batch.length} texts [${embedModel}]` +
            ` (batch ${Math.floor(i / EMBED_BATCH_SIZE) + 1}/${callCount})`
        );
        // Flight recorder (design-docs/28 §4.2): one row per metered
        // embedContent call. Vector payloads are noise — dims land in usage
        // instead of a raw response body.
        const batchLogId = recordCallStart({
          userId: req.user?.id ?? null,
          kind: 'embed',
          model: embedModel,
          request: { endpoint: 'embedContent', model: embedModel, params: { texts: batch.length, taskType, title: title ?? null } },
        });
        try {
          if (isOpenRouterModel(embedModel)) {
            // OpenRouter: taskType/title/outputDimensionality don't exist there.
            const response = await (ai as OpenRouterClient).models.embedContent({
              model: embedModel,
              contents: batch,
            });
            for (const emb of response.embeddings) {
              embeddings.push(emb.values);
            }
          } else {
            const response = await (ai as GoogleGenAI).models.embedContent({
              model: embedModel,
              contents: batch,
              config: {
                taskType,
                outputDimensionality: 768,
                ...(taskType === 'RETRIEVAL_DOCUMENT' && title ? { title } : {}),
              },
            });
            for (const emb of response.embeddings || []) {
              // LAW 6: truncated Matryoshka output is NOT unit-length. Normalize here.
              embeddings.push(l2Normalize(emb.values || []));
            }
          }
          recordCallEnd(batchLogId, {
            status: 'ok',
            usage: { vectors: batch.length, dims: embeddings.length > 0 ? embeddings[embeddings.length - batch.length]?.length ?? null : null },
          });
        } catch (err) {
          recordCallEnd(batchLogId, { status: 'error', error: err instanceof Error ? err.message : String(err).slice(0, 500) });
          throw err;
        }
        if (i + EMBED_BATCH_SIZE < capped.length) {
          await new Promise((r) => setTimeout(r, 150));
        }
      }

      if (embeddings.length !== capped.length) {
        return res.status(502).json({
          error: `embedContent returned ${embeddings.length} vectors for ${capped.length} inputs`,
        });
      }
      res.json({ embeddings });
    } catch (err: unknown) {
      if (err instanceof VaultLockedError || err instanceof NoKeyError) return sendVaultError(res, err);
      const message = err instanceof Error ? err.message : 'Embedding error';
      logServer('error', 'API:SEARCH_EMBED', `Error in /api/search-index/embed: ${message}`, err);
      const quota = quotaExplanation(err, 'embeddings', embedModel);
      res.status(quota ? 429 : 500).json({ error: message, quota });
    }
  });

  /* ── 21F Part A §3: server semantic search ─────────────────────────── */
  const queryCaches = new Map<number, QueryVectorCache>();
  const cacheFor = (userId: number): QueryVectorCache => {
    let c = queryCaches.get(userId);
    if (!c) { c = new QueryVectorCache(64); queryCaches.set(userId, c); }
    return c;
  };

  app.post('/api/projects/:projectId/search', async (req: Request, res: Response) => {
    try {
      const userId = req.user!.id;
      const projectId = req.params.projectId;
      const query = String(req.body?.query ?? '').trim();
      if (!query) return res.status(400).json({ error: 'query is required' });
      const topK = Math.min(Number(req.body?.topK ?? 12) || 12, 50);
      const status = getIndexStatus(userId, projectId);
      // Same model as the index, or the query vectors would score nothing.
      const embedModel = userEmbedModelForSearch(userId);

      const db = getDb();
      const rows = db
        .prepare(
          `SELECT s.artifact_id, s.section_id, s.heading, s.text, s.qa_json, s.section_vec_json, s.qa_vecs_json, a.doc_json
           FROM artifact_index_sections s
           JOIN artifacts a ON a.user_id = s.user_id AND a.project_id = s.project_id AND a.artifact_id = s.artifact_id
           WHERE s.user_id = ? AND s.project_id = ? AND s.model = ?`
        )
        .all(userId, projectId, embedModel) as Array<{
        artifact_id: string; section_id: string; heading: string; text: string;
        qa_json: string; section_vec_json: string; qa_vecs_json: string; doc_json: string;
      }>;

      if (rows.length === 0 || !isVaultUnlocked(userId)) {
        return res.json({ results: [], indexStatus: status });
      }

      // One query embed, reused via the per-user near-dupe cache — keyed by
      // model: a query embedded with another model must never be reused here.
      const cache = cacheFor(userId);
      let hit = cache.get(query, embedModel);
      let queryVec: Float32Array;
      if (hit) {
        queryVec = hit.vectors[0];
      } else {
        const apiKey = resolveServerLaneKey(userId, 'embed', embedModel);
        const client: GoogleGenAI | OpenRouterClient = isOpenRouterModel(embedModel)
          ? new OpenRouterClient(apiKey)
          : new GoogleGenAI({ apiKey });
        let values: number[];
        if (isOpenRouterModel(embedModel)) {
          const response = await (client as OpenRouterClient).models.embedContent({
            model: embedModel,
            contents: [query],
          });
          values = response.embeddings[0]?.values ?? [];
        } else {
          const response = await (client as GoogleGenAI).models.embedContent({
            model: embedModel,
            contents: query,
            config: { taskType: 'RETRIEVAL_QUERY', outputDimensionality: 768 },
          });
          values = response.embeddings?.[0]?.values ?? [];
        }
        const normed = l2Normalize(values);
        cache.set(query, [Float32Array.from(normed)], embedModel);
        queryVec = Float32Array.from(normed);
      }

      const qTokens = new Set(tokenizeForFts(query));
      const scored = rows.map((row) => {
        const secVecs = JSON.parse(row.section_vec_json || '[]') as number[][];
        const qaVecs = JSON.parse(row.qa_vecs_json || '[]') as number[][];
        const qas = JSON.parse(row.qa_json || '[]') as Array<{ question: string; answer: string }>;
        let semantic = 0;
        let matchedVia: 'section' | 'qa' = 'section';
        if (secVecs.length) {
          semantic = Math.max(semantic, cosineSimilarity(queryVec, Float32Array.from(secVecs[0])));
        }
        for (const qv of qaVecs) {
          const c = cosineSimilarity(queryVec, Float32Array.from(qv));
          if (c > semantic) { semantic = c; matchedVia = 'qa'; }
        }
        // Lexical overlap over section text + QA questions (hybrid term).
        const lexTokens = tokenizeForFts(`${row.text} ${qas.map((q) => q.question).join(' ')}`);
        const lexSet = new Set(lexTokens);
        let overlap = 0;
        for (const t of qTokens) if (lexSet.has(t)) overlap += 1;
        const lexical = qTokens.size ? overlap / qTokens.size : 0;
        const score = Math.min(1, semantic + 0.25 * lexical);
        const title = (() => { try { return (JSON.parse(row.doc_json) as { title?: string }).title ?? ''; } catch { return ''; } })();
        return {
          artifactId: row.artifact_id,
          title,
          sectionId: row.section_id,
          heading: row.heading,
          snippet: row.text.replace(/\s+/g, ' ').slice(0, 180),
          score,
          matchedVia: lexical >= semantic ? (matchedVia === 'qa' ? 'qa' : 'section') : matchedVia,
          _semantic: semantic,
          _lexical: lexical,
        };
      });

      const results = scored
        .filter((r) => r.score > 0.05 || r._semantic > 0.2 || r._lexical > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, topK)
        .map(({ _semantic, _lexical, ...rest }) => { void _semantic; void _lexical; return rest; });

      res.json({ results, indexStatus: getIndexStatus(userId, projectId) });
    } catch (err) {
      if (err instanceof VaultLockedError || err instanceof NoKeyError) return sendVaultError(res, err);
      const message = err instanceof Error ? err.message : 'Search failed';
      logServer('error', 'API:SEARCH', `project search failed: ${message}`, err);
      res.status(500).json({ error: message });
    }
  });

  app.get('/api/projects/:projectId/search/status', (req: Request, res: Response) => {
    res.json(getIndexStatus(req.user!.id, req.params.projectId));
  });

}
