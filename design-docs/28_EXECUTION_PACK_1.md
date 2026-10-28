# 28 — Execution Pack 1: Clear-to-Build Work (Ready for Mechanical Execution)

> **Date:** 2026-10-27
> **Branch / Starting Point:** Branch off `dev-vega` into a new working branch for each work package (or one `dev-<agent>-pack1` branch if doing them sequentially). Rebase cleanly on top of `dev-vega` before starting.
> **Why this pack exists:** `design-docs/27_UNEARTHED_QUESTIONS_AND_TENSIONS.md` is the full map of open dreams/tensions. **This file contains ONLY the work that has zero open design questions left** and is ready to be executed by an agent with tests proving every step. Anything with an open UX/product question is explicitly excluded and listed in §7 ("Not in this pack").
>
> **Non-Negotiable Standing Rules (read before touching code):**
> 1. **Git:** Only touch this repo's own worktree/branch. **NEVER push to a remote**, never create git tags, and never modify other worktrees/branches.
> 2. **No External Stress:** Do not run real API calls to Google/OpenRouter/Anthropic from tests, fixtures, or UI open/close cycles. Any network-dependent behavior must be mocked/stubbed (`vi.stubGlobal('fetch', ...)`, local Express listener, or mocked vault client).
> 3. **No UI Theater / AI Slop:** No marketing copy, no invented jargon, no fake "smart" dashboards, no top bars/sticky headers (mobile-first, min viewport **350×700**), and no per-chunk log spam (`logger.action` only on human gestures, max 16 events/gesture).
> 4. **Verification Gates (must be green before committing):**
>    - `npx tsc --noEmit`
>    - `npx vitest run`
>    - `npm run build` (includes `verify-clean-dist` + SW precache stamping)
>    - **Do not use `happy-dom` or `jsdom`** for new tests unless explicitly installed; Node env + `vi.stubGlobal` for `localStorage` / `window` / `navigator` is the established pattern.

---

## Package 1: Artifact Editing + Persistent 4-Layer Revisions (with Diff & Revert)

### 1.1. Why (Motivation)
Artifacts are the user's durable documents ("my Google Docs"). The LLM must be able to upsert them freely during chat; the user must also be able to edit them manually. Both kinds of writes must be **versioned persistently** (across reloads and devices), viewable as diffs, revertable in one click, and must never leave stale summary layers lying to the LLM. See `27_UNEARTHED_QUESTIONS_AND_TENSIONS.md` §2.

### 1.2. Current Code Bugs to Fix (verify first with a test!)
1. **Client queue bug (`src/application/sendQueue.ts` `applyBufferedArtifacts` around line 1228):** When an `<artifact_upsert>` matches an existing artifact (`const existing = deps.artifacts.getArtifact(code) || deps.artifacts.getArtifact(u.id)`), it calls `deps.versioning.recordRevision(...)` and **forgets to update `existing.current` via `deps.artifacts.upsertArtifact(...)`**! Existing notes never actually update on the client path.
2. **Server job bug (`server/db/projectRepo.ts` `commitJobPairTransaction` around line 843):** On `<artifact_upsert>`, it blindly calls `upsertArtifact(db, ..., newRev)` with the new doc, overwriting the artifact without recording the previous state in a revision table.
3. **Ephemeral history:** `ArtifactVersioningDomain` (`src/domains/01-artifact-versioning/ArtifactVersioningDomain.ts`) is RAM-only. Neither `persistWorker.ts` nor SQLite saves it, so hitting F5 wipes the History tab in `ArtifactDetailModal`.
4. **Unwired manual editing:** `handleUpdateArtifactContent` in `src/ui/artifacts/createArtifactHandlers.ts` exists but has no UI. `ArtifactDetailModal.tsx` is read-only.

### 1.3. Data Model Changes (Relational Envelope + `doc_json` Principle)
- **`src/domains/01-artifact-versioning/types.ts`:**
  ```ts
  import type { ArtifactLayers } from '../01-artifact-document/types';
  export type RevisionActor = 'user' | 'ai';
  export interface RevisionProvenance {
    threadId?: string;
    turnId?: string;
    turnIndex?: number | null;
  }
  export interface ArtifactRevision {
    version: number;
    timestamp: number;
    actor: RevisionActor;               // NEW: 'user' or 'ai'
    changeSummary: string;              // keep field name for legacy compat
    provenance?: RevisionProvenance;    // NEW: chat/turn provenance for AI updates
    title: string;                      // NEW: full snapshot of title at this revision
    layers: ArtifactLayers;             // NEW: full 4-layer snapshot
    /** @deprecated Old RAM revisions had {content, previousContent}. Keep optional for legacy reads only. */
    content?: string;
    previousContent?: string;
  }
  ```
- **`ProjectSnapshot` (`src/services/stores/projectStore.ts`):** Add:
  ```ts
  /** Artifact revision history, keyed by artifact id. */
  revisions?: Record<string, ArtifactRevision[]>;
  ```
