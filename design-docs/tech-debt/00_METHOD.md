# Tech Debt Audit — Method & Index

*2026-10-30, branch `dev-orion` @ fe3fbdd. Read-only audit: no code was changed.*

## The phrase test

Every file gets ONE sentence, written for an outsider:

> **It [verb] [what] for [whom] — and nothing else.**

If one phrase, simply put, can't explain what a file does — its contract — then something is at fault. The complexity must always be internal, and the facade must be simple.

A phrase alone can be gamed ("it's the manager that manages things"), so every verdict is paired with mechanical evidence: LOC, actual cross-boundary imports, fan-in/fan-out, and who bypasses whose facade.

## The sufficiency test (the decisive one)

A phrase can be true and still be gamed. So the bar is higher:

> **The phrase, plus what it exports (signatures), must be enough for others to drive the entire code connecting to it.** That phrase + exports + signatures must be enough to understand ALL special cases and ALL special behavior.
>
> If there's special behavior or special considerations not in that description, it's a FAIL. It's gamed.

In practice, a caller must never need to read the implementation — or get burned by it — to use a module correctly. The classic gamed patterns this catches:

- **magic modes** — the signature says "decide X" but a hidden flag flips the answer (a send-gate that silently approves everything in capture mode)
- **hidden side effects** — "remove this artifact" that actually knows and scrubs five unrelated storage places by hand
- **smuggled tenants** — "types" file that also runs policy; "token counter" that also exports the whole project
- **buried caller obligations** — laws like "call hydration before saving" or "attachment provenance works like this" that exist only as mid-file comments, invisible from the signatures
- **facade ≠ contents** — the front door's exported contract differs from what's actually inside

Every verdict in `01_FILE_PHRASES.md` is the phrase verdict; `03_FINDINGS.md` applies the sufficiency lens and lists the files where the phrase passes but the contract is gamed.

## Verdict taxonomy

| verdict | meaning | smell |
|---|---|---|
| **OK** | one phrase, no "and"; the phrase IS the contract | — |
| **AND** | the phrase needs "and"/"also"/"plus" | two tenants share one address |
| **LEAK** | the phrase only makes sense if you already know other files' internals; deep imports past a facade; internal types exposed through props/returns | complexity living *outside* where it lives |
| **JARGON** | the phrase needs invented vocabulary an outsider wouldn't know | same law as UI copy: no AI-speak, no internal words |
| **???** | honestly cannot be phrased | junk drawer or god file |

## Ranking rule

Findings are ranked by **so-what**: the concrete pain each one causes or will cause ("every change to X forces a change in Y", "a bug here ships silently because nobody looks for commit policy inside a file named repo"). No fixes are proposed — that's a separate decision with David.

## Documents

| file | contents |
|---|---|
| `01_FILE_PHRASES.md` | the phrase table: all ~257 source files, slice by slice |
| `02_DEPENDENCY_MAP.md` | the mechanical import graph: fan-in/out, cross-slice edges, deep imports, direction violations |
| `03_FINDINGS.md` | deep-review findings: the 5 split-brain toil generators, 11 gamed contracts (sufficiency failures), and ranked systemic debt |
| `04_ROADMAP.md` | phased refactoring & toil-reduction plan, ordered by ROI |

## Audit coverage

| slice | files | LOC | OK | AND | LEAK | ??? | auditor |
|---|---|---|---|---|---|---|---|
| src/domains | 40 | 5,381 | 30 | 7 | 1 | 0 | deep audit |
| src/ui | 43 | 14,192 | 33 | 7 | 2 | 1 | deep audit |
| src/{application,services,data,gateway,prompts,utils,types} + App/main | 56 | ~19,000 | 40 | 11 | 5 | 0 | deep audit |
| server/ | 31 | 7,309 | 24 | 5 | 1 (+6 side-notes) | 0 | deep audit |

Headline: **~77% of files honestly pass the one-phrase test.** The codebase's disease is not spread evenly — it is concentrated in a tail of ~10 monster files (every one of them the place where recent features landed by default) and in one structural absence: **a neutral home for the shared client/server contract**.
