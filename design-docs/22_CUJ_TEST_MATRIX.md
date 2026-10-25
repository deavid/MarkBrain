# 22 — CUJ Test Matrix: every Critical User Journey × both modes

> **Rule (David, 2026-10-25):** every single Critical User Journey is listed
> here, and every row must say exactly where it is tested — for **Local
> Workspace** AND **Connected (logged-in) VPS**. A row with no test is a bug
> waiting to happen (the Genesis-create 500 shipped because the smoke test
> used `chapters: []` instead of the real UI payload).
>
> **Legend:** ✅ automated test exists · ⚠️ partial (seams covered, full path
> not) · ❌ none · 🖱️ manual only (browser click — `scripts/evidence.cjs`
> harness or human walk)
>
> Evidence column names `src/tests/<file>` (Vitest, 469 tests at last count).

## A. Gate & session

| # | Critical User Journey | Local | Connected | Evidence |
|---|---|---|---|---|
| A1 | Boot with no prior mode choice → AuthGate shows both paths | ✅ | ✅ | `local-vault-and-isolation` (mode-absent = local semantics) + gate is the only render when `currentUser` null — click-level 🖱️ |
| A2 | Choose **Use Local Workspace** → boots isolated Local workspace | ✅ | n/a | `local-vault-and-isolation`, `key-slots` |
| A3 | **Sign in to Server** (email+password) → Connected session, vault unlocked | n/a | ✅ | `server-auth-and-vault` (login 200 + vaultUnlocked), `vps-user-journeys` (Bearer flows) |
| A4 | Wrong password → 401, honest error on the gate | n/a | ✅ | `server-auth-and-vault` ("bad password is rejected") |
| A5 | Server URL override (custom baseUrl) | n/a | ⚠️ | `authLogin(baseUrl…)` shape untested; form is 🖱️ |
| A6 | Refresh mid-session → session restores (mode + token) | ✅ | ✅ | `local-vault-and-isolation` (envelope survives "reload"); vps token restore ✅ (`cuj-gap-sync` G10: `getVpsSession` parse + junk rejection) |
| A7 | **Sign Out** → gate; server session dead | n/a | ✅ | `server-auth-and-vault` ("owner disables friend…" kills sessions) + logout 401 verified in smoke; logout endpoint unit ⚠️ |
| A8 | **Switch to Local Workspace** from Connected → mode flips, no gate | ✅ | ⚠️ | namespace isolation ✅ (`local-vault-and-isolation`); the switch call path 🖱️ |
| A9 | **Sign in to Server…** from Local → gate again | ⚠️ | ⚠️ | 🖱️ |
| A10 | Server restart → vault locked (428) → unlock restores keys | n/a | ✅ | `server-auth-and-vault` §8.6 (clear RAM → 428 → unlock → decrypt) |
| A11 | Account #1 (owner) can never be disabled — CLI, API, UI | n/a | ✅ | `server-auth-and-vault` §8.2 (setUserEnabled throws + PATCH 400) |

## B. Workspace / project lifecycle

| # | Critical User Journey | Local | Connected | Evidence |
|---|---|---|---|---|
| B1 | **Create workspace from Genesis UI** (name/code/description/color + genesis chapter, NO threadId) | ✅ | ✅ | `vps-user-journeys` ("creates the project… genesis chapter", David payload verbatim); local create → `user-journeys` |
| B2 | Rename / re-describe workspace → persists | ✅ | ✅ | `vps-user-journeys` (PUT diff); local save → `critical-notifications`/`loader-error-vs-absent` |
| B3 | Delete workspace (confirm flow) + second delete 404 JSON | ✅ | ✅ | `vps-user-journeys` (DELETE journey); local delete law → `cleanup` |
| B4 | Switch between workspaces; registry mounts the right one | ✅ | ⚠️ | `user-journeys` ("clears all projects when cloud has zero…") |
| B5 | Minimal create gets honest defaults (`Untitled Project`, `#e05a66`) | n/a | ✅ | `vps-user-journeys` ("bare snapshot gets the honest defaults") |
| B6 | Boot loader: project list resolves → Genesis when zero | ✅ | ✅ | `user-journeys` + `loader-error-vs-absent` |
| B7 | Turns/chapters with no threadId survive save/load (legacy + genesis) | ✅ | ✅ | `vps-user-journeys` ("turns omit threadId") |

