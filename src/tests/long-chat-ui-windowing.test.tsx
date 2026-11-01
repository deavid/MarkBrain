/**
 * Long-chat scalability Phase 1 (design-docs/31 + BUGS/LONG_CHAT_PHASE_1_2_PLAN.md).
 *
 * RED-first: these tests pin the four Phase 1 seams BEFORE the production
 * code exists:
 *   1. planTurnCommit stamps meta.contentTokens on both turns; the compiler
 *      and chapter token reads consume the cache instead of re-estimating
 *      every turn string on every render.
 *   2. Default-fold: older Full chapters start collapsed; the last two never.
 *   3. MAX_OPEN_FULL_CHAPTERS: unfolding too many Full chapters auto-folds
 *      the least-recently-opened non-ongoing one.
 *   4. Within-chapter turn windowing: an expanded Full chapter mounts only
 *      the last CHAPTER_TURN_WINDOW_STEP turns, with TRUE global turn indices
 *      (chapter.startIndex + startOffset + idx — never startIndex + idx).
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { planTurnCommit, type TurnCommitRequest } from '../../shared/turnCommit/planTurnCommit';
import { turnPromptTokens } from '../../shared/turnCommit/turnTokens';
import { estimateChapterCutTokens } from '../domains/03-optical-compiler';
import type { ChapterPartition, Turn } from '../types';
import { ChapterSection } from '../ui/chat/ChapterSection';
import type { ChapterTurns } from '../types';
import {
  CHAPTER_TURN_WINDOW_STEP,
  MAX_OPEN_FULL_CHAPTERS,
  defaultChapterCollapsed,
  evictOpenFullChapter,
} from '../ui/chat/chapterFold';

const baseReq = (over: Partial<TurnCommitRequest>): TurnCommitRequest => ({
  kind: 'send',
  threadId: 't1',
  pairKey: 'p1',
  projectId: 'proj',
  askText: 'hello there',
  cleanReply: 'a reply of some length for token estimation',
  rawReply: 'a reply of some length for token estimation',
  artifactUpserts: [],
  topicShift: null,
  links: [],
  unlinks: [],
  stagedAttachments: [],
  capabilities: { writeArtifacts: true, autoChapter: true, graphLinks: true },
  now: 1000,
  ids: { userTurnId: 'u1', assistantTurnId: 'a1' },
  state: { artifacts: [], edges: [], threadTurnsCount: 0, chapters: [] },
  ...over,
});

describe('Phase 1.1 — cached contentTokens on turns', () => {
  it('planTurnCommit stamps meta.contentTokens on the user turn', () => {
    const plan = planTurnCommit(baseReq({}));
    expect(plan.userTurn?.meta?.contentTokens).toBeGreaterThan(0);
  });

  it('planTurnCommit stamps meta.contentTokens on the assistant turn', () => {
    const plan = planTurnCommit(baseReq({}));
    expect(plan.assistantTurn.meta?.contentTokens).toBeGreaterThan(0);
  });

  it('turnPromptTokens reads the cache and falls back to estimating', () => {
    const cached: Turn = {
      id: 't1',
      role: 'user',
      content: 'x'.repeat(380),
      timestamp: 1,
      meta: { contentTokens: 7 },
    };
    expect(turnPromptTokens(cached)).toBe(7);
    const uncached: Turn = {
      id: 't2',
      role: 'user',
      content: 'x'.repeat(380),
      timestamp: 1,
    };
    expect(turnPromptTokens(uncached)).toBe(Math.ceil(380 / 3.8));
  });

  it('estimateChapterCutTokens at Full uses the cached per-turn counts', () => {
    const chap: ChapterPartition = {
      id: 'c1',
      workspaceId: 'p',
      title: 'Chapter',
      status: 'completed',
      startIndex: 0,
      endIndex: 4,
      granularity: 'full',
      description: '',
      summary: '',
      createdAt: 0,
    };
    const turn = (id: string, role: 'user' | 'assistant', content: string, tokens?: number): Turn => ({
      id,
      role,
      content,
      timestamp: 1,
      ...(tokens !== undefined ? { meta: { contentTokens: tokens } } : {}),
    });
    const turns = [
      turn('1', 'user', 'u'.repeat(380), 100),
      turn('2', 'assistant', 'a'.repeat(3800), 1000),
      turn('3', 'user', 'u'.repeat(380), 100),
      turn('4', 'assistant', 'a'.repeat(3800), 1000),
    ];
    // Cached path: the wrapper XML around the turns is tiny relative to the
    // turn bodies, so the estimate must land near the integer sum of the
    // cached counts + wrapper — and crucially must NOT change when the raw
    // bodies change but the cache stays (that would prove it re-read them).
    const withCache = estimateChapterCutTokens(chap, 'full', turns);
    const mutatedBodies = turns.map((t, i) => ({ ...t, content: t.content + ' IGNORED'.repeat(i + 1) }));
    const sameCache = estimateChapterCutTokens(chap, 'full', mutatedBodies);
    expect(sameCache).toBe(withCache);
    // And the number is dominated by the cache sum (2200), not body re-reads.
    expect(withCache).toBeGreaterThanOrEqual(2200);
    expect(withCache).toBeLessThan(2200 + 500);
  });
});

/* ── shared ChapterSection harness ───────────────────────────────────────── */

