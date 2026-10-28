# System Architecture (`02_SYSTEM_ARCHITECTURE.md`)

> **Status: LIVING REFERENCE (2026-10-28).** Describes the system as it is
> actually built today (branch `dev-vega` @ the `dev-orion` merge). Where an
> older archived doc disagrees with this file, trust this file — and where
> this file disagrees with the code, trust the code and fix this file.
> Historical specs and execution logs live in `archive/`.

---

## 1. High-Level Topology — the Two-Mode Architecture

One deployment, two cleanly isolated modes (decided law: `archive/19`):

```
                https://markbrain.unhaunter.com
                              │
                       ┌──────▼──────┐
                       │    Caddy    │  static: /srv/markbrain/dist
                       │  (80/443)   │  proxy:  /api/* → 127.0.0.1:3032
                       └──────┬──────┘          (SSE: flush_interval -1)
                              │
                ┌─────────────▼──────────────┐
                │   Node + SQLite daemon     │
                │   (127.0.0.1:3032)         │
                │   users/sessions/vault     │
                │   atomic rows + delta sync │
                │   chat jobs + call logs    │
                └────────────────────────────┘

  MODE 1 — LOCAL WORKSPACE                MODE 2 — CONNECTED VPS
  (public default, $0, zero server bytes) (owner + invited accounts)
  ┌─────────────────────────────┐        ┌─────────────────────────────┐
  │ Browser                     │        │ Browser                     │
  │  IDB: markbrain-local       │        │  IDB mirror:                │
  │  keys: local passphrase     │        │   markbrain-vps:<org>:<mail>│
  │  vault (PBKDF2+AES-GCM,     │        │  keys: VPS vault (server    │
  │  unlocked to tab RAM)       │        │  RAM) + tab-RAM auto re-arm │
  │  AI: browser ──▶ provider   │        │  AI: VPS jobs (Send-and-    │
  │  search: lexical only       │        │  Forget), SSE, delta sync   │
  │  backup: export/import      │        │  offline replica openable   │
  │  .tar.gz in-browser         │        │  from AuthGate, VPS or not  │
  └─────────────────────────────┘        └─────────────────────────────┘
```

- **Mode 1** never authenticates against the server: every `/api/*` route
  answers `401` without a valid VPS session. AI calls go browser → provider
  with the user's own keys; nothing but static files is served to strangers.
- **Mode 2** is David + friends: zero public registration, immutable owner
  Account #1, per-user encrypted key vault, background chat jobs that finish
  after the phone screen locks, and a full IndexedDB mirror per device.

## 2. Directory & Layer Governance

Vertical business domains, strict downward dependencies (decided rules from
`archive/03_DOMAIN_ARCHITECTURE_RULES.md`): no horizontal tiers, no MVC, no
god components; every domain is DI-testable with tests in `src/tests/` only;
`src/` never imports `server/` and vice versa. **`src/gateway/` is the only
module in `src/` that may call `fetch('/api/…')`** — UI and application code
import gateway functions, never raw fetches.

