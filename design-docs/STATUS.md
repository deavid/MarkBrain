# Design Documentation Status Report (2026-10-28)

**State Snapshot:**
- **Branch:** `dev-vega` at `fe0a11f` (Merge of `dev-orion 940249a`)
- **Status:** Worktree clean
- **Live State File:** This is the single authoritative live-state file. (TODO.md and scratch/pending.md were retired into archive/).

## Design Documentation Index
The following documentation set is active:
- `00_CORE_PHILOSOPHY_AND_LAWS.md`
- `01_REQUIREMENTS_AND_VISION.md`
- `02_SYSTEM_ARCHITECTURE.md`
- `03_DATA_AND_CONTEXT_MODEL.md`
- `04_UX_AND_DESIGN_LAW.md`
- `05_SECURITY_AND_OPERATIONS.md`
- `06_HORIZON_GRAPH_AND_AUTO_ORGANIZATOR.md`
- `07_HORIZON_CLIENT_REPLICA_AND_WASM.md`
- `STATUS.md`
- `SCRATCH.md`

*(Archive contains 46 files and is read-only for provenance/history.)*

## Gate Status and Quality Assurance
- **Test Coverage:** Verified 2026-10-28 after the docs restructure: **679/679 (77 files), tsc clean.**
- **Mandatory Gate Commands:**
    1. `npx tsc --noEmit` (Compile check)
    2. `npx vitest run` (Unit/Integration test)
    3. `npm run build` (Deployment artifact build)
- **Reference:** Implementation details regarding gate verification are specified in `05_SECURITY_AND_OPERATIONS.md` §3.

## Features Landed (Ready for Testing)
*These items landed from the recent `dev-orion` and `dev-vega` commits and are ready for David's manual testing.*

**From `dev-orion` (Execution Pack 1):**
* Package 1: Artifact manual editing + persistent 4-layer revisions + diff/revert + provenance jump + stale-layer guard + New Note + .md download.
* Package 2: Capability toggles (writeArtifacts ON, autoChapter OFF, graphLinks OFF) + chapter header controls (split, merge, shift seam, regenerate summary with steering).
* Package 3: Bijective .tar.gz plaintext export/import + AuthGate offline replica access + sign-out keep-vs-wipe.
* Package 4: 7-day API call flight recorder (server api_call_logs + local markbrain-call-logs IDB + ServerLogsModal tab).
* Package 5: Declarative schema annealing (TABLES_SPEC + annealDatabase) + doc_json envelope cleanup.
* Package 6: Operator plaintext CLI.

**From `dev-vega`:**
* Compressive sidebar Text size setting (Default|Large|Larger|Largest; theme tokens, spacing untouched).
* ReadAloud volume slider responsive fix.
* Per-thread unsent composer draft persistence (composerDrafts.ts, debounced + pagehide/visibilitychange flush).
* PWA offline awareness (connectivity.ts; amber airplane icon; offline sends held queued, auto-flush on reconnect; TTS/Logs/Telemetry gated offline).
* Deploy wording scrub (`playbook.yml`, `RUNBOOK.md`).

## Active Backlog (Honest & Numbered)
1. **Verification & Bug-Fix:** Complete manual testing and bug-fix pass on all above landed features (Orion is mid-check; David to test Text size on mobile, composer draft recovery, offline airplane behavior).
2. **Live Deployment:** First live Ansible deployment to `markbrain.unhaunter.com` (Sequenced deployment via `deploy/RUNBOOK.md`).
3. **Horizon Pack 2 (Design Sign-off Needed):** Two-axis semantic graph + forest map + neighborhood staging; bidirectional suggestions (attach/push-in/push-out); chat-driven Auto-Organizator; WASM browser embeddings; FS Access folder mirror; peer-collaborator prompt tuning.
4. **Future Drawer (Parked):** Security H2 (cookie-only sessions), L1 (prod lockfile), offline-replica password verifier, paragraph-anchored comments.

**Decision Pending:** L1 prod-lockfile script (regen-deps + npm ci + fail-hard playbook) — pitched, awaiting decision.
