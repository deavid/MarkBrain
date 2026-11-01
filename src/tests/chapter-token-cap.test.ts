/**
 * Long-chat scalability Phase 2 (design-docs/31 §3.2 + BUGS/LONG_CHAT_PHASE_1_2_PLAN.md §2).
 *
 * RED-first: pins the pure chapter-cap evaluator, the auto-split boundary
 * resolver, and the end-to-end Auto-Split handler BEFORE the production code
 * exists.
 */
import { describe, it, expect } from 'vitest';
import {  CHAPTER_SOFT_CAP_TOKENS,
  CHAPTER_HARD_CAP_TOKENS,
  CHAPTER_HARD_CAP_GRACE_TURNS,
  evaluateChapterTokenCap,
  type ChapterCapStatus,
} from '../domains/02-chapter-segmentation/chapterCap';
import { resolveAutoSplitBoundary } from '../../shared/prompts/autoSplit';
import type { Turn } from '../types';
import { ChapterSegmentationDomain } from '../domains/02-chapter-segmentation';
import { DialogueTimelineDomain } from '../domains/01-dialogue-timeline';
import { createChapterHandlers } from '../ui/chat/createChapterHandlers';
import type { DomainContextValue } from '../domains/DomainRegistry';

const turn = (i: number, role: 'user' | 'assistant', tokens: number): Turn => ({
  id: `t${i}`,
  role,
  content: 'x'.repeat(Math.ceil(tokens * 3.8)),
  timestamp: i,
  meta: { contentTokens: tokens },
});

/** A chapter's worth of turns totalling `total` tokens, alternating user/assistant, starting with user. */
function makeTurns(totalTokens: number, perTurn = 500): Turn[] {
  const turns: Turn[] = [];
  let acc = 0;
  let i = 0;
  while (acc < totalTokens) {
    const role = i % 2 === 0 ? 'user' : 'assistant';
    const remaining = totalTokens - acc;
    const t = Math.min(perTurn, remaining);
    turns.push(turn(i, role, t));
    acc += t;
    i++;
  }
  return turns;
}

describe('evaluateChapterTokenCap', () => {
  it('exposes the cap constants', () => {
    expect(CHAPTER_SOFT_CAP_TOKENS).toBe(64_000);
    expect(CHAPTER_HARD_CAP_TOKENS).toBe(128_000);
    expect(CHAPTER_HARD_CAP_GRACE_TURNS).toBe(2);
  });

  it('ok below the soft cap', () => {
    const status: ChapterCapStatus = evaluateChapterTokenCap(makeTurns(10_000));
    expect(status.status).toBe('ok');
    expect(status.totalTokens).toBe(10_000);
    expect(status.graceSendsRemaining).toBe(2);
  });

  it('soft-cap between 64k and 128k', () => {
    const status = evaluateChapterTokenCap(makeTurns(70_000));
    expect(status.status).toBe('soft-cap');
    expect(status.graceSendsRemaining).toBe(2);
  });

  it('grace after crossing 128k with fewer than 2 user turns past the line', () => {
    // Deterministic: cumulative tokens reach 128k exactly at the assistant
    // turn (index 1); only ONE user turn follows → still sendable.
    const turns = [turn(0, 'user', 127_998), turn(1, 'assistant', 3), turn(2, 'user', 3)];
    const status = evaluateChapterTokenCap(turns);
    expect(status.status).toBe('grace');
    expect(status.graceSendsRemaining).toBe(1);
  });

  it('hard-blocked once 2 user turns landed past the 128k line', () => {
    const turns = [
      turn(0, 'user', 127_998),
      turn(1, 'assistant', 3),
      turn(2, 'user', 3),
      turn(3, 'assistant', 3),
      turn(4, 'user', 3),
    ];
    const status = evaluateChapterTokenCap(turns);
    expect(status.status).toBe('hard-blocked');
    expect(status.graceSendsRemaining).toBe(0);
  });

  it('works from raw content when the cache is missing', () => {
    const raw: Turn = { id: 'r', role: 'user', content: 'x'.repeat(3800), timestamp: 0 };
    const status = evaluateChapterTokenCap([raw]);
    expect(status.totalTokens).toBe(1000);
    expect(status.status).toBe('ok');
  });
});

