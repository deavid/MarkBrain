# 17 — Failed-request handling: inventory FOR STRIPPING

> **STATUS: teardown map, not a design.**
> David, 2026-10-25, after seeing a failed request stored as
> `<turn role="assistant">Gemini: API key not valid…</turn>`:
>
> *"ASSISTANT SAID: 'Gemini: API key not valid…' LLM will think: uh, now I'm the
> machine. … Do you freaking think this is normal? … We are going to strip it
> all out. We design from scratch. Don't patch - strip"*
>
> This file exists so the strip is complete and nothing is forgotten. The
> from-scratch design is a SEPARATE, later step, designed WITH David.

---

## 1. The lie, end to end (what happens today)

1. A request fails (wrong key → 401, quota, network, whatever).
2. The failure is written **into the assistant turn itself** — `content` becomes
   the error text (`Gemini: API key not valid…` / `The request failed — no
   reply came back.`), `meta.streamState = 'error'`.
3. The turn is a normal timeline turn: **persisted** with the project, **counted
   in the thread**, rendered in the feed, **sent back to the LLM as assistant
   content** on the next message.
4. To the user it reads as a permanent chat record (two dead-end messages, two
   error stains). To the model it reads as **something it said** — it will
   apologize for API keys, offer help with them, or think its own prior turn
   mentioned an API key.

An error is not a message. It must never occupy a turn.

## 2. Where the failure text poisons things

| Path | Where | Evidence |
|---|---|---|
| **Chat payload to the LLM** | `03-optical-compiler/index.ts:216-219` — `chapterXml` serializes **every** turn: `<turn role="${t.role}">${content}</turn>`, no filter | David's screenshot of the raw payload |
| **Persistence** | `persistWorker.ts:82-84` — `threadRegistry.compose(timeline.getTurns(), …)` snapshots every turn; error text is stored with the project forever | "permanently logged and stored, a stain" |
| **Thread titles** | `06-chat-threads/types.ts:139` `sampleTurnsForTitle` filters only empty strings — error text can ride into the auto-title call | code read |
| **Chapter summaries** | `createChapterHandlers.ts:133-137` — `summarizeChapter({ messages: turns.map(...) })` sends raw turns, error text included | code read |
| **Exports** | Backup/export serializes turns → error text ships into JSON/Markdown exports | by construction |

## 3. Code inventory (the strip list)

### A. Error production (provider + server + client transport)

| Piece | File:line | What it does |
|---|---|---|
| Gemini adapter throw | `src/gateway/providers/gemini.ts:100-108` | `!res.ok` → `throw new Error('Gemini: …')` inside `sseStreamResponse` |
| SSE wrapper catch | `src/gateway/providers/types.ts:106-112` | catches produce() throw → emits `status{state:'error', message}` inside an HTTP-200 stream, then closes — **no `error` event, no HTTP error status** |
| Server stream errors | `server/routes/chat.ts:100,131,154,219,227` (`status`), `:275` (`sendSSE('error', …)`) | same SSE vocabulary, proxy path |
| Client chat transport | `src/gateway/api.ts:117-139` `chatStream` | direct (key) vs `/api/chat/stream` (proxy); **ignores abort signal on the direct path** (adjacent bug) |
| Stream reader | `src/domains/03-stream-protocol/index.ts` `executeStreamingTurn` | parses SSE; 2026-10-25 braces added here: collects `status{error}` / `error` events into `streamError`, throws after the loop; empty end-of-stream throws `The stream ended without a reply`; abort path returns a stub result (kept, separate contract) |

### B. Error → chat turn (the write path — the core of the lie)

All in `src/application/sendQueue.ts` `executeTurn`:

