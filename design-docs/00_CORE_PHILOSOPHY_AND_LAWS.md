# Core Philosophy & Laws — MarkBrain's Living Constitution

> **Status:** Living document. This is the foundation-alignment doc: what MarkBrain
> is, the three pillars David has decided, the laws that don't move without him,
> and an honest record of what is merely a current implementation choice versus
> what is still open.
> **Written:** 2026-10-28 against the Oct 28 codebase. Every load-bearing claim
> here was checked against the code, not inherited from older docs.
> **History:** The prior generation of design docs lives in `design-docs/archive/`,
> including `archive/00_core_philosophy_soul.md` (the soul, rewritten 2026-10-17)
> and `archive/27_UNEARTHED_QUESTIONS_AND_TENSIONS.md` (the honest open questions).
> Motivation ground truth: `design-docs/scratch/motivation.md` and
> `design-docs/scratch/corrections.md`.

Throughout this doc, claims are labeled by their actual status, because the
single biggest failure of the old docs was dressing internals up as doctrine:

- **DECIDED LAW** — David decided it. It does not move without him.
- **CURRENT IMPLEMENTATION CHOICE** — in force today, verified in code, but
  explicitly revisable. It serves the law; it is not the law.
- **OPEN HORIZON** — genuinely undecided. Named honestly, not flattened into
  fake certainty.

---

## §1. What MarkBrain Is (and Isn't) — DECIDED

MarkBrain is David's personal cognitive workbench and brain-overflow collector.
David's brain overflows with ideas; he yaps a lot; the thoughts need somewhere
to land before they evaporate. MarkBrain is the place they land. He pours
thoughts out fast — phone on the street, desktop at home — and the tool
collects them, organizes them, and lets him see the whole forest: start
abstract, drill into depth on any part, and never lose the high-level view.

The shape of the work: **conversation is the furnace.** He talks with the LLM
at length — a single chapter of real usage can run on the order of 100k tokens
of deep ranting — and what matters crystallizes out of that conversation into
durable, revision-controlled Artifacts. Artifacts are his Google Docs: the
documents he keeps, edits, reverts, and trusts. Alongside them, compacted
Chapters survive the conversation itself — each chapter carrying its own title,
description, and summary so the hundred thousand tokens compress into something
usable. Everything else in a chat is the raw material, not the product. He
keeps the corpus organized and keeps the forest view over it.

Why not just existing tools? They exist and they don't fit:

- **Not a linear chat log.** A chat assistant that treats history as a dumb
  append-only stream is a linear chat graveyard. Six months in, the "why" behind
  every decision is buried under a hundred thousand messages of scroll. The
  chat is the furnace — Artifacts and compacted Chapters are what survive it.
- **Not a manual-filing wiki.** Obsidian/Notion-style PKM puts the filing
  burden on the human, by hand, every time. That's the workflow David already
  does manually today — dumping artifacts into a chat, having the LLM classify
  them, then redoing the organization himself in folders and YAML headers —
  and it's exactly the labor MarkBrain exists to remove. "The auto-organizator"
  is part of the point.
- **Not an agentic coding/tool-loop platform.** Not Antigravity, not Devin, not
  Goose. Those are built around tool loops and autonomous execution. See
  Pillar 2 — that rejection is a pillar, not a taste note.

Why this tool instead of those: agentic platforms are expensive overkill
(context fills with crap, API calls multiply), and desktop-agent platforms
have no native mobile story. Mobile capture is the killer moment: idea appears
→ open app → dump the thought → close the phone and keep walking. That flow is
a law of this product, not a nice-to-have (§4).

David's honesty flag, still standing: **"I don't know what I want. I know I
need it. It's for me."** This is an exploratory personal tool. The three
pillars below are decided; almost everything else about the experience is
still being discovered by using it. Docs that read as finished doctrine are
part of the AI-slop problem this repo is recovering from.

---

## §2. The Three Core Pillars — DECIDED, David-decided

