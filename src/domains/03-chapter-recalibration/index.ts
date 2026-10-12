import { IChapterSegmentationDomain } from '../02-chapter-segmentation';
import { IDialogueTimelineDomain } from '../01-dialogue-timeline';

export interface IChapterRecalibrationDomain {
  recalibrateSummary(chapterId: string, steeringPrompt?: string): Promise<{ summary: string; keyPoints: string[] }>;
}

export class ChapterRecalibrationDomain implements IChapterRecalibrationDomain {
  constructor(
    private segmentation: IChapterSegmentationDomain,
    private timeline: IDialogueTimelineDomain
  ) {}

  async recalibrateSummary(
    chapterId: string,
    steeringPrompt?: string
  ): Promise<{ summary: string; keyPoints: string[] }> {
    const chapter = this.segmentation.getChapter(chapterId);
    if (!chapter) throw new Error(`Chapter ${chapterId} not found`);

    const turns = this.timeline.getTurnSlice(chapter.startIndex, chapter.endIndex);
    const messages = turns.map((t) => ({ role: t.role, content: t.content }));

    try {
      const res = await fetch('/api/summarize-chapter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: chapter.title,
          messages,
          steeringPrompt,
        }),
      });
      const data = await res.json();
      const summary = data.summary || 'Summary recalibrated.';
      const keyPoints = data.keyPoints || [];
      this.segmentation.updateSummary(chapterId, summary, keyPoints);
      return { summary, keyPoints };
    } catch {
      const fallback = `Recalibrated invariants for ${chapter.title}.`;
      this.segmentation.updateSummary(chapterId, fallback, []);
      return { summary: fallback, keyPoints: [] };
    }
  }
}