| Piece | Line | What it does |
|---|---|---|
| Stub assistant turn | ~321 | every send starts an assistant turn (content `''`, `streamState:'connecting'`) — the failure **fills this turn in** |
| `failedEmpty` write | ~501-528 | empty result → `content: 'The request failed — no reply came back.'`, `streamState:'error'`, `lastOutcome:'error'` |
| catch write | ~577-585 | thrown failure → `content: streamedContent \|\| err.message` (e.g. `Gemini: API key not valid…`), `streamState:'error'`, `lastOutcome:'error'` |
| interrupt write | ~548-561 | `streamState:'interrupted'`, content = partial — **same family**, same question (is a partial+interrupt a turn?) |
| retitle filter | 257-258 | the ONLY place that filters error/interrupted turns — proves the turns are otherwise indistinguishable from replies |

Historical strings (already deleted, for the record): `'No reply came back. Try
again.'` (the original ghost reply), `'Error communicating with reasoning
engine. Please try again.'`. Current strings to delete with the strip: `'The
request failed — no reply came back.'`, and the practice of putting `err.message`
into turn content.

### C. Persistence of the stain

- `src/domains/01-dialogue-timeline/types.ts:11` — `TurnMeta.streamState?: string`
  (the only marker distinguishing a stain from a reply — a string on meta)
- `src/application/persistWorker.ts:82-84` — full turn list into the snapshot
- `src/domains/01-dialogue-timeline/DialogueTimelineDomain.ts` `appendTurn` /
  `updateTurn` — no error concept; role is `'user' | 'assistant' | 'system'`

### D. LLM payload

- `src/domains/03-optical-compiler/index.ts:216-219` — `chapterXml` turns block
  (`withTurns = cutIncludes(granularity, 'body')`), no state filter
- `src/domains/06-chat-threads/types.ts:139` — `sampleTurnsForTitle` (titles)
- `src/ui/chat/createChapterHandlers.ts:133-137` — chapter summarize messages

### E. UI surfaces of the error state

| Piece | File:line | What it does |
|---|---|---|
| Error card | `src/ui/chat/ChatView.tsx:1093-1128` (early return) | red-bordered card replacing the reply widget: "REQUEST FAILED" + reason + "Attempted with <model>" — 2026-10-25 round 3; **still a turn in the feed** |
| Retry banner | `ChatView.tsx:1497` + `showRetry` 576-583 | "Generation failed — the last reply didn't finish." + Retry button (driven by `threadRuntime`) |
| Token-row guards | `ChatView.tsx:1329,1340` | hides token/latency numbers on error turns |
| In-bubble chip (round 2, deleted in round 3) | — | for the record: red chip inside the reply bubble was tried and rejected |
| Interrupted chip | `ChatView.tsx:1364` | amber "RESPONSE INTERRUPTED" chip **inside the reply bubble** — same design family, same question |
| Downgraded chip | `ChatView.tsx:1372-1381` | amber chip on a reply ("DOWNGRADED FROM …") — state painted onto conversation content, same family |

### F. Thread-level outcome state

- `src/domains/06-chat-threads/types.ts:55` — `lastOutcome: 'ok' | 'error' | 'interrupted'` (persisted on the thread)
- `types.ts:160-161` — derives `ThreadRuntime` `'error'` / `'interrupted'`
- `src/ui/chat/useThreadUi.ts:38` — `threadRuntimes` for ChatView/Sidebar/ThreadSwitcher
- `Sidebar.tsx:277`, `ThreadSwitcher.tsx:127` — runtime dots on thread rows

### G. Adjacent error surfaces — NOT this family (boundary, don't strip blindly)

These show failures **outside** the conversation and do not create turns. They
are the existing proof that a non-turn error surface is possible in this app:

- `src/utils/criticalNotifications.ts` + `src/ui/system/CriticalNotifications.tsx` —
  `notifyCritical`, role=alert banner with TTL (save/load failures, `persistWorker.ts:98,108`,
  `snapshotLoader.ts:81`)
- Search index failure panel — `ArtifactsLibraryView` `data-testid="index-failures"`
- Quota explanations — `server/routes/searchIndex.ts` `quotaExplanation` (structured
  errors, human wording)
- `src/tests/stream-failure-propagation.test.ts` — pins the CURRENT (to-be-stripped)
  behavior + ghost-copy bans; rewrite with the new design, keep the bans