```
src/domains/            one type system, one class per domain:
  00-workspace/           workspace/mode state
  01-artifact-document/   UniversalArtifactDocument + 4-layer cuts
  01-artifact-versioning/ ArtifactRevision history + rollback
  01-dialogue-timeline/   turns/pairs
  02-chapter-segmentation/ChapterPartition windows + in-progress law
  02-topological-graph/   SemanticEdge (open kinds)
  03-chapter-recalibration/ summary regeneration side-channel
  03-optical-compiler/    context compiler (capabilities-aware)
  03-stream-protocol/     demuxer (<topic_shift>/<artifact_upsert>/<link>)
  06-chat-threads/        ChatThread, ChatAttachment, ChatCapabilities
  search/                 lexical + vector search engines
  granularity.ts          the 4-cut palette/vocabulary (design law)
  plaintextTree.ts        bijective snapshot ⇄ plaintext tree
  callLogTypes.ts         shared ApiCallLog type
src/application/        orchestration (no UI, no transport):
  sendQueue.ts            pairs discipline, drafts, offline gate, FIFO
  draftQueue.ts           queue storage
  persistWorker.ts        Local persistence (+ deadlines)
  snapshotLoader.ts       hydration
  serverMutationQueue.ts  VPS mutation outbox
  useVpsDeltaSync.ts      10s delta poll + reconcile
  composerDrafts.ts       unsent composer text persistence
  connectivity.ts         isOnline/subscribeOnline
  vaultLockBus.ts         proactive lock state
  cleanupPlan.ts          archive/delete planning (referential law)
  sessionMachine.ts       mode/session state
src/gateway/            THE transport seam:
  api.ts                  every fetch('/api…') in src/ lives here
  direct.ts + providers/  browser→provider adapters for Local mode
src/services/stores/    backends behind one interface:
  projectStore.ts         the port; localStore.ts | vpsStore.ts
  hydrate.ts
src/ui/                 presentation slices (chat, artifacts, graph,
                        context, cleanup, workspace, system) + uiFontScale.ts
server/
  app.ts                  Express app; auth gates; CSP; CORS seam
  db/schemaSpec.ts        TABLES_SPEC + annealDatabase()
  db/index.ts             boot: WAL, FKs, anneal
  db/projectRepo.ts       envelope/doc_json repo, delta, atomic mutations
  db/users.ts             user admin repo
  jobs/chatJobRunner.ts   Send-and-Forget worker (never cancelled by SSE)
  jobs/serverArtifactIndexer.ts  VPS-side semantic indexer (interim)
  lib/accountVault.ts     scrypt + AES-256-GCM vault, tier lane routing
  lib/callRecorder.ts     7-day flight recorder
  lib/models.ts           curated model catalog (errors are final)
  lib/ttsCache.ts         ffmpeg Ogg cache
  lib/{csp,env,log,prompt,tokens,users}.ts
  providers/{gemini,openrouter,lane}.ts
  routes/                 one file per endpoint (account, chat, extract,
                          health, jobs, logs, models, projects, searchIndex,
                          summarize, title, tts)
```

## 3. The Three-Part Storage & Backup Model

Decided law (`archive/27` §1). What is sacred, in order: **Tier 1** artifacts
+ revision history + provenance; **Tier 2** chat threads & turns; **Tier 3**
disposable (embeddings, TTS cache, 7-day call logs — never backed up).

### 3.1 SQLite at runtime + declarative annealing

`server/db/schemaSpec.ts` declares the whole schema as data (`TABLES_SPEC`,
17 tables) and `annealDatabase()` converges any database — fresh, current, or
old-shaped — idempotently on **every boot**. No numbered migrations: add a
`TableSpec`/`ColumnSpec` and the annealer creates/adds it on next boot.
Columns are never dropped; legacy columns stay readable forever.

- **System/auth tables** (strict relational): `users`, `sessions`,
  `user_secrets`, `user_settings`, plus infrastructure tables `chat_jobs`,
  `api_call_logs`, `tts_cache`, `artifact_index_sections`.
- **Domain entity tables** use the **relational envelope + `doc_json`**
  pattern: `projects`, `threads`, `folders`, `turns`, `chapters`, `artifacts`,
  `artifact_revisions`, `edges`, `tombstones` keep only the columns SQL
  actually filters/joins on (ids, ownership, seq/revision, timestamps) and
  hold the canonical domain object in `doc_json`. New domain fields go into
  `doc_json` with TypeScript defaults — zero SQL changes for most feature
  work; reads prefer `doc_json` and fall back to legacy columns only when the
  doc is missing.

**Anti-clobber delta sync:** writes bump `projects.revision`; clients poll
`GET /api/projects/:id/delta?since=<rev>` and merge changed rows. Turns are
only ever deleted via explicit `explicitDeletes` — never because a stale tab's
snapshot lacked them — and deletions propagate as `tombstones`.

### 3.2 Stream A — Operator fast disaster recovery

A consistent `.sqlite` snapshot is pulled off-box to David's home machine
(SQLite online-backup API, local rolling ring, **never in git**). A dead VPS
is restored in ~60 seconds by `deploy/ansible/playbook.yml` with a
`restore_db` pass. See `deploy/RUNBOOK.md`.

### 3.3 Stream B — The bijective plaintext tree (`.tar.gz`)

The human-readable, Git-committable backup. Layout:

```
<project-code-or-id>/
  project.json                      # metadata, capabilities, granularity law
  threads/<thread-id>.json          # thread + turns + chapters
  artifacts/<code-or-id>.md         # YAML frontmatter + raw body
  artifacts/<code-or-id>.history.json  # ArtifactRevision[] for that artifact
  edges.json                        # SemanticEdge[]
```

- Format: POSIX `ustar` tar + native `CompressionStream('gzip')` —
  `src/utils/tarGz.ts`, zero dependencies (Node zlib fallback for tests).
