# 30 — API Call Inspector: Audit & Completion Plan

Date: 2026-10-31 · Branch: `dev-pulsar` · HEAD at time of writing: `48798a4`

This document records (a) the audit of what was actually implemented of the approved
ApiCallInspectorModal design, and (b) the plan to close the remaining gaps.
The approved design (6-tab full-screen inspector, "the one true place for calls")
was agreed in-session on 2026-10-30; see commit pair `9686d8b` + `48798a4`.

---

## 1. What was DONE properly (verified in code)

- **The call id rides the wire — end to end.**
  Adapters emit a `call` SSE event right after `recorder.start` (even for streams
  that later fail). Server job runner broadcasts `call` and carries `callId` in the
  snapshot/error/stopped frames. Late-watcher law: a watcher attached after the
  `chat_jobs` row is deleted learns the callId from the snapshot frame via
  `jobCallIdForUser` (ownership proven from the surviving `api_call_logs` row,
  no existence leak). `commitRegenerate` points the turn at the LATEST call.
  `DraftItem.callId` is persisted (module-load storage resolution,
  `markbrain:local:markbrain:draftQueue` in local mode).
  Pinned by `call-linkage.test.ts` and `call-inspector-recorder.test.ts`.

- **Wire request capture is real and at the adapter.**
  `gemini.ts` and `openrouter.ts` build the exact wire body (model, contents,
  `thinkingConfig` / `reasoning`, temperature) and call `recorder.wire(callId, wireBody)`;
  scrubbed via `scrubRequestDeep`. Rendered verbatim in the Wire tab.

- **ServerLogsModal cleanup is done.**
  API-calls tab machinery removed (247 lines in `48798a4`); header says
  "Logs ONLY — the flight recorder lives in ApiCallInspectorModal"; source-scan
  test pins there is no `setTab('calls')` / `ApiCallsTab` / `ApiCallDetail`.

- **MessageBubble entry point.**
  Inspect (ScrollText) button on assistant messages works in Local AND VPS mode;
  gating is only `!offlineReplica && onInspectCall && message.meta?.callId`.
  The old `jobIdFor(turn.id)` string-guess path is gone (test-pinned).

- A 6-tab modal exists (`ApiCallInspectorModal.tsx`) with verbatim content blocks,
  per-block Copy buttons, and an "initialTab" prop used by tests.

---

## 2. The gaps (what was NOT actioned)

1. **VPS-mode inspect is silently broken.**
   `App.tsx` resolves the call ONLY from local IndexedDB (`getCallLog`).
   In VPS mode the row lives server-side (`api_call_logs`); local IndexedDB has
   no row → `getCallLog` returns `null` → the modal renders nothing
   (`if (!isOpen || !call) return null`). The server route
   (`GET /api/logs/calls/:id`) and the gateway wrapper `getApiCallLog`
   (`src/gateway/api.ts`) exist but NOTHING calls the wrapper — dead code.

2. **DraftQueueTray has no inspect button at all.**
   Zero references to inspect/callId in `DraftQueueTray.tsx`. The linkage data
   (`DraftItem.callId`) exists but is unreachable from the tray. Active, failed,
   and stopped draft cards all lack the affordance. (The `48798a4` commit
   message claims the failed-draft path opens the inspector — it does not.)

3. **Wrong tab set vs the approved six.**
   Implemented: Overview / Request / Wire / Response / Reasoning / Timings.
   Approved: Overview & Timings / System Instruction / Compiled Prompt /
   Wire Request / Thinking (Raw) / Response (Raw vs Processed).
   Missing: dedicated System Instruction tab; Compiled Prompt "By Section"
   toggle (Project Header / Chapter Summaries / Active Artifacts collapsibles /
   Conversation Transcript with char weights); Raw-vs-Processed response split.

4. **Demux result recorded NOWHERE.**
   No field on `ApiCallLog` for extracted actions; nothing in `RecordCallEndInput`.
   The "Extracted Actions" view (topicShift applied/ignored + why, artifact
   upserts created/updated/dropped, links/unlinks resolved/ignored) requires
   new recording at the data layer, not just UI.

5. **Usage/token accounting recorded but never rendered.**
   `call.usage` exists; no tab shows it; no provider-reported-vs-estimated
   distinction anywhere. No summary strip in the header.

6. **No attempt switcher.**
   Rows carry `turnId` (set by `recordCallEnd`), so prior attempts are queryable,
   but there is no query and no dropdown in the header.

7. **Layout not full-screen.**
   `max-w-5xl h-[85vh]` instead of ~96vw × 94vh. Header lacks endpoint and
   HTTP status/outcome badge (the badge lives inside the Overview tab body).
   **No Esc-to-close** — only the X button.

