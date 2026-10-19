import type { DomainContextValue } from '../../domains/DomainRegistry';
import { summarizeChapter } from '../../gateway/api';
import { logger } from '../../utils/logger';

export interface ChapterHandlerParams {
  timeline: DomainContextValue['timeline'];
  segmentation: DomainContextValue['segmentation'];
}

// Chapter declare/summarize/compression handlers — moved verbatim from App.tsx.
export function createChapterHandlers(params: ChapterHandlerParams) {
  const { timeline, segmentation } = params;

  // Declare New Chapter
  const handleDeclareChapter = (
    _messageId: string,
    title: string
  ) => {
    const currentTurnsCount = timeline.count();
    segmentation.declareNewChapter(title, currentTurnsCount, 'User split chapter boundary');
  };

  // Summarize Chapter
  const handleSummarizeChapter = async (chapterId: string) => {
    const target = segmentation.getChapter(chapterId);
    if (!target) {
      logger.warn('App', `Summarize requested for unknown chapter ${chapterId}`);
      return;
    }

    try {
      const turns = timeline.getTurnSlice(target.startIndex, target.endIndex);
      const res = await summarizeChapter({
        title: target.title,
        messages: turns.map((t) => ({ role: t.role, content: t.content })),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        throw new Error(`summarize-chapter HTTP ${res.status}${errBody?.error ? `: ${errBody.error}` : ''}`);
      }
      const data = await res.json();
      segmentation.updateSummary(chapterId, data.summary);
    } catch (err) {
      logger.error('App', `Failed to summarize chapter ${chapterId}`, err);
    }
  };

  // Toggle Chapter Compression
  const handleToggleChapterCompressionMode = (
    _chapterId: string,
    _mode: 'summary' | 'full' | 'dropped'
  ) => {
    // Retained for component contract compatibility
  };

  return {
    handleDeclareChapter,
    handleSummarizeChapter,
    handleToggleChapterCompressionMode,
  };
}
