# 27 — Unearthed Questions, Tensions & Original Requirements (2026-10-26)

> **What this file is:** The honest capture of the questions, problems, and
> requirements unearthed when comparing the September 2026 `librechat-gitkb`
> journals against the October 2026 MarkBrain docs and current codebase.
>
> **Rule:** This file preserves **the questions, the problems, the fears, and
> the tensions** — including where the ideas might be flawed or contradict each
> other — so nothing evaporates across sessions. Do not flatten these into fake
> "settled decisions."

---

## 1. The Durability, Backup & Fast-Redeploy Problem

### The underlying fear (the moon, not the finger)
- David has been burned before: a server got shut down before he could act, and
  the manual effort of reinstalling/reconfiguring DB + server + restoring state
  was miserable enough that he never recovered the project.
- He does not trust browser-only storage (which is why he won't seriously test
  Local mode), and he does not trust a random rented VPS to be the sole holder
  of his work.
- What he trusted in the LibreChat era: **plain Markdown files sitting on his
  home Ubuntu desktop (99.95% uptime) + pushed to a private GitHub repo**
  (`librechat-gitkb`), or Google Drive / Google Docs.
- Target from September (`R6`): **<30-minute Recovery Point Objective (RPO)**
  and near-zero manual steps to redeploy from scratch.

### What actually matters to preserve (in order)
1. **Sacred (Tier 1): Artifacts + their revision history + provenance** (which
   conversation/turns birthed or updated each version, and why).
2. **Important (Tier 2): Chat threads & turns** — slightly more ephemeral than
   artifacts, *except* that provenance links point back into chats so you can
   recover the "why" behind an artifact 6 months later.
3. **Disposable (Tier 3): Embeddings, TTS audio cache, 7-day API call logs.**
   Never need backing up.

### Architecture locked (2026-10-27): The Three-Part Storage & Backup Model
1. **SQLite at runtime** (for security — no filesystem path-traversal/symlink/encoding traps — and OS page-cache performance).
2. **Relational Envelope + `doc_json` Payload + Declarative Annealing on boot:**
   - System/auth tables (`users`, `sessions`, `user_secrets`) stay strict relational SQL.
   - Domain entity tables (`projects`, `threads`, `folders`, `turns`, `chapters`, `artifacts`, `edges`, `tombstones`) keep **only** the relational envelope columns that SQLite actually indexes/queries (`user_id`, `project_id`, `entity_id`, `thread_id`/`seq`, `revision`, `updated_at`) + `doc_json TEXT` for the full TypeScript domain object. Stop duplicating domain fields (`description`, `summary`, `granularity`...) as redundant SQL columns.
   - New domain fields go into `doc_json` with TypeScript defaults (`zero` SQL migrations needed for 95% of feature work).
   - For the rare envelope/auth table change: a declarative schema spec in code (`TABLES_SPEC`) is converged idempotently on every server boot (`initDb()` inspects `sqlite_master` + `PRAGMA table_info` and anneals production to match intent — no brittle Django-style numbered migration files).
3. **Two separate backup/export streams (never binary blobs in Git):**
   - **Stream A — Operator Fast Disaster Recovery (Service Backup):** Consistent `.sqlite` snapshot pulled off-box to the operator's home Ubuntu machine (via SQLite online backup API, kept in a local rolling ring, **never** committed to Git) so `ansible-playbook deploy.yml -e restore_db=...` restores a dead VPS in 60 seconds.
   - **Stream B — Bijective, CI-Proven Plaintext Tree Export/Import:** A human-readable folder structure (`.md` + YAML frontmatter + `.json`/`.jsonl` for threads/revisions) backed by a **100%-coverage round-trip CI invariant test** (`Seed full DB with 0 nulls/empties across all tables & fields → Export to Plaintext Tree → Import to fresh DB → Assert exact equality`). This Plaintext Tree can be committed/pushed to Git cleanly (pure text diffs, zero `.git` bloat, readable with `cat`/`grep` 20 years from now).

### Open exploration (2026-10-27): Client-First Replica, Offline Vault Access & WASM Embeddings

- **Architectural Principle — "VPS Light as a Feather":**
  - The VPS backend must stay feather-light (near-zero CPU/RAM/bandwidth overhead). Anything that can run in the client browser (building `.zip`/`.tar` archives, plaintext tree serialization/deserialization, local folder mirroring, and potentially even embedding calculation) MUST run in the client, not on the VPS.
  - Skip server-side Git-push daemons (Way 1) and skip VPS-heavy zip-generation pull endpoints (Way 3). Server-side CLI (`npm run export-plaintext` / `import-plaintext`) is fine because it is only invoked locally by the operator, never exposed as an external load surface.

