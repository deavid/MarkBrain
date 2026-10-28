# Evidence packs — machine gathers, LLM judges

**Status:** operational (2026-10-18). Runner: `scripts/evidence.cjs`. Contract below is normative for the runner and for any screener prompt consuming a pack. **Verified:** full suite runs back-to-back stable — 13/13 journeys, 0 console/page/http errors, audit findings identical run-over-run. Remaining red verdict = real app findings (see *Known findings*), not harness breakage.

## Why

Reviewing a UI change today means an agent driving the browser turn-by-turn —
slow, expensive, and interleaved with judgment. An evidence pack inverts the
split: a **deterministic, LLM-free harness** browses, clicks, screenshots and
measures; an **LLM screener** (human or agent) reads one self-contained folder
and judges. No image comparison, no baselines, no pixel diffs — the pack
carries *evidence*, not *assertions about pixels*.

This grew out of a full manual review of `dev-orion` (2026-10-18, driving
13 journeys by hand across two Playwright passes + probes). Everything that
made that review work — and every trap found on the way — is now encoded in
the runner, so the next review starts from a pack instead of a browser.

## Running it

```sh
# one-time: npm i --prefix /tmp/pw playwright-core   (or devDependency)
bun run dev          # server must be up (fixture mode needs no cloud)
node scripts/evidence.cjs
# → evidence/<ISO-timestamp>/          (gitignored)
```

Options (env): `MARKBRAIN_URL`, `MARKBRAIN_EVIDENCE_DIR`, `CHROME_BIN`.
Exit codes: `0` green/amber, `1` red (any journey failure, harness error, or
audit fail), `2` harness error. **Red ≠ harness broken** — read
`summary.json` (`totals`, `journeys[].failures`) to see what the red means.

The harness authenticates with the same network-level mock as
`scripts/headless-capture.cjs` (seeded Firebase user, Firestore held, `?fixture=1`)
— zero cloud reads/writes, real local server, real Gemini streams.

### Three layers of testing (the methodology)

| Layer | Command | Judges |
|---|---|---|
| Types | `bunx tsc --noEmit` | compile-level regressions |
| Logic/journeys at unit level | `bunx vitest run` (`src/tests/`) | domain behavior, selectors, persistence codecs |
| Browser evidence | `node scripts/evidence.cjs` | real UI: journeys, geometry, evidence for LLM screening (below) |

The first two are gates. The third produces a *pack*: machine facts + checkpoint
screenshots for a reviewer (LLM or human) to judge — see screener contract.

## Pack layout

```
evidence/<timestamp>/
├── summary.json                 ← entry point; machine verdicts, FAILURES FIRST
├── journeys/<NN-name>/
│   ├── steps.json               ← ordered actions, waits, observations, failures, warns
│   ├── shots/NN-phase.png       ← checkpoint screenshots ONLY (decision points)
│   ├── fail-context.png/.json   ← on journey failure: frame + DOM facts (center stack,
│   │                              switcher open?, send/stop buttons, textarea disabled)
│   └── (consoleSlices/pageSlices/httpSlices inline in summary.json per journey)
├── audit/
│   ├── <viewport>-<surface>.json     ← geometry findings (rects, css paths, html)
│   └── <viewport>-<surface>-failN-*.png  ← clip with ANNOTATED boxes drawn into the
│                                            page: red = failing target, blue = occluder
└── aria/
    └── <journey-or-surface>.aria.txt ← a11y-tree snapshot (text channel, cheap)
```

Stable IDs: journey ids (`01-boot`, `04-chapter-split`, …) and audit keys
(`<viewport>/<surface>` where viewport ∈ `350x700 | 390x844 | 768x1024 | 1440x900`)
never change between runs, so findings can be referenced in tickets/commits.

## summary.json schema (top level)