Pillars 1 and 2 are David's own words (2026-10-17). Pillar 3 was elevated to
pillar status in the 2026-10-28 foundation restructure he approved, out of the
durability work he and Orion did against the old librechat-era journals. There
are exactly three. No other claim in this repo is a pillar. (The old docs' "Universal Artifact" was
explicitly demoted — it is a simplification we arrived at, covered in §3 as an
implementation choice, not here.)

### Pillar 1 — The User Controls the Context (The Mirror Principle)

The whole design language is **context control and context manipulation**:
giving the user easy, visible control over what the LLM sees. The model does
not decide what goes into context. Auto-features do not decide. The user does.

David's own statement of the visible half of this, his words from 2026-10-17:

> "The chat interface must be almost 1:1 with whatever the tool will send you.
> Same order, same contents."

This is the **Mirror Principle**: you cannot control what you cannot see. When
something is compacted, the *model* receives a synthesized turn describing a
summary of content that no longer exists verbatim — while most chat UIs show
the human "everything," hiding the compaction. That asymmetry is the bug. The
human must see the payload the way the model receives it: same order, same
contents, same summaries, tokens per piece visible, and where the expensive
part lives visible.

**CURRENT IMPLEMENTATION CHOICE (in force, verified):** the **Mirror Panel**
(`src/ui/context/MirrorPanel.tsx`) shows the exact compiled prompt in send
order — system instruction, attachments at their cuts, chapters at their cuts —
with per-piece token counts against the context window, plus tabs for the
literal system instruction and payload, because a 73k-token prompt cannot be
read in a 448px column. Granularity is **manual, per attachment and per
chapter**, in four cuts: **Title (with its subtitle) | Description | Summary |
Full.** The compiler is deterministic and client-side. The token orb rides on
top of the chat as ambient telemetry.

Any future context suggestion (proximity-based "attach this", "push this in",
"compact that") must be **user-tapped, never silent auto-mutation.** The
suggester may be a vector DB or a heuristic — it may never be the LLM deciding
on its own authority, and it may never mutate context without the user's tap.
Presets over the mirror ("focus modes" — one setting choosing the default
resolution each chapter/artifact enters at, with manual overrides on top) are
an **OPEN HORIZON**: David has never seen this done in any app and it must be
experimented with; the shape is not specified.

### Pillar 2 — Reject Agentic Platforms

Hard rejection, sharpened by David on 2026-10-17. Agentic platforms try to be
everything: the agent gets multiple turns until *it* decides to hand back, and
it gets tools — bash/shell access, license to rip. MarkBrain is the opposite:

- **1 user send = 1 LLM API call.** No multi-turn agent loops. No model
  self-steering. No shell/tool access. One turn does everything the LLM needs;
  the turn ends when the reply completes. The exact boundary of "one turn"
  may need pushing later — David said so himself — but if we ever revisit, it
  is to do it *cheaper and faster*, never to become an agentic platform.
- **Cheap and fast is a feature.** This is economics of money *and* time:
  agentic workflows burn both — many calls, slow steps, "sitting an entire
  day and doing nothing." In a non-agentic chat space latency doesn't matter;
  **email-grade latency is fine.** David waited minutes — even ten — in
  LibreChat tests and it was fine, because this is organizing thoughts, not
  transactions. Cheap models, even free rotating OpenRouter models with slow
  replies, are viable *because* of this pillar. "Make it run as cheap as
  possible" is the real point underneath several features.

**Capability Toggles ("Extensions") — DECIDED LAW with in-force defaults.**
The model's special output abilities are expressed as XML emission instructions
in the system prompt (`<artifact_upsert>`, `<topic_shift>`, `<link>`). Each is
a **toggleable capability, per chat or per project**; when a toggle is off, its
instruction block is **stripped from `systemInstruction` entirely**, so the
model stops losing IQ to harness bloat in pure-thinking turns. This exists in
code (`src/domains/06-chat-threads/types.ts`, `buildSystemInstruction`):