## C. Chat, pairs, draft queue (the Pair Law)

| # | Critical User Journey | Local | Connected | Evidence |
|---|---|---|---|---|
| C1 | Send → stream → **pair commits atomically** (both turns at once) | ✅ | ✅ | local: `draft-stop-store-as-is`, `user-journeys`; vps: `send-and-forget-jobs` (server commit) |
| C2 | **Stop** mid-stream → stopped draft, partial kept, timeline untouched | ✅ | ✅ | `draft-stop-store-as-is` ("abort → stopped draft"); vps stop: `send-and-forget-jobs` §5.3 |
| C3 | Failed attempt → draft keeps reason (never turn content) | ✅ | ✅ | `draft-stop-store-as-is`, `stream-failure-propagation`; vps: `send-and-forget-jobs` §5.2 (failed job, 0 turns) |
| C4 | **Retry** (clean resend) | ✅ | ✅ | `stream-failure-propagation` ("retry re-queues"); vps `POST /jobs/:id/retry` ✅ (`cuj-gap-jobs` G2) |
| C5 | **Store as-is** (only exit that writes a pair) | ✅ | ✅ | `draft-stop-store-as-is`; vps: `send-and-forget-jobs` §5.3 |
| C6 | **Discard** (no trace) | ✅ | ✅ | `draft-stop-store-as-is`; vps `DELETE /jobs/:id` ✅ (`cuj-gap-jobs` G2) |
| C7 | **Regenerate last reply** — old reply stays until replacement lands | ✅ | ✅ | `stream-failure-propagation` (target pair, regenerate refused unless empty queue); vps: `vps-user-journeys` ("commitPair… replaceTurn rewrites content, id preserved") |
| C8 | Strict FIFO per thread: failed head blocks its thread, never skipped | ✅ | ✅ | `stream-failure-propagation` (local); server FIFO head-block law ✅ (`cuj-gap-jobs` G1) |
| C9 | VPS job exits: retry / store-as-is / discard endpoints behave per Pair Law | n/a | ✅ | store-as-is ✅ (`send-and-forget-jobs`); retry + discard ✅ (`cuj-gap-jobs` G2) |
| C10 | **Send-and-Forget**: phone locks mid-stream → server finishes, pair + chores land | n/a | ✅ | `send-and-forget-jobs` §5.1 (THE core test: disconnect after chunk 1) |
| C11 | Regenerate via jobs (`kind:'regenerate'`) replaces the target turn in place | n/a | ✅ | repo-level ✅ (`vps-user-journeys`); job route path ✅ (`cuj-gap-jobs` G3) |
| C12 | Send-on-enter preferences (Enter / Shift / Ctrl / IME) | ✅ | ✅ | `send-on-enter` (18 cases, both composers) |
| C13 | Drafts survive reload; buffers don't; regenerate draft survives | ✅ | ✅ | `stream-failure-propagation` |
| C14 | Stream failure vocabulary (401, error event, no-complete, partial-only) | ✅ | ✅ | `stream-failure-propagation` (5 reject paths + happy path) |
| C15 | One message in flight at a time | ✅ | ✅ | `stream-failure-propagation` |

## D. Threads & folders

| # | Critical User Journey | Local | Connected | Evidence |
|---|---|---|---|---|
| D1 | Create / rename / delete thread | ✅ | ✅ | `chat-threads` (registry); vps deleteThread tombstone ✅ (`cuj-gap-jobs` G4) |
| D2 | Folders: create/rename/delete/reorder; delete rehomes to Inbox | ✅ | ✅ | `chat-threads`; vps folder tombstone ✅ (`cuj-gap-jobs` G4) |
| D3 | Move thread to folder / Inbox | ✅ | ⚠️ | `chat-threads` |
| D4 | Auto-title stage1 (1st reply) / stage2 (3rd) + manual lock | ✅ | ✅ | `chat-threads`; vps server title chore: `send-and-forget-jobs` (title persisted) |
| D5 | Cmd+K thread switcher + switch preserves content | ✅ | ✅ | `chat-threads` (select round-trip); visual switcher 🖱️ |
| D6 | Archive/unarchive thread | ✅ | ⚠️ | `chat-threads`, `cleanup` |