| Field | Meaning |
|---|---|
| `verdict` | `green` \| `amber` (warns only) \| `red` (any fail / console / page error) |
| `totals` | `journeyFails`, `journeyWarns`, `auditFails`, `auditWarns` |
| `journeys[]` | per journey: `ok`, `failures[]`, `warns[]`, `durationMs`, `files`, console/page/http slices |
| `audit` | viewport → surface → `{fails, warns, file, shots, skippedBackground}` |
| `consoleErrors` / `pageErrors` / `httpErrors` | de-duplicated, fixture noise (Firestore hold) filtered into `expectedNoise` |

## What the geometry audit checks

For every interactive element (`button, a[href], input, textarea, select,
[role=button], [onclick], [tabindex≠-1]`) visible in the viewport, sampled via
`document.elementFromPoint`:

| Rule | Fail / Warn |
|---|---|
| **occluded** — center point lands on a *different control* (not a full-bleed backdrop) | fail |
| **partial-coverage** — fewer than 6 of 9 sampled points clickable | fail |
| **touch-too-small** — min dimension < 12px | fail |
| **touch-small** — min dimension < 16px (project thresholds, David 2026-10-19) | warn |

Touch-target rule (current, since 2026-10-19): **min dimension <12px = fail,
<16px = warn** — a deliberate relaxation of WCAG 2.5.8's 16/24 cutoffs, decided
by David 2026-10-19 for a more lenient audit.
| **control-overlap** — intersection > 25% of the smaller of two foreground targets | fail |

Elements *behind* a full-bleed overlay (modal backdrop, open mobile drawer
backdrop) are **background, skipped by design** — that's intentional modal
backgrounding, not a bug. Counts are reported as `skippedBackground`.

Surfaces audited: `chat` + (`graph`, `export-modal`, `mirror` on desktop |
`drawer` on mobile), across the 4 viewports (min phone 350×700 per docs).

**Known limits:** canvas/physics content (graph nodes) is audited only as DOM
controls, not SVG hit areas; tooltips and `pointer-events:none` decorations are
excluded; color contrast is out of scope (bolt on axe-core later if wanted).

## What the journeys assert

Fixed suite (deterministic, LLM-free): boot · send→stream→telemetry · stop→
interrupted badge · chapter split at clicked message · summarize → executive
abstract · threads (Cmd+K / Cmd+N / switch-back preserves content) · mirror ·
graph · export · import · model picker · mobile 390 (no h-scroll, send
reachable, drawer) · forced-500 → error banner → Retry recovers.

Split placement is checked with a **machine heuristic** (is the new chapter the
LAST header?) and reported as a *warning* — placement quality remains an LLM
judgment, the harness only surfaces the observation + screenshot.

## Screener contract (for the LLM reading a pack)

1. Read `summary.json` first. Only open artifacts for `red`/`amber` items and
   a spot-check of one `green` journey per run (guards against false greens).
2. For each journey flagged: read `steps.json`, then its `shots/`. Judge
   *does the story match the frame* (caption vs screenshot): content in place,
   states coherent, copy sane, no persona regressions.
3. For each audit fail: open the clip shot. Decide real-bug vs.
   harness-noise (e.g. intentional stacking), severity, which journey hurts.
4. Output: ordered findings (severity, journey/viewport, evidence file
   references) + verdict. **No pixel baselines, no image diffing.**
5. The pack is re-screenable as-is — same files, any reviewer/model.

## Principles (the contract's spirit)

- **Failures first, evidence attached** — a screener must never hunt for the problem.
- **Captions on every screenshot** (in `steps.json`) — the LLM is told what
  the frame is *supposed* to show; its job is mismatch detection.
- **Enough context to disprove hypotheses** — for an anomaly, include the
  relevant control's state (rect, disabled/covered, html), not just a frame.
- **No LLM in the harness, no browser in the screener.**

## Operational lessons (encoded in the runner)

Found the hard way while building this — each is now a design decision, not a trap:

1. **Empty thread ≠ normal composer.** A fresh thread renders the *hero*
   composer whose submit button says **"Start Dialogue"** — it has no
   `title="Send message"`. `send()` tries bottom button → hero button → Enter.
2. **The model can finish before you click Stop.** flash-lite replies in ~2s;
   the Stop journey retries the send ×3 and clicks Stop the instant it appears
   (no screenshot in between). A stream that always completes first is a
   *warning*, not a failure — evidence over brittle timing.
3. **Occluded affordances: journeys and audits have separate jobs.**
   Journeys activate handlers with a JS `el.click()` (tests *app logic*); the
   geometry audit owns *hit-testing* (`elementFromPoint`). `force:true` clicks
   are forbidden — they dispatch to whatever covers the target, which muddies
   both signals.
4. **Background vs. occlusion bug.** Covered by a full-bleed element OR fixed
   chrome (drawer/modal/switcher, `position:fixed` z ≥ 40 or unindexed) =
   intentional layering → skipped as background. Covered by another ordinary
   control = fail. Without this rule, every open drawer/modal floods the audit
   with false occlusions of the page behind it.
5. **Deliberate failures must not pollute the verdict.** Journey 13 forces a
   500; a phase flag routes its console/http/page errors to `expectedNoise`.
   Same filter absorbs dev-only noise (vite HMR websocket when another instance
   owns port 24678, held-Firestore boot warnings).
6. **One failure must not cascade.** After a failed journey the runner
   auto-recovers (Escape ×2, stop any stream, ensure Dialogue view) so later
   journeys still produce evidence. Without it, one selector miss turned 13
   journeys into 4.
7. **Failure context on throw** — `fail-context.png/.json` captures the frame
   plus DOM facts (what's stacked at viewport center, which send/stop buttons
   exist, textarea disabled?) so the screener can disprove hypotheses offline.
   This is what proved lesson 1 instead of guessing.
8. **Journey ordering carries state** (later journeys reuse earlier content,
   e.g. switch-back asserts `EVIDENCE-OK` from journey 2). Documented in each
   caption; a fresh `?fixture=1` load resets everything.

## Known findings in the current tree (last run: 2026-10-19, dev-pulsar rebased on dev-orion `bdd1156`)

Produced by the runner — the reference example of what a pack flags;
**re-check the latest pack rather than trusting this list**:

> **Thresholds changed 2026-10-19** (David): touch-target rule is now
> **fail <12px, warn <16px** (was fail <16, warn <24 per WCAG 2.5.8). The
> findings below were measured under the **old** rules and are kept factual
> as a historical reference; under the current rule most of them would no
> longer flag.

- **fail · graph toolbar target sizes (768×1024)** — `Pin` 11px, `Connect Edge`
  13px, `Pull node into context` / `Inspect specification` 12px (`< 16px` hard min
  under the old rule; only `Pin` 11px would still fail today).
- **fail · mirror `RAW PAYLOAD (LITERAL)` toggle 13px** (768 + 1440).
- **62 warns** across the matrix: interactive targets between 16–24px
  (WCAG 2.5.8 AA wants ≥ 24 — the rule in force when measured) — chat icon
  rows, sidebar accordions, etc. Under the current 12/16 rule these would not
  warn.

Everything else: journeys 13/13, zero warnings, no console/page/http errors,
no occlusion fails, no control-overlap fails at any viewport, mobile 350/390 clean.

**Already fixed and confirmed by the harness** (flagged by the 2026-10-18
manual review, fixed in dev-orion `6ef540c`/`5517ce6`, re-verified by journey
`04-chapter-split` on 2026-10-19): split-at-clicked-message — the heuristic now
checks *the new chapter carries the clicked message* (`≥1 msg`) rather than DOM
position, since splitting at message 1 correctly makes the new chapter last —
plus load-error ≠ absence (H1), legacy turn-meta backfill (M2),
`available:false` rendered, export version bump.