- `writeArtifacts` — default **ON**
- `autoChapter` (`<topic_shift>`) — default **OFF** (the model fired chapter
  cuts every 3 messages like a cowboy; chapter cuts are the user's call)
- `graphLinks` (`<link>`) — default **OFF**

The user, not the model and not the harness, decides what the model is
equipped to do.

**Chat is Strictly Pairs — DECIDED LAW.** A conversation is a sequence of
**completed (user, assistant) pairs and nothing else.** An ask never enters
the record until its reply completes. Unpaired asks — errors, stopped streams,
offline sends — live in the **Draft Queue**, which has **exactly three exits**:
**Paired** (the reply completes and the pair commits), **Store as-is** (keep
the text as it stands), or **Discard.** Errors are final: a failed request is
never retried with a silently-downgraded model, and a failed request never
impersonates the model — no fabricated assistant text enters the history, ever.
The send queue walks strictly FIFO per thread and never skips a failed head.
This is the unbreakable contract in both storage modes, client-side in Local
mode and server-owned in Send-and-Forget VPS mode.

### Pillar 3 — Data Sovereignty, Durability & Two-Mode Physics

David has been burned: a server shut down before he could act, and the manual
rebuild was miserable enough that the project died. He does not trust
browser-only storage as the sole holder of his work, and he does not trust a
rented VPS either. What he trusts: plain Markdown files on his own machine,
pushed to Git. The September target stands: **<30-minute Recovery Point
Objective** and near-zero manual steps to redeploy from scratch.

**What is sacred (the tier law):**

- **Tier 1 — Artifacts**, their **persistent 4-layer revision history**, and
  their **chat/turn provenance** (which conversation and which turns birthed or
  updated each version, and why). Safest class; provenance is what lets you
  recover the "why" behind an artifact six months later.
- **Tier 2 — Chat threads & turns.** More ephemeral than artifacts, but backed
  up — provenance links point back into them.
- **Tier 3 — disposable.** Embeddings, TTS audio cache, 7-day API call logs.
  Never backed up, ever.

**The Two-Mode Split — DECIDED LAW** (one deployment, two isolated modes;
the core realization was to stop treating "David" and "random stranger on the
internet" as the same user):

- **Mode 1 — Local Workspace.** The public default: strangers trying the live
  site, casual evaluators, solo desktop users. **$0 forever, zero bytes to the
  server** — `/api/*` refuses all data and LLM routes without a VPS account
  session. 100% of data lives in browser IndexedDB (`markbrain-local`).
  API keys never sit in plaintext on disk: if saved across reloads they're
  encrypted via WebCrypto **PBKDF2 + AES-256-GCM** with a user passphrase
  (verified in `src/data/localKeyVault.ts`), decrypted strictly into tab RAM.
  LLM calls go **direct from the browser to the provider with the user's own
  keys.** Search is fast local lexical/keyword matching — no browser-side
  background embedding daemon.
- **Mode 2 — Connected VPS Workspace.** For the owner (**Account #1**,
  `is_owner = 1`, seeded at install, cannot be disabled or deleted) and
  **invited accounts only — zero public registration.** Enter config and keys
  once on the PC, use everywhere on the phone. Server-side encrypted key vault
  (keys are ciphertext on the cold SQLite disk, derived from the user's
  password, unlocked into server RAM per active session; after a reboot the
  client re-arms by prompting once for the account password). Atomic SQLite
  persistence with WAL — normalized rows, not monolithic project blobs, so the
  phone's background turn and the PC's open tab can't clobber each other.
  **Send-and-Forget background jobs:** hit send, lock the phone, put it in your
  pocket; the VPS finishes the stream, extracts artifacts, titles the thread,
  seals chapter summaries, and commits the pair — the finished pair is waiting
  when you wake the phone. Each device keeps an isolated local IndexedDB mirror
  (`markbrain-vps:<origin>:<email>`) so local scratch data and account data
  never mix.

**VPS Light as a Feather — DECIDED LAW.** The VPS stays near-zero CPU/RAM/
bandwidth. Anything that can run client-side — building archives, plaintext
serialization, local mirroring — **runs in the client**, not on the server.
Operator-side CLI tools (`npm run export-plaintext`, `scripts/plaintext-cli.ts`)
are fine because they're invoked locally by the operator, never exposed as an
external load surface.

**Bijective Plaintext Backups — DECIDED LAW.** Any project exports **in the
browser** (Sidebar export, `createTarGz` in `src/utils/tarGz.ts` +
`src/domains/plaintextTree.ts`) — and via the operator CLI — to a
**`.tar.gz` Plaintext Tree**: `.md` files with YAML frontmatter plus `.json`
for threads/revisions. Human-readable, committable to Git, readable with
`cat`/`grep` twenty years from now. The format is bijective and backed by a
**100%-coverage round-trip CI invariant test** (seed the full DB → export →
import into a fresh DB → assert exact equality). Server backups via a
consistent `.sqlite` snapshot are the operator's disaster-recovery stream,
never committed to Git. And the critical hole David spotted is a required
design fix: **offline replicas must be openable and exportable from the
AuthGate even logged out, with the VPS dead** — a device holding an intact
`markbrain-vps:<origin>:<email>` mirror must not hold it hostage behind a login
the server can no longer answer. (The shared-device security question —
whether Sign Out should offer keep/wipe/encrypt the local replica — is
**OPEN HORIZON**; the capability is decided, the gating mechanism is not.)

---

## §3. Current Architectural Choices — in force, explicitly revisable

These are load-bearing choices that exist in the Oct 28 codebase and are
serving the pillars well. They are **choices**, not commandments; each might be
the wrong one, and saying so is not weakness, it's the record being honest.

**The 4-Layer Cut Symmetry across Chapters and Artifacts.** Chapters
(`ChapterPartition`, `src/domains/02-chapter-segmentation`) and Notes
(`UniversalArtifactDocument`, `src/domains/01-artifact-document`) are **distinct
objects in distinct tables** — this is a deliberate reversal of the old docs'
"Universal Artifact" one-schema claim. What they genuinely share is the
**4-layer cut contract** — Title (with subtitle) | Description | Summary | Full
— and the same granularity language for how each enters the compiled prompt.
The symmetry earns its keep: David's real chapters can run ~100k tokens, larger
than many artifacts, so a chapter having both a ~200-token Description and a
~1,200-token Summary is justified, and one cut vocabulary serves both. The
layers are cumulative, pre-computed so context assembly is cheap; when a body
is edited, the coarser layers must be marked stale so the compiler stops
serving them (a standing requirement for the upcoming Artifact Editing spec,
with revisions snapshotting all layers).

**Relational Envelope + `doc_json`.** On the VPS, system/auth tables stay
strict relational SQL. Domain entity tables keep only the envelope columns
SQLite actually indexes and queries (`user_id`, `project_id`, `entity_id`,
`thread_id`/`seq`, `revision`, `updated_at`) plus `doc_json TEXT` carrying the
full TypeScript domain object. Domain fields are not duplicated as SQL columns;
new domain fields land in `doc_json` with TypeScript defaults, so the vast
majority of feature work needs **zero SQL migrations**.

**Declarative Boot Annealing (`TABLES_SPEC`).** Instead of brittle numbered
migration files, the desired schema is declared in code
(`server/db/schemaSpec.ts`) and converged idempotently on every server boot —
`initDb()` inspects `sqlite_master` + `PRAGMA table_info` and anneals
production to match intent. Schema change = edit the spec, restart, done.

For the graph: edges exist in code (`parent_of`, `child_of`, `relates_to`,
`refines`, `born_from`) and the current graph is, honestly, an unused toy —
nothing consumes edges except drawing lines on SpatialGraph. The aligned
semantic direction (altitude + time-state coordinates, edges with real
consumers, bidirectional user-tapped context suggestions, the chat-driven
plan → agree → execute → rollback organizator) is captured in
`archive/27_UNEARTHED_QUESTIONS_AND_TENSIONS.md` §6 and is **OPEN HORIZON** —
direction agreed, nothing built to spec.

---

## §4. Standing UI & Engineering Laws

These are laws David has beaten into the codebase through repeated correction.
They bind all future work, human or AI.

**Mobile-first, 350×700 minimum.** The UI is written for a 350×700px phone
viewport as its floor. Desktop is a courtesy, not the target. There is no
separate mobile app — the React webapp **is** the mobile experience. David has
told several AIs to write for Mobile UX directly and doesn't care if the UI
looks a bit empty on desktop.

**Zero top bars, zero sticky headers.** A top bar eats the exact vertical
pixels a phone needs. Floating controls ride an **in-flow scroll-clearance
spacer** instead (`scroll-top-clearance` in the chat feed, `h-2` — scrolls
away with the content, never sticky): the fixed sidebar brain toggle
(top-left) and the floating token orb (top-right) overlay that space without
stealing layout. The title itself lives **in flow** at the top of the feed —
editable, scrolls away — and pins as a slim centered pill (~60% max width, so
it never reads as a toolbar) only once you scroll past it; on short viewports
(phone landscape) the pinned row hides entirely. Battle scar: David asked AI
Studio repeatedly to remove the top bar and sticky stuff; a few messages
later it grew one back, 15–20px tall, and mobile became unusable.

**The sacred capture flow: open → type → send → close phone.** The entire app
exists to make this path frictionless. Composer text **auto-saves locally**
(`localDraft` in the chat view) so a pocket-bump or tab close never eats a
thought. Offline sends **queue as drafts** behind an airplane indicator rather
than failing; they flow into the Draft Queue and its three exits when
connectivity returns.

**The "So What?" copy test.** No theater. No invented jargon, no quota guesses,
no features that exist to sound impressive. If the answer to "so what does this
do for David?" is nothing concrete, it doesn't ship. Related standing rules:
sell sparse ideas as sparse ideas; narrative over inventory; don't format
scattered intuitions as a coherent buildable feature set; don't cite refactor
plans as shipped features; scroll is navigation, **compaction is a chapter
displaying its summary instead of its turns** — never blur those two.

**Comment policy (summary).** Every line of comment must be earned: no
tombstone comments, no architecture lectures in code, and the comment ratio
stays **≤15%**. The full policy lives in `archive/13_COMMENT_POLICY.md`; this
is the standing reminder, not the replacement.

**Instrumentation law.** Every line of console output has to be earned:
**≤16 events per human gesture** is the hard cap (one `action` per gesture is
the guideline); **never log hot loops** — no per-chunk, per-iteration, or
per-tick logging; every silent fallback is **≥ WARN**; user-visible failure is
ERROR through `logger`. If honoring the cap is hard, don't add the logging —
silence beats flood.

**Never stress external APIs from tests or UI open/close cycles.** No test
fires real provider calls, and no UI open/close cycle should either. Embedding
and other quota-stingy calls are debounced and cached; running out of
embedding quota merely by typing queries is ridiculous, and the agreed fix
direction — browser-side WASM embeddings with infinite local CPU quota, lazy-
loaded and cached in its own storage bucket — is a decided direction whose
implementation is still **OPEN HORIZON**.

---

## §5. The Camera Lens Analogy — illustrative only

*This section is labeled per the anti-slop rules: it is the **one** labeled
analogy allowed in this doc. It is not the architecture, not the design
language, and not a source of terminology for new docs. The actual design
language is Pillar 1: context control.*

One way to picture the granularity system: LLM context works like a lens with
adjustable depth of field. The **focal plane** is what you're actively working
on — sharp, verbatim. Neighboring ideas soften with distance: rich summaries,
then one-liners, then just labels, then out of frame entirely. And the
**forest view** is deliberately pulling focus out of the weeds so only the
high-level canopy shapes remain — the model thinks about the canopy instead of
the leaves.

That's it. The 4-layer cuts and the mirror do the work; the camera is just a
way to remember how they fit together. The photography metaphor is David's —
used once, here, on purpose, and never to be mistaken for doctrine again.
