/**
 * BUG-013 §1.2/§3: thinking is PERSISTED on every assistant turn
 * (turn.meta.thinking travels through the commit planner) and rendered as a
 * collapsed-by-default disclosure on the bubble.
 */
import { describe, it, expect } from 'vitest';
import { planTurnCommit, type TurnCommitRequest } from '../../shared/turnCommit/planTurnCommit';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MessageBubble } from '../ui/chat/MessageBubble';

const baseReq = (over: Partial<TurnCommitRequest>): TurnCommitRequest => ({
  kind: 'send',
  threadId: 't1',
  pairKey: 'p1',
  projectId: 'proj',
  askText: 'ask',
  cleanReply: 'reply',
  rawReply: 'reply',
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

describe('planTurnCommit persists thinking', () => {
  it('telemetry.thinking lands on assistantTurn.meta.thinking', () => {
    const plan = planTurnCommit(baseReq({ telemetry: { thinking: 'the reasoning trace' } }));
    expect((plan.assistantTurn.meta as any)?.thinking).toBe('the reasoning trace');
  });

  it('no thinking → no field', () => {
    const plan = planTurnCommit(baseReq({ telemetry: {} }));
    expect((plan.assistantTurn.meta as any)?.thinking).toBeUndefined();
  });
});

describe('MessageBubble thinking fold', () => {
  const base = {
    message: {
      id: 'm1',
      role: 'assistant',
      content: 'The visible answer.',
      timestamp: 1,
      meta: { thinking: 'one two three four five' },
    },
    globalTurnIndex: 1,
    chatRender: 'rendered' as const,
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
  };

  it('renders a collapsed-by-default disclosure with the word count', () => {
    const html = renderToStaticMarkup(
      React.createElement(MessageBubble, { ...(base as any), children: undefined })
    );
    expect(html).toContain('data-testid="turn-thinking-toggle"');
    expect(html).toContain('Thought (5 words)');
    // Collapsed default: the thinking TEXT must not be in the markup.
    expect(html).not.toContain('one two three four five');
  });

  it('no thinking → no disclosure', () => {
    const html = renderToStaticMarkup(
      React.createElement(MessageBubble, {
        ...(base as any),
        message: { ...base.message, meta: undefined },
      })
    );
    expect(html).not.toContain('turn-thinking-toggle');
  });
});
