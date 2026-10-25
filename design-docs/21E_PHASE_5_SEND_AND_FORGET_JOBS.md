# 21E — Phase 5: VPS "Send & Forget" Background Chat Jobs

> **Phase:** 5 of 7
> **Goal:** Enable true **"Send on phone and lock the screen"** (*Send-and-Forget*) in Connected VPS mode. When the user submits a chat message (or Regenerate Last Reply) while connected to the VPS, the VPS owns the in-flight execution in a server-side job runner (`server/jobs/chatJobRunner.ts`). Even if the phone browser sleeps or disconnects 100ms after hitting Send, the VPS finishes streaming from the LLM, parses `<artifact>` and `<topic_shift>` sentinels, commits the completed `(user, assistant)` Pair atomically to SQLite `turns`, and runs background thread titling and sealed-chapter auto-summarization on the server.
> **Prerequisite:** Phase 4 committed and green.

---

## 1. The Physics Problem & How Server Jobs Solve It

In a standard browser-driven stream (`fetch('/api/chat/stream')`), the HTTP request lifecycle **is** the job:
- If the user hits Send on their phone and presses the power button to lock the screen, mobile Chrome/Firefox suspends the tab or drops the socket.
- The server sees `req.on('close')`, aborts the Gemini stream, and the client never commits the pair.

To make **Send-and-Forget** rock-solid:
1. Submitting a turn (`POST /api/projects/:projectId/jobs/send`) creates a persistent job record in SQLite (`chat_jobs`) and kicks off an asynchronous server-side worker **decoupled from any HTTP request socket**.
2. Any open tab (the phone while awake, or the PC on the desk) can attach to `GET /api/jobs/:jobId/stream` (SSE) to watch live chunks as they arrive.
3. **Disconnecting from `GET /api/jobs/:jobId/stream` NEVER cancels the job!**
4. Only an explicit `POST /api/jobs/:jobId/stop` cancels the job (putting it in `state = 'stopped'` with its partial text preserved on the job record so the user can choose *Retry*, *Store as-is*, or *Discard* per the Pair Law in `18_CHAT_PAIRS_AND_QUEUE.md`).
5. When the LLM finishes streaming on the server, **the server itself commits the Pair into SQLite `turns`** (plus buffered artifacts and chapter splits) inside a single transaction and marks the job `completed`.
6. Right after committing the Pair, the server runs best-effort background tasks (**Thread Titling** and **Sealed-Chapter Auto-Summarization**) using the user's configured `title` and `summarize` slot models and saves those updates straight to SQLite.

---

## 2. Server-Side Job Runner (`server/jobs/chatJobRunner.ts`)

Create `server/jobs/chatJobRunner.ts`:

### 2.1 In-Memory + SQLite State
For each running job (`jobId`), maintain an in-memory `ActiveJobContext`:
```ts
interface ActiveJobContext {
  jobId: string;
  userId: number;
  projectId: string;
  threadId: string;
  abortController: AbortController;
  subscribers: Set<Response>; // Connected SSE clients watching this job
}
```
And persist all durable state in the `chat_jobs` SQLite table (created in Phase 2):
- `state`: `'queued' | 'sending' | 'completed' | 'failed' | 'stopped'`
- `kind`: `'send' | 'regenerate'`
- `target_turn_id`: `string | null` (for `'regenerate'`)
- `ask_text`, `compiled_prompt`, `system_instruction`, `model`, `staged_attachments_json`
- `partial_text`: updated periodically (every ~250ms or on completion/failure/stop)
- `error_reason`: populated if `state === 'failed'`
- `buffered_artifacts_json`, `buffered_shifts_json`

### 2.2 Per-Thread FIFO Law on the Server
Match `nextSendable()` from `src/application/draftQueue.ts`:
- If a thread has a job in `'failed'` or `'stopped'` state at its head, later `'queued'` jobs on that thread wait until the head job is retried, stored as-is, or discarded.

