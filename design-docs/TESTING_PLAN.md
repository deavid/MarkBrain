# MarkBrain Testing Plan (2026-10-28)

A plan for YOUR hands, organized by the big features. For each: what it is,
what the machines already prove (don't redo that), what only hands can find,
and how risky it is. The machines gate code; you gate *feel and truth*.

**Rule of thumb:** if the thing you doubt can be checked by a screenshot and a
click, it should have a journey — tell me and it gets one. If the doubt is
"does this match how I actually think", only you can answer it.

---

## 0. The three you always do (2 minutes, every session)

1. `?slowsave=1` → type + send → within ~15s the red critical banner appears.
2. Sidebar → Send on Enter → bare Enter obeys the switch on desktop AND phone.
3. Mirror (tap the orb) → Raw payload → attached notes show `file="….md"`,
   not `art-…` ids.

These three have caught real regressions before. They stay ritual.

---

## The big features

### 1. Chat core — the pair law
*What it is:* you send, it streams, pairs are immutable, failures and stops
live as drafts in a FIFO queue with Retry / Store as-is / Discard.

**Already proven (skip):** journeys 02 (stream+telemetry), 03 (stop mid-stream
→ draft, never a turn), 13 (fail → draft → Retry pairs it), 20 (Enter keys),
plus the queue/pair unit suites. All hermetic.

**Find by hand (medium risk):**
- A real conversation with a real model: does the reply *pace* right — not
  instant, not sluggish? Does the telemetry line (tokens, first chunk) feel
  truthful?
- Interrupt two sends in a row: queue them, fail one, Retry it, Discard the
  other. Watch that nothing committed turns back into a draft or vice versa.
- Regenerate on a committed pair: old pair stays, new pair appears.

### 2. Context compilation & the Mirror (the truth-teller)
*What it is:* everything the LLM sees is compiled — notes at their cut
(Title/Description/Summary/Full), chapters at their cut, under a token ceiling.
The Mirror shows exactly that payload. "I must see exactly what the LLM
receives" is your law.

**Already proven:** journey 07 (mirror sections), 16 (cuts render what the
payload carries), 22 (capability toggles change the system message; OFF means
the block is GONE — system message dropped 611→279 tokens with notes off).
Plus the mirror-capabilities bug I caught and fixed this week (the preview now
compiles with the same capabilities the send uses).

**Find by hand (HIGH value):** open Mirror on a REAL unhaunter project with
real attachments. Your question is not "does it render" — it's "does this
payload match my mental model of what I attached?" Cuts, order, ceiling
behavior when you stage too much.

### 3. Artifacts — your Google Docs
*What it is:* the AI upserts notes freely during chat; you can edit them;
every change is a revision you can diff and revert; provenance says which
chat birthed each version; summary layers never lie after a manual edit
(stale-layer guard).

**Already proven:** journey 21 (edit → History "Manual edit" → Revert → note
comes back; `.md` download; the stale-layer banner appears right after a body
edit), 27 (a stream sentinel becomes a real note with 4 layers + AI revision +
"msg 5" provenance), unit suites for the 3 upsert bugs and revision
persistence across reload.

**Find by hand (HIGH value — this is the core promise):**
- Take one real note through a real session: AI writes it, you retitle it,
  AI updates it, you revert one step. Does History read like a story you
  trust? Is the diff useful?
- Edit the body by hand → confirm the "Summary layers out of date" banner →
  Refresh layers → does the summary now match what YOU wrote?
- Provenance "Open chat" on an old revision — does it take you to the right
  place in the right thread?
- Library lenses: Folders / Graph / Proximity on a project with 20+ notes —
  which one do you actually reach for?

### 4. Chapters — the structure of long chats
*What it is:* chats get cut into chapters (split, summarize, granularity
cuts), and you control the cuts: merge, move the seam, re-summarize with a
steering note. The last two chapters are "in progress" and always Full.

**Already proven:** journeys 04 (split lands where you clicked), 05 (summarize
→ description+summary), 16 (in-progress law + cut tables), 23 (merge shrinks
the list, keeps the turns).

**Find by hand (HIGH value):** your real shape — "we rant for hours, then it
compacts into an artifact". Take one long real chat and drive the chapter
controls yourself. Does merge/seam/steering feel like editing a document? The
AI topic-change trigger is OFF by default now — try turning "Cut chapters" ON
in the composer popover for one chat and see if it's still trigger-happy.

### 5. Capability toggles — what the chat is allowed to do
*What it is:* composer popover: Write notes (ON), Cut chapters (OFF), Link
notes (OFF). OFF removes the XML teaching from the system prompt entirely —
that's the "small models get dumber with harness bloat" fix.

**Already proven:** journey 22 end to end (toggles ↔ system message content).

**Find by hand (low risk, high curiosity):** one real chat with Write notes
OFF. Does the model stop trying to emit note blocks? Does it feel lighter?
Then ON again and ask it to save something.

### 6. Staging & attachments
*What it is:* stage notes from the folder rows → they ride the next send →
they weld onto the turn that sent them (no detach buttons — that's the law).

**Already proven:** journeys 14 (stage → tray → unstage), 15 (weld: tray
empties, card anchors to the turn, no detach).

**Find by hand (medium):** stage 3 notes at different cuts (one Title-only,
one Full) and check the Mirror before sending. Does the cost (tokens) match
your expectation?

### 7. Workspace modes, the vault, model settings
*What it is:* Local Workspace (this browser, BYOK) vs Connected (server,
server vault). Your keys sit in a WebCrypto vault with a passphrase; the
composer padlock covers locked-vault and no-key states.

**Already proven:** sendReadiness units (padlock states), capture mode needs
no key.

**Find by hand (medium — fresh-profile scenarios):**
- Fresh browser profile → gate → Local Workspace → create vault → set key →
  send works → reload → padlock shows → unlock → send works.
- Delete the key → send button becomes the padlock → click routes to
  Model Settings → Keys. That's the "never attempt a doomed send" law.
- Your three hand-checks from the old days still apply here.

### 8. Durability & sovereignty — the "losing data" fear
*What it is:* two streams: (a) operator snapshots (off-box .sqlite, Ansible
restore) and (b) YOUR stream — plaintext `.tar.gz` (project.json, threads,
notes as .md with frontmatter, history.json, edges.json), export/import in
the sidebar, and an operator CLI on the server.

**Already proven:** the bijection test (seed everything → export → import →
exact equality, with a rot detector that fails when a new field is missed),
journey 25 (real .tar.gz downloads and is readable; the SAME file imports
into a fresh workspace and survives reload), CLI subprocess round-trip,
export/import error cases.

**Find by hand (HIGH value — this is the Google-Drive-shaped promise):**
- Export a real project → **open the .tar.gz and read the files**. Are they
  the kind of files you'd be happy to be handed in 10 years? That's the
  whole point — the SQL-dump scar.
- Import it into a different browser profile. Compare note-for-note.
- Then: `npm run export-plaintext -- --user you@example.com --out /tmp/x`
  on the server, and diff against the client export. Same content, two doors.

### 9. Offline: replicas, airplane mode, drafts
*What it is:* three separate promises — (a) AuthGate "Open offline" reads a
signed-out, server-down device copy (no login call, ever), sign-out keeps or
erases the copy; (b) PWA airplane mode: offline sends queue and flush on
reconnect; (c) composer drafts survive a crash.

**Already proven:** journey 26 (replica offered → boots offline with ZERO
auth calls → Sign out keeps it), wipeReplicaStorage units, offline-outbox
units.

**Find by hand (HIGH value — on your phone, for real):**
- Turn on airplane mode mid-chat. The amber airplane appears. Type + send →
  it holds. Reconnect → it flushes. (This is your listed item.)
- Kill the tab mid-sentence → reopen → the draft is still there. (Your listed
  item.)
- The full replica story needs a real VPS to be meaningful: sign in, use it,
  stop the server, sign out → gate offers Open offline → your data is there.
  This is the "VPS down and I still need my notes" fear — only a real outage
  (or `systemctl stop`) proves it.

### 10. Flight recorder — "what exactly did we send"
*What it is:* every API call (7 days) with the scrubbed request, the RAW
unparsed response before the demuxer touches it, and stopwatch timings.

**Already proven:** journey 24 (list, detail, raw sentinels intact, no secrets).

**Find by hand (low risk):** after any real chat, open Server Telemetry →
API Calls → pick the call → does the shown request match what you believe
went out? When a provider misbehaves (it will again), this tab is where the
truth is.

### 11. Sync across devices (Connected mode)
*What it is:* outbox + entity-level replay + sync-now + delta polling.

**Already proven:** vps-user-journeys units, sync-now spinner journey.

**Find by hand (medium):** two devices, same account. Make changes on both
while one is offline; reconnect; press Sync now. Check for lost updates or
ghost revivals. Nothing automated replaces two real devices.

### 12. The small things (quick pass, low risk)
- Text size on YOUR phone (your listed item) — Default/Large/Larger/Largest.
- Read-aloud volume slider.
- Mobile at 350px: drawer, touch targets (geometry audit covers the
  invariants; your thumb covers the feel).
- Sidebar search / thread switcher (Cmd+K).

---

## Not testable yet (don't look for these)

Graph semantics + Forest map + Auto-Organizator, bidirectional push-in/out
suggestions, WASM browser embeddings, File System Access folder mirror,
peer-collaborator persona. They're the Horizon pack — designing, not testing.

---

## Suggested passes (each is one sitting)

1. **The ritual + the listed items** (§0, §9 drafts/airplane, §12 text size) —
   20 minutes.
2. **The artifact promise** (§3 on a real note, §8 export-and-read) — one hour,
   the most important sitting.
3. **The long chat** (§4 chapters + §2 mirror on a real rant) — one hour.
4. **Fresh-profile fresh-install** (§7 vault + §9 replica) — 30 minutes.
5. **Two devices** (§11) — whenever convenient.

## When something breaks

Tell me: which mode (Local / Connected / Offline), what you clicked, what you
expected, screenshot. If a send misbehaves, open Server Telemetry → API Calls
and name the call — the raw response lives there. That turns a "it felt wrong"
into a fix in one sitting.
