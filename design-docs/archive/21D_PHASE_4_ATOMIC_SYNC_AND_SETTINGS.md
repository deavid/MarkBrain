# 21D — Phase 4: Normalized Atomic SQLite Storage, Delta Sync & Cross-Device Settings

> **Phase:** 4 of 7
> **Goal:** Replace whole-project blob overwrites with normalized, revision-tracked SQLite persistence on the VPS (`server/routes/projects.ts`), implement the client `vpsStore.ts` backed by the isolated `markbrain-vps:<host>:<email>` IndexedDB cache + atomic delta sync (`GET /api/projects/:id/delta?since=<rev>`), and sync model slot settings (`modelConfig.ts`) across PC and phone.
> **Prerequisite:** Phase 3 committed and green.

---

## 1. Why Atomic Storage & Revision Numbers Matter

In the old architecture, saving a project uploaded the entire `ProjectSnapshot` JSON and overwrote whatever was on the server. That caused two fatal bugs:
1. Every single chat turn rewrote every artifact, thread, and chapter in the project.
2. If your phone ran a background turn on the VPS while your PC tab was open, the next save from your PC overwrote the project and **erased the phone's turn**.

With normalized SQLite tables (`projects`, `threads`, `folders`, `turns`, `chapters`, `artifacts`, `edges`, `tombstones`) and a monotonic integer `revision` per project:
- Every write increments `projects.revision` by `1` inside a SQLite transaction and stamps the touched rows with `revision = newRev`.
- Deleting an entity (`artifact`, `thread`, `folder`, `turn`, `chapter`, `edge`) deletes the row **and** inserts a row into `tombstones (user_id, project_id, entity_type, entity_id, revision)` inside the same transaction.
- Any device holding `revision = R` can call `GET /api/projects/:projectId/delta?since=R` and receive **only** the rows created/updated/deleted since `R`.

---

## 2. Server Repository Layer (`server/db/projectRepo.ts`)

Create `server/db/projectRepo.ts` implementing the following synchronous `better-sqlite3` transactional operations (always scoped by `user_id`):

### 2.1 `listProjectsForUser(userId: number): ProjectSnapshot[]`
- Queries `projects` for `user_id` ordered by `updated_at DESC`.
- Assembles each project's `threads`, `folders`, `turns` (ordered by `seq ASC`), `chapters` (ordered by `order_index ASC`), `artifacts`, and `edges` into the canonical `ProjectSnapshot & { revision: number }`.

### 2.2 `loadProjectForUser(userId: number, projectId: string): (ProjectSnapshot & { revision: number }) | null`
- Returns `null` if no row exists in `projects` for `(user_id, project_id)`.
- Otherwise returns the full assembled `ProjectSnapshot & { revision: number }`.

### 2.3 `applyProjectSnapshotDiff(userId: number, snapshot: ProjectSnapshot): { revision: number }`
To preserve 100% compatibility with the existing `ProjectStore` port (`save(snapshot)`) while gaining **atomic row-level merging** so an open PC tab never erases turns/artifacts created on the phone:
- Inside a single `db.transaction(() => { ... })`:
  1. Reads current server state for `(userId, snapshot.projectId)`.
  2. Bumps `newRev = (current?.revision ?? 0) + 1`.
  3. Upserts `projects` metadata (`name`, `code_name`, `description`, `color`, `active_thread_id`, `granularity_law`, `revision = newRev`, `updated_at`).
  4. **Turns (`turns` table):**
     - Upserts every turn in `snapshot.turns` whose content or `meta_json` changed (stamping `revision = newRev`).
     - **CRITICAL ANTI-CLOBBER LAW:** Turns are only deleted from SQLite if explicitly listed in `explicitDeletes` (via `deleteThread` or `regenerateLastReply`), **never** merely because a stale tab's in-memory `snapshot.turns` hadn't fetched a newer turn from another device yet!
  5. **Artifacts, Chapters, Threads, Folders, Edges:**
     - Upserts changed rows (comparing JSON/content hash so unchanged rows keep their existing `revision`).
     - For deletions initiated by the client, records tombstones in `tombstones` with `revision = newRev`.

