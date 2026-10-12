export interface ProvenanceRecord {
  artifactId: string;
  originChapterId: string;
  turnRange?: [number, number];
  mutationChapterIds: string[];
}