- Conversion: `src/domains/plaintextTree.ts` `snapshotToTree()` /
  `treeToSnapshot()`, deterministic YAML (sorted keys) so Git diffs stay clean.
- Surfaces: browser export/import in the Sidebar I/O accordion (works fully
  offline — it reads the local mirror), and the operator CLI
  (`npm run export-plaintext` / `import-plaintext`, local-only, **no HTTP
  endpoint**).
- Correctness: `src/tests/plaintext-roundtrip.test.ts` seeds a full DB with
  zero nulls/empties, exports, imports into a fresh DB, and asserts exact
  deep equality — the bijection invariant. If a new required field is added
  to the types and not to the fixture, this test fails loudly.

## 4. Offline Awareness & Offline Replicas

- **Connectivity signal** (`src/application/connectivity.ts`):
  `isOnline()` / `subscribeOnline()`; `navigator.onLine !== false` coercion
  (test environments and non-browser hosts read as online; only an explicit
  `false` means offline). Honest limit: a captive portal reads online —
  false positives simply fall into the normal failure path.
- **Send queue offline gate** (`sendQueue.ts`): when offline, sends stay
  **queued** — never attempted, never fail-blocked. The queue's `online`
  listener walks held drafts automatically on reconnect. The sidebar sync
  button becomes a disabled amber airplane while offline; TTS, logs, and
  telemetry are gated with honest titles.
- **Offline replicas** (`workspaceSession.ts` `knownReplicas` +
  `AuthGate.tsx`): every device holding a VPS mirror can **Open Offline**
  from the auth gate — browse and export the cached replica with the VPS
  dead and no session. Sign Out offers keep-replica vs wipe-local-cache.

## 5. The 7-Day API Call Flight Recorder

Ephemeral debugging truth, never a backup target:

- **Server** (`server/lib/callRecorder.ts`, `api_call_logs` table): every
  provider call records exact request (secrets scrubbed), stopwatch
  milestones (`t_send → t_ack → t_first_token → t_end`), status, raw
  unparsed `response_text`, token usage, and error. Pruned to 7 days and
  500 calls/user on insert. Routes `GET /api/logs/calls` (list) and
  `GET /api/logs/calls/:id` (full, owner-scoped).
- **Local mode** (`src/services/callLogStore.ts`): same shape in a separate
  IndexedDB database (`markbrain-call-logs`), never sent anywhere.
- **UI**: the `ServerLogsModal` "API Calls (last 7d)" tab lists rows with
  computed `ackMs`/`ttftMs`/`totalMs`; a row opens the full wire record;
  assistant-turn telemetry badges deep-link to their call.

## 6. Semantic Indexing & TTS Pipeline

### Embeddings — interim build vs locked target

- **Interim (built, 2026-10-25):** `server/jobs/serverArtifactIndexer.ts`
  indexes artifacts server-side — QA generation + `gemini-embedding-001`
  vectors per changed section only (`content_hash` dedupe, zero calls when
  unchanged), stored in `artifact_index_sections`. Search
  (`server/routes/searchIndex.ts`) embeds the query server-side with a
  per-user `QueryVectorCache` (edit-distance ≤ 1 / Dice ≥ 0.95 reuse) and
  blends cosine + lexical scores. Local mode stays lexical-only, zero quota.
- **Locked target (2026-10-27, not yet built):** **browser-side WASM
  embeddings** (transformers.js/ONNX, ~22MB quantized model in a Web Worker,
  weights cached in a dedicated Cache Storage bucket) — infinite local quota
  and 100% offline semantic search, keeping the VPS light as a feather. The
  server path remains only until the WASM spike lands. Full spec and open
  questions: `07_HORIZON_CLIENT_REPLICA_AND_WASM.md`.

### TTS audio cache

`server/lib/ttsCache.ts`: raw 24kHz PCM from the TTS provider is re-encoded
by `ffmpeg` to mono 22,050 Hz Ogg Vorbis (`-qscale:a -1`, ~12× smaller;
`libopus -b:a 16k` fallback when the build lacks libvorbis), cached on disk
by `sha256(model|voice|cleanText)` with a SQLite LRU — the same text never
burns TTS quota twice, and the phone downloads a fraction of the bytes.

## 7. What This File Is Not

Not a tutorial and not a plan. For how to build/run/verify, see
`05_SECURITY_AND_OPERATIONS.md` §3–§4; for what comes next,
`06`/`07` (horizon) and `STATUS.md` (backlog).
