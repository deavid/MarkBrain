# VIBECODED — the provenance of this repository

**Every line of code, test, comment, commit message and design doc in this repo
was written by AI agents, and every review of them was done by AI agents. No
human has read most of this code. That is the arrangement, not an accident, and
this file exists so you can calibrate what you're looking at.**

## Who does what

| Role | Who | What it means concretely |
|---|---|---|
| Direction, taste, product judgment | David (the human) | Says what to build, what's wrong, what's over the top; runs the app and reacts to it; sets the standing laws ("never push", "no secrets in git"); approves with `LGTM`. |
| Code, tests, docs, commits | AI agents | Everything tracked in git. No human types code into this repo, none reformats it, none fixes it by hand. |
| Review | AI agents, in separate passes | A second agent (sometimes a deliberately more expensive model) reads the diff, argues with it, and writes a plan the first one executes. Plus the mechanical gates below. |
| Diffs and code review by a human | Nobody | David does not read the code, the diffs or the pull requests. He inspects *behavior* — the running app and the images/evidence it produces. |

There is no human editor between the machine and `git commit`. If you find
something stupid here, an agent wrote it, another agent almost certainly
approved it, and no person has ever seen it.

## How it actually gets made

- Parallel agents work in **separate git worktrees, one worktree + one branch
  per agent** (they're named after stars: `-altair`, `-vega`, `-sirius`, …). An
  agent may write git history only in its own worktree/branch; nobody touches
  another agent's branch. Work arrives as commits on that branch — often
  squashed — never as a shared working copy.
- Direction arrives as human prose ("the colours are over the top"), not as
  tickets. Agents translate it into code and into the design docs.
- The **design docs are the spec** (`design-docs/`). They are agent-written too,
  which is why the repo keeps correction ledgers: `design-docs/scratch/`
  records where the human overruled the agents, and `changelog.md` records the
  incidents (a secret committed once, a history rewrite, a plan that got
  rewritten from scratch).

## What you can and cannot trust

**Covered by a machine, cheaply and every time** — this is the only strong
evidence in the repo:

| Gate | Command | Covers |
|---|---|---|
| Types | `npm run lint` (`tsc --noEmit`) | compile-level breakage |
| Logic | `npm test` (`vitest`, `src/tests/`) | domain rules, codecs, planners, journeys — 151 tests, all agent-authored |
| Behavior in a real browser | `node scripts/evidence.cjs` | a headless journey suite + geometry/occlusion audit that writes `evidence/<ts>/` for a human or an LLM to screen |

**Not covered by anything:**

- That the code is *good*, idiomatic, or the right design. No human has judged
  that, and agents are biased toward producing plausible-looking structure.
- That a review happened, or that it was independent. Reviews are real, but
  they are **same-family reviews**: agents trained on the same corpora writing
  and grading each other agree on the same mistakes. Correlated blind spots
  survive review.
- That the tests prove what the comments say they prove. Tests are written by
  the same entity that wrote the code, so a shared misunderstanding is invisible
  to both. Where a test and a comment disagree, trust the test and distrust both.
- That any comment, commit message, changelog entry or design doc is true *now*.
  They are agent prose, written confidently, and they rot. Several documented
  behaviours were already found to be false in this repo's own passes.
- Security, privacy, or fitness for any purpose. Treat this as an experiment:
  don't put real credentials in it, don't expose it, don't run it on input you
  care about.

## If you are an agent about to work here

1. Read the docs before the code: `design-docs/` is the spec,
   `design-docs/AGENT_RUNBOOK.md` is how to drive the app headless, and
   `design-docs/scratch/COOPERATION.md` is the working agreement.
2. Run all three gates before claiming anything works, and say which ones you
   ran. Do not describe an unrun gate as passing.
3. Write comments only where the code can't speak (see
   `design-docs/13_COMMENT_POLICY.md`), and never write a comment you would not
   defend to a reviewer who knows the file better than you.
4. Stay inside your own worktree and branch. No pushes, no merges, no history
   edits anywhere else — those are the human's calls, in every case.
5. When a decision is irreversible or needs taste (deleting data, changing
   dependency policy, secrets, anything a user can never undo), say so and ask.
   Do not decide it on the human's behalf because the answer looks obvious.
6. When you cannot verify something, write down that you could not. The one
   thing this repo cannot afford is a confident paragraph with nothing behind
   it — that is exactly how the design docs got "pillars" nobody asked for.

## If you are a human looking at this repo

Judge it by running it and reading the tests. `INSTALL.md` gets you from a fresh
clone to a running app on Node in three commands; `npm run lint && npm test` is
the cheapest honest signal about the state of the code; `design-docs/` will tell
you what the thing is supposed to be, in the voice of the machines that built
it. `git log` will tell you what changed and why, also in that voice.

If you need software that a human has read line by line, this is not that
software. If you want to see how far agents get on a real product when a human
insists on direction and taste but refuses to touch the code — that's what this
is.

---

*Written by an agent (Goose), 2026-10-21, at David's request. Which is the
joke, and also the point.*
