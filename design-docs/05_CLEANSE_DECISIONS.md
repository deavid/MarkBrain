# CLEANSE DECISIONS (`05_CLEANSE_DECISIONS.md`)

> **Append-only decision ledger.** `04_CRITICAL_FINDINGS.md` is the frozen
> first-pass snapshot; when a finding gets resolved, overridden, or acted on,
> the decision lands HERE. Don't rewrite old entries — append with dates.
> (Why a new file: David, 2026-10-18 — "editing files over and over is hard
> for AI Agents too.")

---

## 2026-10-18 — decision batch (David's answers to findings §4)

### Product identity — CLOSED
- **It's a brain collector.** David, verbatim: *"What else is there?? What's
  the option B?"* — there is no option B. The "principal systems architect /
  token topologies / design-systems" soul in the code is fake-soul and dies.
  Findings §0 confirmed, not overturned.
- **Daily driver as designed = chat + chapters.** Context: David has never
  actually used the app (*"Never worked to use it"*). So the core loop is
  chat+chapters **as it will work after the cleanse**, not as evidence of what
  the current app got right by usage.

### Odd-one-out features — triaged (supersedes findings §1 leanings)
| Feature | Decision | Nuance |
|---|---|---|
| **TTS** | **KEEP — low priority** | David would like hearing replies on the go. Earlier "kill it" lean was wrong on *desire*, not on *priority*. Don't polish now; don't delete either. (Also still fix the log's lying "Kokoro-82M" name when touched.) |
| **Google Drive/Docs import** | **KEEP — it's wanted, currently broken** | David did request it. The real need: his artifacts **live in Google Docs as raw formatted docs — not YAML**. So the honest import target is *"raw Docs → artifact"*, not today's YAML-shaped flow. The current implementation is a wanted feature that doesn't work — different problem than "vibecoded extra". Re-scope later; not cleanse-phase work. |
| **SpatialGraph** | **KEEP — low priority** | Never requested (first vibecoding session heard "nodes and edges" and built it), but David: *"it's cool"*. Keep alive, no investment, no feeding. Its role as the *only* hand-authoring surface for edges stays an open design question (mobile?). |

### Tautological tests — CLOSED (actioned same day)
- **DELETE.** Journeys 5, 6, 7, 9 removed from `src/tests/user-journeys.test.ts`
  (7 tests). Journey 3 kept but renamed to what it actually tests (honesty
  fix — it was misnamed, not tautological).
- Remaining suite: Journeys 1, 2, 3 (renamed), 4, 8 = **6 tests**. J2 (parser)
  and J4 (chapter seal) are the load-bearing ones.

### Instrumentation contract — A LAW (David, 2026-10-18)
Verbatim: *"1 per human action is guideline, but a MAX of 16 per human action
is hard rule. And if it's hard to do it, then do NOT add the logging. Don't
log hot loops."*

- **1 event per human action = guideline** (aspirational; aim for it).
- **≤ 16 events per human action = HARD RULE.** Cannot be negotiated away.
- **If honoring the rule is hard → don't add the logging at all.**
- **Never log hot loops** — per-chunk, per-iteration, per-tick paths.
  (Today's `logger.action` inside `Timeline.updateTurn`, called from
  `onChunk`, violates both the cap and the hot-loop ban. Must go.)
- Corollaries from findings §6 still standing: `action` = human gestures only;
  every silent fallback ≥ WARN; user-visible failure = ERROR; `compile()` gets
  one `info` per send.

### Findings-doc structure — CLOSED
- `04_CRITICAL_FINDINGS.md` = **frozen snapshot** of the first review pass.
  Stop editing it except for pointer lines.
- `05_CLEANSE_DECISIONS.md` (this file) = **living, append-only**.
- `scratch/` = session state, unchanged role.

### Cleanse mode — DECIDED (David delegated; I decided)
**Purge-in-place on the domain skeleton.** `server.ts` and `types/index.ts`
are **radioactive**: no new features written into them; their content gets
deleted or migrated into `src/domains/` as touched.

Why not rebuild-on-skeleton:
1. The domain layer is the healthy part (findings §2) — it *is* the skeleton.
2. Rebuilding UI throws away the chat+chapters surface (the only thing David
   wants) to re-litigate layout decisions already LGTM'd in MOBILE_UX_SPEC.
3. The dual-model problem (`types/index.ts` ↔ domains) is real but is a
   **migration**, not a reason to delete working chapter/streaming code.
4. Purge-in-place lets each phase ship something observable — good for a
   project that has only ever been vibecoded.

Caveat (honest): purge-in-place cannot dodge the data-model fight forever.
It's Phase 3 in the plan below, and the mirror (Phase 4) must wait for it.

### Phase plan (proposed — needs David's greenlight before Phase 1 starts)
1. **Lie removal.** System instruction + placeholders + model copy + hardcoded
   `boundaryRules` speak the brain-collector product. Kill dead code found in
   findings (zustand, unused extractor, dead endpoints/fields). Tautologies
   already deleted. No new features.
2. **Instrumentation law pass.** Kill per-chunk action logs; warn every
   fallback in findings §6.2; error through `logger` not `console`; fix
   `LogCategory` closed enum; one `info` per send for `compile()` + turn
   lifecycle. Verify ≤16 events per send by manual trace.
3. **Data-model fight.** Collapse `src/types/index.ts` into the domains (or
   the reverse — decide at that table with the code in front of us); `App.tsx`
   stops being a translator-god; `server.ts`'s twin parser/prompt/persona
   dies or moves down.
4. **Mirror v1** on the single model — per `MOBILE_UX_SPEC.md` §5, David's
   "big one". Then compaction presets ride on it later.

*(later decisions appended below)*
