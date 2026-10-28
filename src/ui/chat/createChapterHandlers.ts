import React from 'react';
import type { DomainContextValue } from '../../domains/DomainRegistry';
import { IN_PROGRESS_CHAPTERS, isChapterInProgress, isChapterOngoing } from '../../domains/02-chapter-segmentation';
import type { Granularity } from '../../domains/granularity';
import { summarizeChapter } from '../../gateway/api';
import { getModelForSlot } from '../../data/modelConfig';
import { logger } from '../../utils/logger';

/**
 * The chapter whose cut now promises a sealed layer nobody wrote.
 *
 * When a chapter is created the previous one is sealed, and it joins the
 * in-progress window (the last chapters always send Full) — so it is NOT the
 * one to fill. The one to fill is the chapter that just LEFT the window: its
 * cut has started promising description/summary to the model and we have
 * written neither. One rule, used by every seal path.
 */
export function chapterThatLeftTheWindow(
  segmentation: DomainContextValue['segmentation']
): ReturnType<DomainContextValue['segmentation']['listChapters']>[number] | null {
  const all = segmentation.listChapters();
  const leftWindow = all[all.length - IN_PROGRESS_CHAPTERS - 1];
  if (!leftWindow) return null;
  if (leftWindow.status !== 'completed') return null;
  if (leftWindow.summary && leftWindow.description) return null;
  return leftWindow;
}

/**
 * Fill that chapter on EVERY seal, not just the manual split.
 *
 * This used to be inline in `handleDeclareChapter` alone, which is why a
 * chapter sealed by the model's own `<topic_shift>` sat at "No summary yet"
 * forever — that seal happens inside the stream, on a different code path.
 * Both domain events fire after the chapter list is already updated, so one
 * subscription covers split, topic_shift and anything sealed later.
 *
 * Cost: at most one model call per chapter, and only when a layer is actually
 * missing (the guard above). Never re-summarizes a chapter that has both.
 */
export function useAutoSummarizeSealedChapters(
  segmentation: DomainContextValue['segmentation'],
  summarize: (chapterId: string) => Promise<void>
): void {
  const summarizeRef = React.useRef(summarize);
  summarizeRef.current = summarize;

  React.useEffect(() => {
    const fillIfDue = () => {
      const due = chapterThatLeftTheWindow(segmentation);
      if (!due) return;
      // Fire-and-forget: the chapter carries the "Writing summary…" chrome and,
      // on failure, the Retry button — never an unhandled rejection.
      void summarizeRef.current(due.id).catch(() => {});
    };
    return segmentation.subscribe((event) => {
      if (event.type === 'chapterDeclared' || event.type === 'chapterSplit') fillIfDue();
    });
  }, [segmentation]);
}

export interface ChapterHandlerParams {
  timeline: DomainContextValue['timeline'];
  segmentation: DomainContextValue['segmentation'];
  /** Chapter Recalibrate (Package 2 §2.6): absent in bare test mounts. */
  recalibration?: DomainContextValue['recalibration'];
}

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

    // Sealing a chapter also triggers the fill — but via
    // useAutoSummarizeSealedChapters, which sees EVERY seal path (this split
    // and the model's own <topic_shift>), not just this one.
  };

  // Summarize Chapter — the server returns the chapter's description (level 2)
  // and summary (level 3); both land on the chapter.
  const handleSummarizeChapter = async (chapterId: string) => {
    const target = segmentation.getChapter(chapterId);
    if (!target) {
      logger.warn('App', `Summarize requested for unknown chapter ${chapterId}`);
      return;
    }

    // The last chapters are still live: they send Full, so a recap would have
    // nothing to back and would be replaced by the next turn anyway.
    const list = segmentation.listChapters();
    const idx = list.findIndex((c) => c.id === chapterId);
    if (idx !== -1 && isChapterInProgress(list, idx)) {
      logger.warn('App', `Summarize refused for in-progress chapter ${chapterId} — the last ${IN_PROGRESS_CHAPTERS} chapters always send Full`);
      return;
    }

    try {
      const turns = timeline.getTurnSlice(target.startIndex, target.endIndex);
      const res = await summarizeChapter({
        title: target.title,
        messages: turns.map((t) => ({ role: t.role, content: t.content })),
        model: getModelForSlot('summarize'),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        throw new Error(`summarize-chapter HTTP ${res.status}${errBody?.error ? `: ${errBody.error}` : ''}`);
      }
      const data = await res.json();
      // Fill gaps, never erase: an empty string coming back (e.g. the server's
      // empty-chapter placeholder returns summary: '') must not wipe a layer the
      // chapter already had — that would remove real text from the payload on a
      // call the user made to ADD something.
      const subtitle =
        typeof data.subtitle === 'string' && data.subtitle.trim() ? data.subtitle : undefined;
      const description =
        typeof data.description === 'string' && data.description.trim()
          ? data.description
          : undefined;
      const summary =
        typeof data.summary === 'string' && data.summary.trim() ? data.summary : undefined;
      if (subtitle === undefined && description === undefined && summary === undefined) {
        logger.warn('App', `Summarize returned no text for chapter ${chapterId} — kept existing layers`);
        return;
      }
      segmentation.updateLevels(chapterId, { subtitle, description, summary });
    } catch (err) {
      // warn, not error: a timeout is an EXPECTED outcome of a slow model call
      // and the chapter chrome already shows the failure plus Retry. An error
      // here puts `console.error` in the browser for a state the UI handles
      // honestly, which is what turns the evidence pack red.
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn('App', `Summarize failed for chapter ${chapterId}: ${msg}`);
      throw err instanceof Error ? err : new Error(msg);
    }
  };

  /**
   * The chapter row's granularity control. The compiler honors all four
   * values (`resolveChapterGranularity`), so this is never a menu that lies.
   */
  const handleSetChapterGranularity = (chapterId: string, granularity: Granularity) => {
    segmentation.setGranularity(chapterId, granularity);
  };

  // Merge with the previous chapter (Package 2 §2.6): undo a cut. The domain
  // refuses when there is nothing above or the previous chapter is live.
  const handleMergeChapter = (chapterId: string) => {
    segmentation.mergeChapters(chapterId);
  };

  // Move the seam between this chapter and the one above, one turn at a
  // time. Bounds (turn 0, neighbours) are guarded inside the domain.
  const handleShiftBoundary = (chapterId: string, newStartIndex: number) => {
    segmentation.shiftBoundary(chapterId, newStartIndex);
  };

  // Regenerate summary with a steering note (Package 2 §2.6): the user says
  // WHAT the recap should emphasise. Same in-progress guard as summarize —
  // live chapters send Full, so anything written now is stale on arrival.
  const handleRecalibrateChapter = async (chapterId: string, steeringPrompt?: string) => {
    if (!params.recalibration) return;
    const target = segmentation.getChapter(chapterId);
    if (!target) return;
    const list = segmentation.listChapters();
    const idx = list.findIndex((c) => c.id === chapterId);
    if (idx !== -1 && isChapterInProgress(list, idx)) {
      logger.warn('App', `Recalibrate refused for in-progress chapter ${chapterId}`);
      return;
    }
    await params.recalibration.recalibrateSummary(chapterId, steeringPrompt);
  };

  return {
    handleDeclareChapter,
    handleSummarizeChapter,
    handleSetChapterGranularity,
    handleMergeChapter,
    handleShiftBoundary,
    handleRecalibrateChapter,
  };
}