const makeChapter = (startIndex: number, endIndex?: number): ChapterPartition => ({
  id: `chap-${startIndex}`,
  workspaceId: 'p',
  title: `Chapter at ${startIndex}`,
  status: endIndex === undefined ? 'active' : 'completed',
  startIndex,
  endIndex,
  granularity: 'full',
  description: '',
  summary: '',
  createdAt: 0,
});

const makeTurn = (i: number): Turn => ({
  id: `turn-${i}`,
  role: i % 2 === 0 ? 'user' : 'assistant',
  content: `body of turn number ${i}`,
  timestamp: i,
});

const baseMessageProps = {
  chatRender: 'markdown' as const,
  online: true,
  offlineReplica: false,
  chosenVoice: 'v',
  playingMessageId: null,
  ttsLoadingId: null,
  ttsFailedIds: new Set<string>(),
  attachmentsOfTurn: () => [],
  chapters: [],
  artifactTitles: {},
  cachedIds: new Set<string>(),
  handlePlayTTS: () => {},
  declaringMessageId: null,
  setDeclaringMessageId: () => {},
  handleDeclareSubmit: () => {},
  newChapterTitle: '',
  setNewChapterTitle: () => {},
  titleFor: () => '',
  subtitleFor: () => '',
  tokensFor: () => 0,
  lastAssistantMessageId: null,
  isLoading: false,
  draftCount: 0,
};

const renderChapter = (opts: {
  startIndex: number;
  turnCount: number;
  isCollapsed?: boolean;
  chapterListLength?: number;
  recorded?: Array<{ id: string; globalTurnIndex: number }>;
}) => {
  const chapter = makeChapter(opts.startIndex, opts.turnCount > 0 && opts.isCollapsed ? undefined : undefined);
  const turns = Array.from({ length: opts.turnCount }, (_, i) => makeTurn(opts.startIndex + i));
  const entry: ChapterTurns = {
    chapter,
    index: 0,
    ongoing: true,
    granularity: 'full',
    turns,
  };
  const messageProps = {
    ...baseMessageProps,
    attachmentsOfTurn: (message: Turn, globalTurnIndex: number) => {
      opts.recorded?.push({ id: message.id, globalTurnIndex });
      return [];
    },
  };
  return renderToStaticMarkup(
    React.createElement(ChapterSection, {
      chapters: [entry],
      chapterIndex: 0,
      chapter: entry.chapter,
      isOngoing: true,
      granularity: 'full',
      turns: entry.turns,
      chapterList: Array.from({ length: opts.chapterListLength ?? 1 }, (_, i) =>
        makeChapter(i * 10)
      ),
      chapterTokens: {},
      isCollapsed: opts.isCollapsed ?? false,
      isLayerCollapsed: () => true,
      onToggleLayer: () => {},
      onToggleCollapse: () => {},
      chapterMenuOpen: false,
      onToggleMenu: () => {},
      onCloseMenu: () => {},
      steerActive: false,
      steerText: '',
      onSteerTextChange: () => {},
      onSteerStart: () => {},
      onSteerSubmit: () => {},
      onSteerCancel: () => {},
      summarizing: false,
      summarizeError: '',
      onSummarize: () => {},
      onSetCut: undefined,
      offlineReplica: false,
      attachmentsOfChapter: () => [],
      titleFor: () => '',
      subtitleFor: () => '',
      tokensFor: () => 0,
      messageProps,
    })
  );
};

