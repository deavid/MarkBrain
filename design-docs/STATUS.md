# STATUS — pending work & project context (`STATUS.md`)

> **Snapshot: 2026-10-19, morning.** Written so any conversation — or a future
> session of this one — can pick the project up cold. The *live* log remains
> [`scratch/pending.md`](scratch/pending.md); when this file disagrees with the
> scratch, the scratch wins and this file is stale. Ground truth for *why*:
> [`scratch/motivation.md`](scratch/motivation.md) · for *beliefs*:
> [`00_core_philosophy_soul.md`](00_core_philosophy_soul.md) · for *laws we
> learned the hard way*: [`scratch/corrections.md`](scratch/corrections.md).

---

## 1. Project context — the 60-second version

**MarkBrain is David's brain collector.** He pours ideas out fast and voluminous;
the tool collects, organizes, and keeps the forest view while letting him drill
into detail. Conversation is the furnace; artifacts and chapters are what
survive. It is *not* a chat toy, *not* Obsidian, *not* an agent platform.

Two principles hold it up (see `00`): **the user controls the context** — the
mirror ("show me what the LLM will see") is the pillar that makes this visible —
and **one turn does everything** (1 Enter = 1 API call, no agent loops; cheap
and fast is a feature). Mobile-first is a hard requirement: the killer moment is
capture-on-the-go, dump a thought, close the phone, read the reply later.
Email-grade latency is fine.

**Product bar right now:** a daily driver on the phone — chat + threads +
chapters. TTS is wanted (listen on the go) but low priority. Drive import is
minor (David moved everything to a git folder of markdown). The honest position
has always been: *"I don't know what I want; I know I need it"* — exploratory
personal tool, docs must keep that visible.

**Standing laws** (full text in `scratch/corrections.md`): reports to David are
**stories, not tables**; collapse questions before asking; instrumentation ≤16
events/human action, never log hot loops; no top bars/sticky headers; min phone
350×700; capture/test runs strictly serial; motivation before mechanics in docs.

## 2. Where the code stands

The architecture rework (the `07` plan, executed yesterday) is **done and
verified**. History is clean: **6 changelog commits on top of `main`** —
server split → persistence port → client restructure (application layer,
send-queue, gateway, ui slices) → one data model → docs → evidence harness.
Every fix is squashed into the feature it hardens; each commit has a body and
`Squashed from:` provenance.

```
server/            routes/ (one file per endpoint) · providers/gemini · lib/
                   GET /api/models = the model catalog (single source of truth)
src/ui/            chat · artifacts · graph · workspace · context   (App = ~600L shell)
src/application/   sendQueue · persistWorker · sessionMachine · snapshotLoader
src/gateway/       the ONLY fetch('/api…') site in src/
src/services/      stores/ = ProjectStore port (firestoreStore | localStore)
src/domains/       one type system: Turn / ChapterPartition (windows) /
                   SemanticEdge (open kinds) / UAD — legacy model deleted
```

**Testing methodology is three layers** (contract: `EVIDENCE_PACK.md`):

```sh
bunx tsc --noEmit && bunx vitest run      # 1–2: code gates — currently 98/98
bun run dev && node scripts/evidence.cjs   # 3: evidence pack → evidence/<ts>/
# screen summary.json failures-first, then only flagged artifacts. No manual browsing.
```

Pack history: 06-59-06 (baseline, RED 10 fails) → 07-43-46 (touch-fails 0)
→ 08-15-13 (mirror v1) → **19-57-36 (current, thresholds 12/16): GREEN —
0 fails, 0 warns, 13/13 journeys, 0 console/page/http errors.** "Red" and
"amber" have no remaining sources.

**Branch landscape:** `main` = `294de01` (threads/folders/switcher work from
nova + altair) + the 6 commits above (`3367ea2` tip). `dev-pulsar` = the
evidence-harness author; its work is merged. Other historical worktrees
(sirius/vega/done) were behind main at last check — David manages them.

## 3. Pending — the two confirmed next items

### A. Touch-target backlog (drive the evidence pack to green)

All numbers from the current pack; fix is mechanical, verify = re-run pack:

| Where | Size | Hard rule |
|---|---|---|
| Graph toolbar @768: **Pin** | 11px | ≥16px |
| Graph toolbar @768: **Connect Edge** | 13px | ≥16px |
| Graph toolbar @768: **Pull node** / **Inspect** | 12px | ≥16px |
| Mirror **"RAW PAYLOAD (LITERAL)"** toggle @768 + @1440 | 13px | ≥16px |

**Open decision (the only decision):** the **62 warns** are targets in the
16–24px band (WCAG 2.5.8 AA wants ≥24). *Fails alone → pack green.* Sweeping
to 24px touches ~60 controls and changes visual density. My lean: fix the 10
fails now, re-run the pack, then decide on the 24px sweep with fresh evidence —
some of those are likely compact-by-design chips.

