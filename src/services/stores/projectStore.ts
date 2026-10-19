/**
 * ProjectStore — the persistence PORT (anticorruption boundary).
 *
 * Exactly one interface for the full CRUD surface persistenceService actually
 * dispatches today. Everything above the port (facade, domains, UI) is
 * backend-agnostic; the two implementations behind it are:
 *
 *   - stores/firestoreStore.ts — Firestore, scoped to auth.currentUser,
 *     handleFirestoreError on permission-denied, setDoc({merge:true}).
 *   - stores/localStore.ts     — IndexedDB via localBackend.ts, this browser
 *     only, no identity.
 *
 * No speculative methods: load / list / save (full snapshot) / create /
 * delete / replaceAll (import path). Backend choice happens at exactly ONE
 * dispatch point in persistenceService.getStore() — and it is re-read per
 * call, because setBackend() can flip the backend at runtime.
 *
 * ProjectSnapshot is the canonical wire format: identical bytes travel through
 * both backends, so export → import round-trips cross-backend (see
 * persistenceService exportDatabase/importDatabase).
 */
import type { Turn } from '../../domains/01-dialogue-timeline/types';
import type { ChapterPartition } from '../../domains/02-chapter-segmentation/types';
import type { UniversalArtifactDocument } from '../../domains/01-artifact-document/types';
import type { SemanticEdge } from '../../domains/02-topological-graph/types';
import type { ChatThread, ThreadFolder } from '../../domains/06-chat-threads/types';

export interface ProjectSnapshot {
  projectId: string;
  turns: Turn[];
  chapters: ChapterPartition[];
  artifacts: UniversalArtifactDocument[];
  edges: SemanticEdge[];
  updatedAt: number;
  // Chat threads (see domains/06-chat-threads). Optional on load — the
  // registry backfills legacy snapshots; always written on save.
  threads?: ChatThread[];
  folders?: ThreadFolder[];
  activeThreadId?: string;
  // Present on list/create docs (mapped into workspace metadata):
  name?: string;
  codeName?: string;
  description?: string;
  color?: string;
}

/**
 * The port itself. Implementations own their own logging and error mapping —
 * the facade dispatches once and never branches per backend again.
 *
 * Contract notes (behavioral, identical for both impls as observed today):
 *  - load  → null ONLY when confirmed absent; any failure (network, permission,
 *           no session) THROWS — error must never masquerade as absence (H1).
 *  - list  → [] when unauthenticated / unreadable (never throws).
 *  - save  → full snapshot upsert; firestore merges, local replaces the record.
 *  - create→ writes a snapshot the facade already built (meta included);
 *            firestore THROWS when there is no signed-in user.
 *  - delete→ firestore THROWS when there is no signed-in user / on write error.
 *  - replaceAll → import semantics: local = atomic clear+write (restore),
 *            firestore = merge upserts (never deletes remote docs missing
 *            from the file — a restore must not destroy later writes).
 */
export interface ProjectStore {
  load(projectId: string): Promise<ProjectSnapshot | null>;
  list(): Promise<ProjectSnapshot[]>;
  save(snapshot: ProjectSnapshot): Promise<void>;
  create(snapshot: ProjectSnapshot): Promise<void>;
  delete(projectId: string): Promise<void>;
  replaceAll(projects: ProjectSnapshot[]): Promise<void>;
}
