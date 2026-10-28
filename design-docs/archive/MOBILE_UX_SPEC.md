# MOBILE UX SPEC (`MOBILE_UX_SPEC.md`)

> **TENTATIVE DRAFT — not decided.** Revision 4, 2026-10-17 22:24 — the
> mirror-principle insight plus the modes-as-presets resolution folded in.
> David LGTM'd the direction ("all you said, LGTM") and will read this final
> version. **LGTM: verbal on r3+direction; final stamp after he reads r4.**

---

## 1. Prime directive

**The phone is the primary device. Desktop is a courtesy.**

Not a responsive checkbox — the whole point of the form factor. The tool has
to work for the guy walking down the street with one thought he's about to
lose. A decision that makes the phone better and desktop a little emptier:
take it, every time. Sparse desktop = accepted behavior. Cramped phone =
product failure. The desktop can live.

## 2. The capture flow — the sacred path

The interaction the entire app exists to protect:

1. Idea hits mid-walk. You're already slightly annoyed, because ideas always
   hit mid-walk.
2. Open the app — *fast*. No splash theater, no onboarding, no "welcome back."
3. Cursor already in the composer. Type the thought — paragraph, page,
   whatever the brain dumped. Send.
4. **Close the phone.** The model hasn't answered; that's completely fine.
   The message is durable; the reply waits like email.
5. Later — 10 minutes, an hour — open it, read, continue or branch.

What this forces:

- **Send persists before any model roundtrip completes.** UI never blocks on
  the LLM to confirm "your thought is saved." Bad network, bad model day —
  the thought is still safe. That's the promise.
- Leaving mid-response is normal. Return and the state is honest about how
  far things got.
- Nothing rides this path: no dialogs, no tooltips, no auto-expanding panels,
  no "are you sure." Anything delaying type-by-one-tap is a bug.
- Slow replies are fine — email-grade latency. "Thinking…" is information,
  not failure.

## 3. Chrome: what must NOT exist

David has re-laid-down these rules 15–20 times against AI tools that keep
re-adding them because "apps have headers." No tool gets to claim ignorance:

- ❌ **No top app bars.**
- ❌ **No sticky/fixed headers.**
- ❌ **No sticky footers.**
- ❌ **No tab bars** eating vertical space.
- ✅ **One sidebar behind a visible button — the hamburger, top-left.**
  *Settled: decided, insisted, fought for.* Not a gesture, not an edge-swipe:
  a button you can see. (`Sidebar.tsx` does this today.)

Vertical space on a phone is the scarcest resource in the product. Chrome
steals from composer and timeline, and composer + timeline *are* the product.

## 4. The screens that actually exist (verified inventory)

- **Chat canvas — the one permanent view.** Single column: active
  conversation at the bottom where thumbs live; chapters above. You
  naturally scroll the list of chapters — that's navigation, not compaction.
  (`ChatView.tsx` real.)
- **Artifact viewing — modal, full stop.** `ArtifactDetailModal.tsx` opens
  with details/revisions/pin. The bottom-sheet idea from the refactor plan:
  **rejected by David — "No. I don't. End of the topic."** Don't mention
  sheets again.
- **Sidebar** — real one: inline accordions in document flow (code avoids
  clipping containers), project structure / tree / settings.
- **Telemetry shipped:** 5px right-edge heat strip + saturation orb
  (`04-presentation/telemetry/`).
- **Chapter segmentation — logic exists; gesture UI does not.** Domain
  (`02-chapter-segmentation`) has slicing/merging logic. The glowing drag
  handle from the plan **confirmed nonexistent** by David. There may be one
  or two "split at point X"-ish controls; his read: *"It works? I don't
  think so."* Boundary editing gets its own treatment in §6.

## 5. Context visibility: show me what the LLM will see

*(This replaces the old §5 "scattered ideas" list. The HUD-as-instrument-
cluster framing was AI-vibed; what David actually wants is simpler and
sharper.)*

The argument, in his structure:

An AI has a context window. Input tokens — that's text, arranged as turns:
system turn, user turn, assistant turn. When we compact something, **what
the model gets** is roughly a "User Turn" saying *here's a summary of stuff
that no longer exists.* Meanwhile **what the user sees in the chat is
"everything"** — no compaction visible, no trace of what the tool actually
assembled. So the human and the model are looking at two different
conversations, and the human has no way to inspect the model's.

The ask — mostly one sentence:

> **The chat interface must be almost 1:1 with whatever the tool will send
> the LLM. Same order, same contents.**

Concretely:

- If something is summarized, **show it summarized to me too** — in the same
  place, same order it will be sent.
- **Show token counts per chapter.** Show me where the expensive part is.
- (Lower priority, acknowledged as feature-requests, but wanted):
  control the ordering; control the detail level; fine-tune what gets
  injected. "I know how it works, I just need the interface to be able to
  inject stuff properly."
- The core of it, not negotiable in spirit: **"The majority is just — show me
  what the LLM will see."**

Why this matters as principle, not feature: Principle 1 says the user
controls the context. **You cannot control what you cannot see.** The mirror
is Principle 1 with the lights on.

Related bits, honest status:

- **The focus modes, finally understood:** they are not a separate feature
  competing with the mirror — they're **presets over it.** A sort of autopilot
  for compaction: an auto-compaction rule/config where *one simple setting*
  decides at what resolution each chapter and each artifact enters the single
  compiled payload (sharp / summarized / label-only / out). On top of that,
  manual adjustment — or overrides, or something; exact shape not settled.
  *"We never saw anything similar in any app so can't tell what would work
  best"* → this wants experimentation, not specification. See §7.