- **Locked: Bijective Cross-Provider Plaintext Export / Import (`.tar.gz` in JS, client-side):**
  - Format: **`project.tar.gz`** (POSIX `ustar` tar + native browser `CompressionStream('gzip')` / `DecompressionStream('gzip')` — ~80 lines of zero-dependency TypeScript, zero care for Windows `.zip`).
  - Any user can export a project (or full workspace) into a Plaintext Folder Tree packaged right in the browser and import that `.tar.gz` into *any* other MarkBrain server or Local Workspace mode with 100% fidelity (backed by the CI bijection test).

- **Locked direction: Each Browser Device as a Self-Sufficient Replica + Local Folder Mirror (`File System Access API`):**
  - On desktop browsers, the user can optionally link a local directory (`showDirectoryPicker()`) so the browser itself writes the Plaintext Tree straight to their hard drive whenever deltas arrive.
  - **The Critical Hole David Spotted ("Logged out + VPS is down"):**
    - Right now, when a user clicks **Sign Out**, `clearVpsSession()` removes `markbrain:vpsSession` and returns the user to `AuthGate`. Even though their entire IndexedDB mirror (`markbrain-vps:<origin>:<email>`) is still sitting intact on their device, **they cannot open it or export it without the VPS answering `POST /api/auth/login`!**
    - Worse: if their session expires or they logged out, and the VPS dies permanently, their device has a full replica in IndexedDB that the UI refuses to let them touch!
    - **Required design fix:** `AuthGate` (and the app) must detect existing local `markbrain-vps:<origin>:<email>` mirrors on the device (via `indexedDB.databases()` or a saved local registry of cached accounts) and offer **"Open Offline / Export Cached Replica (`<email>`)"** right on the AuthGate without requiring the VPS to be online!
    - *Security question to weigh on that hole:* On a personal phone/PC, letting the user browse/export the local IndexedDB cache when the VPS is unreachable is pure win. On a shared computer, if someone explicitly clicked "Sign Out", should "Sign Out" ask *"Keep local replica on this device (available offline) or wipe local cache?"* — or encrypt/gate the local replica with the user's password hash / local verifier so the user can unlock their local cache offline using their password even when the VPS is dead?

