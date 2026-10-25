# 18 — Chat is pairs: drafts live in the queue

> **STATUS: BUILT 2026-10-25 (e95682a).** Adopted design (David, 2026-10-25). Replaces the failed-request
> family inventoried in `17_ERROR_HANDLING_INVENTORY.md`. Build against this,
> strip according to 17 §4. No code lands piecemeal — strip + rebuild together.

---

## 1. The law

1. **A conversation is a sequence of complete pairs.** User asks, LLM replies.
   Nothing else is chat.
2. **An ask never leaves the draft area until it finishes successfully.**
   (David: *"never leaves the draft area until finishes successfully."*)
3. **Exits from the draft area — exactly three:**
   - **paired** — a reply arrived → the pair commits to chat storage
   - **store as-is** — user decides a partial reply is good enough → the pair
     commits with that partial as the reply
   - **discard** — the unpaired ask + any partial are thrown away (*"that would
     discard the pair"*)
   Nothing is auto-committed, ever. Failure, Stop, and partial text are all the
   same situation: a draft that hasn't finished.
4. **The queue is strict FIFO, one message at a time.** Attempts walk from the
   head. **The walk stops at a failed head and never skips it** — later drafts
   wait until the head is paired, stored as-is, or discarded. New sends enter
   at the **tail**. Pair order = send order, always.

## 2. Two stores (isolation is the point)

| | Pair store (chat storage) | Queue store (drafts) |
|---|---|---|
| Contains | complete pairs only | unpaired asks (queued / sending / failed) + any partial reply text |
| Feeds | UI feed, LLM payload, titles, summaries, exports | the queue strip UI only |
| Persistence | project snapshot (cloud/sync as today) | **device-local only** (survives reload, never in the snapshot, never exported, never synced) |
| Who writes it | pair commit (atomic) | send / retry / store-as-is / discard |

This is the write-queue isolation from the sync discussion, applied here:
drafts are pending work of *this device*, not project data.

## 3. Draft item states

```
queued ──► sending ──► paired          (pair commits; item leaves the queue)
               │
               ├─► failed (reason kept; partial kept if any)
               │      ├─ retry       → sending   (CLEAN resend of the ask)
               │      ├─ store-as-is → paired    (partial becomes the reply;
               │      │                           only shown when a partial exists)
               │      └─ discard     → gone
               │
               └─► stopped (user pressed Stop = failed variant, same three exits)
```

- **Retry = clean resend of the ask.** The partial is kept for store-as-is but
  is not sent as continuation context. (David: *"correct"*.)
- **Discard removes the whole would-be pair** (ask + partial) with no trace in
  chat storage.
- **Failure reason** (e.g. `Gemini: API key not valid…`) lives on the queue
  item, shown in the queue strip — it is never turn content.

## 4. Commit

`commitPair(ask, reply)` appends **both turns atomically** to the pair store in
one step. Everything downstream (retitle, chapter summarize, autosummarize,
exports, LLM payload) sees pairs only — **no error filters anywhere**, because
unpaired things are not in the data.

- Artifacts keep welding to the pair's reply turn (unchanged behavior, one
  turn id later in the process).
- Store-as-is is a normal commit; the partial is just the reply. No marker —
  marking would be state painted onto conversation content again.

## 5. UI

- **Feed:** pairs only. No error cards, no interrupted chips, no dead-end
  user messages. (The error card / retry banner / token guards from 17 §E are
  stripped.)
- **Queue strip above the composer:** one compact item per draft — ask text,
  state (`queued` / `sending` / `failed: <reason>` / `stopped`), actions
  **Retry · Store as-is · Discard** (store-as-is only when a partial exists).
  Failed head is visually the blocking one; later items show as waiting.
- **In-flight display (deliberate consequence of law 2):** while sending, the
  ask + streaming partial render **in the queue strip / its expanded card**,
  not as feed bubbles. The feed gains the pair atomically on success.
- **Stop** = move the in-flight item to `stopped` (partial kept). It is not a
  feed event.
- Existing adjacent surfaces stay as they are: critical save banner, index
  failure panel, quota explanations (17 §G).

## 6. Payload & persistence rules

- Compiled prompt (`03-optical-compiler` turns block) = committed pairs only.
- Titles (`sampleTurnsForTitle`) and chapter summarize messages = committed
  pairs only.
- Snapshots (`persistWorker` compose) = committed pairs only.
- Exports = committed pairs only. Drafts never leave the device.

## 7. Offline

The queue **is** the offline send queue (same object as the sync discussion:
*"queue the messages and send them as soon as we get connectivity… one message
at a time"*). No connectivity → items sit `queued`; the walk starts when back.
Strict FIFO law unchanged.

## 8. Strip ↔ rebuild map (from 17)

| Strip (17) | Becomes (18) |
|---|---|
| stub assistant turn at send (`sendQueue` ~321) | queue item, no turn until commit |
| error writes to `content` (failedEmpty / catch) | `failed` queue item + reason field |
| `TurnMeta.streamState` error/interrupted + `lastOutcome:'error'` | queue item states (turn meta keeps only success telemetry) |
| error card + retry banner + token guards (`ChatView` 1093/1497/1329/1340) | queue strip |
| interrupted chip / downgraded chip (decide in rebuild: chip on the reply of a committed pair is allowed for **downgrade** — it describes the reply that exists; interrupt no longer exists as a feed state) | — |
| `stream-failure-propagation.test.ts` behavior pins | rewritten to queue laws (keep the ghost-copy bans) |
| SSE `status{state:'error'}` swallow / empty-success braces | kept as transport truth, but failure now lands on the queue item, never a turn |

## 9. Open details (small, decide at build time)

- Queue granularity: **per-thread** (Vega's default — pair order is per
  conversation) vs one global device queue.
- Queue strip density: collapsed single line vs expanded streaming card.
- Whether `stopped` shows wording distinct from `failed` (probably: "Stopped"
  vs "Failed: …").
