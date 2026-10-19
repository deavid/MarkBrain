export interface ChapterPartition {
  id: string;
  workspaceId: string;
  /** Chat-thread ownership — indices are relative to that thread's turn list. */
  threadId?: string;
  title: string;
  summary?: string;
  keyPoints?: string[];
  status: 'active' | 'completed';
  startIndex: number;
  endIndex?: number; // undefined means ongoing/until latest
  topicShiftReason?: string;
  createdAt: number;
}

export type SegmentationEvent =
  | { type: 'chapterDeclared'; chapter: ChapterPartition }
  | { type: 'chapterSplit'; oldChapterId: string; newChapter: ChapterPartition }
  | { type: 'boundaryShifted'; chapterId: string; newStartIndex: number }
  | { type: 'chapterSummaryUpdated'; chapterId: string; summary: string; keyPoints?: string[] }
  | { type: 'chaptersLoaded'; chapters: ChapterPartition[] };
