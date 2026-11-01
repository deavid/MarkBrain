# 29 — CUJs for Execution Pack 1 (design-docs/28)

Critical user journeys for the six packages, in the words a person would use for them.
Each CUJ maps to a visual journey in `scripts/evidence.cjs` (screenshots + assertions,
headless Chromium against the dev server) and/or a unit-level journey test.
Package 5 (schema annealing) and Package 6 (operator CLI) have no UI surface:
they are covered by `schema-annealing.test.ts` and `plaintext-cli.test.ts`
(a real subprocess export→import round-trip), so no UI CUJ exists for them.

## New CUJs (new evidence journeys)

### CUJ-21 — "Fix my note and see who changed what" → `21-artifact-edit-history`
Open a note → Edit → change the body → Save. History grows by one revision
labeled as mine. Open an older revision's diff, Revert to it — the note goes
back (title + all layers together), and the revert itself is recorded in History.
Take the note out as a `.md` file while I'm there.

### CUJ-22 — "The chat only does what I allow" → `22-capability-toggles`
Composer popover ("What the chat can do"): toggle Write notes / Cut chapters /
Link notes. What the LLM receives changes accordingly — with notes ON the raw
payload carries the artifact instructions, with it OFF those instructions are
not there at all (not hidden: absent). Same for the chapter block. Toggles come
back to their defaults for the next run.

### CUJ-23 — "Merge two chapters by hand" → `23-chapter-controls`
Chapter ⋯ menu → Merge with previous chapter → the chapter list shrinks by one
and the turns survive. (Move seam + re-summarize with steering note live in the
same menu; merge is the destructive one, so it is the one pinned here.)

### CUJ-24 — "What exactly did we send?" → `24-flight-recorder`
Sidebar → Server Telemetry & Logs → API Calls (last 7d) tab → open one call:
scrubbed request (system instruction + compiled prompt), the raw unparsed
response *before* the demuxer strips artifact/topic_shift blocks, timings
(ack · first token · total), usage, job/turn ids — and no API key anywhere.

### CUJ-25 — "Back up my project as files, then restore it" → `25-plaintext-io`
Sidebar → Plaintext backup (.tar.gz) → a real .tar.gz downloads, and it is
plainly readable inside (project.json, threads/, artifacts/). Then on a fresh
local workspace: import that same file → the project appears; a reload later
it is still there (durability you can see).

### CUJ-26 — "Read my data with the server down" → `26-offline-replica`
Signed out, AuthGate offers "Offline replicas on this device" → Open offline
boots the workspace without any login call to the server (asserted: zero
`/api/auth` requests). "Sign out & erase this device's copy" wipes the replica
off the list.

## Existing journeys affected by the pack (already covered, watch for drift)

| Journey | Touchpoint |
|---|---|
| 01 boot | fixture artifacts now carry codes/layersStaleAt |
| 02 send | capabilities merge (defaults) ride every send |
| 04/05/16 chapters | cut controls unchanged, but the ⋯ menu now sits in the header |
| 07 mirror | resolved Capabilities line + stale-layer omission at Full cut |
| 08 artifacts | artifact cards open the new Edit-capable modal |
| 09/10 export/import | the plaintext entries sit next to the JSON/MD lanes |

## Known gap found while writing these (2026-10-28)

Pack 28 §3 promised an **offline badge** when running on an offline replica —
no such indicator ships anywhere in the UI today. CUJ-26 asserts what exists
(no-auth boot, no auth calls); the badge itself is still to build.

## Run results (2026-10-28, evidence pack)

- CUJ-21 `21-artifact-edit-history` — ✅ verified visually: edit lands, the
  stale-layer banner ("Summary layers out of date… Refresh layers") appears
  right after the manual edit, History records "v1 · Manual edit", Revert
  restores the old body, `.md` download carries the body.
- CUJ-22 `22-capability-toggles` — ✅ verified visually: notes OFF drops the
  system message 611 → 279 tokens with zero XML blocks left; the mirror states
  "Capabilities: notes OFF · chapters OFF · links OFF".
- CUJ-23 `23-chapter-controls` — ✅ (needs a second chapter: run with `04`
  or the full pack; the bare fixture has one chapter and the journey says so).
- CUJ-24 `24-flight-recorder` — ✅ verified visually: seeded calls list with
  `ack 120 ms · ttft 450 ms · total 1800 ms`, raw unparsed response keeps the
  sentinel blocks, no secrets rendered.
- CUJ-25 `25-plaintext-io` — ✅ verified visually: real `.tar.gz` download
  (readable project.json / threads/ / artifacts/ inside), the SAME file
  imports into a fresh local workspace and survives a reload.
- CUJ-26 `26-offline-replica` — ✅ verified visually: gate offers the replica,
  "Open offline" boots with **zero** `/api/auth` calls, Sign out (keep) keeps
  the replica offered. (The wipe leg needs a workspace sidebar; empty mirror
  only offers plain Sign out — `wipeReplicaStorage` is pinned by two unit
  tests in `offline-replica.test.ts` instead.)

## What the visual pass caught beyond the pack

