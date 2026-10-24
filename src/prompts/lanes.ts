/**
 * Lane prompt builders + response parsers, shared by the server routes and the
 * browser→provider adapters (design-docs/16 Phase 1). One source of truth: a
 * prompt that drifts between proxy mode and direct mode would make the two
 * paths answer differently.
 */
import type { GeneratedQaPair } from '../services/searchIndexStore';

/* ------------------------------------------------------------------- title */

export function buildTitlePrompt(
  messages: Array<{ role: string; content: string }>,
  version: number
): string {
  const transcript = messages
    .map((m) => `${m.role}: ${String(m.content || '').slice(0, 400)}`)
    .join('\n')
    .slice(0, 3000);

  const stageHint =
    Number(version) >= 2
      ? 'More of the conversation is now known — pick the concrete topic that emerged, not just the opening question.'
      : 'This is early in the conversation — capture the apparent topic that is here.';

  return `Give this conversation a title.

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
}

/** First line, de-quoted, Title Case budget. Never throws; empty → null. */
export function cleanupTitle(raw: string): string | null {
  let title = (raw || '')
    .trim()
    .split('\n')[0]
    .replace(/^["'“”«»]+/, '')
    .replace(/["'“”«».!]+$/, '')
    .trim()
    .slice(0, 60);
  return title || null;
}

/* --------------------------------------------------------------- search QA */

export interface QaSectionPayload {
  id: string;
  heading: string;
  text: string;
}

export const QA_MAX_CHARS_PER_SECTION = 2500;

export function buildQaPrompt(
  title: string,
  subtitle: string | undefined,
  sections: QaSectionPayload[]
): string {
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

export function parseQaPairs(
  raw: string,
  fallbackSections: QaSectionPayload[]
): GeneratedQaPair[] {
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
export function fallbackQaPairs(sections: QaSectionPayload[]): GeneratedQaPair[] {
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
    ).slice(0, 12),
  }));
}

/* --------------------------------------------------------------------- tts */

/** Strip markup so read-aloud speaks prose, not syntax. */
export function cleanTtsText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' [code specification block omitted] ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
    .replace(/[#*_~]/g, '')
    .slice(0, 1500);
}

export const TTS_ALLOWED_VOICES = ['Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr'] as const;

export function clampTtsVoice(voice: string): string {
  return (TTS_ALLOWED_VOICES as readonly string[]).includes(voice) ? voice : 'Kore';
}
