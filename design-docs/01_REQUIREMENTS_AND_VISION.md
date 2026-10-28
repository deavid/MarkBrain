# 01 — REQUIREMENTS & VISION (`01_REQUIREMENTS_AND_VISION.md`)

> Written 2026-10-28 as part of the foundation-alignment restructure. It replaces
> the old `01_requirements_and_meta.md` (now in `archive/`) as the front door of
> the design docs. Ground truth for motivation lives in
> `scratch/motivation.md`; the rules this file obeys live in
> `scratch/corrections.md` — motivation first, no invented doctrine, verify
> against code, and say honestly when something is not built yet.

---

## 1. What MarkBrain Is

MarkBrain is a **brain collector**: a place to pour ideas out fast, before they
evaporate, and to keep thinking in them afterward. Conversation is the furnace;
what survives are artifacts and chapters, organized so you can go abstract or
drill into depth without ever losing the high-level picture.

It is **not** a traditional chat assistant (which treats history as a dumb
linear log), **not** a PKM/wiki like Obsidian or Notion (manual filing, no
conversational co-creation), and **not** an agentic platform (no tool loops, no
multi-turn autonomy — see Problem 4).

The honest position, stated up front because it governs everything downstream:
**"I don't know what I want; I know I need it."** This is a personal tool in an
exploratory stage. Everything below describes intent and current direction, not
finished doctrine. Docs written with finished-doctrine confidence were part of
the problem this restructure exists to fix.

Two working principles hold the design up (they are David's stated positions,
not AI-invented pillars):

