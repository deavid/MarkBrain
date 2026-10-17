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