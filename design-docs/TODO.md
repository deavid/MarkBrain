# TODO / BUGS — the pickup file

> **What this is:** the plain, current list of things *known broken, known
> missing, or decided-but-not-built* — written so anyone (human or AI) can pick
> up slack without re-reading the whole doc set. One item = enough context to
> start; keep items short and concrete, delete them when done.
>
> **What this is not:** the live project state (that's `scratch/pending.md`) or
> the architecture story (`STATUS.md`, `09_…`). When in doubt, an item here
> should cite the doc or decision that spawned it.

---

# FOLLOW-UP REGISTER (2026-10-25 evening) — do not lose this

> David: *"recap on where are we … please write down everything to follow up
> because we're doing a lot and we're going to forget."* This is the single
> list. Newest status on top of each section.

## Where we are

Branch `dev-vega` on `MarkBrain-dev-vega`, server **13032** (running with
**VITE_BYOK=1**), tsc clean, **424/424 tests**. Today shipped, in order:
CSP Google sign-in fix → UI feedback block (row opens popup, badges deleted,
click-outside, compact workhorse, Models|Keys tabs) → vault **removed** →
BYOK behind the flag + flag-off reads stored keys as EMPTY → live provider
catalog fetching **removed** (external-stress rule) → **pairs/queue rebuild**
(failures are drafts, never turns — 17/18) → **Regenerate last reply**
(queue-gated, replaces reply only on success) → **chat slot is the single
source of truth** (3.8 bug) + title lane honors its slot.

## TESTING ROUND 2026-10-25 evening — DONE

- [x] T1 chat slot: 3.8 means 3.8 ✅ · [x] T2 pairs law ✅ · [x] T4 regenerate ✅
- [x] T3 Stop/Store-as-is: David could not click-test it — emulated through
      the real SendQueue instead (5 tests, draft-stop-store-as-is.test.ts) ✅
- [x] T5 flag-off leftovers: unit-tested (key-slots.test.ts, 3 laws) ✅
- [x] T7 near-match: David found the short-query cliff (Dice 0.95 fails
      +1 letter on short text); fixed with edit-distance ≤ 1 rule ✅
- [x] T8 ?slowsave=1 banner ✅
- **T6 (Sirius manual plan) SHELVED forever for now** — with the rest of the
  BYOK discussion. Do not run it, do not nag.
- Also fixed this round: model errors are final (no watchdog downgrade,
  a00c401); catalog = the three REAL text models (ed22294); a bad model
  can never kill the server (130cf16 — it once did).

## ARCHITECTURAL DEEP DIVE — COMPLETED & LOCKED IN PoR (`19` / `20` / `21*`)

David & Vega completed the architectural deep dive on 2026-10-25 and locked the
master blueprint + 7-phase Plan of Record for the executing agent:

- **North Star Blueprint (Soul, Requirements, Decisions D1–D10):**
  `design-docs/19_NORTH_STAR_BLUEPRINT.md`
- **Coarse Plan (10-Mile Breadth Map across all 10 bases):**
  `design-docs/20_COARSE_ARCHITECTURE_PLAN.md`
- **Fine Plans (7-Phase Step-by-Step Plan of Record):**
  - `design-docs/21_POR_INDEX.md` — Master index, invariants, and verification gates
  - `design-docs/21A_PHASE_1_GREAT_PURGE.md` — Purge Firebase, Firestore, Google Drive, and QR mailbox; add `scripts/verify-clean-dist.cjs` build guard
  - `design-docs/21B_PHASE_2_SQLITE_AUTH_AND_USERS.md` — VPS SQLite schema, `scrypt` auth, immutable Owner Account #1 (`deavidsedice@gmail.com`), `npm run user` CLI, `/api/admin/users`, and server RAM/disk encrypted key vault
  - `design-docs/21C_PHASE_3_LOCAL_VAULT_AND_MODE_ISOLATION.md` — Strict workspace isolation (`local` vs `vps:<host>:<email>`), `AuthGate` server login UI, WebCrypto `PBKDF2 + AES-GCM` Local Passphrase Vault (RAM-only decrypted keys), and Owner Users tab in Settings
  - `design-docs/21D_PHASE_4_ATOMIC_SYNC_AND_SETTINGS.md` — Normalized SQLite atomic tables, `revision` delta sync (`/api/projects/:id/delta`), anti-clobber law, and cross-device syncing of API keys + model slots
  - `design-docs/21E_PHASE_5_SEND_AND_FORGET_JOBS.md` — Server-side `ChatJobRunner` (`POST /api/projects/:id/jobs/send`) so locking the phone screen after hitting Send still finishes the LLM turn on the VPS, commits the Pair to SQLite, titles the thread, and auto-summarizes sealed chapters
  - `design-docs/21F_PHASE_6_VPS_EMBEDDINGS_AND_TTS_CACHE.md` — VPS-only semantic indexer & search (`POST /api/projects/:id/search`) with lexical-only search in Local mode; VPS `ffmpeg` TTS re-encoding (`ogg`, 22kHz mono, `q=-1`) + disk cache (`data/tts-cache/`)
  - `design-docs/21G_PHASE_7_CADDY_ANSIBLE_DEPLOY.md` — `deploy/Caddyfile`, `deploy/markbrain.service`, and `deploy/ansible/playbook.yml` for `markbrain.unhaunter.com`

## PENDING FROM SIRIUS — SUPERSEDED BY `19`–`21G` (except S1 Mobile Polish)

- [ ] **S1. (04-A) PWA install + mobile pass** — READ `MOBILE_UX_SPEC.md`
      before quoting effort. Android only. Note: in the new architecture (`19`),
      full mobile support (Send-and-Forget, synced keys, background indexing)
      belongs to Mode 2 (Connected VPS Workspace); Mode 1 (Local Workspace) is
      desktop-first.
- [x] **S2. QR image for "Send to phone"** — KILLED by D2 (`19_NORTH_STAR_BLUEPRINT.md`).
      PC and phone sync via the user's VPS account (`deavidsedice@gmail.com`).
- [x] **S3. VPS deployment posture** — RESOLVED by `19` & `21B`: Caddy serves
      static files to the public at $0; `/api/*` requires a valid VPS account
      login (`401` for strangers) and uses the authenticated user's own
      unlocked vault key.
- [x] **S4. Firebase auth/internal-error** — KILLED by D1 (Firebase removed
      entirely in Phase 1).

## DRAWER (explicitly parked — do not design prematurely)

- Comments anchored to artifact paragraphs (David: "I'd leave this in the drawer")
- Store-visibility / cleanup screen (how storage is used — law in 14)
- Anything feature-shaped that is not fully fleshed out (design drawer rule)

## Standing constraints (memorized rules — full text in memory)

No git writes outside my own worktree+branch · never push · never git tags ·
don't fix Sirius's breakage (report and stop) · never stress external systems
(no provider calls from tests or UI open/close) · never commit secrets, ask
before secrets-policy changes · SO WHAT copy rule (no AI-speak, no invented
jargon, no provider quota claims) · design drawer for un-designed features.

---

## Done — 2026-10-25: errors are final — downgrade removed (`dev-vega`)

David asked for 3.8; the server's 9s watchdog silently re-streamed from 3.5
with a "DOWNGRADED FROM…" chip. *"I don't want the smart downgrade - I want
the actual error … make errors final."* `requireModelId` now hard-errors on an
unknown/wrong-capability model (all six routes); the watchdog and its second
stream are deleted; `downgradedFrom` is gone from telemetry, TurnMeta and the
UI. Pins: `errors-are-final.test.ts` (a00c401).

---
## Done — 2026-10-25: failures are drafts, not turns (`dev-vega`)

Built per `18_CHAT_PAIRS_AND_QUEUE.md` (commit e95682a). Stripped the whole
failed-request-as-turn family (17 §4) and rebuilt: DraftQueue (device-local
drafts, per-thread FIFO, failed head never skipped, three exits
Retry/Store-as-is/Discard), atomic commitPair as the ONLY turn writer,
in-flight streaming in the draft area, transport treats a stream without a
complete event as failure even with partial text. 412/412.

---
## Done — strip failed-request handling (`dev-vega`, superseded by the entry above)

David 2026-10-25, third rejection: the error is stored **as an assistant turn**
(`<turn role="assistant">Gemini: API key not valid…</turn>`) — it pollutes the
conversation, persists forever, and poisons the LLM's view of what it said.
*"Don't patch - strip."*

- **Full inventory:** `17_ERROR_HANDLING_INVENTORY.md` — every piece (error
  production, turn write path, persistence, LLM payload, UI surfaces, thread
  state), the poison paths (payload, persistence, titles, summaries, exports),
  the strip checklist, and the open design questions.
- **Design ADOPTED: `18_CHAT_PAIRS_AND_QUEUE.md`** — chat is complete pairs;
  unpaired asks are drafts in a strict-FIFO device-local queue (retry /
  store-as-is / discard; stop at a failed head). Strip + rebuild together
  per 18 §8 map. No piecemeal patches.

---

## Done — 2026-10-25: a failed request can no longer impersonate the model (`dev-vega`)

David, verbatim: *"We called Gemini 3.5 Flash Lite SUCCESSFULLED and it replied
'No reply came back. Try again.' … This UX says that the LLM replied [that]."* A
wrong BYOK key (401) was swallowed by the adapter into `status{state:'error'}`
inside an HTTP-200 SSE; the stream layer found no `complete` event and returned
an empty **success**; the queue wrote the ghost reply with model name + token
counts.

- **Three braces:** `executeStreamingTurn` now collects `status{error}` and
  `error` events and **throws** (the old frame-catch swallowed error events
  too), and an empty end-of-stream throws *"ended without a reply"*;
  `sendQueue` records `failedEmpty` as `streamState:'error'` + `lastOutcome:'error'`
  with no token accounting, and the catch path shows the **real reason**
  (`Gemini: API key not valid…`) instead of *"Error communicating with
  reasoning engine"*; ChatView renders a red **REQUEST FAILED** chip and hides
  token/latency numbers on failed turns.
- Ghost copy *"No reply came back. Try again."* deleted — pinned by
  `src/tests/stream-failure-propagation.test.ts` (9 tests, incl. source-level
  copy bans).

---

## Done — 2026-10-22: notes are sent as filenames, not as ids (`dev-vega`)

David: *"we are sending the IDs to the LLM in chat which incorrectly is taking
it as the filename… we need to present clear filename-like to the AI."*

- **Cause:** `<artifact id="art-1792614286498-4845">` in the compiled payload —
  the model read the database key as the note's name and wrote it into prose.
- **Fix:** `<artifact file="<title-slug>.md">`; the id is gone from the payload.
  `artifactFileName()` + `uniqueFileName()` in `03-optical-compiler`;
  `artifactXml` takes an optional name.
- **Protocol speaks filenames end to end:** upsert/link examples are
  `file="….md"`; the stream parser accepts `file` (extension stripped) *and*
  legacy `id=`. Server `DEFAULT_SYSTEM_INSTRUCTION` in step.
- Law: `10_ATTACHMENT_TIMELINE.md` §21. Tests: `artifact-filename.test.ts` (15).
  Evidence: J16 asserts the raw payload from the Mirror.
- **Open, pre-existing:** a model re-emitting an attached note's filename creates
  a duplicate instead of updating it — there is no code→id resolver yet.

---

## Done — 2026-10-22: the composer's keyboard contract (`dev-vega`)

David: *"Shift+Enter never sends, Ctrl+Enter always send, and Enter may or may
not send depending on a configuration. We need an option in the sidebar for
Enter (even on phone) sending or not sending by default."*

- **Three keys, two fixed, one preference.** `Shift+Enter` never sends,
  `Ctrl/Cmd+Enter` always sends, bare `Enter` obeys a switch. Mid-IME Enter is
  never a send. Law + evidence in `10_ATTACHMENT_TIMELINE.md` §20.
- `src/ui/chat/sendOnEnter.ts` — `composerKeyAction()` is the one rule; both
  composers route through a shared `handleComposerKeyDown` (the old
  `e.key === 'Enter' && !e.shiftKey` inline rule is deleted).
- **Switch** "Send on Enter" in the sidebar (`Sends` / `New line`), persisted in
  localStorage like `chatRender`, reachable on a phone through the drawer.
  Tests: `src/tests/send-on-enter.test.ts`; journey **J20**.

---

## Done — 2026-10-21 night: the four noise/data-loss items (`dev-vega`)

David, verbatim: *"shouldn't we have some ephemeral red notification for critical
errors? like, we've been losing data and didn't notice… the chapters default to
granularity=Summary… They should default to Full, and nothing except the user
should move them… hide the Title-Description-Summary-Full controls, the user can
click to cycle the granularity and that's it. And I would make the width of the
artifact 25% smaller in the chat."* All four shipped.

- **Critical failures are now visible.** `utils/criticalNotifications.ts` +
  `ui/system/CriticalNotifications.tsx`: a red `role="alert"` banner, one human
  sentence, no stack (that stays in the console), gone on its own after 12s, a
  repeating failure refreshes one banner instead of stacking. Reported into from
  exactly two places, both silent-data-loss paths: a failed **save**
  (`persistWorker`) and a failed **load** (`snapshotLoader`). Law recorded in
  `05_CLEANSE_DECISIONS.md`; tests in `src/tests/critical-notifications.test.ts`;
  live proof in `/tmp/critical-banner-check.cjs` (fires, renders, dismisses,
  expires, never stacks).
- **…and it did not fire. Fixed the same night, properly.** David reloaded and
  said so, with his console attached: the writes were failing with
  `resource-exhausted` and the banner never appeared. Root cause: **a
  quota-blocked Firestore write does not reject.** The client keeps it in its
  retry loop with a backoff cap ("Using maximum backoff delay to prevent
  overloading the backend"), so `setDoc` NEVER settles — the `catch` that raises
  the banner simply never ran. The wiring was fine; the failure was invisible by
  construction.
  - `utils/deadline.ts` — `withDeadline(op, ms, what)`: an operation that never
    settles still fails loudly (the deadline does not cancel the write; it stops
    waiting for it).
  - `SAVE_ACK_DEADLINE_MS = 15s` around `getStore().save(...)` in
    `persistenceService` — a save that sits unacknowledged for 15s counts as
    failed, so the fingerprint stays unset (it retries) and the user is told.
    `LOAD_DEADLINE_MS = 30s` for reads (a hung load is at least *visible*: the
    boot loader spins, the save gate stays shut).
  - `persistWorker` no longer blames the cloud for every error in the block:
    payload assembly and transmission are separate `try`s, with separate
    messages (an assembly crash says "Could not save your work").
  - Evidence seam `?slowsave=1` (dev only): the save path hangs exactly like a
    quota-blocked write and never consults a backend, so fixture runs stay
    read-only. **Journey `19-critical-notice`** drives it end to end and asserts
    the banner appears, says what is at risk, carries no error specifics, is a
    live region, and dismisses. Tests: `deadline.test.ts` (5),
    `save-watchdog.test.ts` (4), plus the app-layer wiring in
    `critical-notifications.test.ts`.
- **Nothing but the user moves a chapter's cut.** `sealedGranularity` is deleted
  (it was called at `ChapterSegmentationDomain` ×3 and `ThreadRegistry` ×1);
  sealing/splitting/closing now only fix turn windows, and
  `resolveChapterGranularity(chapter)` = explicit choice, else Full. Legacy
  snapshots are migrated ONCE on hydrate (`granularityLaw` marker written on
  every save), so the chapters that already read Summary come back Full and a
  Summary the user picks afterwards stays. See `10_…` §19, item 1 below.
- **The chat artifact card lost its chips** (`hideGranularityChips`): the row
  body is the control — click cycles the cut, exactly as asked. Chips remain
  where a cut is *chosen*: folder row, staged tray, chapter header, detail modal.
- **The chat card is 25% narrower**: a fixed 240px (`size="compact"`) instead of
  the 320px library row, and it no longer `grow`s — the first attempt kept
  `grow`, measured 852px in evidence, and the reduction was invisible.

Evidence: J15 gained the card checks (no chips, ≤260px, click cycles the cut);
gates GREEN — `tsc` clean, **226/226** vitest, evidence 18/18 journeys, 0 fails,
0 warns, 0 console errors.

---

## Done — 2026-10-20: the attachment timeline (10_ATTACHMENT_TIMELINE.md)

The four things David flagged from the screenshots are built (commit on
`dev-altair`): top clearance that scrolls away, the folder row as the picker
(6 states, dot verb), staged tray → welded-to-turn attachments, and the chapter
view = the cut (Recap eradicated, token count per chapter). Details: doc 10 §18.

- ~~Top pills overlap content~~ → in-flow clearance spacer in the chat feed and
  the folder list; nothing sticky (verified by journey `17-top-clearance`).
- ~~No attach / granularity control outside the detail modal~~ → folder rows
  carry the dot + the four chips + the token cost; `AttachmentPicker` deleted.
- ~~Nothing shows what will be sent~~ → staged tray in the composer (both
  composers), removable with `×`, counted in the live total.
- ~~No record of where an attachment entered~~ → `turnIndex`/`turnId` welded at
  Send; the card renders on that turn and in the chapter's compacted strip.
- ~~Chapter view ≠ payload (`Recap` + honest strip)~~ → the body renders the cut
  (description → summary → turns) + `N tok` per chapter; `Recap` is gone.
- ~~Voice selector eats composer space~~ → it lives in the sidebar; `[ + ]`
  opens the library.
- **Also:** manual chapter split now fires the background summarize for the
  chapter it seals (so the `summary` cut it steps to is backed by text).

---

## Done — 2026-10-19 night: the attachment slice (all six original items)

Items 1–2, 4–6 of the previous list are **built** (commits on `dev-altair`).
The payload is now: this chat's attachments (each at its own granularity) +
this chat's chapters (each at its own granularity). Nothing is included by
distance. Details in `09_CHAT_ARTIFACTS_PAYLOAD.md` §11 and `changelog.md`.

- ~~Compiler: four chapter granularities~~ → `03-optical-compiler` emits
  title / description / summary / full, cumulative (a cut, not a swap).
- ~~Chapter row: real granularity control~~ → the chat header and the mirror
  both carry the four-word control; the compiler honors it.
- ~~Chapter resolution rule~~ → `resolveChapterGranularity()` + explicit
  `chapter.granularity`; **sealing does NOT step full → summary** (that
  auto-seal was removed 2026-10-21 — see the top of this file).
- ~~Attachment model~~ → `ChatAttachment` on `ChatThread`, per chat, attach at
  full, no detach, no excluded state. `ThreadRegistry.attachArtifact` /
  `setAttachmentGranularity` / `purgeArtifact`.
- ~~Remove Focus machinery~~ → `nodeTiers`, `TierReason`, pins, overrides,
  radius BFS, ancestor backbone, `opticalMode` and its sidebar toggle are gone.
  The graph is a library lens only.
- **Bonus found in the code and fixed:** the model's `<topic_shift>` already
  carries `abstract` (= what the new chapter is about) and `summary`; the first
  was being stored as `topicShiftReason` (and rendered as a "Shift" chip) and
  the second was dropped. New chapters are now born with a description; the
  legacy field is backfilled in `hydrate.ts`.

---

## Done — 2026-10-20 night: the colour law, one widget, the honest rail (12)

**All nine items below shipped** on `dev-altair`; the built list (with the
deviations) is `12_PLAN_OF_RECORD.md` §18, the verdicts are
`11_DESIGN_LEDGER.md`. The items stay below as the statement of the problem,
not as work.


Full verdicts live in `11_DESIGN_LEDGER.md`; the concrete, self-reviewed
execution blueprint (with all 4 open questions resolved and exact hexes,
props, and file-by-file changes) lives in **`12_PLAN_OF_RECORD.md`**. Execute
Packages 1–6 in `12_PLAN_OF_RECORD.md` in order:

11. **The chapter body lies at the `Description` cut** (S1): `ChatView.tsx:671/679`
    render `description`/`summary` with only a `granularity !== 'title'` gate, so
    the payload carries the title while the UI shows the summary paragraph
    (ledger V1.2). Gate both on `cutIncludes`, add the J16 Description step, and
    one journey that asserts **UI == payload** (via the Mirror breakdown) instead
    of element counts.
12. **Colour law v2** (R1.1/R1.2): hue becomes a stroke/ink/dot, never a fill;
    dark plate + bright ink always; one filled thing per row (the dot); 6 states
    = 4 even-spaced hues (`#41d686` `#d4da5b` `#ff9d00` `#ff645f`) + animated
    staged cyan `#37d2f2` + hue-less grey `#7d8792`. Kills the 1.34:1
    active-chip inversion by construction (V1.5).
13. **The 5px rail** (R1.5): real payload order + real breakdown (no
    `historyTokens * 0.7`), one segment per part, hue = that part's own
    granularity, height = `min(1, cbrt(total/1M))` with segments subdividing that
    fill. Yardstick open (ledger §Open to David 1).
14. **One artifact widget everywhere** (R1.3/R1.4): row body = the verb, arrow-out
    icon = the detail modal, same component in folder / chat cards / staged tray
    / chapter strip / mirror. Chat cards have *no* modal route today.
15. **Retry must not carry un-welded attachments** (V1.3): `sendQueue.ts:296/310`
    commits staged items only on the new-send branch while compile reads them
    anyway → sent, unrecorded, re-sent. Product call open (ledger §Open 2).
16. **`Write it` must not change the cut** (V1.4): on `full → summary` seals it
    silently downgrades to `description` (17 fewer tokens, masked by item 11).
17. **350px header** (V1.6): `Full` chip clipped, fold control off-screen inside
    `overflow-hidden`; add a *clipped-inside-overflow* geometry check to the audit
    (it currently only checks touch size + document scroll).
18. **Summarize: timeout + abort + visible failure** (V1.7) — also the source of
    the console error that makes the evidence pack RED (V1.1). Doubles as item 9's
    Regenerate.
19. **Taste/hygiene pass** (R1.6 + V1.8): one token count, one message counter
    (`msg N`, 1-based), legacy attachments say "from the start of this chat",
    dead `TTS_VOICES` / `estimateChapterCutTokens`, the duplicate
    `GranularityChips` in `MirrorPanel`, orb gets role/keyboard/aria, modal gets
    provenance, ≤390px pill band.

---

## Open — decided or discovered, not built

### 1. Chapters have no summary until someone presses Summarize
A chapter closes on a topic shift; nothing summarizes the chapter that just
ended. `description` is seeded by the model's topic-shift turn, `summary` is
only produced by the explicit `/api/summarize-chapter` call. A closed chapter
therefore often sends `title + description` while claiming granularity
`summary` (the mirror shows the real token cost, so it is not a lie — but the
level is empty).
**State after 10:** a *manual* split fires the background summarize for the
chapter it seals, and clicking `Description`/`Summary` on a chapter missing
that layer fires it too. A chapter sealed by the model's `<topic_shift>` inside
the stream is still not auto-summarized (summarize is active-thread-only
today). Those show the honest "No summary yet" chrome.
**Options left:** a thread-aware summarize call in the queue (costs one call
per chapter boundary — a money decision), or lower the sealed default to
`description` when no summary exists. Not decided — and note the second option
is now partly moot: since 2026-10-21 (top of this file) a closed chapter does
NOT drop to a lower cut at all; it stays Full until the user moves it, so the
"level is empty" problem only appears when the user asks for a layer nobody
wrote (which the "Write it" chrome handles honestly).

**Law added 2026-10-21 (David): the last TWO chapters are in progress.** They
are forced to Full, their cut controls are replaced with an "In progress ·
Full" badge (chat header and mirror), and `handleSummarizeChapter` refuses them:
a chapter you are still talking inside is not one to cut or recap. The
background summarize on a manual split now targets the chapter that just
LEFT the window (it is the one whose sealed cut starts promising layers), so
nothing summarizes inside the window. `isChapterInProgress` /
`resolveChapterSendGranularity` in `02-chapter-segmentation/selectors.ts` own
this; `isChapterOngoing` stays purely geometric (turn ownership never moves).
Evidence: J04 now makes four chapters, J16 asserts the badge and the hidden
chips; `src/tests/chapter-in-progress.test.ts`.

### 2. Import/extraction prompts don't state the cut contract — CLOSED 2026-10-21
**Measured, then rebuilt.** The prompts asked for "a few phrases" and "a few
paragraphs"; the export showed 31-token descriptions, 151-token summaries, 33 of
41 summaries opening by restating the description, and imported bodies that had
kept 59% of their source files. The layers are now four distinct jobs at four
scales, the prompts say the layers are read together in order, JSON is gone from
every LLM call (sentinel `=== HEADER ===` blocks), and the body is spliced from
the uploaded file instead of being retyped by the model.
Evidence: `src/tests/compaction-prompts.test.ts`, design-docs/09 §"The
compaction contract".

#### 2b. NEW — the subtitle is a layer, and every row shows it
The old one-sentence `description` was the missing half of a title: a bare
four-word name told the reader (and the model) nothing, and ~40 tokens is free.
`subtitle` is now a layer sent with the title at the `title` cut, rendered inline
in every row (`title — subtitle`, two lines, italic hook), and legacy notes get
it on hydrate from a short description. Re-importing the surviving source files
is still the only way to recover the content the old imports dropped.

### 3. Terminology sitting (unchanged)
`TERMINOLOGY.md` §1–§5 inventory is still the agenda. §0 (granularity /
attachment / artifact / Focus eradication) is now *code*, not prose. Remaining
offenders: tier/level in stale docs, workspace vs project, control mode,
compaction (display vs payload), telemetry (numbers vs ambient).

### 4. Model picker vs "no model selection"
`TERMINOLOGY.md` §0 kills model selection ("it's Gemini Flash Lite"). The
sidebar model picker and `/api/models` still exist (journey 11 exercises them).
Remove when the provider story settles — it is a UI + server contract change,
not part of the attachment work.

### 5. Chat shows turns even when the chapter isn't sent that way
**SUPERSEDED 2026-10-20** — the chat body now renders exactly the cut (doc 10).
Kept here so the old objection is on record: it was rejected because legacy
chapters often have no summary "which would hide content behind nothing". The
resolution was chrome, not a lie: a missing layer renders a "No summary yet —
[Write it]" prompt, so nothing hides behind nothing.

### 6. `full` sends the whole cut (Option A) — token cost
Confirmed by David (2026-10-19): at `full`, title + description + summary +
body / verbatim turns are all sent, because the layers are written to be read
together. If real artifacts turn out to repeat themselves, revisit whether
`full` should drop the summary layer.

### 7. Detail modal edits only the body
`ArtifactDetailModal` shows description/summary but the editable field is the
body (raw YAML/rendered). Editing the description/summary layers by hand is
not wired. Low priority; imports set them.

### 8. No detach once committed (accepted, not a bug)
Attaching is one-way **at the moment it is sent**: staged items are freely
removable (they haven't happened yet), committed ones are welded to a turn
(`turnIndex`) and expose granularity only (doc 10 §2 L2). Artifact deletion
garbage-collects attachments everywhere. Floor = title. If "sent forever" gets
annoying in practice, that is a new feature (an excluded state), not a fix.

### 9. No "Regenerate" next to a chapter's token count
`Write it` appears only when the promised layer is missing. A summary that has
gone stale (or was written from a thinner chapter) has no re-run affordance in
the header yet — `/api/summarize-chapter` is already there to call.

### 10. The graph lens is not a picker
Staging lives in the folders lens (the rows). The graph renders nodes with no
attach state — fine for now (it is the forest view), but a node with a "what
does this cost me in this chat" ring would be the natural next step.

---

## See also
- `11_DESIGN_LEDGER.md` — **external verdicts** (David's feedback rounds,
  review reports) with verdicts + measurements. Every round lands there before
  any of it is built; the actionable subset lands here.
- `scratch/pending.md` — live state, newest first.
- `STATUS.md` — cold-start snapshot + queued decisions (keyPoints, over-budget,
  tokenCeiling, 24px pass). Note: keyPoints are now **deleted** (were never
  sent); over-budget + tokenCeiling setter remain open.
- `09_CHAT_ARTIFACTS_PAYLOAD.md` — the reshape this slice implements.