## E. Chapters

| # | Critical User Journey | Local | Connected | Evidence |
|---|---|---|---|---|
| E1 | Declare chapter split at a message | ✅ | ✅ | `chapter-split` (5 cases) |
| E2 | Chapter summarize (description + summary layers) | ✅ | ✅ | `chapter-seal-autosummarize`, `compaction-prompts`; vps server chore ✅ (`send-and-forget-jobs`, sealed chapter filled) |
| E3 | Never re-summarizes a chapter that has both layers | ✅ | ✅ | `chapter-seal-autosummarize` |
| E4 | In-progress window: last two chapters send Full | ✅ | ✅ | `chapter-in-progress` (10 cases) |
| E5 | Topic-shift `<topic_shift>` seals + opens a chapter | ✅ | ✅ | `user-journeys` (demux), `chapter-split`; vps buffered-shift application ✅ (`cuj-gap-jobs` G5) |
| E6 | Granularity law (user-only cuts) | ✅ | ✅ | `chapter-in-progress`, `optical-compiler`, `design-law` |

## F. Artifacts & knowledge graph

| # | Critical User Journey | Local | Connected | Evidence |
|---|---|---|---|---|
| F1 | Chat `<artifact>` extraction lands as note with the pair | ✅ | ✅ | `user-journeys` (demux), `artifact-filename`; vps buffered-artifacts → artifacts table ✅ (`cuj-gap-jobs` G5) |
| F2 | Edit/save artifact | ✅ | ✅ | `atomic-sqlite-sync` (Device A edit survives), `vps-user-journeys` |
| F3 | Delete artifact → tombstone propagates to the other device | n/a | ✅ | `atomic-sqlite-sync` §6.3, `vps-user-journeys` |
| F4 | Archive → cleanup tool delete law (blockers named, cascade rules) | ✅ | ✅ | `cleanup` (12 cases) |
| F5 | Import markdown/txt queue + per-file processing | ✅ | ✅ | `import-rules`, `import-detect`, `artifact-filename`; modal handlers 🖱️ |
| F6 | Import AI extraction (sentinel layers, failure-aware retry) | ✅ | ✅ | `compaction-prompts` (import rows) + `errors-are-final` |
| F7 | Import duplicate detection (3 tiers) + relationships | ✅ | ✅ | `import-detect` |
| F8 | Artifact filenames (title-as-file, disambiguation) | ✅ | ✅ | `artifact-filename` (25 cases) |
| F9 | Graph lens renders artifacts + edges | ⚠️ | ⚠️ | edge model ✅ (`unified-model`); rendering 🖱️ |
| F10 | Attachments: stage → commit weld, granularity per chat | ✅ | ✅ | `attachments` (13), `attachment-palette`, `optical-compiler` |

## G. Search & indexing

| # | Critical User Journey | Local | Connected | Evidence |
|---|---|---|---|---|
| G1 | Local search is **lexical only, 0 network/quota** | ✅ | n/a | `vps-embeddings-and-tts-cache` §A.1, `draft-search-engine` (12) |
| G2 | Connected: server indexes sections once; unchanged save = 0 calls | n/a | ✅ | `vps-embeddings-and-tts-cache` §A.2 |
| G3 | Connected: semantic search ranks + near-dupe query vector reuse | n/a | ✅ | `vps-embeddings-and-tts-cache` §A.2 + `query-vector-cache` (16) |
| G4 | Query-vector cache laws (exact > near > pay) | ✅ | ✅ | `query-vector-cache` |
| G5 | Search config (flags, thresholds, URL overrides) | ✅ | ✅ | `search-config` (9) |
| G6 | Index All / Re-index (explicit, vps mode only) + staleness laws | ✅ | ✅ | `artifact-filename` (stale/resume), `indexer-stragglers` (8), `embed-model-staleness` |
| G7 | Indexer stragglers: publish-per-doc, no re-report, cap batching | ✅ | ✅ | `indexer-stragglers` |

