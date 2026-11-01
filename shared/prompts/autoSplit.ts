/**
 * The AI Auto-Split Chapter lane (design-docs/31 §3.2, Phase 2.3).
 *
 * ONE source of truth for the prompt, the response parser and the boundary
 * resolver, shared by all three execution paths (capture/fixture, direct
 * browser mode, server proxy) — the same law the other lanes follow in
 * `shared/prompts/prompt.ts`.
 *
 * Sentinel blocks, never JSON: every other MarkBrain extraction lane speaks
 * sentinels (`parseSentinelBlocks`) because models wrap JSON in fences and
 * break escaping on multi-paragraph fields.
 */
import type { Turn } from '../types/timeline';
import { parseSentinelBlocks } from '../utils/sentinelParser';

/** Any single turn is truncated to this many chars (first/last split) so a 128k chapter still compiles into a compact, fast prompt. */
export const AUTO_SPLIT_TURN_CHAR_CAP = 600;

export interface AutoSplitChapterChapters {
  title: string;
  subtitle: string;
  description: string;
  summary?: string;
}

export interface AutoSplitChapterResult {
  /** Turn offset WITHIN the chapter where the second half begins (a valid interior user turn). */
  splitTurnOffset: number;
  /** True when the raw model output had to be clamped/corrected. */
  clamped: boolean;
  previousChapter: AutoSplitChapterChapters;
  currentChapter: { title: string; subtitle: string; description: string };
}

function truncateTurn(content: string): string {
  const text = content || '';
  if (text.length <= AUTO_SPLIT_TURN_CHAR_CAP * 2) return text;
  return `${text.slice(0, AUTO_SPLIT_TURN_CHAR_CAP)}\n[… ${text.length - AUTO_SPLIT_TURN_CHAR_CAP * 2} chars truncated …]\n${text.slice(-AUTO_SPLIT_TURN_CHAR_CAP)}`;
}

export interface AutoSplitPromptInput {
  title: string;
  /** The chapter's turns, in order. */
  messages: Array<{ role: string; content: string }>;
}

/**
 * Build the Auto-Split prompt: numbered turns, valid user-turn candidates
 * called out, and the sentinel contract for the split point plus both
 * halves' identity layers.
 */
export function buildAutoSplitChapterPrompt(input: AutoSplitPromptInput): string {
  const { title, messages } = input;
  const transcript = messages
    .map((m, i) => `[Turn #${i} | ${m.role}]\n${truncateTurn(m.content)}`)
    .join('\n\n');
  const candidates = messages
    .map((m, i) => ({ i, role: m.role }))
    .filter((m) => m.role === 'user')
    .map((m) => `#${m.i}`)
    .join(', ');

  return `Split this long conversation chapter, titled "${title}", into TWO chapters at the point where the topic/sub-topic shifted, roughly in the middle.

Rules:
- The split point must be a USER turn (the ask that opened the new topic). Valid candidates: ${candidates}.
- Split roughly in half, at the most natural seam between the two topics.
- Write the identity layers for BOTH halves. The first half keeps this chapter's position in history; the second half continues the conversation.
- NEVER repeat across layers and never open a layer with "This document outlines" / "The user and AI discuss": name the thing and state what is in it.

Respond with plain text using exactly these sentinel headers on their own lines. No JSON, no code fences, no commentary.

=== SPLIT_TURN ===
The turn number where the SECOND half begins, like #12

=== FIRST_TITLE ===
3 to 8 words for the first half.

=== FIRST_SUBTITLE ===
1 to 2 sentences, ~40 tokens.

=== FIRST_DESCRIPTION ===
1 to 2 dense paragraphs continuing from the subtitle.

=== FIRST_SUMMARY ===
The detailed recap of the first half, continuing from the description.

=== SECOND_TITLE ===
3 to 8 words for the second half.

=== SECOND_SUBTITLE ===
1 to 2 sentences, ~40 tokens.

=== SECOND_DESCRIPTION ===
1 to 2 dense paragraphs continuing from the subtitle.

--- CHAPTER TRANSCRIPT ---
${transcript}`;
}

/**
 * Clamp a raw (possibly hallucinated) split offset to a VALID interior user
 * turn. Law: never trust raw LLM indices.
 *
 * Valid offsets are integers in `[2, turns.length - 2]` (both halves stay
 * non-trivial); the offset must point at a `user` turn. Out-of-bounds,
 * assistant-turn or non-numeric outputs snap to the nearest valid user turn,
 * degrading to the midpoint user turn.
 */
export function resolveAutoSplitBoundary(
  turns: Array<{ role: string }>,
  rawOffset: number
): { splitOffset: number; clamped: boolean } {
  const len = turns.length;
  const midUser = (() => {
    const mid = Math.floor(len / 2);
    for (let r = 0; r < len; r++) {
      for (const cand of [mid + r, mid - r]) {
        if (cand >= 0 && cand < len && turns[cand].role === 'user') return cand;
      }
    }
    return mid;
  })();

  if (len < 4) {
    // Too small to split meaningfully: the midpoint user turn is the only
    // sane answer (the caller refuses to split below the minimum anyway).
    return { splitOffset: Math.min(Math.max(1, midUser), Math.max(1, len - 1)), clamped: true };
  }

  const min = 2;
  const max = len - 2;
  const raw = typeof rawOffset === 'number' && Number.isFinite(rawOffset) ? Math.round(rawOffset) : Number.NaN;
  const candidate = Number.isNaN(raw) ? midUser : Math.min(max, Math.max(min, raw));

  // Nearest valid USER turn to the candidate, searched outward.
  for (let r = 0; r <= max - min; r++) {
    for (const cand of [candidate - r, candidate + r]) {
      if (cand < min || cand > max) continue;
      if (turns[cand].role === 'user') {
        return { splitOffset: cand, clamped: cand !== raw };
      }
    }
  }
  return { splitOffset: midUser, clamped: true };
}

/**
 * Parse a sentinel reply into a validated Auto-Split result. Falls back to
 * the midpoint user turn and empty layers when the model ignored the
 * contract — the caller decides whether an empty result is usable.
 */
export function parseAutoSplitChapterResponse(
  raw: string,
  turns: Array<{ role: string }>,
  fallbackTitle: string
): AutoSplitChapterResult {
  const blocks = parseSentinelBlocks(raw || '');
  const rawOffset = Number(String(blocks.split_turn || '').replace(/[^\d-]/g, ''));
  const boundary = resolveAutoSplitBoundary(turns, Number.isNaN(rawOffset) ? Number.NaN : rawOffset);

  const first: AutoSplitChapterChapters = {
    title: (blocks.first_title || '').trim() || fallbackTitle,
    subtitle: (blocks.first_subtitle || '').trim(),
    description: (blocks.first_description || '').trim(),
    summary: (blocks.first_summary || '').trim(),
  };
  const second = {
    title: (blocks.second_title || '').trim() || `${fallbackTitle} (continued)`,
    subtitle: (blocks.second_subtitle || '').trim(),
    description: (blocks.second_description || '').trim(),
  };
  return {
    splitTurnOffset: boundary.splitOffset,
    clamped: boundary.clamped,
    previousChapter: first,
    currentChapter: second,
  };
}