## 4. What the strip deletes (checklist for the teardown PR)

- [ ] `sendQueue` error/interrupt/failedEmpty writes of error text into `content` —
      no failure ever becomes `content` of a turn
- [ ] `sampleTurnsForTitle` / summarize / compiler must not need error filters
      because **error state is not in the turn list at all**
- [ ] `TurnMeta.streamState` as a carrier of failure (and likely `lastOutcome`'s
      `'error'` as it exists today)
- [ ] ChatView error card + retry banner + token guards + (decide) interrupted chip
      and downgraded chip — all as "conversation furniture"
- [ ] `stream-failure-propagation.test.ts` behavior pins (keep the copy bans)

## 5. Design direction — ADOPTED by David 2026-10-25 (the root answer)

> *"Think that all turns are pairs. User asks, LLM replies. … I send an ask,
> that gets queued, and once I get a reply, then it gets paired and out to
> regular chat storage. If I didn't get a reply, it's not chat. It's a draft
> pending."*

- **Chat storage = complete pairs only.** Ask+reply. An unpaired ask never
  enters the timeline, therefore never persistence, titles, summaries,
  exports, or the LLM payload. One boundary replaces all the filters.
- **Commit point = reply arrival**, not send time. (Today's stub-turn-at-send
  is the bug's origin.)
- **Failures live in the queue** as unpaired asks — state `queued | sending |
  failed`. Retry or Discard from the queue. The queue IS the offline send
  queue (one message at a time) — same object, same store.
- **The queue is drafts, not history:** per-device pending work (write-queue
  isolation). UI: queue strip above the composer (Retry / Discard), never
  bubbles in the feed.

### Edges — RESOLVED by David 2026-10-25

1. **Stop mid-stream / provider failure / partial text — one rule:** an ask
   *"never leaves the draft area until it finishes successfully."* The draft
   keeps whatever partial reply arrived. Three exits only: **store as-is**
   (user decides the partial becomes the reply — the pair commits), **retry**,
   or **discard**. Nothing is auto-committed, ever.
2. **Retry = resend the ask** (clean resend of the ask text); the partial is
   kept in the draft for the store-as-is option. *(Interpretation — correct me
   if retry should instead continue from the partial.)*
3. **Queue is strict FIFO, one message at a time:** *"it will attempt the
   first message on queue first, in order until it reaches the new one. New
   one enters queue last when trying to send."* New sends append to the tail;
   attempts walk the queue from the head. Pair order = send order.

### Sub-point — RESOLVED (David, 2026-10-25): stop at the head

The walk **stops at a failed head and never skips it** — later drafts wait
until the head is paired, stored as-is, or discarded (*"we need to give the
option to the user to discard instead - and that would discard the pair"*).
Retry = clean resend of the ask (partial kept only for store-as-is).

**Full design: `18_CHAT_PAIRS_AND_QUEUE.md`.**

## 6. Remaining design questions (after §5)

1. **Where does a failure live?** If not a turn: a transient notice (critical-banner
   family)? a thread-level event log? a per-send state that only the composer/
   banner sees? Is it persisted at all?
2. **What does the next request see?** Today the LLM sees error text as assistant
   turns AND unanswered user messages. Do failed sends leave the user message in
   the payload? Do we resend it? Do we drop the pair?
3. **Retry semantics** — what does Retry mean if the failure left no turn?
4. **Partial streams** (some prose arrived, then failure/interrupt) — is partial
   text a turn? An artifact of the attempt? Does it get shown, saved, sent?
5. **Interrupt (Stop)** — same family or different? (A stop is user action, not a
   provider failure — but today it is also state painted onto a turn.)
6. **Spam** — N failed sends in a row: N stains today. One notice? One per send?
7. **Downgrade chip** — in or out of the "state painted on conversation content" ban?
8. **Export/history** — should anything of a failed attempt ever leave the device?

---

*Last updated: 2026-10-25, after the third UI round (error card) was rejected on
principle. Everything in §3A-F is subject to the strip; nothing in this file is
approved design.*