### 2.3 Executing the Job (`runJob(jobId)`)
1. Mark `state = 'sending'` in `chat_jobs` and broadcast `{ type: 'status', state: 'streaming' }` to any connected SSE `subscribers`.
2. Resolve the user's API key via `resolveServerLaneKey(userId, 'chat', job.model)` and validate `requireModelId(job.model, 'chat')`.
3. Stream from Gemini or OpenRouter using `abortController.signal`.
4. As chunks arrive:
   - Parse sentinel blocks (`<artifact>`, `<topic_shift>`) using the exact same parser (`src/utils/sentinelParser.ts` / `server/routes/chat.ts` logic).
   - Accumulate `cleanText`, `bufferedArtifacts`, and `bufferedShifts`.
   - Broadcast SSE events (`chunk`, `artifact_upsert`, `topic_shift`) to all currently connected `subscribers`.
5. **On Normal Stream Completion (`complete`):**
   - If `cleanText.trim().length === 0` and `bufferedArtifacts.length === 0`: treat as failure (`'The stream ended without a reply.'`).
   - Otherwise, inside **one SQLite transaction**:
     - **If `job.kind === 'send'`:**
       - Create `userTurn` (`id: 'turn-user-' + job.jobId`, `role: 'user'`, `content: job.ask_text`, `meta.attachments = stagedAttachments`).
       - Create `assistantTurn` (`id: 'turn-ai-' + job.jobId`, `role: 'assistant'`, `content: cleanText`, `meta.model = job.model`).
       - Insert both into `turns`.
     - **If `job.kind === 'regenerate'`:**
       - Update the existing assistant turn `job.target_turn_id` in `turns` with `content = cleanText`, `timestamp = Date.now()`.
     - Upsert any `bufferedArtifacts` into `artifacts`.
     - Apply any `bufferedShifts` into `chapters` (sealing the previous chapter and opening the new chapter partition).
     - Delete the completed row from `chat_jobs` (or mark `state = 'completed'` with `result_user_turn_id` / `result_assistant_turn_id`).
     - Increment `projects.revision`.
   - Broadcast `{ type: 'complete', revision: newRev, userTurnId, assistantTurnId }` to any connected SSE `subscribers` and close their streams.
   - Trigger asynchronous post-commit server chores (§2.5 below).
6. **On Error (`catch` when not aborted):**
   - Set `state = 'failed'`, `error_reason = err.message`, `partial_text = cleanText` in `chat_jobs`.
   - Increment `projects.revision` so reconnecting clients see the failed draft state.
   - Broadcast `{ type: 'error', message: err.message }` to connected SSE `subscribers`.
   - **Zero turns are written to `turns`!**
7. **On Explicit Stop (`POST /api/jobs/:jobId/stop`):**
   - Abort `abortController`.
   - Set `state = 'stopped'`, `partial_text = cleanText` in `chat_jobs`.
   - Increment `projects.revision`.

### 2.4 The Three Exits for Failed / Stopped Server Jobs
Provide endpoints matching the three DraftQueue exits (`design-docs/18_CHAT_PAIRS_AND_QUEUE.md`):
1. **Retry (`POST /api/jobs/:jobId/retry`):**
   - Resets `state = 'queued'`, clears `partial_text`, `error_reason`, `buffered_artifacts_json`, `buffered_shifts_json`, and kicks `runJob(jobId)`.
2. **Store as-is (`POST /api/jobs/:jobId/store-as-is`):**
   - Commits the Pair (`job.ask_text` + `job.partial_text || '[Stopped before reply completed]'`) into `turns` inside a SQLite transaction, deletes the job from `chat_jobs`, and increments `projects.revision`.
3. **Discard (`DELETE /api/jobs/:jobId`):**
   - Deletes the job from `chat_jobs`, increments `projects.revision`, and kicks the next queued job on that thread if any.

### 2.5 Post-Commit Background Chores on the Server (Title + Chapter Auto-Summarize)
Immediately after `runJob` commits a Pair (detached `void runPostCommitChores(userId, projectId, threadId)`):
1. **Thread Auto-Titling:**
   - Check the thread's `turns` count and `title_version`. If `title_version === 0 && turns.length >= 2` (or at the existing title refresh milestones), call the user's `title` slot model on the server using `buildTitlePrompt`, update `threads.title` and `threads.title_version` in SQLite, and bump `projects.revision`.
2. **Sealed-Chapter Auto-Summarization:**
   - Check the thread's `chapters` using `chapterThatLeftTheWindow(chapters)`.
   - For any sealed chapter missing `description` or `summary`, call the user's `summarize` slot model on the server using `buildSummarizePrompt`, write `title`, `description`, and `summary` to `chapters` in SQLite, and bump `projects.revision`.

