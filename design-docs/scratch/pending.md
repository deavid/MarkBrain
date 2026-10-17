# Pending / open work

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
- **Real-data mode (opt-in, designed 23:39):** narrow Firebase refresh token
  only → `.env`. David explicitly ACCEPTS owner-scope R/W risk (single-user
  app, not production yet); Google account cookies = hard no ("hell no"),
  persistent-profile rig = refused. Harvest = from his already-signed-in
  session (DevTools manual) OR scripted throwaway login — pick when built.
  `?capture` guard = persistState no-op. Not blocking commits ①②④.
  No admin/console escalation from a client refresh token (self-account
  APIs incl. accounts:delete are the only sharp edge — self-harm, not
  escalation).

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