describe('resolveAutoSplitBoundary', () => {
  it('accepts a valid interior user-turn offset', () => {
    const turns = makeTurns(10_000, 500); // 20 turns, user at even offsets
    expect(resolveAutoSplitBoundary(turns, 8)).toEqual({
      splitOffset: 8,
      clamped: false,
    });
  });

  it('clamps an assistant-turn offset down to the nearest user turn', () => {
    const turns = makeTurns(10_000, 500); // user turns at even offsets
    const result = resolveAutoSplitBoundary(turns, 9);
    expect(result.clamped).toBe(true);
    expect(turns[result.splitOffset].role).toBe('user');
  });

  it('clamps out-of-bounds offsets into the interior', () => {
    const turns = makeTurns(10_000, 500);
    const low = resolveAutoSplitBoundary(turns, -5);
    expect(low.splitOffset).toBeGreaterThanOrEqual(2);
    expect(turns[low.splitOffset].role).toBe('user');
    const high = resolveAutoSplitBoundary(turns, 999);
    expect(high.splitOffset).toBeLessThanOrEqual(turns.length - 2);
    expect(turns[high.splitOffset].role).toBe('user');
  });

  it('never produces an empty first or second half', () => {
    const turns = makeTurns(6_000, 500); // 12 turns
    for (const raw of [-100, 0, 1, 11, 12, 100]) {
      const r = resolveAutoSplitBoundary(turns, raw);
      expect(r.splitOffset).toBeGreaterThanOrEqual(2);
      expect(r.splitOffset).toBeLessThanOrEqual(turns.length - 2);
    }
  });

  it('degrades to the midpoint user turn on garbage input', () => {
    const turns = makeTurns(10_000, 500);
    const r = resolveAutoSplitBoundary(turns, Number.NaN);
    expect(Number.isInteger(r.splitOffset)).toBe(true);
    expect(turns[r.splitOffset].role).toBe('user');
  });
});

/* ── End-to-end Auto-Split handler ───────────────────────────────────────── */

