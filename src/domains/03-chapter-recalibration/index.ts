import { IChapterSegmentationDomain } from '../02-chapter-segmentation';
import { IDialogueTimelineDomain } from '../01-dialogue-timeline';
import { summarizeChapter } from '../../gateway/api';

export interface IChapterRecalibrationDomain {
  recalibrateSummary(
    chapterId: string,
    steeringPrompt?: string
  ): Promise<{ description: string; summary: string }>;
}

export class ChapterRecalibrationDomain implements IChapterRecalibrationDomain {
  constructor(
    private segmentation: IChapterSegmentationDomain,
    private timeline: IDialogueTimelineDomain
  ) {}

  async recalibrateSummary(
    chapterId: string,
    steeringPrompt?: string
  ): Promise<{ description: string; summary: string }> {
    const chapter = this.segmentation.getChapter(chapterId);
    if (!chapter) throw new Error(`Chapter ${chapterId} not found`);

    const turns = this.timeline.getTurnSlice(chapter.startIndex, chapter.endIndex);
    const messages = turns.map((t) => ({ role: t.role, content: t.content }));

    try {
      const res = await summarizeChapter({
        title: chapter.title,
        messages,
        steeringPrompt,
      });
      const data = await res.json();
      const description = data.description || '';
      const summary = data.summary || '';
      this.segmentation.updateLevels(chapterId, { description, summary });
      return { description, summary };
    } catch {
      const fallback = `Recap of ${chapter.title}.`;
      this.segmentation.updateLevels(chapterId, { summary: fallback });
      return { description: chapter.description || '', summary: fallback };
    }
  }
}