---

## 3. Mount Job Routes (`server/routes/jobs.ts`)

Create `server/routes/jobs.ts` (all routes gated by `requireAuth`):
- `POST /api/projects/:projectId/jobs/send` → enqueues & starts a `'send'` or `'regenerate'` job, returns `{ job, revision }`.
- `GET /api/projects/:projectId/jobs` → lists non-completed jobs for `(req.user.id, projectId)`.
- `GET /api/jobs/:jobId/stream` → SSE endpoint:
  - Immediately sends `{ type: 'snapshot', partialText: job.partial_text, state: job.state }`.
  - If the job is already `'completed'`, sends `{ type: 'complete' }` and closes.
  - If the job is `'failed'`, sends `{ type: 'error', message: job.error_reason }` and closes.
  - If `'queued'` or `'sending'`, adds `res` to `subscribers` so live chunks stream to the client; on `req.on('close')`, simply removes `res` from `subscribers` **without** aborting `abortController`!
- `POST /api/jobs/:jobId/stop` → aborts in-flight job and marks `'stopped'`.
- `POST /api/jobs/:jobId/retry` → retries `'failed'` or `'stopped'` job.
- `POST /api/jobs/:jobId/store-as-is` → commits partial pair to SQLite `turns` and removes job.
- `DELETE /api/jobs/:jobId` → discards job.

---

## 4. Wire Client `SendQueue` to Server Jobs in Connected VPS Mode (`src/application/sendQueue.ts`)

In `src/application/sendQueue.ts`:
- **In Mode 1 (`local`):** `SendQueue` continues to run 100% locally in the browser as it does today.
- **In Mode 2 (`vps`):**
  1. `enqueueSend` / `regenerateLastReply` adds the local draft card AND calls `POST /api/projects/:projectId/jobs/send`.
  2. Attaches to `GET /api/jobs/:jobId/stream` to display live streaming text in the draft card while the screen is awake.
  3. If the stream disconnects (e.g. phone screen locked), the client does **not** fail the draft!
  4. When the stream emits `complete` **or** when the phone screen wakes up and `useVpsDeltaSync` pulls `GET /api/projects/:projectId/delta`, the client receives the committed Pair from SQLite `turns` and removes the completed draft from `DraftQueue`.
  5. Clicking `Stop`, `Retry`, `Store as-is`, or `Discard` on a draft in Connected VPS mode calls the corresponding `/api/jobs/:jobId/...` endpoint and syncs the delta.

---

## 5. Phase 5 Unit & Integration Tests (`src/tests/send-and-forget-jobs.test.ts`)

Create `src/tests/send-and-forget-jobs.test.ts` testing:
1. **The Phone Screen-Lock Scenario (Core Test):**
   - Start a chat job via `POST /api/projects/:id/jobs/send` with a mocked slow LLM stream (e.g. yields 3 chunks over 50ms).
   - Connect an SSE listener after chunk 1 and immediately **disconnect/destroy the client socket** (simulating locking the phone screen).
   - Wait for the mocked LLM stream to finish on the server.
   - Query `GET /api/projects/:id/delta?since=0` (simulating unlocking the phone screen).
   - Assert:
     - The job is completed and no longer in `activeJobs`.
     - Both the `user` turn and `assistant` turn Pair are committed in SQLite `turns` with the full reply content.
     - Thread auto-title and sealed-chapter auto-summary ran on the server and persisted to SQLite.
2. **Server Job Failure Law:**
   - If the upstream LLM returns 429/500 while the phone screen is locked, `turns` has **0** new rows, and `activeJobs` contains the `'failed'` job with `errorReason` and `partialText`.
3. **Explicit Stop vs Disconnect:**
   - Disconnecting the SSE socket keeps the job running to completion; calling `POST /api/jobs/:id/stop` aborts the upstream stream and lands the job in `'stopped'` state, where `POST /api/jobs/:id/store-as-is` commits the partial pair.

---

## 6. Phase 5 Verification Gate

```bash
npm run lint
npm test
npm run build
```

Commit Phase 5:
```bash
git add -A
git commit -m "Phase 5: VPS Send-and-Forget chat job runner with background pair commit, titling, and chapter summarization"
```