8. **Timings shallow.**
   Only `tSend` carries a wall-clock timestamp. No per-phase wall-clock times,
   no thinking/writing phase durations, no chars/sec. Reasoning tab lacks
   char count + duration. No char/token counts in any tab header.

---

## 3. The plan (TDD-first, one feature commit per phase)

Standing law: failing tests FIRST — run them, show the RED — then implement.
Test the real seams (recorded data, real pipeline handoffs), not synthetic inputs.

### Phase 1 — make the button actually work (fix the broken promise)
- VPS mode: `onInspectCall` resolves the call via the server route through
  `getApiCallLog` (gateway); local mode keeps the IndexedDB `getCallLog`.
- DraftQueueTray: inspect button on active/failed/stopped cards, wired to
  `DraftItem.callId`.
- RED tests: mode-aware resolution; tray affordance per card state.
- Closes gaps 1–2.

### Phase 2 — full-screen chrome
- ~96vw × 94vh container; header shows endpoint + HTTP/outcome badge;
  summary strip (total · TTFT · tokens in → out · chunk counts); Esc closes.
- RED tests on rendered markup.
- Closes gaps 5 (partial), 7, and the header half of 8.

### Phase 3 — restructure to the approved six tabs (pure UI, data already recorded)
- Merge Timings into **Overview & Timings**, deepened: per-phase wall-clock
  timestamps, thinking/writing phase durations, chars/sec, request params.
- Dedicated **System Instruction** tab, char/token count in the tab header.
- **Compiled Prompt** tab with Full Raw ↔ By Section toggle: parse structural
  markers (Project Header / Chapter Summaries / Active-in-Memory Artifacts as
  collapsibles / Conversation Transcript) with char weights per section.
  Derived from the recorded string — no data-layer change.
- **Thinking (Raw)** tab: char count + duration added.
- Closes gaps 3 (except Response), 8, 10.

### Phase 4 — record the demux result (data layer)
- `recordCallEnd` (and the local-mode equivalent) captures the parsed outcome:
  - topicShift: value + applied/ignored + reason (e.g. autoChapter OFF, last-wins)
  - artifactUpserts: file + created/updated/dropped
  - links/unlinks: slugs + resolution + applied/ignored
  - usage: provider-reported vs estimated flag
- Wire it from the `chatJobRunner` / `sendQueue` demux handoff.
- RED tests pinned on the real demux handoff seam, not invented inputs.
- Closes the data halves of gaps 4–5.
- SCOPE NOTE (David, decide before this phase): the "why ignored/applied" detail
  requires the demux handoff to carry outcome reasons into telemetry. Keep the
  recording minimal (outcome + reason strings); if the Extracted Actions view
  should stay simpler (just what was extracted), Phases 4–5 shrink accordingly.

### Phase 5 — Response (Raw vs Processed) tab
- Raw provider text with `<artifact_upsert>` / `<topic_shift>` / `<link>` /
  `<unlink>` tags highlighted in place.
- Clean chat reply (what landed in the bubble).
- Extracted Actions (demux result from Phase 4).
- Closes the UI halves of gaps 3–4.

### Phase 6 — attempt switcher
- Query prior recorded calls by `turnId`; header dropdown
  ("Attempt #2 (latest) ▾") so failed retries can be inspected too.
- Closes gap 6.

---

## 4. Definition of done

- All six approved tabs present, full-screen, Esc-closable, Copy buttons,
  char/token counts in tab headers.
- Inspect reachable from: assistant MessageBubble (Local + VPS) and every
  active/failed/stopped draft card.
- VPS mode actually renders server-recorded calls (no silent null modal).
- Demux outcome + usage accounting recorded and displayed.
- Full suite green, `tsc --noEmit` clean, `npm run build` clean;
  every phase landed as a big feature commit with RED tests shown first.

---

## 5. STATUS (2026-10-31) — ALL PHASES DONE

| Phase | Commit |
|---|---|
| 1 — the button works everywhere (VPS retrieval + tray affordance) | a60890e |
| 2 — full-screen chrome (96vw×94vh, endpoint+outcome header, summary strip, Esc) | eb58dcb |
| 3 — the approved six tabs (merged Overview & Timings, System, By-section Prompt) | b59c9ab |
| 4 — record the demux outcome + honest usage flag | 8f0a394 (+ fix 7c56b9c) |
| 5 — Response: Raw vs Processed (sentinels highlighted, clean reply, extracted actions) | 602ba32 |
| 6 — the attempt switcher (inspect the failed retry too) | cd3dce6 |

Full suite 848/848 green across 100 files at Phase 6; tsc clean; build clean.
