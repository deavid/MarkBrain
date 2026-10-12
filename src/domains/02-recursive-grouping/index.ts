export interface SuperChapter {
  id: string;
  title: string;
  childChapterIds: string[];
  aggregatedSummary?: string;
}

export interface IRecursiveGroupingDomain {
  createSuperChapter(title: string, chapterIds: string[]): SuperChapter;
  listSuperChapters(): SuperChapter[];
  getSuperChapter(id: string): SuperChapter | null;
  aggregateSummary(id: string, summaries: string[]): string;
}

export class RecursiveGroupingDomain implements IRecursiveGroupingDomain {
  private groups: Map<string, SuperChapter> = new Map();

  createSuperChapter(title: string, chapterIds: string[]): SuperChapter {
    const sc: SuperChapter = {
      id: `super-${Date.now()}`,
      title,
      childChapterIds: [...chapterIds],
    };
    this.groups.set(sc.id, sc);
    return sc;
  }

  listSuperChapters(): SuperChapter[] {
    return Array.from(this.groups.values());
  }

  getSuperChapter(id: string): SuperChapter | null {
    return this.groups.get(id) || null;
  }

  aggregateSummary(id: string, summaries: string[]): string {
    const sc = this.groups.get(id);
    const combined = summaries.filter(Boolean).join('\n\n');
    if (sc) sc.aggregatedSummary = combined;
    return combined;
  }
}
