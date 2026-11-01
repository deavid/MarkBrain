# Design Documentation Status Report (2026-11-01)

**State Snapshot:**
- **Branch:** `dev-vega`
- **Status:** Worktree clean · All gates green (`tsc` clean, `vitest` 120 files / 988 tests passed, `npm run build` clean, hermetic evidence pack `28/28` journeys passed).
- **Live State File:** This is the single authoritative live-state file. Completed execution plans and resolved bug logs are retired into `design-docs/archive/`.

## Design Documentation Index (Active)
- `00_CORE_PHILOSOPHY_AND_LAWS.md` — Living constitution & core pillars
- `01_REQUIREMENTS_AND_VISION.md` — Product vision & requirements
- `02_SYSTEM_ARCHITECTURE.md` — Two-mode topology & runtime architecture
- `03_DATA_AND_CONTEXT_MODEL.md` — Projects, Threads, Turns, Chapters, Artifacts & 4-layer cuts
- `04_UX_AND_DESIGN_LAW.md` — Mobile-first laws, typography, and banned chrome
- `05_SECURITY_AND_OPERATIONS.md` — Key vault, auth, and mandatory verification gates
- `06_HORIZON_GRAPH_AND_AUTO_ORGANIZATOR.md` — Open horizon: semantic graph & auto-organizator
- `07_HORIZON_CLIENT_REPLICA_AND_WASM.md` — Open horizon: client replica & WASM embeddings
- `31_LONG_CHAT_SCALABILITY.md` — Long-chat scalability architecture, shipped Phases 1–3, and future storage/archiving horizon
- `DECISIONS_BACKUP_SQLITE_VS_PLAINTEXT.md` — Decision record: service backups vs user data sovereignty
- `TESTING_PLAN.md` — Manual hands-on testing checklist
- `STATUS.md` — This file
- `SCRATCH.md` — Working notes index (`scratch/`)
- `BUGS/FEATURE_INLINE_ATTACHMENTS_AND_IMAGES.md` — Drawer: mid-message image attachments (§2; §1 inline `<attach>` shipped)
- `BUGS/FEATURE_VIEW_COLOR_MAPPING.md` — Drawer: view-level configurable color mapping for Graph & Library

*(Historical specs, completed execution plans (`28`, `29`, `30`, `BACKUP_DISCUSSION_FIX_PLAN`, `LONG_CHAT_PHASE_1_2_PLAN`), the 2026-10-30 tech-debt audit (`tech-debt-2026-10-30/`), and the resolved 2026-10-31 bug plans (`BUGS_KNOWN`, `CLEAR_FIXES_PLAN`, `BUG_003/006/007/013`) live in `design-docs/archive/`.)*

## Recently Landed (Oct 30 – Nov 1, 2026)

1. **Long-Chat & Million-Turn Scalability (`31_LONG_CHAT_SCALABILITY.md`, Phases 1–3)**:
   - **Phase 1 (UI & Compiler)**: `TurnMeta.contentTokens` cached at commit + WeakMap prompt memoization; older `full` chapters default-folded + `MAX_OPEN_FULL_CHAPTERS = 3` eviction with scroll compensation; 40-turn trailing window per chapter; bounded TTS device-cache scan; synchronous bottom-first thread open.
   - **Phase 2 (Caps & AI Auto-Split)**: Pure `evaluateChapterTokenCap` (`64k` soft cap, `128k` hard cap + 2 user-turn grace); composer hard-cap block; sentinel-based **Auto-Split Chapter** across VPS, Direct, and hermetic capture modes (CUJ `28-long-chat-ui`).
   - **Phase 3 (Storage)**: Composite SQLite index `idx_turns_user_project_thread_seq`; tail-first `GET /api/projects/:id/turns` pagination; incremental per-turn IndexedDB store (`DB_VERSION = 2`) with v1→v2 cursor migration and signature-diff saves.
2. **2026-10-31 Bug-Fix & Redesign Wave (`BUG-001` through `BUG-014`)**:
   - Lean graph cards, border-clipped edges, sky selection ring, and `visible_factor` one-click `Auto-Space` solver (`BUG-001`..`005`).
   - 6-tab `ArtifactDetailModal` with single visible editable slug (`code.md`) and unified Category (`BUG-006`).
   - In-place chat operation chips (`<link>`, `<artifact_upsert>`, `<topic_shift>`, `<attach>`), true `<> Raw` view with collapsible artifact bodies, compiler stubs, and live streaming chips (`BUG-007/008/011/012`).
   - Native `user`/`assistant` API turns for the last 2 chapters + persistent collapsible thinking (`BUG-013`).
   - Sidebar text size labels (`Small / Medium / Large / Largest`) with proportional sidebar width scaling (`BUG-014`).
3. **6-Tab API Call Inspector (`archive/30_API_CALL_INSPECTOR_PLAN.md`)**:
   - End-to-end `callId` linkage, VPS + Local mode inspection, attempt switcher, and recorded demux/commit outcomes.
4. **Tech-Debt & Split-Brain Refactoring (`archive/tech-debt-2026-10-30/`)**:
   - 6 phases: neutral `shared/` contract layer, single pure Turn Commit Planner, thread-keyed domains, UI decomposition, and composition-root seams.

## Active Horizon & Future Drawer (Parked Until Needed)
1. **Sidebar Storage Meter + Working-Set Archiving (`31_LONG_CHAT_SCALABILITY.md` §4.2)**:
   - Optional lightweight sidebar storage indicator (`navigator.storage.estimate()` + working-set budget, getting louder past 50%), followed later (when storage actually fills up) by archiving old chapters/projects out of client memory/IDB while keeping them on the VPS.
2. **View-Level Color Mapping (`BUGS/FEATURE_VIEW_COLOR_MAPPING.md`)**:
   - Configurable "Color By" lens in Graph/Library (e.g., by active chat attachment granularity, category, or folder).
3. **Mid-Message Image Attachments (`BUGS/FEATURE_INLINE_ATTACHMENTS_AND_IMAGES.md` §2)**:
   - Auto-named inline image handles (`img-01.png`) in chat and markdown artifacts.
4. **Horizon Pack 2 (`06`, `07`)**:
   - Two-axis semantic graph & Auto-Organizator; WASM browser embeddings.
