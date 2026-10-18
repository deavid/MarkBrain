# Pending / open work

## State (2026-10-18, morning — critical review pass)

- **Full-app critical review written:** `design-docs/04_CRITICAL_FINDINGS.md`.
  David asked for a very critical look (husks, odd-one-out, disconnected
  stuff) with the possibility of a full cleanse. Bingo partially hit: mechanics
  partly hold (streaming, chapters, persistence, domain skeleton) but **the
  app's soul is a different product** — "principal systems architect / token
  topologies / design systems" (system instruction, placeholders, model copy,
  highConcept, tests) vs David's actual collector/organizer/forest-view from
  `motivation.md`.
- **Top findings (detail in the doc):** wrong-product persona; dead domains
  (`ProvenanceTracking`, `RecursiveGrouping` — instantiated, never called);
  `<link>` parsed and dropped (no `onLink` handler in App); token ceiling
  decorative; T0–T3 "pre-computation" not implemented; mirror absent (tap-orb
  stats wanted, orb silently cycles optical modes instead); heat-strip legend
  lies (shows chapter recency, not tiers); dual data model
  (`src/types/index.ts` frankenmodel vs `domains/*/types.ts`); `App.tsx` god
  component (1086L); twin parser in `server.ts` + stream-protocol; TTS + Drive
  import + 849L SpatialGraph = odd-one-out features not in any design doc.
- **Tests + instrumentation audit added to findings (§5, §6).** 13 tests,
  7 tautologies (J5 persistence "roundtrip" never touches persistenceService;
  J6/J7/J9 reimplement App logic *inside the test*); J3 misnamed. Only J2
  (parser) + J4 (chapter seal) are load-bearing. Instrumentation: per-chunk
  `logger.action` on `updateTurn` = N logs per send (violates 1-event-per-
  human-action); `LogCategory` closed enum excludes ImportModal/Compiler/etc
  so those files use raw console; `compile()` has zero logs; silent fallbacks
  (model watchdog→lite, TTS, YAML, getBackend, topic_shift parse) don't warn;
  real bug: `handleSummarizeChapter` summarizes the ACTIVE chapter regardless
  of the `chapterId` argument + no `res.ok` check.
- **Findings §4 questions ANSWERED (2026-10-18 08:52) — decisions recorded in
  `design-docs/05_CLEANSE_DECISIONS.md` (append-only ledger; 04 is now a
  frozen snapshot):**
  - Product = **brain collector**, no option B. Daily driver = chat + chapters
    (never actually used yet — app never worked for him).
  - Cleanse mode = **my call → purge-in-place**, `server.ts` + `types/index.ts`
    radioactive. Phase plan proposed in 05 §phase-plan (1 lie removal →
    2 instrumentation law → 3 data-model fight → 4 mirror) — **Phase 1 DONE +
    COMMITTED (`66ed42a` on `dev-nova`, worktree alias nova):**
    persona/placeholders/model copy/prompt voice/category defaults
    (`system-spec`→`note`)/`/api/chat` dead endpoint all purged across ~21
    files. Green: vitest 6/6, tsc clean. Deliberately NOT touched (Phase 3):
    internal identifiers (`substrateTokens`, `<knowledge_substrate>` XML tag,
    `knowledge_substrate` protocol), test fixture strings, legacy
    `architecture` folder default (old data may exist).
  - **Phase 2 (instrumentation law) DONE (2026-10-18 ~10:05), uncommitted:**
    per-chunk action flood killed (`updateTurn` hot path silent),
    `appendTurn`/`declareNewChapter` action→info, `LogCategory` opened,
    every fallback warns (persistence/YAML/topic_shift/SSE/Drive×4/cancel/
    segmentation-unknown-id/ceiling-breach), `compile()` + graph load +
    turn lifecycle instrumented, raw `console.*` eliminated from all of `src/`,
    summarize-chapter wrong-chapter + missing `res.ok` bugs fixed, Stop +
    ImportConfirm gesture actions added. Per-send trace: typical 5 / worst ~9
    / cap 16 → PASS. Green: vitest 6/6, tsc clean. Full record in 05 ledger.
    Awaiting commit; Phase 3 (data-model fight) next.
  - **Tautologies: DELETE — actioned same day** (J5/6/7/9 removed, J3 renamed;
    suite 13 → 6 tests; run `bunx vitest run` to verify).
  - Logging: **law** = 1/human action guideline, **max 16 hard rule**, don't
    log hot loops; hard-to-do ⇒ don't log at all. Also in corrections.md.
  - TTS keep (low priority) · Drive import wanted-but-broken (artifacts are raw
    Google Docs, NOT YAML — re-scope later) · SpatialGraph keep (low priority).

## State (2026-10-17, end of night)