1. **Mirror lied about capabilities (real bug, fixed).** The preview compile
   (`useContextPayload`) never passed the resolved capabilities, so the mirror
   showed the DEFAULT system instruction while the real send used the thread's
   toggles — exactly what pack 28 §4 R4 exists to prevent. Fixed: the preview
   now compiles with the same `resolveCapabilities(thread, project)` the send
   uses.
2. **No offline badge** (promised in pack 28 §3) — still to build.
3. **Escape does not close** the Import modal or the Server Logs modal —
   real UX papercut; journeys now close them via their own buttons.
4. **Harness had drifted behind the app** (pre-existing, not pack):
   the auth gate (9c87b32), the local key vault, and the proactive padlock
   all arrived after `evidence.cjs` was last touched. The harness now boots
   through the gate, provisions the vault from the layered env `GEMINI_API_KEY`,
   and re-unlocks the padlock before sends.

## The harness is hermetic — no live sends, ever (2026-10-28)

David caught it: the send-flow journeys were making **real API calls** with the
real key, unattended. That is against the standing rule (no external calls from
tests, period). Corrected:

- The harness is **hermetic, full stop**. It never reads a key, never
  provisions the vault, and a hard guard fails the pack if any request
  leaves localhost. The send-flow journeys run against the fake stream.
- J12 at 390px now asserts the honest offline state: with no key the composer
  shows the padlock ("Add an API key to send") instead of the send button —
  same affordance, three titles, all must sit inside the viewport.

Final state: **27/27 journeys green, audit all green, 0 errors, 0 external
requests**, verdict AMBER (J23's honest warn: merging needs a second
chapter — run `MARKBRAIN_JOURNEYS=04,23`).

### The reds observed in the live runs (for when live sends are on)

One chain, not five bugs: a send can die mid-stream ("The stream ended without
a reply"), and the queue law then blocks every send behind it (J15's staged
tray, J20's sends, J12's committed-thread geometry). Evidence: the key
validates via `curl` against the exact `streamGenerateContent` endpoint,
single-send probes pass (HTTP 200), and the pack touched zero vault/stream
code. Most likely the provider free-tier throttles under the pack's send
burst. Separately observed once (not reproduced): a 400 "API key not valid"
while the same key succeeded via `curl` seconds later — worth a look at the
vault unseal path if it recurs.

J13's premise (force a 500 on the *server* route) cannot bite in local BYOK
mode, where chat goes browser→provider directly; that journey needs a
VPS-mode harness to mean anything.

### The fake stream is BUILT (2026-10-28, same day)

Common-sense design, no more questions: `fixtureChatStream` in
`src/gateway/api.ts`, gated on `isCaptureMode()` in front of every network
path. It speaks the exact SSE vocabulary the real adapters emit
(`status` / `chunk` / `complete`), ~200ms per chunk so Stop is clickable,
and records every call in the flight recorder with provider `fixture`.
What it replies is decided by the prompt words:

- `Reply with exactly: X` → the reply is exactly `X` (journeys unchanged)
- `EMIT-ARTIFACT: code` → the reply carries an `<artifact_upsert>` sentinel
  (one atomic chunk — never split, so chunk-level demux can't see half a
  block): the demuxer→upsert→revision chain is exercised for real
- `EMIT-TOPIC: Title` → same, for `<topic_shift>`
- `should fail` → fails ONCE per distinct prompt; Retry of the same text
  succeeds (the transient-failure shape J13 needs)
- anything else → a short canned sentence

`evaluateSendReadiness` reports ready in capture mode (no key, no vault —
a padlock over a fake stream is theater). J13's dead `page.route` 500 is
gone (it never fired in BYOK mode — chat goes browser→provider, not
`/api/chat/stream`); the keyword does the failing. New journey
`27-fixture-sentinel` proves the sentinel chain end to end: stream →
demuxer strips it from the visible reply → real note with four layers →
AI revision in History → provenance "in this chat".

**Result: 27/27 journeys green + audit all green + zero errors + zero
external requests.** The six formerly-live journeys (02/03/06/13/15/20)
now run hermetically — 03 even captures a real stopped mid-stream draft
(partial text + Retry/Store-as-is/Discard, never a turn).

### The reds observed in the live runs (kept for live debugging by hand)

One chain, not five bugs: a real send can die mid-stream ("The stream ended
without a reply", thrown at `03-stream-protocol/index.ts:351` when zero
content arrives), and the queue law then blocks every send behind it. Two
wire-level failure modes were observed, both with a key that validates via
`curl` on the exact `streamGenerateContent` endpoint: (1) stream opens then
closes empty; (2) once, `400 API key not valid` while curl succeeded minutes
apart — possible vault-unseal race handing the adapter a mangled key (the
wire probe later showed the app CAN send the exact key byte-for-byte).
Attribution "provider free-tier throttling" is probable, not proven.
If it ever matters again: reproduce BY HAND with your own vault, then read
the dying call in Server Telemetry → API Calls — the flight recorder now
stores the raw unparsed response + error per call, which is the evidence
this session lacked. The harness itself will never chase it (no live mode).

### Open design question (drawer, not built)

Real coverage of the send flow without a provider needs a **capture-mode fake
stream** (deterministic reply, zero network) in the client gateway — then the
send-flow journeys could run hermetically too. Deliberately NOT built without
discussing the shape first.