- **Tap the orb → small popup with interesting stats.** David: "that's nice
  and I would use it." First brick of the mirror UI — cheap, wanted, no
  redesign needed.
- **The old "Context HUD" (aperture meter, tier counts everywhere):** marked
  **AI-vibed** until further notice. May grow out of the orb popup; not a
  committed surface.
- The per-tier telemetry *data* mostly exists (`ContextTelemetry` shape); the
  mirror is mostly a rendering contract, not new architecture.

## 6. Decisions & designs already on the table (David, 2026-10-17)

- **Chapter cards compact manually.** Explicit control, no scroll-depth
  mystery. (And: scrolling ≠ compaction — scroll is navigation; compaction
  means a chapter shows its summary instead of its turns.)
- **No notification story.** No push, no badge. The capture flow must not
  yank you back. The app's politeness is leaving you alone.
- **Minimum phone: 350 × 700 px.** Below that: broken. Designs must survive
  a genuinely small screen.
- **No bottom sheet.** Modal it is. Topic closed.
- **Boundary toolkit — KISS design, its own future file/topic.** The full
  feature is "very complicated… we will need to open a full topic, full file
  just for it." Interim direction (his, deliberately stupid-simple): only
  **three operations**, mostly about the last 1–2 chapters, activated from a
  **dropdown of sorts into a mode** that swaps the UI for the toolkit
  (doesn't need to feel fast or natural):
  1. **Move the seam one turn up / one turn down** — two buttons, hit
     repeatedly, seam between the last two chapters.
  2. **Split the last chapter in two.**
  3. **Merge the last two chapters into one.**
  That's it. Glowing multi-message drag lines are dead until this simple
  thing proves insufficient.
- **Sidebar trigger: top-left hamburger — settled** (fought for, kept).
  Thumb-reach of top-left noted as a *good observation for later*, not now.
  Space analysis (his): top-left floats and content flows below ≈ zero space
  lost, works on any screen; bottom-left would need a sticky bottom bar ≈
  20px = unacceptable; beside the composer works *for that screen only* and
  goes weird on a graph screen. → placement questions for non-phone widths or
  future screens only; phone chat baseline is locked.
- **Sidebar open behavior: overlay on phone, push on desktop** — switch by
  screen width. Alternative he floated: overlay by default **plus a pin
  icon** — pinned means push (content squeezed aside). Pin variant is
  un-decided; the overlay/push-by-width rule is the stated preference.
- **Focus-mode toggles in the sidebar, never a top bar.** He's seen a
  sidebar toggle "in the past." ⚠️ But see §7 — the modes themselves are in
  question, not just their placement.

## 7. Focus modes — reconceived as presets over the mirror

The earlier framing ("do the modes work? where's the button?") was the wrong
question. Corrected understanding (David + Goose, 2026-10-17 22:24):

- **What they are (gist, not spec):** auto-compaction presets — an
  autopilot rule/config layered on the mirror. One simple setting says what
  resolution each chapter and each artifact goes into the payload; the
  individual controls (manual tweaks, overrides — "no idea" which exactly)
  sit underneath or on top. Autofocus/forest/etc., *if they survive*, are
  just named presets of that setting.
- **Honesty about the current code:** whatever's in `03-optical-compiler`
  today does **not work** — "empty husk shell," vibecoded from poorly
  understood stuff. Treat it as evidence of the idea's neighborhood, not as a
  feature description.
- **Process:** *never seen anything like it in any app* → **experiment.**
  Build the mirror first (it's the foundation the presets would ride on),
  then try preset shapes against real usage. Specification before experiment
  would be inventing again.
- **Placement if/when it exists:** sidebar, never the top bar (the AI keeps
  trying; it keeps dying; §3 already bans the habitat).

## 8. Performance & tolerance

Capture works on bad networks (local draft/save first — email clients do
this). Status honest (`StreamStatusPayload` exists). Long messages normal —
this user writes pages, not quips. No spinner purgatory blocking reading;
you can always scroll what already arrived while the rest cooks.

## 9. Still open (needs discussion or experiment, not answers yet)

1. **The preset shape** — what exactly *is* the auto-compaction setting, what
   granularity (per-chapter? per-artifact? per-project defaults?), which
   overrides? Unspecified by design — **experiment after the mirror exists.**
   (Supersedes the old "do modes mean anything" question — they mean
   *this*.)
2. **Overlay + pin variant** for the sidebar — adopt, or stick with
   width-based overlay/push?
3. **Where the boundary toolkit's dropdown lives** when §6's design gets its
   own file (which it will).
4. **Sidebar trigger on future non-chat screens** (graph view etc.) —
   unresolved by design; phone chat baseline is settled.
5. **Mirror scope for v1** — full order+contents parity vs. start with
   tokens-per-chapter + summaries-visible (the cheap 80%)? Low priority
   anyway; don't let it block anything.

---

**LGTM status: ✅ APPROVED — r4 read and approved by David 2026-10-17 22:25.
File closed.** Future changes = revision 5+ with a fresh look, not silent edits.

*Revision history: r1 dry invented list (rejected); r2 verified inventory +
argued questions (much better); r3 answers folded in, mirror as §5, modes
flagged as husks, boundary toolkit KISS; **r4 = modes reconceived as presets
over the mirror, experiment-over-spec marked — LGTM'd, closed.***