### 2.4 Dedicated Atomic Mutation Endpoints (`applyAtomicMutation`)
In addition to snapshot diffing, support explicit atomic operations via `POST /api/projects/:projectId/mutate`:
```ts
export type AtomicMutation =
  | { op: 'upsertArtifact'; artifact: UniversalArtifactDocument }
  | { op: 'deleteArtifact'; artifactId: string }
  | { op: 'upsertThread'; thread: ChatThread }
  | { op: 'deleteThread'; threadId: string }
  | { op: 'upsertFolder'; folder: ThreadFolder }
  | { op: 'deleteFolder'; folderId: string }
  | { op: 'upsertChapter'; threadId: string; chapter: ChapterPartition }
  | { op: 'deleteChapter'; chapterId: string }
  | { op: 'commitPair'; threadId: string; userTurn: Turn; assistantTurn: Turn; artifacts?: UniversalArtifactDocument[]; chapters?: ChapterPartition[] }
  | { op: 'replaceTurn'; threadId: string; turn: Turn };
```
Every mutation runs inside a single SQLite transaction, increments `projects.revision`, and returns `{ revision: newRev }`.

### 2.5 `getProjectDelta(userId: number, projectId: string, sinceRevision: number)`
Returns:
```ts
export interface ProjectDeltaResponse {
  projectId: string;
  revision: number;
  projectMeta?: {
    name: string;
    codeName: string;
    description: string;
    color: string;
    activeThreadId?: string;
    updatedAt: number;
  };
  threads: ChatThread[];
  folders: ThreadFolder[];
  turns: Turn[];
  chapters: ChapterPartition[];
  artifacts: UniversalArtifactDocument[];
  edges: SemanticEdge[];
  tombstones: Array<{ entityType: string; entityId: string }>;
  activeJobs: ChatJobSummary[]; // populated in Phase 5
}
```
Only rows with `revision > sinceRevision` are returned! If `sinceRevision === currentRevision`, all arrays are empty (`[]`) and the payload is `< 100 bytes`.

---

## 3. Mount Project Routes (`server/routes/projects.ts`)

Create `server/routes/projects.ts` (all routes protected by `requireAuth`):
1. `GET /api/projects` → returns `{ projects: listProjectsForUser(req.user.id) }`.
2. `GET /api/projects/:projectId` → returns `{ project: loadProjectForUser(req.user.id, projectId) }` (or `404`).
3. `POST /api/projects` → creates a new project, returns `{ project, revision }`.
4. `PUT /api/projects/:projectId` → runs `applyProjectSnapshotDiff(req.user.id, req.body)`, returns `{ ok: true, revision }`.
5. `POST /api/projects/:projectId/mutate` → runs `applyAtomicMutation(req.user.id, projectId, req.body.mutations)`, returns `{ ok: true, revision }`.
6. `GET /api/projects/:projectId/delta` → reads `?since=<number>`, returns `getProjectDelta(...)`.
7. `DELETE /api/projects/:projectId` → deletes the project and all child rows for `(req.user.id, projectId)`.
8. `POST /api/projects/replace-all` → imports an array of `ProjectSnapshot[]` into the user's account inside one transaction.

---

## 4. Client `vpsStore.ts` & Isolated IndexedDB Cache (`src/services/stores/vpsStore.ts`)

Create `src/services/stores/vpsStore.ts` implementing `ProjectStore`:
1. Uses `localBackend.ts` parameterized by `getActiveIdbName()` (`'markbrain-vps:' + host + ':' + email`) as its fast local mirror.
2. **`list()`:**
   - Fetches `GET /api/projects`, updates the `markbrain-vps:...` IndexedDB mirror, and returns the projects.
   - If offline (network error), falls back to reading the `markbrain-vps:...` IndexedDB mirror so the user can still view their workspace on a plane/subway.
