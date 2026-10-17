# THE CORE PHILOSOPHY (THE SOUL)

> Rewritten 2026-10-17 against David's corrected principles. Motivation lives in
> `01_requirements_and_meta.md` §3 — this file is about what we believe and what
> we've merely decided.

---

## 1. What this is

MarkBrain is a personal cognitive workbench for thinking out loud with an LLM
without losing the forest. You pour ideas in; the tool collects, organizes, and
lets you zoom between the high-level view and the deep detail. (Why it exists —
the brain-overflow problem, the cost problem, the mobile problem — is written
up honestly in the requirements doc.)

What it is *not*:

* **Not a chat assistant** that treats history as a dumb linear log.
* **Not a PKM/wiki** (Obsidian, Notion) that makes you file everything by hand.
* **Not an agentic IDE/terminal** (Antigravity, Devin) built around tool loops
  and autonomous execution.

---

## 2. What we believe (the principles)

These are the two things that actually hold the design up. Everything else is
up for grabs; these aren't — at least not without a real fight.

### Principle 1: The user controls the context.

The whole design language is **context control and context manipulation**:
giving the user easy control over what the LLM sees. We provide tools and
information — the mirror (showing what the model gets), telemetry, focus pins,
chapter cards, provenance — so the user can decide what to pull into context, but **the user is the one in control.** Not
the model, not the auto-features. If a feature ever takes that control away
from the user, it's wrong, regardless of how clever it is.

### Principle 2: Reject agentic platforms.

We are not building an agentic platform. In practice that means:

* **One turn does everything.** One user action, one API call. No multi-turn
  agent loops where the model keeps going until *it* decides to hand back.
* **Specific tools, not generic rip.** The model doesn't get bash/shell access
  and license to do whatever it wants. Any capability we expose is specific and
  deliberate.
* **The model doesn't steer the app.** It can't modify settings or go fetch
  data on its own authority. (At most it can emit a recognized request that
  the user accepts — mechanism TBD.)

This is partly taste and partly economics: agentic workflows burn money *and*
time — many calls, slow steps, "sitting an entire day and doing nothing." One
turn is cheap and fast, and cheap-and-fast is a feature, not a compromise.

*Honest note:* this is the spirit. The exact definition may need pushing later —
"we'll see if we need to push this definition." We'd rather tighten or loosen
this deliberately than drift into agentic-ness by accident.

---

## 3. What we've decided (reversible)

These are choices, not commandments. Each might be the wrong one.

* **Universal Artifact** — chat chapters and documents share one schema. This
  is *a simplification we arrived at*, possibly right, possibly wrong. It buys
  us uniform graph participation, revisions, and compression; it costs us
  schema purity. Revisitable.
* **Multi-resolution tiers (T0–T3)** — every artifact is stored at four
  fidelities: label → abstract → summary → verbatim. Pre-computed so context
  assembly is cheap. A good idea so far, but it's still an idea.
* **A graph, generically** — nodes and edges where the edge can be *any*
  relationship type. Known kinds in the code today (`parent_of`, `relates_to`,
  `refines`, `born_from`, `child_of`) are a starting set, not a closed truth.
* **A deterministic client-side compiler** that assembles the prompt from the
  graph before each call. That's an implementation choice (see
  `CONTEXT_COMPILER.md`), not doctrine — it could be replaced if something
  better shows up.

---

## 4. What we're not sure of

David's honest position, which the docs used to hide: *"I don't know what I
want. I know I need it. It's for me."* This is an exploratory personal tool.
The open design questions are listed in `01_requirements_and_meta.md` §5, and
they're genuinely open. Anyone (human or AI) writing new docs here should keep
this uncertainty visible instead of manufacturing confidence.

---

## 5. The analogy (optional): a camera lens

*This section is illustrative only. It is not the architecture, not the design
language, and not a source of terminology for new docs. The actual design
language is Principle 1: context control.*

One way to picture the tier system: LLM context works like a lens with
adjustable depth of field.

* **The focal plane** — what you're actively working on: sharp, verbatim.
* **Progressive blur** — neighboring ideas stay visible but soften with
  distance: rich summaries, then one-liners, then just labels, then out of
  frame entirely.
* **Forest view** — deliberately pulling focus out of the weeds so only the
  high-level shapes remain, which is useful when you want the model thinking
  about the canopy instead of the leaves.

That's it. The tiers do the work; the camera is just a way to remember how they
fit together. The photography metaphor is David's — used once, here, on
purpose.