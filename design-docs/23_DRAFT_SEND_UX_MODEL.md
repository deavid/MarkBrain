# 23 — The Send Model: drafts own their payload, their progress, and their exit

> **Trigger (David, 2026-10-25):** "we don't know what the AI is doing — is it
> thinking? some counter of seconds and states… The attachments should belong
> to the draft for reply that I retried. I've no idea now on what did I send."
> Plus: a VAULT_LOCKED send failure is a dead-end (server restarted, keys
> locked, the draft just… failed).

## 1. The schema as it was (and why it confused)

**A send is three objects that were not visibly bound together:**

| Object | Where it lived | Problem |
|---|---|---|
| The ask | `DraftItem.text` | ✅ fine |
| The payload (attachments) | ThreadRegistry staged tray — a per-thread "next send" global | ❌ the draft had NO snapshot; `executeAttempt` compiled the LIVE tray at attempt time. After Retry, the tray still claimed "rides the next send · removable until then" — the user could not see what the queued draft would send, and edits between queue and attempt silently changed the payload |
| The progress | `streamPhase` ('waiting'/'streaming') + a free-text `streamingStatus` | ❌ one vague label ("Writing reply" / "Synthesizing…") for three observably different states: queued behind a head, connected-but-no-token-yet, actually writing. No clocks. The provider's "thinking" is not observable — but *waiting for the first token* is, and we never said so |
| The failure exit | `DraftItem.reason` text | ❌ a VAULT_LOCKED failure (server restart) showed the sentence with no action — the fix is a password away, on another screen |

## 2. The amended model (this doc is the contract)

**The Draft is the unit of a send.** It owns:

```ts
DraftItem {
  id, threadId, text, kind, targetTurnId, state, createdAt,
  attachments: ChatAttachment[]        // SNAPSHOT at enqueue — the payload
  progress: {                          // honest, observable phases only
    phase: 'queued' | 'connecting' | 'awaiting-first-token' | 'writing';
    since: number;                     // when the current phase began
    firstTokenAt?: number;             // when the first chunk landed
    chars?: number;                    // clean partial length while writing
  }
  errorCode?: 'VAULT_LOCKED' | string  // machine-readable exit (reason stays human)
  partial?, reason?, bufferedArtifacts?, bufferedShifts?, serverJobId?
}
```

### 2.1 Attachment ownership law (amends design-docs/18)
1. **Enqueue snapshots.** `handleSendMessage` copies the armed set
   (`threadRegistry.getAttachments(threadId)` — staged + committed, the exact
   set 18 says a retry must deliver) into `draft.attachments`.
2. **The tray is the editor of the un-sent payload.** While the head draft of
   the thread is `queued` (nothing `sending`), the staged tray renders THAT
   draft's `attachments` — add/remove/granularity edits mutate the draft
   (staged items only; committed ones are history and stay welded). Copy:
   *"riding this send · removable until it goes out."*
3. **Sending freezes the payload.** Once `sending`, the tray stops being an
   editor of it; the draft card shows the snapshot read-only: *"6 notes ·
   10.8k tok riding this send."* New staging then arms the NEXT draft
   (tray copy reverts to "arms the next send").
4. **Retry re-sends the SAME snapshot** — it is the same send. Regenerate
   carries its snapshot too.
5. **Commit welds the snapshot** (existing `commitStagedAttachments` path,
   driven from the snapshot, not live state). Discard drops the draft;
   its snapshot leaves with it (nothing was sent — no silent re-arming).

### 2.2 Progress phases (the honest ladder)
Only states we can actually observe — never invent "thinking":
- `queued` — waiting behind a failed/stopped head or an in-flight sibling.
- `connecting` — job enqueued / fetch in flight.
- `awaiting-first-token` — connected; zero bytes back. THIS is where the
  model "thinks"; the copy says exactly that: *"— the model is thinking; no
  text yet"*.
- `writing` — first token arrived; show elapsed-since-first-token + chars.

Each phase carries `since`; the card ticks every second:
`AWAITING FIRST TOKEN · 12s` / `WRITING · 8s · 1,204 chars`.
Send button: phase-aware (`Sending…` → `Writing reply…`) — the word
"Synthesizing" is banned (it means nothing). Status bar keeps the partial
stream text but leads with the same phase chip + clock.

### 2.3 VAULT_LOCKED recovery (both modes)
- Server error events carry `code: 'VAULT_LOCKED'` (watcher stores
  `draft.errorCode`). A failed draft with that code renders an inline
  unlock affordance on the card: password field → `POST /api/auth/unlock`
  (or local `unlockLocalVault`) → **auto-retry the same draft**.
- No navigation to Model Settings required — the dead-end David hit must
  never require leaving the conversation.

### 2.4 Reconcile law (added after the 2026-10-25 "chat never sends" deadlock)
The server is the source of truth for sends in Connected mode. On every
project load the client reconciles `GET /api/projects/:id/jobs` into drafts:
failed/stopped jobs materialize as failed/stopped drafts **with their exits**
(Retry / Store as-is / Discard); queued/sending jobs materialize as queued
drafts whose attempt only attaches to the stream (never double-sends). A lost
failed HEAD must never silently FIFO-block a thread — the failure that killed
chat was exactly that: one vault-locked job as head, three sends queued behind
it forever, nothing on screen. A queued draft behind a blocked head says so:
*"Queued — blocked by the failed draft above."*

## 2.5 — Topic-shift chapter law (David 2026-10-25, live-found)

A model reply may carry several `<topic_shift>` sentinels; chapter cuts obey:

1. **LAST shift wins** — the chapter that opens is the one the reply ENDED on
   (demuxFullTurn parses every sentinel, keeps the last, fires once).
2. **The cut applies at the message that CAUSED the change** — the human ask of
   the pair (thread index `turnCount - 2`), not after the reply.
3. **A cut that already exists at that index is RETITLED** — client-declared
   genesis, a previous commit's cut, a re-emitted sentinel on regenerate — the
   shift replaces that chapter's title/metadata; it never opens a duplicate.
4. Delta-synced chapters route **per thread**: only the active thread's
   chapters live in the segmentation domain; other threads' chapters go to the
   registry cache (a strip that renders foreign chapters against this timeline
   showed "Genesis Chapter" twice with duplicated contents).

Pinned by: `topic-shift-law.test.ts` (demux), `send-and-forget-jobs` §5.4
(server law incl. regenerate-replace), `cuj-gap-jobs` G5 (seal+open vs
retitle-in-place), `cuj-gap-sync` G6 (per-thread routing), `send-model`
(client law).

## 3. Implementation notes
- `sendQueue.executeAttempt` / `executeVpsAttempt` compile from
  `item.attachments ?? getAttachments(threadId)` (fallback keeps old drafts
  working). VPS `stagedAttachments` payload uses the snapshot.
- `chatJobRunner` SSE `error` event gains `code`; client maps it.
- `AttachmentControls` tray takes its rows from either the queued draft's
  snapshot or the staged set (§2.1.2/2.1.3) — same row widget, one source.
- Tests: snapshot-at-enqueue; retry re-sends same snapshot after tray edits;
  sending freezes; phase transitions + clocks (fake timers); VAULT_LOCKED →
  errorCode → unlock → auto-retry (fetch-stubbed). CUJ matrix rows C1–C7/J-row
  gain evidence.
