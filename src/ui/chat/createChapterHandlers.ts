import type { DomainContextValue } from '../../domains/DomainRegistry';
import { isChapterOngoing } from '../../domains/02-chapter-segmentation';
import type { Granularity } from '../../domains/granularity';
import { summarizeChapter } from '../../gateway/api';
import { logger } from '../../utils/logger';

export interface ChapterHandlerParams {
  timeline: DomainContextValue['timeline'];
  segmentation: DomainContextValue['segmentation'];
}

// Chapter declare/summarize handlers.
export function createChapterHandlers(params: ChapterHandlerParams) {
  const { timeline, segmentation } = params;

  // Declare New Chapter — the split happens AT the clicked message. The
  // button promises "Split into new chapter starting at this message", so the
  // clicked turn becomes the FIRST turn of the new chapter (never a chapter
  // spawned at the thread end while the clicked spot does nothing).
  const handleDeclareChapter = (messageId: string, title: string) => {
    const splitIndex = timeline.getTurns().findIndex((t) => t.id === messageId);
    if (splitIndex === -1) {
      logger.warn('App', `Split chapter: message ${messageId} not found in timeline — ignored`);
      return;
    }

    // The chat surface can render a synthesized genesis window (no registered
    // chapters yet) — materialize it so there is a real chapter to split and
    // the messages before the click stay owned by a window.
    if (segmentation.listChapters().length === 0) {
      segmentation.declareNewChapter('Genesis Chapter', 0);
    }

    const chapters = segmentation.listChapters();
    // Locate the chapter whose window contains the click. Containment mirrors
    // the selector rule (02-chapter-segmentation/selectors): an ongoing
    // chapter — active or last in the list — runs to the latest turn.
    let targetIdx = -1;
    for (let i = 0; i < chapters.length; i++) {
      if (chapters[i].startIndex <= splitIndex) targetIdx = i;
      else break; // chapters are ordered by startIndex
    }
    if (targetIdx === -1) {
      logger.warn('App', `Split chapter: no chapter starts at/before turn ${splitIndex} — ignored`);
      return;
    }
    const target = chapters[targetIdx];
    const ongoing = isChapterOngoing(chapters, targetIdx);
    if (!ongoing && target.endIndex !== undefined && splitIndex >= target.endIndex) {
      logger.warn('App', `Split chapter: turn ${splitIndex} lies outside chapter ${target.id} — ignored`);
      return;
    }

    segmentation.splitChapter(target.id, splitIndex, title);
  };

  // Summarize Chapter — the server returns the chapter's description (level 2)
  // and summary (level 3); both land on the chapter.
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
      segmentation.updateLevels(chapterId, {
        description: typeof data.description === 'string' ? data.description : undefined,
        summary: typeof data.summary === 'string' ? data.summary : undefined,
      });
    } catch (err) {
      logger.error('App', `Failed to summarize chapter ${chapterId}`, err);
    }
  };

  /**
   * The chapter row's granularity control. The compiler honors all four
   * values (`resolveChapterGranularity`), so this is never a menu that lies.
   */
  const handleSetChapterGranularity = (chapterId: string, granularity: Granularity) => {
    segmentation.setGranularity(chapterId, granularity);
  };

  return {
    handleDeclareChapter,
    handleSummarizeChapter,
    handleSetChapterGranularity,
  };
}