- **Locked Direction (2026-10-27): Browser-Side JS / WASM Embeddings (`transformers.js` / ONNX):**
  - *Why David wants this (the actual two problems it solves):*
    1. **Embedding API quota is stingy and runs out** (Google's embedding quota is tiny, which forced moving to OpenRouter `nvidia/nemotron-3-embed-1b:free`; running out of embedding quota simply from typing queries in search is ridiculous). LLM text-gen quota for `generate-qa` is fine — it's the *embedding* calls (indexing + every search query) that need infinite local CPU quota.
    2. **Full semantic search in Airplane Mode:** Because the query embedding runs locally in WASM inside the browser against the cached vectors in IndexedDB, both `vecSections` and `vecQa` work 100% offline on the phone without network!
  - *Agreed architecture:* Lazy-load a ~22MB quantized ONNX embedding model in a Web Worker on first search/index use, cached in its own dedicated Cache Storage bucket (`markbrain-models-v1`) so app updates never re-download it. `generate-qa` can still use the LLM when online, while all vector embedding (both indexing and query-time search) runs locally in WASM with infinite quota.

---

## 2. Artifacts as "My Google Docs" (Editing, AI Upserts, Revisions, Provenance) — ALIGNED

### Settled alignment (2026-10-27)
- **Workflow:** AI upserts artifacts without confirmation popups; user can also edit artifacts manually; safety comes from persistent revision history + diff view + 1-click revert + provenance links.
- **The 4-layer staleness issue when editing `body`:** Agreed this is a design requirement for the upcoming Artifact Editing spec (not a bug today only because manual editing isn't wired yet). When we write the Artifact Editing design doc, it must specify how `subtitle` / `description` / `summary` behave when `body` is edited (and revisions must snapshot all layers).
- **Bugs still to fix when implementing:**
  - **Bug 2.1 (Client-side `sendQueue.ts`):** `applyBufferedArtifacts` on existing artifact records revision but forgets `artifacts.upsertArtifact(...)`.
  - **Bug 2.2 (Server-side `projectRepo.ts`):** `commitJobPairTransaction` overwrites artifact without recording a revision.
  - **Bug 2.3 (Persistence):** `ArtifactVersioningDomain` must be persisted, not RAM-only.

---

## 3. Chapters, Compaction & Toggleable Chatbot "Extensions" — ALIGNED

### Settled alignment (2026-10-27)
- **Why Chapters need all 4 layers (`Title | Description | Summary | Full`):**
  - My assumption that a chapter is "8 messages" was dead wrong. In David's real usage (e.g. LibreChat), a single brainstorming chapter can run **~100k tokens** of deep ranting before it ever crystallizes into an artifact — making a chapter *larger* than an artifact! At 100k tokens, having both a ~200-token `Description` and a ~1,200-token `Summary` (plus `Title` and `Full`) is completely justified, and preserves symmetry with Artifacts ("a chapter is like an artifact that contains turns and attachments").
- **Why Chapters felt broken in practice:**
  - Because the AI sees `<topic_shift>` in the system prompt and fires it every 3 messages like a cowboy.
- **The fix (aligned):**
  1. Put the user in control of chapter cuts (or tune `<topic_shift>` to be rare).
  2. Add **Chatbot Capability Toggles ("Extensions")** so features like `<topic_shift>` (Auto-Chapter), `<artifact_upsert>` (Write Artifacts), and `<link>` (Graph Links) can be enabled/disabled — stripping their instructions out of `systemInstruction` when off so the model stops losing IQ to harness bloat.

---

## 4. Referential Deletion Law (`doc 14`) — ALIGNED (No Change)

### Settled alignment (2026-10-27)
- David's correction: There is **no contradiction** in `14_CLEANUP_AND_DELETION.md`.
- While chats are more ephemeral than artifacts, **a live chat depends on the artifacts attached to its turns** to render and to continue compiling context. Permanently deleting an artifact that a chat holds would break that chat.
- Until we ever care to build "detach/purge artifact from a chat" (not needed now), the existing workflow in `doc 14` is already complete and intentional:
  - Don't want the artifact in the library? **Archive it.**
  - Don't want its tokens in the chat? **Set its cut to `Title`.**
  - Want it permanently gone from disk? Archive the chats that use it first, then delete in Cleanup.

---

## 5. Ephemeral 7-Day API Call Inspector (The Flight Recorder) — ALIGNED

### The requirement
- Not for backup, purely for debugging, testing, and trust (*"Show me what
  actually happened on the wire"*).
- Whenever we make an LLM API call (chat, summarize, extract, title, etc.),
  record an ephemeral log entry (in-memory ring buffer or rolling store, max
  7 days TTL):
  1. **Exact request:** timestamp sent (`t_send`), target provider/model/url,
     parameters, and the exact `systemInstruction` + `compiledPrompt` /
     messages sent (with secrets/API keys scrubbed).
  2. **Stopwatch milestones:**
     - `t_send`: request leaves us.
     - `t_ack`: HTTP response headers / stream established (before first token).
     - `t_first_thinking` / `t_first_token`: first chunk received (`TTFT`).
     - `t_end`: stream finished or errored (`totalMs`).
  3. **Exact response:** raw unparsed text as received from the provider
     (including raw `<artifact_upsert>` / `<topic_shift>` tags before our
     demuxer stripped them!), token usage metadata, finish reason, or raw error.

### Open questions
- **Q4.1 — Where should it live in the UI?**
  - Inside the existing `ServerLogsModal` as a second tab (`API Calls (last 7d)`)
    AND/OR clickable directly from the token/latency badge at the bottom of
    each assistant turn in the chat? (Clicking a turn's `1,240 tok · 2.1s`
    badge to open that turn's exact raw wire call would make debugging instant.)
- **Q4.2 — RAM vs SQLite table with 7-day auto-prune:**
  - In-memory ring buffer (say last 100 calls) is 50 lines of code and zero
    disk I/O, but wipes if the server restarts.
  - A single unbacked-up SQLite table (`api_call_logs` with `DELETE WHERE
    created_at < now - 7d` on insert) survives server restarts for the full 7
    days.

---

## 6. The Graph & Semantics Problem (Dreams 1, 2, and 3 Unified — 2026-10-27)

### Why the current graph is an unused toy
- `isHighConcept: boolean` was originally a throwaway idea about connecting
  things *between* projects; it does nothing today except color a label red in
  the metadata tab and can be removed or repurposed.
- Current edges (`relates_to`, `parent_of`, `refines`, `born_from`) were never
  properly designed with David, custom edge types aren't supported, the LLM
  rarely emits them, and since the broken auto-radius compiler was killed on
  Oct 19, **nothing in the app consumes edges** except drawing grey lines on
  `SpatialGraph`.
- Meanwhile, the proximity engine only suggests *new* unattached artifacts to
  add — it never suggests **expanding or compacting artifacts that are ALREADY
  attached** when the conversation moves closer to or further from them!

### The aligned semantic model (what the Graph & Auto-Organizator actually need to be)

1. **Two real semantic coordinates on every artifact (replacing `isHighConcept`):**
   - **Axis 1 — Scope / Altitude (Broad $\longleftrightarrow$ Specific):**
     - `canopy` (vision, high-level pillar)
     - `system` (subsystem, major domain/topic)
     - `leaf` (specific mechanic, detail, calculation)
     - `evidence` (playtest learning, stream feedback, empirical log)
   - **Axis 2 — Epistemic Time-State (Reality $\longleftrightarrow$ Wish $\longleftrightarrow$ Past):**
     - `current` (what is actually true / built in the project right now)
     - `wish` (tentative design, exploration, proposal)
     - `superseded` (old version / historical context — kept so we know why we
       moved on, but must **never** be mistaken by the LLM for current spec!)
   - *Prompt payoff:* Both coordinates ride as attributes on `<note>` in the
     compiled prompt so the LLM immediately knows whether a document is current
     ground truth, a tentative wish, or a superseded historical version.

2. **Edges that actually do a job (open/customizable kinds + clear consumers):**
   - Allow open/custom relationship types alongside a useful core set (e.g.
     `parent_of` / `child_of`, `supersedes`, `depends_on`, `relates_to`, or
     user/AI-defined labels).
   - **Consumer 1 — Hierarchical Forest Map:** Organize the forest view by
     **Altitude** (`canopy → system → leaf`) and filter/tint by **Time-State**
     (`current` vs `wish` vs `superseded`) instead of an unstructured physics
     hairball.
   - **Consumer 2 — 1-Tap Neighborhood Staging:** When viewing or staging a
     note, surface its connected parent/children/related notes so the user can
     pull its neighborhood into context (e.g. at `Description` or `Summary`) in
     one tap while keeping 100% manual control.

3. **Bidirectional Context Suggestions (Add + Expand + Compact):**
   - Using proximity (WASM embeddings + FTS) and graph distance against the
     current chat draft / recent turns:
     - **Unattached notes close to the topic:** suggest staging (`+ Attach`).
     - **Already-attached notes at `Title`/`Description` that are now central to
       the current draft:** suggest **expanding** (`Push IN → Summary / Full`).
     - **Already-attached notes at `Full`/`Summary` that have drifted far from
       the current topic (and are eating token budget):** suggest **compacting**
       (`Push OUT → Description / Title`).
   - Always a suggestion the user taps to accept — never silent auto-mutation.

4. **Chat-Driven Auto-Organizator (`plan → agree → execute → rollback`):**
   - Instead of wiring 40 nodes and classifications by hand on a phone screen,
     the user discusses the corpus in chat (attaching notes cheaply at
     `Description`/`Summary`), agrees on a structure, and the LLM emits a
     **batch organization plan** (setting `altitude`, `state`, `category`/folder,
     `tags`, and `edges` across multiple artifacts at once) that the user
     reviews as a diff card, applies in one click, and can roll back as a
     single revision step.

5. **Dream 4 ("Peer Collaborator vs Task-Monkey"):**
   - Recognized as a prompt/alignment tuning effort (much easier once capability
     toggles strip XML schema bloat out of pure-thinking turns; can be tuned
     iteratively over a few evenings).

---

## 7. Pinned in the Drawer (For Later)
- **Security Audit H2:** Cookie-only sessions (`HttpOnly`) vs keeping
  `localStorage` Bearer token copy.
- **Security Audit L1:** Production lockfile (`package-lock.prod.json` +
  `npm ci` in Ansible deploy) + 3 low-severity nits from `26_SECURITY_AUDIT.md`.
- **Comments anchored to artifact paragraphs:** Parked until a full workflow
  exists.