- **The user controls the context.** The whole design language is context
  control and manipulation — tools and information to decide what the LLM sees,
  with the human holding the knobs. The Mirror ("show me what the LLM will
  see") is this principle made visible.
- **One turn does everything.** 1 Enter = 1 API call. No hidden agent loops, no
  tools running loose. If this definition ever gets refined, it gets refined
  deliberately — never drifted.

---

## 2. Who It's For

Honest answer first: **it's for David.** A personal tool built because he
needed it. If it turns out other people think like this, bonus.

The shape of that person:

- **A high-volume conversational thinker.** He yaps. LLMs are his sparring
  partner over conversations that scale into hundreds of thousands of tokens,
  with many thoughts packed into a single message.
- **A deep systems thinker.** Projects that are *deep* (hundreds of technical
  details) and *wide* (dozens of interconnected branches) — the profile of a
  software architect, worldbuilder, researcher, designer.
- **A mobile-first ideator.** The killer moment is capture on the go: an idea
  hits while walking → open the app → dump the thought → send → **close the
  phone immediately** → read the reply ten minutes later. Email-grade latency
  is fine; losing the thought is not.

These three traits are why the six problems in §3 exist, and why their
solutions look the way they do.

---

## 3. The Six Root Problems We Solve

Each problem is stated as the failure first — a concrete story of what goes
wrong — then how MarkBrain answers it today. Where the answer is only partial,
that is said.

### Problem 1 — Mobile capture dies on the way

**The Failure.** The idea hits while you're away from the desk. Desktop-first
agent platforms are windows into a computer; running them from a phone doesn't
work. Bridging through external chat was tried (a sidecar to Matrix/Google Chat
at work) — it works, but costs ~3 API calls per message. And even when capture
technically works, the browser tab is fragile: close the phone mid-typing, kill
the app, lose the network — and the thought you were pouring out is gone. For a
brain collector, that is the one unforgivable failure.

**How MarkBrain answers it today.** The app is a mobile-first PWA — one webapp,
usable from the desktop too even if it looks sparse there; no top bars, no
sticky headers, ever (they waste vertical space and tools keep re-adding them).
Capture is built to survive everything around it:

- **Send-and-Forget VPS jobs.** The HTTP request that sends a message is not
  the job: the server enqueues it, streams from the provider decoupled from any
  socket, and commits the result to SQLite on success. Closing the phone never
  aborts a job; the reply waits for you (`server/jobs/chatJobRunner.ts`).
- **Composer draft persistence.** Text typed but not sent survives page kills
  per thread, debounced to storage and flushed on page hide — mobile browsers
  kill pages without `beforeunload`, and this accounts for it
  (`src/application/composerDrafts.ts`).
- **Offline draft queuing.** A send never enters chat storage at send time; it
  becomes a queue item that stays in the draft area until it finishes
  successfully. Offline, the queue holds; when connectivity returns, the walk
  resumes strict FIFO per thread (`src/application/sendQueue.ts`,
  `src/application/connectivity.ts`).

### Problem 2 — Context blindness (the depth-vs-breadth trap)

**The Failure.** After 50 turns in the weeds of one feature, the LLM is stuck
down there. Ask for high-level ideas and it hallucinates or loops around
whatever was discussed last, because the context is flooded with low-level
noise. The reverse fails too: zoom out to a forest view and the depth is gone.
Traditional tools force a single resolution; the thinking needs both at once.

**How MarkBrain answers it today.** Every artifact and every chapter carries a
**4-layer granularity cut** — Title ⊂ Description ⊂ Summary ⊂ Full, cumulative,
so each level includes the shorter ones plus its own layer
(`src/domains/granularity.ts`). Attachments and chapters enter the compiled
payload at whatever cut the user chooses, which is what makes "near = detailed,
far = label" an ordinary operation rather than a hack. The **Mirror** makes the
whole thing visible: the chat interface shows what the model will see, in send
order — attachments at their cuts, chapters at their cuts, tokens per item, and
the literal system instruction and compiled payload as separate tabs
(`src/ui/context/MirrorPanel.tsx`). You can't control what you can't see.

On the horizon: **bidirectional context suggestions** — the proximity engine
suggesting not only unattached notes to attach, but already-attached notes to
push in (expand) or push out (compact) as the conversation drifts toward or
away from them. See `design-docs/06_HORIZON_GRAPH_AND_AUTO_ORGANIZATOR.md`.

### Problem 3 — The linear chat graveyard

**The Failure.** Good ideas, decisions, and trade-off debates get buried
mid-log in a thousand-turn chat. Copy-pasting the survivors into documents
breaks the flow and loses the *why* — the decision detaches from the
discussion that produced it. Six months later the artifact exists but the
reasoning behind it has evaporated.

**How MarkBrain answers it today.** Everything of value crystallizes into an
artifact, without ceremony: the model emits `<artifact_upsert>` in its single
turn, the stream protocol demuxes it, and the artifact is upserted — no
confirmation popups, no flow break (`src/domains/03-stream-protocol/index.ts`).
Safety comes not from gates but from history:

- **Manual editing** is wired in the artifact view (title, subtitle, body —
  `src/ui/artifacts/ArtifactDetailModal.tsx`).
- **Persistent 4-layer revision history**: every revision snapshots the title
  and all four layers together — never a body-only diff — so a revert restores
  the whole document as one piece
  (`src/domains/01-artifact-versioning/types.ts`; persisted in the
  `artifact_revisions` table, `server/db/schemaSpec.ts`).
- **Diff and revert in the UI**: per-revision body diffs, one-click revert that
  records the discarded state first (`ArtifactDetailModal.tsx`).
- **Chat/turn provenance**: AI-made revisions carry the thread and turn they
  came from, so History links back to the conversation that birthed the change
  — the *why* stays attached to the *what*.

### Problem 4 — Agent swarms burn money and time

**The Failure.** Agentic platforms run many calls per action. Two costs
compound: **money** (context fills with tool-output crap; every step is
another billed call) and **time** (cheap models are slow or flaky, and inside
an agentic loop "you could be sitting an entire day and doing nothing"). The
sidecar experiment made it concrete: ~3 calls per message just to bridge chat.
Personal ideation doesn't need a swarm — it needs one good turn.

**How MarkBrain answers it today.**

- **1-turn discipline.** One user input = exactly one LLM roundtrip, by
  architecture, not by restraint. Nothing hides behind the send button.
- **Capability toggles.** Features like auto-chaptering (`<topic_shift>`),
  artifact writing (`<artifact_upsert>`), and graph links can be switched off
  per chat — and when off, their instruction blocks are stripped from the
  system instruction entirely, so the model stops losing IQ to harness bloat
  (`buildSystemInstruction` in `src/domains/03-optical-compiler/index.ts`).
- **Multi-provider key slots.** Four optional BYOK slots — Gemini Free, Gemini
  Paid, OpenRouter Free, OpenRouter Paid — device-local, never exported, never
  logged (`src/data/keySlots.ts`, providers in `src/gateway/providers/`).
- **Account-wide Free/Paid tier switch.** A single `chatTier` preference
  flips which lane every chat call rides — "put money on it" is one setting,
  not a per-model hunt (`src/data/localKeyVault.ts`, `src/data/keySlots.ts`).

### Problem 5 — The static taxonomy trap

**The Failure.** Early-stage ideas cross boundaries and defy folders — or
twenty coarse buckets. Forced categorization fails immediately, and a taxonomy
locked in at project birth is wrong by the time the project matures. Worse,
the existing graph edges were never designed with a real consumer in mind:
nothing in the app actually *uses* them, so they're an unused toy.

**How MarkBrain answers it today.** Structure stays loose: **folders** exist
for the organization that *is* stable (`ThreadFolder`,
`src/domains/06-chat-threads/types.ts`), and **open graph edges** let any
relationship kind ride between nodes — the known kinds are a starting set, and
nothing coerces an edge to a default (`src/domains/02-topological-graph/types.ts`).

On the horizon — and this is where the real answer lives — the **Two-Axis
Semantic Model** replaces the dead `isHighConcept` flag with two real
coordinates on every artifact: **Altitude** (canopy → system → leaf →
evidence) and **Time-State** (current → wish → superseded, so old versions are
kept for their *why* but can never masquerade as current spec to the LLM).
Plus the **Chat-Driven Auto-Organizator**: discuss the corpus in chat, agree
on a plan, review the batch organization as a diff card, apply in one click,
roll back as one revision step — plan → agree → execute → rollback, never
full-auto. Designed in `design-docs/06_HORIZON_GRAPH_AND_AUTO_ORGANIZATOR.md`.

### Problem 6 — Server death & lock-in trauma

**The Failure.** David has been burned before: a server got shut down before he
could act, and the manual misery of reinstalling, reconfiguring, and restoring
state was bad enough that he never recovered the project. The September target
was a **<30-minute Recovery Point Objective** with near-zero manual steps. He
does not trust browser-only storage, and does not trust a random rented VPS as
the sole holder of his work.

**How MarkBrain answers it today.**

- **Firebase/Google Cloud: abolished.** The backend is a flat-rate VPS running
  Node/Express with **SQLite** at runtime — one directory, one database file,
  one systemd unit, Caddy in front. No trace of Firebase remains in the
  codebase.
- **Fast restore.** Ansible deploys the whole stack from scratch
  (`deploy/ansible/playbook.yml`); the runbook's backup line is a single
  SQLite `.backup` command, and restoring a dead VPS is pulling the snapshot
  and re-running the playbook (`deploy/RUNBOOK.md`).
- **Bijective Plaintext Tree export/import.** Any project exports to a
  human-readable folder tree — Markdown + YAML frontmatter for artifacts,
  JSON for threads/chapters/revisions/edges — packaged as a **`.tar.gz` built
  in the browser** (zero-dependency POSIX ustar + native CompressionStream;
  the VPS stays light, `src/utils/tarGz.ts`). The tree is bijective with the
  snapshot: export → import → exact equality, enforced by a 100%-coverage
  round-trip CI test (`src/domains/plaintextTree.ts`,
  `src/tests/plaintext-roundtrip.test.ts`). It reads with `cat` and `grep`
  twenty years from now, and diffs cleanly in Git.
- **Offline replica access on every device.** Each browser device holds a
  local mirror of the workspace, and `AuthGate` detects known replicas on the
  device and offers **Open Offline** — no login call, no living server
  required (`src/ui/workspace/AuthGate.tsx`).

**An explicit tombstone, so no future doc resurrects it:** the **Google Drive
import is permanently dead** (archive/19 D1, archive/21A). It was wanted but
broken — imported artifacts arrived as raw Google Docs, not YAML — and David
has since moved everything into a git folder of plain Markdown. The replacement
is the local **Markdown/YAML multi-file import** (`ImportModal.tsx` accepts
`.md`/`.txt` files into a multi-file session queue,
`src/ui/artifacts/import/`) plus the plaintext `.tar.gz` trees above. **Do not
list Drive as future work anywhere. It is not coming back.**

---

## 4. Core Requirements Checklist

Grouped by subsystem. These are the requirements the product is held to; where
an item is future work it says so and points at §5.

### Context & Compiler

- The compiled context is fully **visible to the user** — the Mirror shows
      attachments, chapters, system instruction, and payload, in send order,
      with tokens per item (`src/ui/context/MirrorPanel.tsx`).
- **4-layer granularity** (Title ⊂ Description ⊂ Summary ⊂ Full) applies
      to both attachments and chapters, cumulative, one shared ordering and
      palette (`src/domains/granularity.ts`).
- Only explicitly attached artifacts enter the payload — no silent
      proximity or graph heuristics inserting content behind the user's back.
- Capability blocks absent from the system instruction when their
      capability is off (`03-optical-compiler/index.ts`).
- *(Horizon)* Bidirectional context suggestions — attach / expand /
      compact, always user-tapped, never silent auto-mutation → doc 06.

### Artifacts & Revisions

- `<artifact_upsert>` flows without confirmation popups; manual editing is
      wired alongside it (`ArtifactDetailModal.tsx`).
- Every revision snapshots **title + all four layers** as one document
      (`01-artifact-versioning/types.ts`).
- Revisions persist in the `artifact_revisions` table
      (`server/db/schemaSpec.ts`) — not RAM-only.
- Per-revision diff view and one-click revert (revert records the
      discarded state first).
- Chat/turn provenance on AI revisions, linking History back to the
      conversation.
- Known follow-ups before the Editing spec ships: stale-layer flags when
      `body` is edited manually; the revision-recording bugs from archive/27 §2
      (send-queue upsert path, `commitJobPairTransaction`, versioning
      persistence) must be closed.

### Chapters & Capabilities

- Chapters are first-class context units with the same 4-layer cuts as
      artifacts — a deep chapter can outrun an artifact in size, and deserves
      the same resolution ladder.
- Capability toggles per chat: auto-chapter, write-artifacts, graph-links
      — each strips its instruction block from the system instruction when off
      (`ChatCapabilities`, `DEFAULT_CHAT_CAPABILITIES`).
- Chapter cut control stays with the user (KISS toolkit: move seam /
      split / merge on the last 1–2 chapters, plus isolated recalibration
      calls that don't pollute the timeline).

### Chat Pairs & Queue

- A conversation is a sequence of **complete pairs**: an ask never enters
      chat storage at send time; only a successful attempt commits both turns
      atomically, with buffered artifacts and topic shifts
      (`src/application/sendQueue.ts`).
- Failure / Stop / partial text leave **no turns behind** — the draft
      keeps them with reason + partial, for retry / store-as-is / discard.
- Strict FIFO walk per thread; a failed head is never skipped.
- Send-and-Forget on the VPS: closing the socket never aborts the job;
      only explicit stop does, preserving the partial
      (`server/jobs/chatJobRunner.ts`).
- Unsent composer text survives page kills per thread
      (`src/application/composerDrafts.ts`), mode-scoped so Local drafts never
      leak into VPS workspaces.

### Two-Mode Storage & Backups

- Two modes, one codebase: **Local Workspace** (browser-only) and **VPS**
      mode, isolated — drafts, keys, and storage are mode-scoped.
- Runtime storage is **SQLite**; system/auth tables stay strict
      relational; domain entities keep a relational envelope + `doc_json`
      payload, with declarative schema annealing on boot (no numbered
      migration files) (`server/db/schemaSpec.ts`).
- Keys are BYOK, device-local, never exported, never logged
      (`src/data/keySlots.ts` — the only module that reads/writes them).
- Plaintext Tree export/import is **bijective** and CI-proven
      (`src/tests/plaintext-roundtrip.test.ts`); archives are `.tar.gz` built
      client-side.
- Ansible playbook restores a dead VPS from a snapshot
      (`deploy/ansible/playbook.yml`); the runbook documents the backup
      command (`deploy/RUNBOOK.md`). RPO target: < 30 minutes.
- Offline replica: `AuthGate` offers Open Offline for known local
      replicas, no server required.
- Google Drive import: **killed permanently** — local Markdown/YAML
      multi-file import instead (`src/ui/artifacts/ImportModal.tsx`). Never
      re-propose Drive.

### Mobile UX & Accessibility

- Mobile-first, period. Full usability on a phone screen; desktop may look
      sparse. **No top bars, no sticky headers** unless David explicitly
      approves them.
- **Sidebar Text Size setting: Default | Large | Larger | Largest**
      (100/115/130/150% UI font scale — `UI_FONT_SCALE_CHOICES` in
      `src/ui/workspace/Sidebar.tsx`). It scales small text hardest — the
      smallest sizes benefit most — and **never touches layout spacing**, so
      it reads as bigger text, not a broken layout. It exists because the
      viewport font-size must stay user-scalable, making this the only honest
      way to read at arm's length.
- Capture flow: open → dump thought → send → close phone → reply waits
      for you. Works even if the model hasn't answered before you leave.
- Latency tolerance is a feature, not a concession: this is thinking work,
      not transactional. "It's more like Email."

---

## 5. What Is Built vs What Is On the Horizon

A short pointer table, so nobody has to guess which claims are backed by code.
Built items name the code that proves it; horizon items name the design doc
that owns the idea.

| Thing | Status | Where |
|---|---|---|
| PWA shell (manifest + service worker) | Built | `index.html`, `public/sw.js`, `public/manifest.webmanifest` |
| Composer draft persistence | Built | `src/application/composerDrafts.ts` |
| Offline-aware send queue (pair discipline) | Built | `src/application/sendQueue.ts`, `src/application/connectivity.ts` |
| Send-and-Forget VPS jobs | Built | `server/jobs/chatJobRunner.ts` |
| 4-layer granularity cuts | Built | `src/domains/granularity.ts` |
| The Mirror (payload visibility) | Built | `src/ui/context/MirrorPanel.tsx`, `SaturationOrb.tsx` |
| `<artifact_upsert>` stream protocol | Built | `src/domains/03-stream-protocol/index.ts` |
| Manual artifact editing | Built | `src/ui/artifacts/ArtifactDetailModal.tsx` |
| Revision history + diff/revert + provenance | Built | `src/domains/01-artifact-versioning/`, `artifact_revisions` in `server/db/schemaSpec.ts` |
| Capability toggles | Built | `src/domains/03-optical-compiler/index.ts`, `src/domains/06-chat-threads/` |
| Key slots + Free/Paid tier switch | Built | `src/data/keySlots.ts`, `src/data/localKeyVault.ts` |
| Folders + open graph edges | Built | `src/domains/06-chat-threads/types.ts`, `src/domains/02-topological-graph/` |
| SQLite two-mode storage + annealing | Built | `server/db/schemaSpec.ts`, `server/db/projectRepo.ts` |
| Ansible deploy + fast restore | Built | `deploy/ansible/playbook.yml`, `deploy/RUNBOOK.md` |
| Bijective Plaintext Tree (`.tar.gz`) export/import | Built | `src/domains/plaintextTree.ts`, `src/utils/tarGz.ts`, `src/tests/plaintext-roundtrip.test.ts` |
| Local Markdown/YAML multi-file import | Built | `src/ui/artifacts/ImportModal.tsx`, `src/ui/artifacts/import/` |
| Offline replica access from AuthGate | Built | `src/ui/workspace/AuthGate.tsx` |
| Sidebar Text Size (Default/Large/Larger/Largest) | Built | `src/ui/workspace/Sidebar.tsx` |
| Two-Axis Semantic Model (Altitude × Time-State) | Horizon | `design-docs/06_HORIZON_GRAPH_AND_AUTO_ORGANIZATOR.md` |
| Bidirectional context suggestions (add/expand/compact) | Horizon | `design-docs/06_HORIZON_GRAPH_AND_AUTO_ORGANIZATOR.md` |
| Chat-Driven Auto-Organizator (plan → agree → execute → rollback) | Horizon | `design-docs/06_HORIZON_GRAPH_AND_AUTO_ORGANIZATOR.md` |
| Client-first replica deepening + local folder mirror | Horizon | `design-docs/07_HORIZON_CLIENT_REPLICA_AND_WASM.md` |
| WASM local embeddings (offline semantic search) | Horizon | `design-docs/07_HORIZON_CLIENT_REPLICA_AND_WASM.md` |

One caution to carry forward, learned the hard way: **file existence is not
behavior.** The entries above were checked against what the code actually
does, but vibecoded features have been "empty husk shells" before. When this
doc and the code disagree, trust the code and fix the doc.