3. **`load(projectId)`:**
   - Fetches `GET /api/projects/:projectId`, updates the `markbrain-vps:...` IndexedDB mirror (storing `revision`), and returns the snapshot.
4. **`save(snapshot)` / `create(snapshot)` / `delete(projectId)` / `replaceAll(projects)`:**
   - Writes to the `markbrain-vps:...` IndexedDB mirror **and** sends the update to `/api/projects/...`.
5. **Delta Sync Poller & Visibility Wake Hook (`src/application/useVpsDeltaSync.ts`):**
   - When in Connected VPS mode (`mode === 'vps'`) with an active project:
     - Tracks `lastRevisionRef.current`.
     - Whenever the tab regains focus (`document.visibilityState === 'visible'` or `window` `focus` event — e.g. **waking up the phone screen**) or every 10 seconds while visible, calls `GET /api/projects/:projectId/delta?since=${lastRevisionRef.current}`.
     - If `delta.revision > lastRevisionRef.current`, merges the new/updated `turns`, `artifacts`, `chapters`, `threads`, `folders`, and `tombstones` directly into the live domains (`timeline`, `artifacts`, `segmentation`, `threadRegistry`, `graph`) and updates `lastRevisionRef.current = delta.revision`.

Update `src/services/persistenceService.ts`:
- `export type StorageBackend = 'local' | 'vps';`
- `getBackend()` reads `getWorkspaceMode()` from `workspaceSession.ts`.
- `getStore()` returns `vpsStore` when `getBackend() === 'vps'`, else `localStore`.

---

## 5. Cross-Device Model Slot & Key Tier Sync (`src/data/modelConfig.ts`)

In `src/data/modelConfig.ts`:
- When in Connected VPS mode (`mode === 'vps'`):
  - On login / boot, `hydrateAccountSettingsFromVps()` calls `GET /api/account/settings` and writes `modelSlots` into the scoped `markbrain:vps:...:modelConfig` + updates the key summary (`configured` / `hint` / `chatTier`).
  - Whenever `setModelForSlot(slot, modelId)` or `swapChatKey(tier)` is called in Connected VPS mode, it updates local state immediately **and** fires `PUT /api/account/settings` so the user's phone and PC always stay in sync.

---

## 6. Phase 4 Unit & Integration Tests (`src/tests/atomic-sqlite-sync.test.ts`)

Create `src/tests/atomic-sqlite-sync.test.ts` testing:
1. **Multi-device anti-clobber law:**
   - Device A (PC) and Device B (Phone) both load Project X at `revision = 1`.
   - Device B commits a new chat Pair (`turn-ask-2`, `turn-reply-2`) via `commitPair` → `revision = 2`.
   - Device A (still holding its earlier turn list from `revision = 1`) edits an artifact and saves → `revision = 3`.
   - Verify that SQLite at `revision = 3` contains **both** Device B's new chat Pair **and** Device A's edited artifact (zero data lost!).
2. **Delta sync (`GET /api/projects/:id/delta?since=1`):**
   - Returns only the rows changed in revisions `2` and `3`, and returns empty arrays when called with `?since=3`.
3. **Tombstone propagation:**
   - Deleting an artifact on Device A records a tombstone at `revision = 4`; Device B pulling `?since=3` receives the tombstone and removes the artifact from its domain.
4. **Cross-device settings sync:**
   - Changing the `chat` model slot to `gemini-3.8-flash` via `PUT /api/account/settings` is immediately returned to a second device calling `GET /api/account/settings`.

---

## 7. Phase 4 Verification Gate

```bash
npm run lint
npm test
npm run build
```

Commit Phase 4:
```bash
git add -A
git commit -m "Phase 4: normalized SQLite atomic project store, revision delta sync, and cross-device settings"
```