- **SQLite (`server/db/index.ts` `SCHEMA` constant):** Add to the declarative schema spec:
  ```sql
  CREATE TABLE IF NOT EXISTS artifact_revisions (
    user_id INTEGER NOT NULL,
    project_id TEXT NOT NULL,
    artifact_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    timestamp INTEGER NOT NULL,
    actor TEXT NOT NULL DEFAULT 'ai',
    change_summary TEXT NOT NULL DEFAULT '',
    provenance_json TEXT NOT NULL DEFAULT '{}',
    title TEXT NOT NULL DEFAULT '',
    layers_json TEXT NOT NULL DEFAULT '{}',
    PRIMARY KEY (user_id, project_id, artifact_id, version),
    FOREIGN KEY (user_id, project_id) REFERENCES projects(user_id, project_id) ON DELETE CASCADE
  );
  ```
  Also add to `server/db/index.ts` the small helper functions in `projectRepo.ts` (`upsertArtifactRevisions(db, userId, projectId, artifactId, revisions, newRev)`, `loadArtifactRevisions(db, userId, projectId)`) using the exact same `(user_id, project_id, ..., revision)` upsert pattern as other domain tables. Include `artifact_revisions` in the full snapshot GET (`GET /api/projects/:id` returning `snapshot.revisions`), in the `/delta` assembly, and in the `tombstones`/`purge` path when an artifact is deleted (delete rows in `artifact_revisions` for that artifact).

### 1.4. Client Persistence & Domain Wiring
- **`persistWorker.ts`:** In `payload`, add `revisions: versioning.getAllRevisions()` (add `getAllRevisions(): Record<string, ArtifactRevision[]>` to `ArtifactVersioningDomain`).
- **`snapshotLoader.ts` (`hydrateProjectFromSnapshot`):** Add `versioning: IArtifactVersioningDomain` to `HydrationDeps`, and call `versioning.loadHistory(snap?.revisions || {})` (add `loadHistory(map)` to `ArtifactVersioningDomain`).
- **Pass `versioning` through `DomainRegistry.tsx`** into both functions (`persistProjectSnapshot` / `hydrateProjectFromSnapshot`).
- **Legacy migration:** If `ArtifactVersioningDomain.recordRevision` is called with old-style `content: string`, treat it as `{ body: content }` snapshot with existing layers. Make `getHistory` return the stored list; never wipe an artifact's existing revisions when loading an empty list.
- **VPS delta sync (`src/application/useVpsDeltaSync.ts` and `mergeDeltaIntoDomains`):** When delta rows contain `revisions` or artifact updates, ensure `versioning` merges new revisions by `artifactId + version` (never duplicates on re-hydrate or 10s poll).

### 1.5. Fix the AI Upsert Paths (Client & Server)
- **Client (`sendQueue.ts` `applyBufferedArtifacts`):**
  - If `existing` exists:
    1. Record a revision snapshot of **the OLD state** (title + `existing.current` layers) with `actor: 'ai'`, `changeSummary: \`Update from chat: ${u.content.description}\``, and `provenance: { threadId, turnId: assistantTurnId, turnIndex: assistantTurnIndex }`.
    2. Call `deps.artifacts.upsertArtifact({ ...existing, title: u.title || existing.title, current: { subtitle: u.content.subtitle, description: u.content.description, summary: u.content.summary, body: u.content.body }, updatedAt: Date.now() })`.
  - If new artifact: same behavior as today, plus record initial revision (version 1) with `actor: 'ai'` and provenance.
- **Server (`server/db/projectRepo.ts` `commitJobPairTransaction`):**
  - Before calling `upsertArtifact` for each `u` in `input.artifacts`, load the existing artifact doc (`SELECT doc_json FROM artifacts WHERE ...`).
  - If it exists, build an `ArtifactRevision` of its **old** `title` and `current` layers with `actor: 'ai'`, provenance from `input.threadId`, `input.targetTurnId ?? assistantTurnId`, and the computed turn index, and upsert it into `artifact_revisions` in the same SQLite transaction as the pair commit.
  - If new, upsert initial revision (version 1).

### 1.6. Manual Editing + Stale-Layer Guard in `ArtifactDetailModal.tsx`
- Add an **Edit** toggle button (pencil icon) in `ArtifactDetailModal` header.
- **Edit mode:** A `textarea` for `body` (monospace, `font-mono text-11`), plus editable `title` (input) and `subtitle` (input/textarea).
- On **Save** (`handleUpdateArtifactContent` in `createArtifactHandlers.ts`, extend to accept title/subtitle/layers or add a new `handleManualArtifactEdit`):
  1. Call `versioning.recordRevision` with `actor: 'user'`, `changeSummary: 'Manual edit'`, snapshotting **OLD** title + layers.
  2. Update `title`, `subtitle`, `body` via `artifactsDomain.upsertArtifact`.
  3. **Stale-layer guard (`ArtifactLayers` + `UniversalArtifactDocument`):**
     - Add optional `layersStaleAt?: number` to `UniversalArtifactDocument` (or `layersStale?: boolean` on `ArtifactDocumentDomain`).
     - If `body` changed and `description` / `summary` were NOT updated in the same manual edit, set `layersStaleAt: Date.now()` on the artifact.
- **Compiler stale behavior (`src/domains/03-optical-compiler/index.ts` / `artifactCutText` in `01-artifact-document/ArtifactDocumentDomain.ts`):**
  - If an artifact is stale (`layersStaleAt` set), then:
    - At `full` granularity: send `Title + Subtitle + Body` **ONLY** (omit `description` and `summary` since they no longer match `body`).
    - At `description` / `summary` granularity: append `[Layers out of date — read full note for current content]` or render a stale badge in the UI. At `title` no change.
