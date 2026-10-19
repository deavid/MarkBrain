import type { DomainContextValue } from '../../domains/DomainRegistry';
import type { SendQueue } from '../../application/sendQueue';
import { sampleTurnsForTitle } from '../../domains/06-chat-threads';
import { titleThread } from '../../gateway/api';
import { logger } from '../../utils/logger';

export interface SuggestTitleDeps {
  sendQueue: SendQueue;
  threadRegistry: DomainContextValue['threadRegistry'];
  triggerReRender: () => void;
}

// User-initiated title suggestion — moved from App.tsx; the POST /api/title-thread
// call site now goes through the gateway (same payload, same response handling).
export function createSuggestTitle(deps: SuggestTitleDeps) {
  const { sendQueue, threadRegistry, triggerReRender } = deps;
  const handleSuggestTitle = (threadId: string) => {
    const turns = sendQueue.getTurnsOf(threadId);
    if (turns.filter((t) => (t.content || '').trim()).length === 0) return;
    titleThread({ messages: sampleTurnsForTitle(turns), version: 2 })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: any) => {
        if (data?.title && threadRegistry.forceAutoTitle(threadId, data.title)) {
          logger.info('App', 'Suggested title applied', { threadId, title: data.title });
          triggerReRender();
        }
      })
      .catch((err) => logger.warn('App', 'suggest-title failed', err));
  };
  return handleSuggestTitle;
}
