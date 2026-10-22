/**
 * searchIndex routes — the two API calls the draft-proximity testbed needs.
 *
 *   POST /api/search-index/generate-qa   → LLM Q&A extraction, windowed by the caller
 *   POST /api/search-index/embed         → gemini-embedding-001, L2-normalized
 *
 * Both degrade to deterministic offline fallbacks when GEMINI_API_KEY is
 * absent, so tests and keyless dev boxes still exercise the whole pipeline.
 */
import type { Express, Request, Response } from 'express';
import { ai } from '../providers/gemini';
import { logServer } from '../lib/log';
import type { GeneratedQaPair } from '../../src/services/searchIndexStore';

const EMBED_MODEL = 'gemini-embedding-001';
const QA_MODEL = 'gemini-3.5-flash-lite';

/** gemini-embedding-001 accepts 2,048 input tokens; 6,000 chars ≈ 1,600. */
const EMBED_TEXT_CHAR_CAP = 6000;
const EMBED_MAX_PER_REQUEST = 80;
const EMBED_BATCH_SIZE = 50;
/** The caller windows long documents; the route enforces its own hard ceiling. */
const QA_MAX_SECTIONS = 12;
const QA_MAX_CHARS = 20000;
const QA_MAX_CHARS_PER_SECTION = 2500;

interface SectionPayload {
  id: string;
  heading: string;
  text: string;
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

      if (!ai) {
        logServer('warn', 'API:SEARCH_QA', 'No GEMINI_API_KEY — returning fallback Q&A pairs');
        return res.json({ qaPairs: fallbackQaPairs(sections), offline: true });
      }

      const response = await ai.models.generateContent({
        model: QA_MODEL,
        contents: buildQaPrompt(title, subtitle, sections),
        config: { temperature: 0.2 },
      });

      const qaPairs = parseQaPairs(response.text || '', sections);
      if (qaPairs.length === 0) {
        logServer('warn', 'API:SEARCH_QA', 'Model produced no parseable Q&A — using fallback');
        return res.json({ qaPairs: fallbackQaPairs(sections), offline: true });
      }
      res.json({ qaPairs });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Q&A extraction error';
      logServer('error', 'API:SEARCH_QA', `Error in /api/search-index/generate-qa: ${message}`, err);
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/search-index/embed', async (req: Request, res: Response) => {
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

      if (!ai) {
        logServer('warn', 'API:SEARCH_EMBED', 'No GEMINI_API_KEY — returning deterministic vectors');
        return res.json({ embeddings: capped.map(fallbackEmbedding), offline: true });
      }

      const embeddings: number[][] = [];
      for (let i = 0; i < capped.length; i += EMBED_BATCH_SIZE) {
        const batch = capped.slice(i, i + EMBED_BATCH_SIZE);
        const response = await ai.models.embedContent({
          model: EMBED_MODEL,
          contents: batch,
          config: {
            // EmbedContentConfig.taskType is a plain string in @google/genai —
            // no cast needed (the previous conditional type was also misspelled).
            taskType,
            outputDimensionality: 768,
            ...(taskType === 'RETRIEVAL_DOCUMENT' && title ? { title } : {}),
          },
        });
        for (const emb of response.embeddings || []) {
          // LAW 6: truncated Matryoshka output is NOT unit-length. Normalize here.
          embeddings.push(l2Normalize(emb.values || []));
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
      const message = err instanceof Error ? err.message : 'Embedding error';
      logServer('error', 'API:SEARCH_EMBED', `Error in /api/search-index/embed: ${message}`, err);
      res.status(500).json({ error: message });
    }
  });
}
