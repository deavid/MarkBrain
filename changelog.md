# Changelog

All notable changes to MarkBrain. Format loosely follows [Keep a Changelog](https://keepachangelog.com/).

## 2026-10-18 — stable → main (12 commits, 52 files, +3301/−1202)

Pulled `main` (`a997fc5..3c7493e`) into `dev-nova` and compared against `stable`. Everything below landed on `main` since the `stable` tag.

### Added

- **Markdown rendering in artifact detail** — the Tier 3 body now renders as formatted markdown by default, with a **Rendered / Raw** toggle to get back to the raw source. New dependency-free renderer (`src/utils/markdown.ts`): escape-first pipeline (untrusted bodies cannot inject HTML; link schemes whitelisted to http/https/mailto/tel), supports headings, tables, nested lists, fenced code, blockquotes, hard-line-break parity with Raw, and deliberately no underscore emphasis so `t3_body` stays literal. New `.md-body` styles in `src/index.css`. (commit `d3c501f`)
- **Mirror v1** — tapping the floating saturation orb now opens a **Mirror panel** (`src/domains/04-presentation/telemetry/MirrorPanel.tsx`) instead of cycling optical modes: totals vs ceiling, notes in context with tier + token counts, chapters in send order, and the raw payload (`compiledPrompt` + `systemInstruction`) — exactly what the LLM will see on the next send. Orb tooltip: "…tokens of …— tap to see what the LLM will see". (commit `3858039`)
- **Tier provenance / honest in-context UX** — the optical compiler now emits a `reason` with every `nodeTiers` entry (`pin | fallback | override | ancestor | radius | culled`). Surfaced as:
  - Detail-modal toolbar split into **Pinned / Not pinned** (manual) vs **Prompt: &lt;tier&gt;** + colored provenance chip (`MANUAL PIN`, `AUTO FOCUS`, `FORCED`, `ANCESTOR`, `AUTO · N HOPS`, `CULLED`) with full-sentence tooltips.
  - Tree badges color-coded per source: `T3 · pin`, `T2 · forced`, `T1 · anc`, `T2 · d1`, `T3 · auto`, `T2 · culled` with explanatory tooltips.
  - T1–T3 / **Auto** buttons now highlight the actual forced override (not the computed tier); the tree tier menu gained the previously missing **Auto** reset so overrides can be cleared.
  - Pin copy on rows/graph made honest: "Pin — manually include at full focus" / "Unpin — remove manual focus (depth-of-field may still include it)". (commit `d3c501f`)
- **Google Drive import rework** (commit `eecaad5`):
  - `verifyDriveScopes()` — checks the OAuth token via tokeninfo before any Drive call; missing `drive.readonly` shows an amber banner ("Signed in **without** Google Drive access…") with a **Reconnect** button (disconnect + fresh `prompt=consent` sign-in) instead of Google's raw 403.
  - The previously dead **paste-a-URL input** is now rendered: paste a Google Docs / Drive link and **Fetch** it (the working import path; `extractGoogleDocIdFromUrl` + `fetchGoogleDocById` existed but had no UI).
  - **Google Picker** ("Browse Google Drive…") replaces the hand-rolled Drive file list (which had a lying "All Files" filter and a search box). Google's hosted picker (`google.picker`, members validated before use), shelved behind `VITE_GOOGLE_PICKER_ENABLED` — **off by default**: disabled button with "Unfinished" tooltip and visible hint.
  - **Source lock** — once a file is loaded or extraction/fetch is running, Browse/Fetch controls collapse into a source bar with a disabled-until-done **Choose different** reset, preventing a second `triggerAIExtraction` from racing the first and clobbering fields.
  - AI extraction call now capped with `AbortSignal.timeout(120_000)` so a slow model (observed 113–135 s) can't leave the spinner spinning forever.
  - `getOrInitAuth` now uses a cached `fetchAppConfig` shared with the Picker key.
- **Layered env files** (commits `b7fdbb1`, `3f7e2a2`, `3c7493e`):
  - Precedence: real OS/runtime env > `.env` (personal, gitignored, per-workspace) > `.env.shared` (local, gitignored) > `../MarkBrain/.env.markbrain-main.shared` (canonical credentials shared by all sibling worktrees, resolved from each loader's own directory, silently skipped when absent). `server.ts` and `vite.config.ts` both load all layers so standalone `vite build` resolves the same values; `VITE_*` keys reach `import.meta.env` via a `define` bridge.
  - `/api/auth/config` now serves `pickerApiKey` (Google Picker developer key — client-side by design, restrict by referrer).
  - `.env.example` documents the layering, `GOOGLE_PICKER_API_KEY`, and the `VITE_GOOGLE_PICKER_ENABLED` flag.
  - **Security:** `.env.shared` was briefly committed, then un-tracked again (`git rm --cached`, `.env*` ignore restored); only `.env.example` (placeholders) is ever tracked. A history rewrite purged `.env.shared` and a pre-existing `firebase-applet-config.json` from all refs.
- **Storage-boundary sanitizer** — new `src/utils/storageSanitize.ts` (`sanitizeForStorage`, JSON semantics: drop `undefined` keys, `undefined` array elements → `null`) applied in `saveProjectSnapshot` for both backends, so future `undefined` producers are harmless by construction. Regression tests added (`src/tests/storage-sanitize.test.ts`, 3 tests).
- **Persistence-boundary hydration** — `loadProjectSnapshot` now normalizes stored artifacts into canonical shape (`hydrateArtifact`/`hydrateSnapshot`): backfills `workspaceId`, numeric `createdAt`/`updatedAt`, and `current.t0..t3` tiers from legacy flat `description/summary/content` records, with one warn per project load.
- **New tests** — `src/tests/markdown.test.ts` (10 renderer tests incl. XSS/scheme-whitelist), `src/tests/optical-compiler.test.ts` (6 provenance tests), `src/tests/storage-sanitize.test.ts` (3). Suite: **25/25 passing**.
- **New scripts & docs** — `scripts/probe-latency-matrix.mjs`, `probe-latency-variance.mjs`, `probe-quota-raw.mjs`, `probe-paid-tier.mjs` (re-runnable Gemini latency/quota diagnostics; paid key read from `/tmp` only), `scripts/chat-law-test.cjs`, `scripts/name-wipe-test.cjs`; `design-docs/05_CLEANSE_DECISIONS.md`, `design-docs/06_GEMINI_3_8_FLASH_LATENCY.md`, `design-docs/CONTEXT_COMPILER.md`.

### Changed

- **Persona & copy cleanse (Phase 1 — lie removal)** — the "principal systems architect / optical substrate / zero-leakage" fiction was removed across the UI and prompts:
  - System instruction (server + compiler): MarkBrain is now "a thinking partner for a brain that overflows with ideas"; artifact types are `note | decision | summary | reference | topic` (was `architecture | token-spec | …`); defaults `projectTitle: 'Untitled'`, focus `General`.
  - Chat UI: speakers are **You / MarkBrain** (was Architect / MarkBrain Engine); placeholders rewritten ("Pour it out before it evaporates — we'll organize later.", "Keep typing — Enter to send…"); status copy "Thinking…", "MarkBrain is thinking…"; extracted-notes section labelled **Extracted notes / Collected** (was Synthesized Architectural Specification / Ingested in Knowledge Substrate).
  - AuthGate, ProjectGenesis, ProjectLauncher, Sidebar, ExportModal, models.ts badges ("Quick / Daily Driver / Deep Dive"), empty-state copy, headless fixture — all de-jargoned. Default artifact category `system-spec` → `note`. Workspace fallbacks: "Untitled Project" / codeName `IDEAS`.
  - Dead **`POST /api/chat`** (non-streaming) endpoint removed from `server.ts`; `parseModelResponse` helper deleted. SSE `complete` event now sends only `rawReply` + `telemetry` — the server no longer parses artifacts/topic shifts.
  - Demo/no-key fallback stream rewritten to honest copy ("Demo mode (no API key) — streaming a canned reply…") and now emits a `note` artifact so the extraction pipeline is exercised without a key.
  - Removed phantom claims: `boundaryRules` field gone from workspace/project metadata; model descriptions no longer promise capabilities that don't exist.
- **One parser, one data model (Phase 3)** — the twin parser was killed: the **client demux is the sole parser** of artifact blocks/topic shifts (`StreamProtocolDomain.demuxFullTurn` — superset of any server parse; `complete` handler ignores server-sent `reply/artifacts/topicShift`). `Artifact` in `src/types/index.ts` is now an alias of the domain's `UniversalArtifactDocument` (single source of truth); ~170 lines of legacy duplicate shape (`workspace_id`, flat `description/summary/content`, `revisions/relations/provenance/history` embedded on the artifact) deleted. Version history now comes from the versioning domain (`versioning.getHistory`), not an embedded `history` array. `yamlArtifactParser` serializes/parses the canonical shape (timestamps normalized to epoch ms). `tokenCalculator` reads `current.t1/t2/t3` everywhere (incl. Markdown/YAML export).
- **Instrumentation law (Phase 2)** — `logger.ts` header codifies the rules: one `action` per human gesture, `info` for lifecycle, **every** fallback/`warn` branch must warn, `error` for user-visible failures/data-loss, **hard rule ≤16 events per human action**, never log hot loops. Log category union opened (`string & {}`). Per-chunk stream logging removed (`DialogueTimeline.updateTurn` silent on the hot path); compiler compile-log gated behind `log: true` (only the once-per-send call site passes it; the display memo stays silent); raw `console.*` across the codebase replaced by `logger` (Firebase auth, Drive, ServerLogs, DomainRegistry, YAML parser, stream SSE). Fallback branches that were silent now warn (localStorage backend default, snapshot load/persist failures, Drive export fallbacks, topic_shift parse failure, cancel-fetch failure, etc.).
- **Stuck "In Context (focal)" bug fixed** — three combined causes (commit `d3c501f`):
  1. **Double modal**: tree row clicks opened the tree's own `ArtifactDetailModal` *and* the App-level one; closing the top revealed a second whose `isInContext` was tier-based while its button toggled the pin — clicking "remove" actually re-pinned, so the button never turned off. Tree modal deleted; row click and *Inspect* route to the single App modal.
  2. **Selection injection**: `selectedArtifactId` was force-added to compile `focalIds`, so "Current: Tier" never changed while the modal was open. Focal list is now pins only (behavior-neutral for chat, since selection only ever differed from pins while the modal blocked input).
  3. Missing **Auto** in the tree tier menu (overrides set there could never be cleared) — fixed above.
- **Save correctness fixes** (commit `eedb85c`) — Firestore's `setDoc` rejects `undefined` field values; the import path produced them (graph `{x,y}` coords that don't exist yet, `graph/yamlDocument` keys materialized as `undefined` in `upsertArtifact`). **One poisoned artifact made every subsequent snapshot save throw — quietly — so the session looked fine and everything since the last good save vanished on reload.** Fixed at three levels:
  - `upsertArtifact` omits optional keys entirely instead of setting `undefined`.
  - `App.tsx handleAddArtifact` copies graph coordinates only when numeric.
  - `DomainRegistry` flushes the pending 500 ms debounced save on `pagehide`/`visibilitychange` so a fast reload can't lose the last mutation. Persistence failures now `logger.error` (were `console.warn`).
- **Snapshot meta must ride along** — `saveProjectSnapshot` now includes `name/codeName/description/color` because IndexedDB `put()` *replaces* the record; omission wiped project metadata on the first auto-save.
- **`handleAddArtifact` idempotent by title** — "Save as Artifact" updates the already auto-upserted extracted note instead of creating a duplicate.
- **Summarize chapter targets the requested chapter** — `handleSummarizeChapter(chapterId)` summarizes *that* chapter (was always the active one), and non-OK responses now throw with the server error instead of failing silently.
- **Optical compiler system instruction** rewritten to the plain-speaking persona; compile logs warn when the compiled prompt exceeds the token ceiling.
- **Sidebar responsive default** — sidebar now defaults open only on ≥768 px viewports (was always open), so the mobile drawer+backdrop doesn't bury the composer on first load.
- **Token label precision** — orb and sidebar show raw counts below 1000 tokens (was "0k").
- **Chapter/timeline copy & robustness** — genesis chapter titled "Genesis Chapter" (was "Genesis Architecture"); `shiftBoundary`/`updateSummary` warn on unknown chapter ids; interrupt/error paths log via `logger`; empty-reply fallback messages are honest ("Extracted N notes — no prose reply came back." / "No reply came back. Try again.").
- **TTS log copy** — "Kokoro-82M" references replaced with generic "TTS" wording.
- **Root-caused Gemini 3.8 Flash latency (docs)** — `design-docs/06`: 429 `QuotaFailure: GenerateRequestsPerDayPerProjectPerModel-FreeTier`, limit 20/day, resets midnight PT; attribution matrix refuted thinking/JSON-mode/non-stream hypotheses; `thinkingBudget=0` leak documented (server-side; SDK sends the field correctly — verified via fetch intercept). Paid-key comparison probe: TTFC 1.5–2.0 s on a healthy 3.8 Flash vs 33–49 s free-contended (time-of-day confound noted).
- **Hard rule documented** — "NEVER PUSH without explicit instruction" (`docs` commit `1aea8d4`).

### Removed

- `POST /api/chat` non-streaming endpoint and its server-side `parseModelResponse` (dead code — client demux is the sole parser).
- Server `indexing` SSE status event and server-sent `reply/artifacts/topicShift` in `complete` (raw text + telemetry only).
- Hand-rolled Drive file list (`listDriveFiles`, filter pills, search box) from the Import modal — replaced by Google Picker (flagged off) + URL paste.
- Tree-local duplicate `ArtifactDetailModal`, the `related` context filter, and `relatedArtifactIds` computation from `ArtifactFolderTree`.
- Legacy `Artifact` shape fields from `src/types/index.ts`: `workspace_id`, flat `description/summary/content`, embedded `revisions`, `relations`, `provenance`, `history`, plus `ArtifactVersion`, `ChapterArtifact`, `WorkspaceState`, `ContextTelemetry`, `ArtifactRevision`, `ArtifactRelation`, `ProvenanceRecord`, `RelationKind` (moved to domain layer).
- Embedded per-artifact `history` from YAML serialization/parsing and from import/chat artifact creation (version history lives in the versioning domain).
- `boundaryRules` workspace/project metadata field; `handleRestoreArtifactVersion` (dead — History tab no longer offers rollback).
- `.env.shared` from git tracking (was briefly committed; see Security).
- Pre-existing secrets from git history via history rewrite: `.env.shared` and `firebase-applet-config.json`.

### Fixed

- Stuck **"In Context (focal)"** button / never-changing "Current: Tier" (double modal + selection injection + missing Auto reset — see Changed).
- **All Firestore saves silently failing after an import** (`undefined` fields; one poisoned doc killed every later save) — session looked fine, data vanished on reload.
- **Fast reload losing the last mutation** (500 ms debounced save now flushed on `pagehide`/`visibilitychange`).
- **Project metadata wiped on first auto-save** with the local backend (meta omitted from snapshot `put()`).
- Duplicate artifacts from "Save as Artifact" (now idempotent by title).
- Imported artifacts with graph metadata but no `x/y` poisoning saves (coordinates copied only when numeric).
- Stale narrow Google grants producing raw 403 "insufficient authentication scopes" (scope verification + Reconnect).
- Dead paste-a-URL import input (now rendered and working).
- Import spinner spinning forever on slow AI extraction (120 s timeout).
- Import source race (double-trigger extraction clobbering fields — source lock).
- "Related" tier overrides that could not be cleared from the tree menu (Auto button).
- Summarize applying to the wrong chapter; silent HTTP failures.
- Mobile first-load composer buried under the sidebar drawer (responsive default).
- Sub-1000-token counters displayed as "0k".
- Legacy flat artifacts loaded without canonical tier fields (hydration backfill with warn).
- YAML frontmatter parse failures now warn instead of silent `console.warn`.

### Security

- `.env.shared` un-tracked; `.env*` ignored again; only `.env.example` (placeholders) is committed. History rewritten to purge `.env.shared` and `firebase-applet-config.json` from all refs.
- Markdown renderer is escape-first with scheme whitelisting — artifact bodies cannot inject HTML/JS into the detail modal despite `dangerouslySetInnerHTML`.
- Google Picker developer key documented as client-side-by-design; restrict by referrer in Google Cloud Console.

---

### Follow-up fixes (same day, post visual review)

- **Escape dismiss everywhere** — Mirror, Export, and Import modals now close on Escape, consistent with ArtifactDetailModal (they were X-only).
- **Vite config deprecation** — all `__dirname` uses in `vite.config.ts` (dotenv layering + `@` alias) replaced with `import.meta.dirname`; the `configLoader: 'native'` boot warning is gone.
- **Favicon** — new `public/favicon.svg` + `<link rel="icon">` in `index.html`; no more `/favicon.ico` 404.

---

*Range: `stable` → `main` @ `3c7493e` (2026-10-18). Commits: `56d9b57`, `805ebc4`, `d221c08`, `3858039`, `1aea8d4`, `a997fc5`, `d3c501f`, `eedb85c`, `b7fdbb1`, `eecaad5`, `3f7e2a2`, `3c7493e`.*