import type { DomainContextValue } from '../../domains/DomainRegistry';
import type { SendQueue } from '../../application/sendQueue';
import { sampleTurnsForTitle } from '../../domains/06-chat-threads';
import { titleThread } from '../../gateway/api';
import { getModelForSlot } from '../../data/modelConfig';
import { logger } from '../../utils/logger';

export interface SuggestTitleDeps {
  sendQueue: SendQueue;
  threadRegistry: DomainContextValue['threadRegistry'];
  triggerReRender: () => void;
}

// User-initiated title suggestion (the sparkles button), via POST /api/title-thread.
export function createSuggestTitle(deps: SuggestTitleDeps) {
  const { sendQueue, threadRegistry, triggerReRender } = deps;
  // Resolves true when a title was actually applied, false when there was
  // nothing to title or the request failed. The caller NEEDS that answer to show
  // feedback; fire-and-forget makes a failed suggestion look like a dead button.
  const handleSuggestTitle = async (threadId: string): Promise<boolean> => {
    const turns = sendQueue.getTurnsOf(threadId);
    if (turns.filter((t) => (t.content || '').trim()).length === 0) return false;
    try {
      const r = await titleThread({ messages: sampleTurnsForTitle(turns), version: 2, model: getModelForSlot('title') });
      if (!r.ok) {
        logger.warn('App', 'suggest-title failed', { status: r.status });
        return false;
      }
      const data: any = await r.json();
      if (data?.title && threadRegistry.forceAutoTitle(threadId, data.title)) {
        logger.info('App', 'Suggested title applied', { threadId, title: data.title });
        triggerReRender();
        return true;
      }
      return false;
    } catch (err) {
      logger.warn('App', 'suggest-title failed', err);
      return false;
    }
  };
  return handleSuggestTitle;
}