## H. Settings, keys, admin

| # | Critical User Journey | Local | Connected | Evidence |
|---|---|---|---|---|
| H1 | Local vault: create / unlock / lock / reset (3 UI states) | ✅ | n/a | `local-vault-and-isolation`, `key-slots` |
| H2 | Key never in plaintext on disk (zero-leak law) | ✅ | ✅ | `local-vault-and-isolation` §1; vps ciphertext: `server-auth-and-vault` §8.5 |
| H3 | Key slots: set/clear, trim, lane binding, provider isolation | ✅ | ✅ | `key-slots` (14) |
| H4 | VPS keys: server vault, redacted `{configured, hint}` over the wire | n/a | ✅ | `server-auth-and-vault` §8.5 |
| H5 | Model slot selection — 7 lanes, per-call read, no silent swap | ✅ | ✅ | `model-config` (12), `chat-slot-is-truth`, `errors-are-final` |
| H6 | Cross-device settings sync (PC slot change visible on phone) | n/a | ✅ | `atomic-sqlite-sync` §6.4 |
| H7 | Owner Users tab: add / enable / disable / reset password | n/a | ✅ | `server-auth-and-vault` §8.7–8.8 (friend create, 403 non-owner, disable kills session) |
| H8 | Keys never leak into exports | ✅ | ✅ | `export-scrub` (5) |

## I. TTS (Read-aloud)

| # | Critical User Journey | Local | Connected | Evidence |
|---|---|---|---|---|
| I1 | TTS transport: load → play → end; volume cbrt curve; seek | ✅ | ✅ | `tts-transport` (8) |
| I2 | Connected: Ogg cache MISS→store, HIT→0 quota | n/a | ✅ | `vps-embeddings-and-tts-cache` §B.3 |
| I3 | Local: browser-direct PCM path | ✅ | n/a | `provider-adapters` (tts adapter honest fallback) |
| I4 | Fallback to browser speech synthesis on failure | ⚠️ | ⚠️ | 🖱️ (ChatView fallbackSpeech) |

## J. Persistence, sync & data