- **UI indicator + Regenerate button:**
  - In `ArtifactDetailModal`, when stale, show a small amber badge: `Summary layers out of date` with a `Refresh layers` button that calls `/api/extract` (existing server route `server/routes/extract.ts`) with the current `body` and updates `subtitle`, `description`, `summary`, then clears `layersStaleAt` (recording a revision snapshot of the stale state first with `actor: 'ai'`).

### 1.7. History Tab: Real Diffs + Revert + Provenance
- In `ArtifactDetailModal.tsx` History tab:
  - Each revision row shows: `vN` badge, timestamp, `actor` chip (`Manual edit` or `AI · chat "<threadTitle>" msg #N`), and `changeSummary`.
  - **View Diff button** per revision: opens a side-by-side or inline line diff between that revision's `layers.body` and the previous revision's `layers.body` using existing `src/utils/lineDiff.ts` (`diffLines`, `diffStats`). Use the same dark-surface/well UI language as `RevisionTriageModal.tsx` (no borders; `bg-surface-1/2`, `shadow-well`, `bg-recess-1` for removed lines, `bg-veil-1` for added).
  - **Revert to this version button:** Calls `versioning.rollback(artifactId, targetVersion)` which must:
    1. Record a NEW revision snapshot of the **current** state before reverting (actor `'user'`, `changeSummary: \`Revert to v${targetVersion}\``).
    2. Restore `title` and all four `layers` to the artifact via `artifactsDomain.upsertArtifact`.
  - If `provenance.threadId` exists, add a **"Open chat"** link/button that closes the modal and switches to that thread (`selectThread(threadId)`) and scrolls to the turn if `turnId` present.

### 1.8. "New Note" + Download `.md`
- Add a `+ New Note` button in `ArtifactsLibraryView` (header/import row) that opens a minimal create modal (title, optional body) and calls `artifactsDomain.upsertArtifact` (new id `art-${Date.now()}-...`), records initial revision (`actor: 'user'`), and selects it.
- Add a **Download .md** icon-button in `ArtifactDetailModal` (download icon next to close): creates a `Blob` with `artifact.current.body` and triggers download of `${artifact.code || artifact.id}.md`.

### 1.9. Tests Required (all must pass)
- `src/tests/artifact-revisions.test.ts`:
  - `recordRevision` + `getHistory` + `rollback` round-trip restores full `title` + all 4 layers (including empty/missing layers).
  - `loadHistory` / `getAllRevisions` round-trip preserves data.
- `src/tests/artifact-upsert-bugs.test.ts`:
  - Mock domain deps and invoke `applyBufferedArtifacts` (or run a simulated send) with an `<artifact_upsert>` on an existing artifact → assert `artifacts.upsertArtifact` was called with new layers AND `versioning.recordRevision` captured old layers + provenance.
  - Run `commitJobPairTransaction` against an in-memory SQLite DB (`initDb(':memory:')`) with an existing artifact and assert `artifact_revisions` row inserted with old layers and `actor='ai'`.
- `src/tests/stale-layers.test.ts`:
  - Setting `layersStaleAt` causes compiler's `full` cut to omit description/summary while still sending body; `description` cut indicates stale.
- **Client-side editing test (optional DOM-free handler test):** manual edit handler records revision before upsert and marks stale when only body changes.
- **Persistence integration test:** `hydrateProjectFromSnapshot` with `snap.revisions` → `versioning.getHistory` returns them; `persistProjectSnapshot` payload includes `revisions`.

---

## Package 2: Chatbot Capability Toggles ("Extensions") + Chapter Header Cleanup

### 2.1. Why (Motivation)
The system prompt is bloated with XML schema instructions (`<topic_shift>`, `<artifact_upsert>`, `<link>`) on every turn, which makes small/free models dumber and trigger-happy (`<topic_shift>` every 3 messages). Users must control which "extensions" the chatbot has, with `<topic_shift>` **OFF by default**. See `27_UNEARTHED_QUESTIONS_AND_TENSIONS.md` §3.

### 2.2. Data Model
- Define in `src/domains/06-chat-threads/types.ts`:
  ```ts
  export interface ChatCapabilities {
    /** Allow/instruct LLM to emit <topic_shift> to cut chapters. DEFAULT: false. */
    autoChapter: boolean;
    /** Allow/instruct LLM to emit <artifact_upsert>. DEFAULT: true. */
    writeArtifacts: boolean;
    /** Allow/instruct LLM to emit <link>. DEFAULT: false. */
    graphLinks: boolean;
  }
  export const DEFAULT_CHAT_CAPABILITIES: ChatCapabilities = {
    autoChapter: false,
    writeArtifacts: true,
    graphLinks: false,
  };
  ```
- Add `capabilities?: Partial<ChatCapabilities>` to `ChatThread` (per-thread overrides), and `capabilities?: Partial<ChatCapabilities>` to `ProjectSnapshot` (project default; optional for backward compat).
- `resolveCapabilities(thread, projectSnapshot): ChatCapabilities` merges: `DEFAULT_CHAT_CAPABILITIES` ← project default ← thread override.

