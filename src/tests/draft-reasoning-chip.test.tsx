/**
 * The draft card shows the model's thinking, live (David 2026-10-30).
 *
 * During the thinking phase ('awaiting-first-token') with reasoning ticking:
 *   - the phase chip reads "AWAITING FIRST TOKEN · Ns · 12,431 chars thinking"
 *     (same ticking-count treatment as the writing phase's chars), and
 *   - the card body shows the reasoning preview in the SAME partial-preview
 *     styling — no new colors, no new components.
 * With reasoningChars === 0 the chip stays exactly as it was.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

beforeEach(() => {
  vi.unstubAllGlobals();
});

const { DraftPhaseChip, DraftQueueTray } = await import('../ui/chat/DraftQueueTray');

const BASE_PROGRESS = { since: Date.now() - 204_000 };

describe('DraftPhaseChip — the thinking count ticks like the writing count', () => {
  it('awaiting-first-token with reasoning shows the char count + "thinking"', () => {
    const html = renderToStaticMarkup(
      React.createElement(DraftPhaseChip, {
        progress: { ...BASE_PROGRESS, phase: 'awaiting-first-token', reasoningChars: 12431, reasoningPreview: '...' },
        fallback: 'Writing reply',
      })
    );
    expect(html).toMatch(/AWAITING FIRST TOKEN · \d+s · 12,431 chars thinking/);
  });

  it('awaiting-first-token WITHOUT reasoning keeps today\'s chip, word for word', () => {
    const html = renderToStaticMarkup(
      React.createElement(DraftPhaseChip, {
        progress: { ...BASE_PROGRESS, phase: 'awaiting-first-token' },
        fallback: 'Writing reply',
      })
    );
    expect(html).toMatch(/AWAITING FIRST TOKEN · \d+s — the model is thinking; no text yet/);
    expect(html).not.toContain('chars thinking');
  });

  it('the writing chip is untouched (chars, no "thinking" word)', () => {
    const html = renderToStaticMarkup(
      React.createElement(DraftPhaseChip, {
        progress: { ...BASE_PROGRESS, phase: 'writing', firstTokenAt: Date.now(), chars: 512 },
        fallback: 'Writing reply',
      })
    );
    expect(html).toMatch(/WRITING · \d+s · 512 chars/);
    expect(html).not.toContain('thinking');
  });
});

describe('DraftQueueTray — the reasoning preview rides the partial-preview styling', () => {
  const props = {
    offlineReplica: false,
    tokensFor: () => 0,
    titleFor: (id: string) => id,
  };

  const thinkingDraft = {
    id: 'd1',
    threadId: 'T1',
    text: 'the ask',
    state: 'sending' as const,
    createdAt: Date.now(),
    progress: {
      ...BASE_PROGRESS,
      phase: 'awaiting-first-token' as const,
      reasoningChars: 12431,
      reasoningPreview: 'Let me consider the graph structure first…',
    },
  };

  it('a thinking draft with reasoning shows the preview text', () => {
    const html = renderToStaticMarkup(
      React.createElement(DraftQueueTray, { ...props, drafts: [thinkingDraft as never] })
    );
    expect(html).toContain('12,431 chars thinking');
    expect(html).toContain('Let me consider the graph structure first…');
    expect(html).toContain('draft-reasoning-preview');
  });

  it('no reasoning ticking → no preview block, card exactly as today', () => {
    const html = renderToStaticMarkup(
      React.createElement(DraftQueueTray, {
        ...props,
        drafts: [{ ...thinkingDraft, progress: { ...BASE_PROGRESS, phase: 'awaiting-first-token' } } as never],
      })
    );
    expect(html).not.toContain('draft-reasoning-preview');
    expect(html).not.toContain('chars thinking');
  });

  it('once writing, the reasoning preview is gone (the reset is visible)', () => {
    const html = renderToStaticMarkup(
      React.createElement(DraftQueueTray, {
        ...props,
        drafts: [
          {
            ...thinkingDraft,
            partial: 'Answer text',
            progress: { ...BASE_PROGRESS, phase: 'writing' as const, firstTokenAt: Date.now(), chars: 11, reasoningChars: 0, reasoningPreview: '' },
          } as never,
        ],
      })
    );
    expect(html).not.toContain('draft-reasoning-preview');
    expect(html).toContain('Answer text');
  });
});