**Result (2026-10-19 ~07:45): 3A done — fails 10 → 0.** All ten controls now
render ≥16px (graph toolbar lives inside the canvas zoom transform, so sizing
is 30px unscaled ≈ 17px rendered at 768 — verified post-transform; mirror
toggle 13 → 17px). New pack `evidence/2026-10-19T07-43-46`: 13/13 journeys,
0 errors, **verdict AMBER** — driven solely by warns (62 → 72: the ten fixed
controls joined the 16–24 band, by design).

**24px sweep — RESOLVED BY DAVID (2026-10-19 ~21:00): rethreshold, not redesign.**
He chose the cleaner cut: the audit now **fails <12px, warns <16px**
(project thresholds, superseding WCAG 2.5.8's 16/24 — configured in
`scripts/evidence.cjs`, contract updated in `EVIDENCE_PACK.md`). Sweep
question dissolved: under the new rule the very next pack came back
**GREEN — 0 fails, 0 warns** (`evidence/2026-10-19T19-57-36`), first green
verdict of the project. The old "72 warns" era is closed under old rules.

### B. Mirror v1 — the pillar, made whole

David: *"We'd probably should work into that soon. I've been avoiding the chat
for a while."* What exists today (`ui/context/MirrorPanel`, journey 07 green):
payload totals vs ceiling, tier distribution, notes-in-context, chapters in
send order with the full-vs-summary rule, literal raw payload.

What's missing for the mirror to actually earn "same order, same contents"
(audit-backed, no speculation):

1. **Chapter rows don't come from the compiler.** Rows re-derive tokens from
   raw content while the footer's `historyTokens` counts the *compiled* XML —
   same estimator now (one `estimateTokens`), but different inputs, so rows can
   still disagree with their own total. Fix = compiler emits a per-chapter
   breakdown in `ContextTelemetry`; mirror displays it instead of re-estimating.
2. **Why-cards are invisible in the mirror** — `nodeTiers.reason`
   (pin/ancestor/radius/culled) exists, the modal shows chips, the mirror's
   declared type omits it. "Why does the model see this?" belongs in the pillar.
3. **Honesty labels** — mirror totals are compile-time *estimates*; chat meta
   already shows `est.`/`isFallback`, mirror doesn't say so.
4. Smaller: keyPoints now flow but aren't shown per chapter; no thread identity
   in the header.

**Result (2026-10-19 ~08:00): v1 LANDED** (items 1–3 + honesty check):
compiler now emits `telemetry.chapterBreakdown` at the exact moment each
chapter's XML enters the prompt — mirror rows display *those* numbers and
*that* mode (sum = historyTokens, tolerance documented); notes rows carry
quiet non-interactive reason badges; payload total prefixed `est.`. Tests
95/95; pack 13/13 / 0 geometry fails / 0 errors; shots eyeballed (rows sum
to displayed subtotal; chips legible and quiet at 350px).

**keyPoints verdict: NOT SENT → NOT DISPLAYED** (proof: compiler closed-chapter
branch is summary-only, zero `keyPoints` refs). Showing them would be a lie;
sending them is a payload decision → queued below for David.

**Follow-ups:**
- *Notes rows self-estimate* → **LANDED** (2026-10-19 ~08:20): compiler
  `noteBreakdown`, mirror rows consume it — rows 56+46 = `notes 102` on
  screen. The suspected *"0 tok"* row was a **thumbnail-scale misread** — it
  reads 6 tok (4×-verified + runtime cross-check); no bug ever existed,
  retracted here where it was first written down.
- Smaller: keyPoints visibility in mirror (blocked on the send decision →
  queued table).

Explicitly out of scope for v1, as before: compaction presets/modes
(post-mirror experiment by design), ordering/detail fine-tuning (low priority).

## 4. Pending — queued behind the two

| Item | Note |
|---|---|
| **keyPoints: send or stop?** | compiler never sends them (summary-only chapters) yet summarize generates and stores them — a payload call for David; mirror display follows the answer |
| Over-budget degradation | compiler only `logger.warn`s ("no degradation path exists yet") — budget logic is feature work |
| `tokenCeiling` setter | ceiling is always the 32k default; no UI to change it |
| Manual-mode chip semantics | noted in old review round-2 as "later" |
| Perf when projects grow | projection/selector paths untested at real scale |
| Split corner | clicking a chapter's *first* message → empty *old* chapter (label-mandated semantics; guard if it ever bothers) |
| Drive import | re-scope later if ever — David moved to git markdown |

**Parked *with* reasons (from yesterday's review, don't re-litigate):** cancel-
chain on project switch (needs a deliberate call on cross-thread queued jobs) ·
ghost stream on thread delete (pre-existing, quota-only) · stale tab across
redeploy (inherent). **Parked *by David* — do not reopen unprompted:**
OpenRouter/free-model routing, email integration, internet deploy (standing:
first understand the attack surface), vision meta-questions (`01` §5).

## 5. Ready state

Tree clean · gates green (tsc, **98/98**) · latest pack
`evidence/2026-10-19T19-57-36/` verdict **GREEN** · server stopped.
**3A, 3B, README, package name, thresholds all done.** What remains is
decision-shaped (queued table: keyPoints, ceiling, over-budget, chips) or
parked with reasons. Update this file when the shape of "pending" changes —
dates, not intentions, are what keep it honest.
