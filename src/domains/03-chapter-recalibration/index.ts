import { IChapterSegmentationDomain } from '../02-chapter-segmentation';
import { IDialogueTimelineDomain } from '../01-dialogue-timeline';
import { summarizeChapter } from '../../gateway/api';

export interface IChapterRecalibrationDomain {
  recalibrateSummary(
    chapterId: string,
    steeringPrompt?: string
  ): Promise<{ subtitle: string; description: string; summary: string }>;
}

export class ChapterRecalibrationDomain implements IChapterRecalibrationDomain {
  constructor(
    private segmentation: IChapterSegmentationDomain,
    private timeline: IDialogueTimelineDomain
  ) {}

  async recalibrateSummary(
    chapterId: string,
    steeringPrompt?: string
  ): Promise<{ subtitle: string; description: string; summary: string }> {
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
      const subtitle = data.subtitle || '';
      const description = data.description || '';
      const summary = data.summary || '';
      this.segmentation.updateLevels(chapterId, { subtitle, description, summary });
      return { subtitle, description, summary };
    } catch {
      const fallback = `Recap of ${chapter.title}.`;
      this.segmentation.updateLevels(chapterId, { subtitle: fallback });
      return { subtitle: fallback, description: chapter.description || '', summary: chapter.summary || '' };
    }
  }
}