describe('Auto-Split Chapter (end to end through the handler)', () => {
  it('splits an over-cap chapter into two and unblocks the composer', async () => {
    const segmentation = new ChapterSegmentationDomain('proj') as unknown as DomainContextValue['segmentation'];
    const timeline = new DialogueTimelineDomain('proj') as unknown as DomainContextValue['timeline'];

    // One big active chapter: 30 turns ≈ 15,000 tokens of REAL cached content
    // — but we evaluate the cap on these turns, so to reach 135k we need
    // contentTokens summing to 135k. Use small per-turn tokens but many turns.
    const turns = makeTurns(135_000, 4_500); // 30 turns
    for (const t of turns) timeline.appendTurn(t.role, t.content, undefined, t.meta, t.id);
    segmentation.declareNewChapter('Big Chapter', 0);

    // The gateway is injected: deterministic midpoint split, like capture mode.
    const autoSplitGateway = async (params: { messages: Array<{ role: string; content: string }> }) => {
      const resolved = resolveAutoSplitBoundary(
        params.messages as unknown as Turn[],
        Math.floor(params.messages.length / 2)
      );
      return new Response(
        JSON.stringify({
          splitTurnOffset: resolved.splitOffset,
          clamped: resolved.clamped,
          previousChapter: {
            title: 'First Half Topic',
            subtitle: 'first half subtitle',
            description: 'first half description',
            summary: 'first half summary',
          },
          currentChapter: {
            title: 'Second Half Topic',
            subtitle: 'second half subtitle',
            description: 'second half description',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const handlers = createChapterHandlers({ timeline, segmentation });
    const result = await (handlers as unknown as {
      handleAutoSplitChapter: (chapterId: string | undefined, gateway: typeof autoSplitGateway) => Promise<unknown>;
    }).handleAutoSplitChapter(undefined, autoSplitGateway);

    const chapters = segmentation.listChapters();
    expect(chapters.length).toBe(2);
    const first = chapters[0];
    const second = chapters[1];
    expect(first.title).toBe('First Half Topic');
    expect(first.subtitle).toBe('first half subtitle');
    expect(first.description).toBe('first half description');
    expect(first.summary).toBe('first half summary');
    expect(first.status).toBe('completed');
    expect(second.title).toBe('Second Half Topic');
    expect(second.status).toBe('active');
    expect(second.startIndex).toBe(first.endIndex);

    // The two halves carry roughly equal token loads and the active chapter
    // is back under the hard cap.
    const firstTurns = timeline.getTurnSlice(first.startIndex, first.endIndex);
    const secondTurns = timeline.getTurnSlice(second.startIndex, undefined);
    const firstStatus = evaluateChapterTokenCap(firstTurns);
    const secondStatus = evaluateChapterTokenCap(secondTurns);
    expect(firstStatus.status).toBe('ok');
    // 67.5k tokens sits between the 64k soft cap and the 128k hard cap: the
    // block lifts (the point of the split) even though the soft nudge shows.
    expect(['ok', 'soft-cap']).toContain(secondStatus.status);
    expect(secondStatus.status).toBe('soft-cap');
    expect(result).toMatchObject({ splitIndex: second.startIndex });
  });
});

/* ── Phase 2.2 UI: banners + composer block (rendered truth) ─────────────── */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChatView } from '../ui/chat/ChatView';
import type { ChapterTurns } from '../types';

/** A one-chapter thread whose turns carry a cached token total. */
function oneChapterThread(totalTokens: number): ChapterTurns[] {
  const turns = makeTurns(totalTokens, 1_000);
  return [
    {
      chapter: {
        id: 'chap-active',
        workspaceId: 'p',
        title: 'Active Chapter',
        status: 'active',
        startIndex: 0,
        granularity: 'full',
        description: '',
        summary: '',
        createdAt: 0,
      },
      index: 0,
      ongoing: true,
      granularity: 'full',
      turns,
    },
  ];
}

const baseProps = {
  project: { id: 'p', name: 'P', codeName: 'P', description: '', color: '#333', createdAt: 0, updatedAt: 0 },
  onSendMessage: async () => {},
  isLoading: false,
  onAddArtifactToProject: () => {},
  onSummarizeChapter: async () => {},
  onDeclareChapter: () => {},
  threadId: 't1',
  onAutoSplitChapter: async () => {},
};

function renderChat(totalTokens: number): string {
  return renderToStaticMarkup(
    React.createElement(ChatView, {
      ...baseProps,
      chapters: oneChapterThread(totalTokens),
    } as never)
  );
}

describe('Phase 2.2 — cap banners + composer block render as specified', () => {
  it('soft-cap: amber banner with Auto-Split, send button ENABLED', () => {
    const html = renderChat(70_000);
    expect(html).toContain('data-testid="chapter-soft-cap-banner"');
    expect(html).toContain('data-testid="auto-split-chapter-btn"');
    expect(html).toContain('getting long');
    expect(html).not.toContain('data-testid="chapter-hard-cap-banner"');
    // Not blocked: the submit button carries no cap-disable.
    expect(html).not.toContain('Chapter limit reached — split the chapter to continue');
  });

  it('grace: amber warning with the remaining-send count', () => {
    // 128k + 1 user turn past the line → 1 send remaining.
    const html = renderChat(128_500);
    expect(html).toContain('data-testid="chapter-grace-banner"');
    expect(html).toContain('left before you must split');
    expect(html).toContain('data-testid="auto-split-chapter-btn"');
  });

  it('hard-blocked: red banner, composer send DISABLED, Auto-Split offered', () => {
    // 128k crossing + 2 user turns past it → blocked.
    const turns = [
      turn(0, 'user', 127_000),
      turn(1, 'assistant', 1_500),
      turn(2, 'user', 1),
      turn(3, 'assistant', 1),
      turn(4, 'user', 1),
    ];
    const html = renderToStaticMarkup(
      React.createElement(ChatView, {
        ...baseProps,
        chapters: [
          {
            chapter: {
              id: 'chap-active',
              workspaceId: 'p',
              title: 'Active Chapter',
              status: 'active',
              startIndex: 0,
              granularity: 'full',
              description: '',
              summary: '',
              createdAt: 0,
            },
            index: 0,
            ongoing: true,
            granularity: 'full',
            turns,
          },
        ],
        onAutoSplitChapter: async () => {},
      } as never)
    );
    expect(html).toContain('data-testid="chapter-hard-cap-banner"');
    expect(html).toContain('Chapter limit reached (128k tokens)');
    expect(html).toContain('data-testid="auto-split-chapter-btn"');
    // The send button is disabled AND explains why.
    expect(html).toContain('Chapter limit reached — split the chapter to continue');
    expect(html).toContain('disabled');
    // The manual-split affordance on the last message stays mounted.
    expect(html).toContain('data-testid="chapter-cap-note"');
  });

  it('ok: no banner at all', () => {
    const html = renderChat(10_000);
    expect(html).not.toContain('chapter-soft-cap-banner');
    expect(html).not.toContain('chapter-grace-banner');
    expect(html).not.toContain('chapter-hard-cap-banner');
    expect(html).not.toContain('auto-split-chapter-btn');
  });
});