### 2.3. Compiler (`src/domains/03-optical-compiler/index.ts`)
- Add `capabilities?: ChatCapabilities` to `OpticalCompilerOptions` (default `DEFAULT_CHAT_CAPABILITIES` when absent).
- Split `systemInstruction` into:
  - **Base persona** (always present, the "You are MarkBrain, a thinking partner..." + grounding instructions).
  - **Capability blocks:**
    - `<topic_shift>` instruction block **only included when `capabilities.autoChapter === true`** (and add explicit wording: *"Topic changes are rare — only emit this when the conversation truly moves to a substantially different subject; do not emit on ordinary follow-ups."*).
    - `<artifact_upsert>` block **only included when `capabilities.writeArtifacts === true`**.
    - `<link>` block **only included when `capabilities.graphLinks === true`**.
- If all three are off, system prompt must not mention `topic_shift`, `artifact_upsert`, or `<link>` at all.
- Add a test asserting each capability flag independently adds/removes its block from `compiled.systemInstruction`.

### 2.4. Stream Demuxer (`src/domains/03-stream-protocol/index.ts`)
- Demuxer already parses `<topic_shift>`, `<artifact_upsert>`, `<link>` and strips them from clean text. Keep parsing/stripping them for robustness (so a rogue model can't pollute the chat with XML), but:
  - In `sendQueue.ts` (`applyBufferedShifts`, `applyBufferedArtifacts`) and `server/jobs/chatJobRunner.ts` / `server/db/projectRepo.ts`:
    - Only apply buffered topic shifts if `capabilities.autoChapter` is true.
    - Only apply buffered artifact upserts if `capabilities.writeArtifacts` is true.
    - Ignore links if `capabilities.graphLinks` is false.
  - Pass resolved capabilities into the job enqueue payload (`staged_attachments_json` sibling field `capabilities_json` in `chat_jobs`, or include in job insert params; thread it into `commitJobPairTransaction`).

### 2.5. UI — Where the Toggles Live (keep it minimal and mobile-friendly)
- Add a small `SlidersHorizontal` (or `Settings2`) icon button on the chat composer row (left of `[+ Attach]` or in the header near the orb) that opens a compact **"Chat capabilities" popover/panel** (a modal like `MirrorPanel` on mobile, a dropdown on desktop — use existing modal pattern, NO new top bars):
  - Three checkboxes/toggles with plain labels:
    - `Write notes (<artifact_upsert>)` → default ON
    - `Cut chapters (<topic_shift>)` → default OFF
    - `Link notes (<link>)` → default OFF
  - Scope selector: `This chat` / `All chats in project (default)` (writes to thread override vs project default).
- Show resolved state read-only in the Mirror Panel's `System Message` tab header (e.g. `Capabilities: notes ON · chapters OFF · links OFF`).

### 2.6. Chapter Controls Wiring (`src/ui/chat/ChatView.tsx` chapter header)
Wire existing-but-unused domain methods into a small dropdown menu (⋯ icon) on the chapter header (next to the fold chevron), with **no** new sticky bars:
1. **Split chapter at this message** (already exists as `handleDeclareChapter` — keep).
2. **Merge with previous chapter:** implement `mergeChapters(chapterId)` in `ChapterSegmentationDomain` (merge current chapter into previous: extend previous `endIndex` to current `endIndex`, remove current chapter; if previous is in-progress, refuse).
3. **Move seam up/down:** call `segmentation.shiftBoundary(chapterId, newStartIndex ± 1)` (guard: cannot move past turn 0 or into next chapter).
4. **Regenerate summary (Recalibrate):** wire `recalibration.recalibrateSummary(chapterId, steeringPrompt?)` (`src/domains/03-chapter-recalibration/index.ts`) into a menu item `Regenerate summary` (optionally opens a tiny input for a steering note like *"focus on mechanics decisions"*). Guard: not on in-progress chapters (already guarded in `createChapterHandlers.handleSummarizeChapter`).

### 2.7. Tests Required
- `src/tests/capabilities.test.ts`:
  - Default resolution (project default ← thread override).
  - Compiler includes/excludes each XML instruction block per flag; when `autoChapter` on, includes the "rare" guidance sentence.
  - Demuxer/`applyBufferedShifts` ignores shifts when `autoChapter` is false; artifact upserts ignored when `writeArtifacts` false (including the server `commitJobPairTransaction` path against `:memory:` SQLite).
- `src/tests/chapter-controls.test.ts`:
  - `mergeChapters` merges correctly and preserves turn windows; refuses in-progress previous.
  - `shiftBoundary` respects bounds.
  - Recalibrate handler calls the gateway with correct model slot (`summarize`).

---

## Package 3: Bijective `.tar.gz` Plaintext Export/Import (Client-Side) + Offline Replica Access on AuthGate

### 3.1. Why (Motivation)
Data sovereignty + durability: any user must be able to export their full workspace (or a single project) as human-readable plaintext files, import them into ANY MarkBrain instance (Local mode or another VPS) losslessly, and access/export their local IndexedDB replica even when logged out and the VPS is unreachable. See `27_UNEARTHED_QUESTIONS_AND_TENSIONS.md` §1. The VPS must stay light — archive creation happens **in the browser**.

### 3.2. Zero-Dependency Tar Writer/Reader (`src/utils/tarGz.ts`)
- Implement POSIX `ustar` writer:
  ```ts
  export interface TarEntry { path: string; data: Uint8Array; mtime?: number; }
  export function createTar(entries: TarEntry[]): Uint8Array;
  export async function createTarGz(entries: TarEntry[]): Promise<Uint8Array>; // uses native CompressionStream('gzip')
  export function parseTar(bytes: Uint8Array): TarEntry[];
  export async function parseTarGz(bytes: Uint8Array): Promise<TarEntry[]>; // uses native DecompressionStream('gzip')
  ```
  - 512-byte headers: name (100B), mode (`0000644\0`), uid/gid (0), size (octal, 12B), mtime (octal), checksum (spaces then sum), typeflag (`'0'`), magic `ustar\0`, version `00`.
  - File content padded to 512-byte blocks; two zero blocks at end.
  - `path` must be sanitized: reject `..`, absolute paths, backslashes on import.
  - Node fallback: if `CompressionStream` undefined (some test environments), dynamically use `node:zlib` `gzipSync`/`gunzipSync` via guarded import or a small injectable codec param so `vitest` in Node env works without browser globals.

### 3.3. Canonical Plaintext Tree (`src/domains/plaintextTree.ts` — pure, shared by browser & Node CLI)
```text
<project-code-or-id>/
  project.json                       # ProjectSnapshot minus turns/chapters/artifacts/edges/threads/folders/revisions (metadata + capabilities + granularityLaw)
  threads/<thread-id>.json           # ChatThread + its turns[] + chapters[] (or separate turns/chapters files per thread)
  artifacts/<code-or-id>.md          # YAML frontmatter + Markdown body
  artifacts/<code-or-id>.history.json# ArtifactRevision[] for that artifact
  edges.json                         # SemanticEdge[]
```
- **Artifact `.md` YAML frontmatter fields (flat, kebab-case):** `id`, `code`, `title`, `type`, `category`, `tags`, `lifecycle`, `color`, `createdAt`, `updatedAt`, `layersStaleAt`, `subtitle` (folded `>-` block), `description` (`|-` block), `summary` (`|-` block), `graph` (JSON inline or nested YAML), then `---` then raw `body`.
- **Functions:**
  ```ts
  export function snapshotToTree(snapshot: ProjectSnapshot): TarEntry[]; // UTF-8 encodes text files
  export function treeToSnapshot(entries: TarEntry[], fallbackProjectId?: string): ProjectSnapshot;
  export async function exportProjectTarGz(snapshot: ProjectSnapshot): Promise<Uint8Array>;
  export async function importProjectTarGz(bytes: Uint8Array): Promise<ProjectSnapshot>;
  ```
- Implement a minimal, strict YAML subset parser for our frontmatter (do NOT add a heavy dependency if avoidable; if using `yaml` npm package, verify it's already in `package.json` or add it and run `npm install --legacy-peer-deps`). YAML writing must be deterministic (sorted keys, consistent indentation) so Git diffs stay clean.

### 3.4. Bijection CI Test (`src/tests/plaintext-roundtrip.test.ts`) — THE MOST IMPORTANT TEST
1. Build a fixture `ProjectSnapshot` that exercises **every field** of every type (turn with `meta`, `extractedArtifacts`, `telemetry`, attachments with `turnIndex`/`turnId`, chapters with all granularity values + `subtitle`/`description`/`summary`, artifacts with all layers + `graph.relationships` + `yamlDocument` + `lifecycle` + `layersStaleAt`, threads/folders/edges, revisions with provenance + actor, project `capabilities`, `granularityLaw`). Include Unicode, multiline Markdown, `---` inside body, and empty strings.
2. **Reflective coverage assertion:** walk the fixture and assert no `undefined` values in required fields (fail loudly when a new required field is added to the types but not to the fixture — this is the "rot detector").
3. `snapshotToTree` → `treeToSnapshot` → assert **deep equality** with the original snapshot (normalizing only `updatedAt` if intentionally regenerated).
4. Also test `exportProjectTarGz` → `importProjectTarGz` byte-level round-trip, and `parseTarGz(createTarGz(entries))` equality.

### 3.5. UI Wiring (Sidebar I/O + Project-level)
- In `Sidebar.tsx` (Import/Export I/O accordion), add:
  - **Export Plaintext (.tar.gz):** exports ALL projects as a single `.tar.gz` containing one folder per project, using `getBackend().list()` (or compose current snapshots). Trigger browser download via `Blob` + `URL.createObjectURL`.
  - **Import Plaintext (.tar.gz):** file picker accepting `.tar.gz`/`.tgz`/`.tar`; calls `importProjectTarGz` per project folder; for each snapshot, calls `getBackend().create(snapshot)` if new id, else show a small conflict choice (`Import as new copy` [new projectId + name suffix] vs `Replace existing` [calls `save`]).
  - Also add **Export this project (.tar.gz)** next to the active project row (or in `ExportModal.tsx` as a new `plaintext` format option that produces the tar.gz instead of a text blob).
- Keep the old `Export Database JSON` button for now (do not break existing flows) but label the new one clearly as `Plaintext backup (.tar.gz)`.

### 3.6. Offline Replica Access (`src/ui/workspace/AuthGate.tsx` + `src/services/workspaceSession.ts`)
- **Track known replicas:** In `workspaceSession.ts`, add:
  ```ts
  const KNOWN_REPLICAS_KEY = 'markbrain:knownReplicas';
  export interface KnownReplica { baseUrl: string; email: string; idbName: string; lastUsedAt: number; }
  export function listKnownReplicas(): KnownReplica[];
  export function rememberReplica(baseUrl: string, email: string): void; // called on successful VPS login + on delta sync
  export function forgetReplica(baseUrl: string, email: string): void;   // only on explicit "wipe local replica"
  ```
- **AuthGate changes:**
  - Below the Sign In form and "Use Local Workspace", if `listKnownReplicas().length > 0`, render a **"Offline replicas on this device"** section listing each replica (`email @ host`) with an **Open offline** button.
  - Clicking **Open offline**: sets `markbrain:workspaceMode = 'vps'` and saves a session object with `token: ''` and a new `offline: true` flag on `VpsSessionInfo` (or a `markbrain:offlineReplica` flag), then enters the workspace **without calling `POST /api/auth/login`**.
  - When in offline replica mode: `apiFetch` calls must short-circuit to local mirror (or fail quietly without critical banners), `vpsStore.load/list` read from `localLoadProject/localListProjects` only, no background `/delta` polling (skip `useVpsDeltaSync` when `offline: true`), and `vpsSync.replayOutbox` must no-op. Show a small non-intrusive `Offline replica` badge near the sidebar account area (not a top bar).
  - **Export works fully offline:** since `getBackend().list()` in offline mode reads the IndexedDB mirror, `Export Plaintext (.tar.gz)` works with zero network.
- **Sign Out options:** Change Sign Out to show two choices when in VPS mode:
  - `Sign out (keep offline replica)` → `clearVpsSession()` + `setWorkspaceMode` back to gate but **keep** IndexedDB + `knownReplicas` entry.
  - `Sign out & wipe local replica` → also `indexedDB.deleteDatabase(getActiveIdbName())` and `forgetReplica(...)`.
- **Optional local unlock (nice-to-have, only if simple):** store a `kdfSalt` + `verifierHash` (PBKDF2 of password) in `knownReplicas` on login and require the same password to open the offline replica. If this adds scope/risk, leave it OUT of this pack and note it as a follow-up — the primary requirement is *access/export when VPS is down*, not shared-device encryption.

### 3.7. Tests Required
- `plaintext-roundtrip.test.ts` (bijection, see §3.4).
- `tar-gz.test.ts`: header encoding, padding, Unicode filenames, gzip round-trip (using Node zlib fallback in test env), path sanitization rejects `../evil`.
- `offline-replica.test.ts`: `rememberReplica`/`listKnownReplicas`/`forgetReplica` storage behavior; AuthGate renders offline section when replicas exist (can be a pure render/logic test without full DOM if using react-test-renderer is not available — otherwise cover the session helpers + offline store selection logic).

---

## Package 4: Ephemeral API Call Flight Recorder (7-Day Inspector)

### 4.1. Why (Motivation)
Principle 1 demands seeing exactly what happened on the wire: exact request (secrets scrubbed), stopwatch milestones, and raw response, kept ephemerally for debugging (≤7 days), never backed up. See `27_UNEARTHED_QUESTIONS_AND_TENSIONS.md` §5.

### 4.2. Server-Side Recorder (`server/lib/callRecorder.ts`)
- SQLite table (add to `SCHEMA` in `server/db/index.ts`):
  ```sql
  CREATE TABLE IF NOT EXISTS api_call_logs (
    id TEXT PRIMARY KEY,
    user_id INTEGER,
    kind TEXT NOT NULL,            -- 'chat' | 'summarize' | 'extract' | 'title' | 'embed' | 'qa'
    provider TEXT NOT NULL,        -- 'gemini' | 'openrouter'
    model TEXT NOT NULL,
    t_send INTEGER NOT NULL,
    t_ack INTEGER,
    t_first_token INTEGER,
    t_end INTEGER,
    status TEXT NOT NULL,          -- 'ok' | 'error' | 'aborted'
    request_json TEXT NOT NULL,    -- { endpoint, model, systemInstruction, compiledPrompt/messages, params } (NO api keys/headers)
    response_text TEXT,            -- raw provider text (unparsed)
    usage_json TEXT,               -- token usage metadata
    error_text TEXT,
    job_id TEXT,                   -- nullable, links send-and-forget jobs
    turn_id TEXT                   -- nullable, links committed assistant turn when known
  );
  CREATE INDEX IF NOT EXISTS idx_api_call_logs_user_time ON api_call_logs(user_id, t_send DESC);
  ```
- `recordCallStart({ userId, kind, provider, model, request })` → returns `id`; `recordCallAck(id)`, `recordCallFirstToken(id)`, `recordCallEnd(id, { status, responseText, usage, error, turnId })`.
- Prune on insert: `DELETE FROM api_call_logs WHERE t_send < ?` with `Date.now() - 7*24*3600*1000`. Also cap at e.g. latest 500 calls per user (delete older).
- **Instrument these call sites:**
  - `server/routes/chat.ts` `/api/chat/stream`
  - `server/jobs/chatJobRunner.ts` `runJob` (set `job_id`, and set `turn_id` after `commitJobPairTransaction` returns `assistantTurnId`)
  - `server/routes/summarize.ts`, `server/routes/extract.ts`, `server/routes/title.ts`
  - `server/routes/searchIndex.ts` (qa/embed calls) — mark kind accordingly
- **Secrets rule:** never log `Authorization` headers, API keys, vault key material, or `user_secrets`. Only model, provider, endpoint path, systemInstruction, compiledPrompt/messages, params, and raw response.
- **Routes (behind `requireAuth`):**
  - `GET /api/logs/calls?limit=50&before=<t_send>` → list newest first (metadata only, truncate `request_json`/`response_text` to e.g. 200 chars for list view).
  - `GET /api/logs/calls/:id` → full record (only if `user_id === req.user.id`).

### 4.3. Client-Side (Local Mode) Recorder (`src/services/callLogStore.ts`)
- For **Local Workspace** (browser direct provider calls in `src/gateway/providers/gemini.ts` and `openrouter.ts`, plus `src/gateway/direct.ts`), record the same shape into a separate IndexedDB database `markbrain-call-logs` (store `calls`, key `id`, index `t_send`), with the same 7-day + 500-entry pruning. Never sent to any server.
- Reuse a shared type `ApiCallLog` in `src/domains/callLogTypes.ts` (or `src/types`) used by both server and client.

### 4.4. UI Inspector
- **`ServerLogsModal.tsx`:** add a tab **"API Calls (last 7d)"**:
  - List rows: `kind`, `model`, `status`, `t_send` formatted, and computed durations (`ackMs`, `ttftMs`, `totalMs` from timestamps).
  - Click a row → detail view showing full `systemInstruction`, `compiledPrompt`/messages, `response_text` (raw, unparsed), `usage`, and `error_text`, with a `Copy` button per section (reuse `MirrorPanel`'s raw/rendered toggle pattern).
  - Data source: in VPS mode call `GET /api/logs/calls`; in Local mode read from `markbrain-call-logs` IndexedDB.
- **Turn badge deep-link (VPS path first):** on an assistant turn's telemetry badge (in `ChatView.tsx` where `turn.meta` token/latency is shown), if `turn.meta.callLogId` exists (set it in `commitJobPairTransaction` when we know the log id, and in client `sendQueue` for local mode), make it clickable to open `ServerLogsModal` directly at that call id. If wiring the badge proves fiddly, ship the modal tab first and add the badge link as a small follow-up commit.

### 4.5. Tests Required
- `src/tests/call-recorder.test.ts` (server, `:memory:` SQLite):
  - start/ack/first-token/end lifecycle writes correct timestamps and status.
  - pruning deletes records older than 7 days and beyond 500 per user.
  - `GET /api/logs/calls/:id` returns 404 for another user's log (use the real Express listener pattern from `session-sliding-renewal.test.ts`).
  - **Secrets test:** create a recorder call with a fake request object containing an `apiKey`/`Authorization` field and assert those fields never appear in stored `request_json`.
- Client store test: IndexedDB-backed pruning logic can be tested with a mocked IDB or by factoring prune into a pure function and testing that.

---

## Package 5: Declarative Schema Annealing + Envelope/`doc_json` Cleanup

### 5.1. Why (Motivation)
Avoid brittle numbered SQL migrations. Domain features should not require SQL schema changes. See `27_UNEARTHED_QUESTIONS_AND_TENSIONS.md` §1 (Architecture locked).

### 5.2. Declarative Schema Spec (`server/db/schemaSpec.ts`)
- Extract the current `SCHEMA` string from `server/db/index.ts` into a structured spec:
  ```ts
  export interface ColumnSpec { name: string; ddl: string; }
  export interface TableSpec { name: string; createSql: string; columns: ColumnSpec[]; indexes?: string[]; }
  export const TABLES_SPEC: TableSpec[] = [ /* users, sessions, user_secrets, user_settings, projects, threads, folders, turns, chapters, artifacts, edges, tombstones, chat_jobs, artifact_index_sections, tts_cache, artifact_revisions (Package 1), api_call_logs (Package 4) */ ];
  ```
- `annealDatabase(db: Database.Database): void`:
  - For each `TableSpec`: if table missing → `db.exec(createSql)`; else for each `ColumnSpec`, if `PRAGMA table_info(table)` lacks the column → `ALTER TABLE ... ADD COLUMN ${ddl}`.
  - Create indexes with `CREATE INDEX IF NOT EXISTS`.
  - Wrap in a transaction; log a single `info` per actual change (not per boot).
- `initDb()` calls `annealDatabase(next)` instead of executing the raw `SCHEMA` string + ad-hoc `ensureColumn` calls (delete the old ad-hoc block).

### 5.3. Envelope + `doc_json` Cleanup (do this carefully, behind tests)
- **Goal:** Stop duplicating domain fields as SQL columns that are never queried. Canonical payload = `doc_json`; envelope columns = only what SQL actually filters/joins on.
- **Tables to clean:**
  - `threads`: keep `(user_id, project_id, thread_id, title, title_version, folder_id, created_at, updated_at, revision, doc_json)`. `title`/`title_version`/`folder_id` are used by list queries — verify with `rg "SELECT.*threads" server/db/projectRepo.ts` before dropping anything. If a column is only written and never read in a `WHERE`/`SELECT` for list rendering, stop maintaining it (leave the column in place for backward compat; do NOT drop columns in SQLite — just stop relying on them).
  - `turns`: keep `(user_id, project_id, thread_id, turn_id, seq, revision, doc_json)` as the live contract. `role`/`content`/`timestamp`/`meta_json` are duplicated in `doc_json`; keep writing them only if a query uses them, otherwise mark them legacy in a comment and read exclusively from `doc_json`.
  - `chapters`: keep `(user_id, project_id, chapter_id, chapter_thread_id, order_index, revision, doc_json)`. `title`/`description`/`summary`/`granularity`/`start_turn_id`/`end_turn_id` become legacy (read from `doc_json`).
- **Rule for the agent:** before changing any read path, run `rg "doc_json|SELECT" server/db/projectRepo.ts` and make the read path always prefer `doc_json` when present, falling back to legacy columns only when `doc_json` is `'{}'` or missing (for rows written by older builds). Never delete columns (SQLite `DROP COLUMN` is a migration risk we explicitly avoid).

### 5.4. Tests Required
- `src/tests/schema-annealing.test.ts`:
  - `annealDatabase` on a fresh `:memory:` DB creates all tables in `TABLES_SPEC`.
  - Running `annealDatabase` twice is a no-op the second time (idempotent).
  - Simulate an old DB (create table with a subset of columns) → anneal adds the missing columns without touching existing rows.
  - Add a new dummy `ColumnSpec` to a test-local spec and verify it converges without errors.
- Existing VPS tests (`vps-user-journeys.test.ts`, `session-sliding-renewal.test.ts`, etc.) must still pass unchanged.

---

## Package 6: Operator Plaintext CLI (server-side, local-only)

### 6.1. Why (Motivation)
The operator (David) needs a local CLI to export/import the bijective plaintext tree for Git backups (`librechat-gitkb`) and fast restore, without exposing any heavy endpoint on the VPS. CLI runs locally on the server (or against a pulled `.sqlite` file on the home PC).

### 6.2. Commands (`scripts/plaintext-cli.mjs` + `package.json` scripts)
- Reuse `src/domains/plaintextTree.ts` from Package 3 via `tsx` (project already uses `tsx` for `server.ts`).
- `package.json`:
  ```json
  "export-plaintext": "tsx scripts/plaintext-cli.ts export",
  "import-plaintext": "tsx scripts/plaintext-cli.ts import"
  ```
- `scripts/plaintext-cli.ts`:
  - `export --user <email> [--project <projectId>] --out <dir>`:
    - Opens DB with `initDb(process.env.MARKBRAIN_DB_PATH)`.
    - Loads the user's projects (via `projectRepo` list/get + revisions from Package 1).
    - Writes the folder tree (`.md` + `.json`) to `<out>/<project-code-or-id>/...` using `snapshotToTree` and `fs.writeFileSync` (create dirs recursively).
  - `import --user <email> --in <dir> [--project <projectId>]`:
    - Reads the tree, `treeToSnapshot`, then upserts via existing `projectRepo` functions in a transaction (including `artifact_revisions`).
- **Do NOT** add any HTTP endpoint for this. CLI only.

### 6.3. Test Required
- `src/tests/plaintext-cli.test.ts` (or a script-level test): run export against a seeded `:memory:`/temp-file DB into a temp dir, then import into a fresh temp DB and assert snapshots match (reuses the Package 3 round-trip fixture).

---

## 7. Explicitly NOT in This Pack (open design questions — do not build yet)
These are captured in `design-docs/27_UNEARTHED_QUESTIONS_AND_TENSIONS.md` and need David's input or a separate design doc first:
1. **Graph semantic model** (Altitude `canopy/system/leaf/evidence`, Time-State `current/wish/superseded`, open edge kinds) and the **Auto-Organizator** (chat-driven batch plan/apply/rollback).
2. **Bidirectional context suggestions** (push-in/push-out of already-attached notes).
3. **WASM/ONNX browser embeddings** (needs a spike on model choice, Web Worker + Cache Storage packaging, and how it interacts with the existing `generate-qa` pipeline).
4. **File System Access API live folder mirror** (`showDirectoryPicker`) — depends on Package 3's tree format and needs a UX decision on permission prompts and conflict behavior.
5. **Peer-collaborator persona tuning** (David will co-write the system prompt).
6. **Security audit leftovers:** H2 (cookie-only sessions), L1 (prod lockfile), and the 3 low-severity nits.
7. **Offline replica password unlock** (shared-device encryption of the local mirror) — optional hardening on top of Package 3 §3.6.

---

## Suggested Execution Order & Commit Cadence
1. **Package 5** (schema annealing + envelope cleanup) — small, unblocks clean table additions for Packages 1 & 4.
2. **Package 1** (artifact editing + revisions) — biggest product win; includes `artifact_revisions` table.
3. **Package 2** (capability toggles + chapter controls) — independent of Package 1 except for the shared `ProjectSnapshot.capabilities` field (coordinate if merging).
4. **Package 4** (flight recorder) — independent, adds `api_call_logs` table via Package 5's annealer.
5. **Package 3** (plaintext export/import + offline replica) — depends on Package 1's revisions being in `ProjectSnapshot`.
6. **Package 6** (operator CLI) — depends on Package 3.

Commit after each package (or each numbered sub-step if large), with `npx tsc --noEmit && npx vitest run` green before every commit. Do not push.
