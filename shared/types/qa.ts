/**
 * GeneratedQaPair — the Q&A entry the search index builds per artifact.
 *
 * Lives in shared/ because BOTH the server QA job (server/jobs/serverArtifactIndexer.ts
 * via shared/prompts/lanes.ts) and the client store (src/services/searchIndexStore.ts)
 * speak this shape. The IndexedDB store re-exports it so its consumers are unchanged.
 */
export interface GeneratedQaPair {
  id: string;
  sectionHeading: string;
  question: string;
  answer: string;
  keywords: string[];
}
