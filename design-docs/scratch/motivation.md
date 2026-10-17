# Motivation — David's actual "why" (his words, 2026-10-17)

> This is the ground truth for motivation. When docs contradict this, this wins.
> David yaps a lot and needs the whole picture before action — this file exists
> so nothing gets lost in summaries.

## The core need

- David's brain overflows with ideas and concepts. He talks a lot ("I yap a lot")
  and needs to **pour it somewhere** before it evaporates.
- MarkBrain is:
  1. **The collector** of these ideas.
  2. **The auto-organizator.**
  3. **The thing that helps him visualize the whole forest** — start abstract,
     drill into depth on parts, **without losing the high-level view.**

## Why not just existing tools?

It's technically doable today with existing tools:
- **Antigravity (Google)** — artifacts, memories, and tricks get most of the way.
- **This very platform (Goose)** — he already has a markdown repo folder for
  design-concept ideas; could manage it directly here.
- Tried and rejected: **LibreChat** (does not fit), **AI Studio** (does not fit),
  **Goose** (good for agentic workflows — but what he wants *isn't* agentic).

Two real problems with the existing-tools approach:

### Problem 1: Agentic platforms are expensive overkill
- They run commands, do stuff, take many manual steps.
- Two consequences:
  1. **Context fills up with crap.**
  2. **Lots of API calls → very, very expensive.**
- (Side note: bridging to external chat — sidecar/runner/daemon to Google Chat
  or Matrix/Element — he built this at work, it works, but it's terribly
  expensive: each message ≈ 3 calls.)

### Problem 2: No native mobile support
- Desktop-agent platforms are "windows into a computer," highly complex.
- Running them from a phone, or phone→computer tethering: outside their use case.
- **Mobile capture is the killer moment:** on the go, idea appears → open app →
  dump the thought ASAP before forgetting → maybe send to chat → **close the
  phone immediately**, keep walking → check 10 minutes later for the reply.
- **Latency tolerance is high.** This is organizing thoughts, not transactional.
  In LibreChat tests he waited minutes — even 10 minutes, sitting at a computer —
  and it was fine. He writes *a lot* of thoughts in one message.

## The experiment space (once you control context)

Nobody does these; worth experimenting:
- Notes/topics are **connected in a graph** — known relationships exist.
- Pulling **related stuff or summaries** into context on demand.
- **Embeddings / vector DBs** to find related docs.
- **Full-text search engines** by keywords.
- "A plethora of stuff to be examined."

## The three modes (main objective, approximate)

- **Mode 1 — Chat → extract → repeat.** User talks to LLM, discusses ideas.
  LLM extracts the conversation as an artifact/doc and stores it. User moves to
  a different idea or refines/deepens the previous one. Extract into new doc.
  Rinse and repeat.
- **Mode 2 — Pull related context.** User asks about something / starts a
  discussion. LLM notices it relates to something already discussed and pulls
  it in.
- **Mode 3 — Organize from above.** View the coarse concept from a bird's eye
  and see if it makes sense overall.

## Honesty flag (important)

> "I have to be honest. I don't know what I want. I know I need it. It's for me."

- This is a **personal tool, exploratory stage**. Docs written with finished-
  doctrine confidence are part of the AI slop problem.
- "More or less" — the modes above are a sketch, not a spec.

## Open tensions — RESOLVED by David (2026-10-17 evening)

David's meta-instruction for these: **focus on intent, acceptability, overall
vision — details come later as we cover the ground. Understand the spirit, not
the functionality.**

### Mode 2 → resolved: user-knobbed deterministic pull
- It's a **vector DB pulling context automatically** — not the LLM deciding.
- User control = **enable/disable the feature, configure how much it pulls**
  (more/less context automatically). Control lives in app settings, not in the
  LLM's hands.
- The LLM **cannot modify app settings or request data on its own.** Spirit-level
  exception: the LLM *could* output a request in a specific format the app
  recognizes, which the user then accepts — either explicit accept, or
  auto-accept by default **with the ability to always undo.** (Exact mechanism:
  TBD. Don't spec it yet.)

### Auto-organizator → resolved as: plan → execute → review, not full-auto
- "Totally undefined at the moment" — the problem I described is real.
- Current *manual* workflow today: dump artifacts at LLM chats → have them
  classify until I like the classification → ask them to bucket each one →
  then redo the actual organizing myself manually (folders, or a database, or
  replacing markdown with YAML headers + tags). Lots of manual stuff.
- The spirit is **not "full auto."** It's: *I get a discussion → I agree on a
  plan → I let the LLM execute the plan → if I don't like the result, either
  roll back that step, or roll forward with follow-up changes.*

### Cost → resolved, and bigger than money: it's time economics too
- Economics of **money** (many calls) *and* **time** (agentic latency).
- Very good cheap models exist but they're slow, or low-availability, and fail.
  In an agentic workflow "you could be sitting an entire day and doing nothing."
  In a non-agentic chat space: **it doesn't matter.**
- **Parallel conversations — I romanticized it; David corrected me.** Real position:
  - Multi-chat / multi-thread per project = **probably something desired**, for
    topic-specific organization "or whatever we want to organize." Currently the
    app is single chat per project.
  - But **"it's not that big of a deal."** David typically works in a single
    chat only. "One chat works way too well" — **continuity matters.** His brain
    melts at work where he has 20 chats to jump between and feed. Not a core
    pillar; a nice-to-have.
  - *Could* have additional benefits if models are too slow/unreliable — or
    "to make even worse models, cheaper ones work properly."
  - **The real point under it: "To make it run as cheap as possible!"**
- **Cost stretch idea (record, explore later): free-model routing.** OpenRouter
  always has several free models (they rotate). Could be **zero cost** if we
  route smartly — auto-retry, etc. Slow replies fine: **"it's more like Email."**
- **Email integration — "so stupid it's good," note only, don't deepen now.**
  What if ~90% of this runs over email? Send ideas, read and reply; email on
  phones typically has local autosave; low-frequency/low-speed transfer matches
  the vibe. "Might be a shortcut/revolution, or a huge waste of thinking time.
  No idea." → parked in pending.md as explore-later.

### The mirror principle (David, 2026-10-17 22:16 — his core UX insight)

> "The chat interface must be almost 1:1 with whatever the tool will send you.
> Same order, same contents."

- The LLM sees input tokens as turns (system/user/assistant). When something
  is compacted, *the model* gets a "User Turn" saying there's a summary of
  stuff that no longer exists.
- **But the human sees "everything"** — no compaction visible, no view of what
  the tool actually sends. "I don't see what you see."
- The ask: if we summarize, **present it summarized to the user the same way**;
  show tokens per chapter; show where the expensive part is; (later, lower
  priority) let the user control ordering / detail level / injection fine-tuning.
- Core of it, his words: **"The majority is just — show me what the LLM will
  see."** This is Principle 1 (user controls context) made *visible*; you can't
  control what you can't see.
- **Focus modes, resolved (22:24):** modes are not a rival feature — they're
  **presets over the mirror**: "a sort of autopilot for compaction, an
  auto-compaction rule / config." One simple setting = what resolution each
  chapter/artifact enters the payload at; manual/overrides possibly on top.
  Exact shape unclear — **never seen in any app; must be experimented with.**

### Graph → gut answer: **both / hybrid** (hand-authored + inferred)

### Mobile → resolved: mobile-first, single webapp, no exceptions
- **Top problem.** David has told several AIs: write for Mobile UX directly.
  Doesn't care if the UI looks a bit empty on desktop. The UI must work on phone.
- Is the React app the mobile experience? **YES — only a mobile app, as a
  webapp**, loadable from the computer too.
- Specific battle scar: told AI Studio countless times to remove the top bar,
  remove sticky stuff, work only with a sidebar — a few messages later it puts
  one back (15–20px). Then mobile view looks crap/unusable and vertical space
  is wasted. **Top bars / sticky headers are banned** unless David okays them.