| # | Critical User Journey | Local | Connected | Evidence |
|---|---|---|---|---|
| J1 | Auto-save debounce + flush on tab hide | ✅ | ✅ | `critical-notifications`, `deadline` |
| J2 | Save never settles → deadline → ONE critical notice | ✅ | ✅ | `critical-notifications`, `deadline` |
| J3 | Load failure ≠ absence → saves stay blocked, honest notice | ✅ | ✅ | `loader-error-vs-absent` (3) |
| J4 | Multi-device anti-clobber (stale save keeps the other device's pair) | n/a | ✅ | `atomic-sqlite-sync` §6.1 |
| J5 | Delta sync: `?since` returns only changed rows; tip is empty | n/a | ✅ | `atomic-sqlite-sync` §6.2 |
| J6 | Delta merge into live domains (focus wake + 10s poll) | n/a | ✅ | merge ✅ (`cuj-gap-sync` G6: tombstones, upserts, turns, threads) |
| J7 | vpsStore offline: mirror fallback for list/load | n/a | ✅ | save-404→create ✅ (`vps-user-journeys`); offline list/load ✅ (`cuj-gap-sync` G7) |
| J8 | Export backup (JSON/MD/YAML) round-trips; no keys | ✅ | ✅ | `export-scrub`, `spec-export-version` |
| J9 | Import backup (restore DB) replaces content | ✅ | ✅ | `parseDatabaseExport` round-trip ✅ (`export-scrub`); full replaceAll journey ✅ (`cuj-gap-sync` G8) |
| J10 | Storage sanitize (undefined keys dropped) | ✅ | ✅ | `storage-sanitize` |

## K. Security & ops

| # | Critical User Journey | Local | Connected | Evidence |
|---|---|---|---|---|
| K1 | Unauthenticated `/api/*` content → 401 JSON | n/a | ✅ | `server-auth-and-vault` §8.3 |
| K2 | API errors are JSON — never an HTML stack page | ✅ | ✅ | `vps-user-journeys` ("malformed body… never an HTML stack page") |
| K3 | Server logs view is authed | n/a | ✅ | gating ✅ (`cuj-gap-jobs` G9) |
| K4 | CSP: script-src self, two provider origins only | ✅ | ✅ | `shell-mode` (cspHeader, 5 cases) |
| K5 | Markdown XSS: escape-first, scheme whitelist | ✅ | ✅ | `markdown`, `message-body` |
| K6 | Build secret guard fails on key-shaped strings in `dist/` | ✅ | ✅ | `npm run build` runs `verify-clean-dist` (gate) |
| K7 | Model errors are final (no silent downgrade) | ✅ | ✅ | `errors-are-final` (12) |
| K8 | Token logout / disabled-user session kill | n/a | ✅ | `server-auth-and-vault` §8.8 (session rows deleted → 401) |

---

## Gap register (fill these — see §L after each lands)

| Gap | What is missing | Priority | Status |
|---|---|---|---|
| G1 | Server FIFO head-block law: a failed/stopped job head blocks later queued jobs on that thread; retry/discard unblocks | High | ✅ closed — `cuj-gap-jobs` (2 its: failed-head + retry, stopped-head + discard). Fixed `runJob` to refuse non-head jobs (21E §2.2) and kick the next queued job when the head resolves |
| G2 | `POST /jobs/:id/retry` + `DELETE /jobs/:id` (discard) end-to-end | High | ✅ closed — `cuj-gap-jobs` (retry 2nd-attempt completes; discard removes job, bumps revision, 0 turns) |
| G3 | Jobs `kind:'regenerate'` via `/jobs/send` → replaces target turn in SQLite | High | ✅ closed — `cuj-gap-jobs` (id preserved, content replaced, no new turn row) |
| G4 | `deleteThread` / `deleteFolder` mutations → tombstones via delta | Medium | ✅ closed — `cuj-gap-jobs` (rows gone + delta carries `{entityType, entityId}` tombstones) |
| G5 | Job commit with buffered `<artifact>` + `<topic_shift>` → artifacts row + chapter seal/open | Medium | ✅ closed — `cuj-gap-jobs` (artifact row in GET project; active chapter sealed with endIndex; new chapter opened) |
| G6 | `useVpsDeltaSync` merge (tombstones, artifacts, chapters, turns, threads) | Medium | ✅ closed — `cuj-gap-sync` (4 its: tombstones win, upsert-by-id + chapter sort, turn merge order/lane filter, thread patch/create + folder create). `mergeDeltaIntoDomains` exported as test seam |
| G7 | `vpsStore` list/load offline mirror fallback | Medium | ✅ closed — `cuj-gap-sync` (fetch rejects → IndexedDB mirror serves list/load; absent stays null) |
| G8 | Backup restore journey: `parseDatabaseExport` → `replaceAll` → GET round-trip | Medium | ✅ closed — `cuj-gap-sync` (serialize → parse → POST replace-all → GET round-trips content) |
| G9 | `/api/server-logs` 401 unauth / 200 auth | Low | ✅ closed — `cuj-gap-jobs` (folded: 401 JSON unauth, 200 `{logs}` authed) |
| G10 | `workspaceSession` session parse/restore + `getActiveIdbName` vps naming | Low | ✅ closed — `cuj-gap-sync` (round-trip + junk rejection, idb naming both modes, scoped key both branches, clear cleanup) |

**Browser-clicked UI (🦸 honest boundary):** the React tree is verified through
`scripts/evidence.cjs` (manual harness) and human walks — the automated suite
covers domain/gateway/server layers. Anything marked 🖱️ is click-level only.