describe('Phase 1.3 — within-chapter turn windowing', () => {
  it('exports the window step constant', () => {
    expect(CHAPTER_TURN_WINDOW_STEP).toBe(40);
  });

  it('a 100-turn chapter mounts only the LAST 40 bubbles and shows the load-earlier control', () => {
    const recorded: Array<{ id: string; globalTurnIndex: number }> = [];
    const html = renderChapter({ startIndex: 0, turnCount: 100, recorded });
    expect(html).toContain('data-testid="chapter-load-earlier-turns"');
    expect(recorded.length).toBe(40);
    expect(recorded[0].id).toBe('turn-60');
    expect(recorded[recorded.length - 1].id).toBe('turn-99');
  });

  it('windowed bubbles carry TRUE global turn indices (startIndex + startOffset + idx)', () => {
    const recorded: Array<{ id: string; globalTurnIndex: number }> = [];
    renderChapter({ startIndex: 500, turnCount: 100, recorded });
    expect(recorded[0].globalTurnIndex).toBe(560);
    expect(recorded[recorded.length - 1].globalTurnIndex).toBe(599);
  });

  it('a chapter within the window mounts every turn and no control', () => {
    const recorded: Array<{ id: string; globalTurnIndex: number }> = [];
    const html = renderChapter({ startIndex: 0, turnCount: 30, recorded });
    expect(html).not.toContain('chapter-load-earlier-turns');
    expect(recorded.length).toBe(30);
    expect(recorded[0].id).toBe('turn-0');
  });
});

describe('Phase 1.2 — default-fold + open-Full-chapter cap', () => {
  const chapterAt = (startIndex: number, granularity: ChapterPartition['granularity'], status: 'active' | 'completed' = 'completed'): ChapterTurns['chapter'] => ({
    ...makeChapter(startIndex, startIndex + 10),
    granularity,
    status,
  });

  it('the last two chapters never default-fold', () => {
    const chapters = [
      chapterAt(0, 'full'),
      chapterAt(10, 'full'),
      chapterAt(20, 'full'),
      chapterAt(30, 'full'),
      chapterAt(40, 'full'),
    ];
    expect(defaultChapterCollapsed(chapters, 4)).toBe(false);
    expect(defaultChapterCollapsed(chapters, 3)).toBe(false);
  });

  it('older Full chapters default-fold; older summary/description chapters do not', () => {
    const chapters = [
      chapterAt(0, 'summary'),
      chapterAt(10, 'full'),
      chapterAt(20, 'description'),
      chapterAt(30, 'full'),
      chapterAt(40, 'full'),
    ];
    expect(defaultChapterCollapsed(chapters, 0)).toBe(false); // summary
    expect(defaultChapterCollapsed(chapters, 1)).toBe(true); // full, older
    expect(defaultChapterCollapsed(chapters, 2)).toBe(false); // description
    // Index 3 is INSIDE the last-two live window (5 chapters → 3,4 live):
    // Full or not, it never default-folds.
    expect(defaultChapterCollapsed(chapters, 3)).toBe(false);
    const four = [
      chapterAt(0, 'summary'),
      chapterAt(10, 'full'),
      chapterAt(20, 'full'),
      chapterAt(30, 'full'),
    ];
    expect(defaultChapterCollapsed(four, 1)).toBe(true); // full, older
    expect(defaultChapterCollapsed(four, 2)).toBe(false); // index 2 of 4 is inside the live window
  });

  it('evictOpenFullChapter folds the least-recently-opened non-ongoing Full chapter', () => {
    expect(MAX_OPEN_FULL_CHAPTERS).toBe(3);
    // 4 Full chapters, all unfolded, open order oldest-first: 0,1,2,3.
    // The ongoing chapter is the LAST one (index 3) — never evicted.
    const chapters = [
      chapterAt(0, 'full'),
      chapterAt(10, 'full'),
      chapterAt(20, 'full'),
      chapterAt(30, 'full'),
    ];
    const evicted = evictOpenFullChapter({
      chapters,
      openOrder: ['chap-0', 'chap-10', 'chap-20', 'chap-30'],
      collapsed: {},
    });
    expect(evicted).toBe('chap-0');
  });

  it('eviction skips explicitly-collapsed chapters and never touches the ongoing one', () => {
    const chapters = [
      chapterAt(0, 'full'),
      chapterAt(10, 'full'),
      chapterAt(20, 'full'),
      chapterAt(30, 'full'),
      chapterAt(40, 'full'),
    ];
    // chap-0 already folded by the user: 4 remain open → over the cap, and
    // the oldest OPEN one (chap-10) is the eviction target, not chap-0.
    const evicted = evictOpenFullChapter({
      chapters,
      openOrder: ['chap-0', 'chap-10', 'chap-20', 'chap-30', 'chap-40'],
      collapsed: { 'chap-0': true },
    });
    expect(evicted).toBe('chap-10');
  });

  it('no eviction when the open Full count is within the cap', () => {
    const chapters = [chapterAt(0, 'full'), chapterAt(10, 'full'), chapterAt(20, 'full')];
    const evicted = evictOpenFullChapter({
      chapters,
      openOrder: ['chap-0', 'chap-10', 'chap-20'],
      collapsed: {},
    });
    expect(evicted).toBeNull();
  });
});