- **Design-docs rewrite + consolidation pass: DONE.** (Commit `8aebe04` +
  consolidation commit.) The timestamp canyon is closed — all docs conform to
  the late-session decisions.
- **LGTM ledger:** `STREAM_PROTOCOL.md` ✅ (21:49) · `MOBILE_UX_SPEC.md` ✅
  r4, closed (22:25) · six-doc sweep ✅ (consolidation pass — mirror into
  `01`, sheets/drag killed in `02`, modes-as-presets into compiler, diagram +
  stamps fixed in `SYSTEM_ARCHITECTURE`, comments scrubbed in `03`).
- **Scratch files are the live state:** `COOPERATION.md` (charter — read in
  full after every `/compact`), `motivation.md` (ground truth incl. mirror
  principle), `corrections.md` (laws), this file.

## In flight (2026-10-17, late night)

- **Local branch + full-database backup/restore — BUILT, VERIFIED (2026-10-18
  00:34).** David greenlit after the eradication ("go for it"): the rule was
  never "localStorage is evil" — it was ONE source of truth per session, no
  dual-write mirror. Shape (branching enclosed per David's constraint):
  - `persistenceService.ts` = the ONLY module that knows >1 backend exists
    (getBackend/setBackend via meta-key `markbrain:backend` — meta-use, not
    data). Dispatches the 4 CRUD functions: `firestore` (default) | `local`.
  - `localBackend.ts` = private IndexedDB adapter (DB `markbrain-local`,
    store `projects`, keyPath `projectId`, canonical ProjectSnapshot —
    IndexedDB not localStorage: 5MB quota dies on artifacts+turns+graph).
  - Session branch in DomainRegistry only: Local mode presents display-only
    LOCAL_USER pseudo (uid `local`, "Local Space") so App/Sidebar/Genesis
    stay backend-agnostic; Firebase observer null in local mode does NOT
    knock the session to the gate.
  - AuthGate second button "Continue locally"; Genesis gets "Restore from a
    database backup instead" (fresh browser must restore with NO sidebar);
    Sidebar I/O accordion gets Backup DB / Restore DB (canonical
    `markbrain-database` v1 JSON — export format IS the architecture;
    export works on Firestore too).
  - Fixed latent bug in the port: createCloudProject returned bare snapshot
    (no meta) → WorkspaceDomain fell back to displaying the raw ID. Both
    branches now return meta-merged records.
  - Acceptance test `scripts/roundtrip-test.cjs` (serial, one Chromium):
    A: local → create → Backup DB → canonical JSON; B: fresh context →
    local → restore → same UI. **ROUNDTRIP PASS.** tsc clean (pre-existing
    vitest gap only). Fixture capture green. David tests the Firestore side,
    agent tested the local side.
- **Project deletion — BUILT, VERIFIED (2026-10-18 08:13).** David: "no way to
  remove projects… from the selection screen… clear confirmation." Stack goes
  through the same port: `persistenceService.deleteProject` (firestore
  deleteDoc / local IDB delete, capture-guarded) → `WorkspaceDomain.removeProject`
  (the `projectDeleted` event type already existed, method didn't — added;
  active project promotes next or '' → Genesis) → `deleteWorkspace` in
  DomainRegistry (storage first, then registry, count stays truthful) →
  ProjectLauncher trash button + confirmation modal (names the project,
  lists ALL data consequences, extra warning when deleting the current
  project). Verified on local: delete test PASS (IDB empty, Genesis
  returns); roundtrip PASS; fixture green; tsc clean.
- **AuthGate error UX cleanup — "strip all stupidity from here" (David's ask).**
  - Verdict on record: the "Enter New API Key" button + localStorage key-override
    were invented by an earlier AI to appease *"keep the Firebase key secret"* —
    instead of saying the true thing. `.env` (gitignored) is the deal; that was
    always the ask. Bundle exposure accepted while building locally.
  - **No internet deploy until David understands the attack surface** — he finds
    Google's model (public-by-design keys that can incur costs; spoofable
    referrer "restrictions"; slow quota alerts) terrible, and he's right to.
  - Correction to *my* claim: "key gets you nothing" was wrong — it can cost
    money (quota/billing abuse). Firestore rules only guard *data*, not *wallet*.
  - Direction decided: error-code-driven gate (domain / key / transient /
    unknown classes), kill the key-paste UI + `saveCustomApiKey` + hardcoded
    project IDs (links derive from `VITE_FIREBASE_API_KEY`... project id from
    `VITE_FIREBASE_PROJECT_ID`). David is adding localhost to Authorized Domains.
- **"Storage IS Firebase" (David, decided):** extirpate the localStorage mesh
  (registry + snapshot mirror + api-key override) and ALL demo seeds
  (`initDefaultProject`, `INITIAL_PROJECTS`, `getStoredSnapshotSync`).
  persistenceService → pure Firestore. Keep: auth session persistence (David
  doesn't care → SDK default), `persistentLocalCache()` as the sanctioned
  offline layer, boot stage until cloud list resolves (approved: no Genesis
  flash). KILL: Sync Now + synced badge ("kill with fire" — hollow BS sweep).
  `initialData.ts` dies entirely; `AVAILABLE_MODELS` rehomed to own file.
  design-docs have NO written position on storage — checked; no conflict.
- **Headless rig redesign PENDING David's pick** among: network-fulfill
  (WebChannel format pain), emulator (heavy, future upgrade for sync tests),
  real-credentials profile (needs one human login; write-capable session —
  risky as default), **recommended: single labeled fixture + dev-only
  `?fixture=1` seam** (his "clear test data for agentic access").
- **Real-data mode — DESIGNED, BUILT, AND VERIFIED (2026-10-18 00:18).**
  `node scripts/headless-capture.cjs --real` → `screen: main`, screenshots show
  real Unhaunter + real artifacts; live `accounts:lookup` 200; writes no-op via
  `?capture=1`. Requires `HEADLESS_AUTH_USER_B64` (+ `HEADLESS_REFRESH_TOKEN`
  canary) in `.env` (gitignored; verified 503-char token, never committed).
  The real gotcha (supersedes the earlier "minimal record rejected" theory):
  the `{fbase_key, value}` envelope is the **IndexedDB** record shape —
  `getAuth` prefers IndexedDB persistence, and localStorage wants the **bare
  user object**; seeding the envelope into localStorage makes `_fromJSON` throw
  (no top-level uid) and the SDK evicts the key silently (diagnosed by reading
  `@firebase/auth` dist: `PersistenceUserManager.create` scans all persistences
  and migrates a bare user object into IndexedDB). Fix = unwrap the envelope,
  zero mutation. Runbook §3.1/§3.5 updated. Fixture mode re-verified green;
  `tsc` clean except pre-existing vitest gap.
- **OOM incident (2026-10-18 00:01) — LAW: capture runs are strictly serial.**
  A duplicated verification loop spawned 40+ Chromiums in parallel → memory
  thrash → systemd-oomd SIGKILLed the Goose scope (4.5G RSS + 15.7G swap peak).
  One Chromium at a time, always `browser.close()`, never batch. Recorded in
  runbook §3.5 + §4.

## Genuinely open (design — nobody has answers yet)

- Original meta-questions (`01` §5): graph authoring mechanism (gut: hybrid),
  out-of-frame culling rule, chapter-close grace period, export story.
- **Preset shape** (what the auto-compaction setting actually is) — experiment
  *after* the mirror exists. `MOBILE_UX_SPEC.md` §9.
- **Mirror v1 scope** — full order+contents parity vs. cheap 80%
  (tokens-per-chapter + summaries visible first). Low priority; don't block on it.
- Sidebar overlay+pin variant; boundary toolkit dropdown home; sidebar trigger
  on future non-chat screens.
- LLM data-request format ("pull X" with user accept/auto-accept+undo) vs
  1-turn discipline — spirit OK, mechanism TBD.
- Auto-organization mechanism (spirit: plan → user agrees → execute →
  rollback/roll-forward; NOT full auto).

## Repo housekeeping (not urgent)

- [ ] README — **hero copy fully locked** (`scratch/readme-copy.md`, 2026-10-18):
      motto pairing + 3-paragraph description, all three parts LGTM'd by David.
      README itself still to be written around that seed.
- `package.json` still named `"react-example"` (AI Studio scaffold leftover).
- README: **added 2026-10-17** (root `README.md`; front door only — docs stay
  source of truth). Same session added `design-docs/AGENT_RUNBOOK.md` +
  `scripts/headless-capture.cjs` (headless run/mock/screenshot rig, David's ask).
- OpenRouter / free-model routing — explore when touching the gateway
  (provider-adapter shape flagged in `STREAM_PROTOCOL.md` §2).
- Email integration — **PARKED. Do not deepen until David reopens it.**
- Multi-chat per project — low-priority nice-to-have ("one chat works way too
  well" is the default position).

## Laws that got us here (full list in `corrections.md`)

- Verify *behavior*, not file existence (husk shells).
- Plan ≠ shipped; sell sparse ideas as sparse ideas.
- No top bars / sticky headers; capture flow sacred; min phone 350×700.
- Motivation before mechanics; metaphor once, labeled; commandments only for
  decided things.

*(Detailed pre-consolidation history lives in git commit `8aebe04` and its
predecessors — this file is state, not archaeology.)*