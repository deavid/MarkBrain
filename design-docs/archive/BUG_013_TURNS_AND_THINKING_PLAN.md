# Implementation Plan: Native API Turns for Last 2 Chapters + Persistent Thinking (`BUG-013`)

- **Status**: **100% Clear — Ready for Implementation** (approved by David on 2026-10-31).
- **Covers**: `BUG-013` — replacing the naive single-message blob with real native API turns (`user` / `assistant`) for the last 2 chapters, permanently storing thinking (`reasoning`) on every assistant turn, rendering a collapsible thinking block on messages in the UI, and sending only the **last assistant turn's thinking** back to the model.

> **Workflow Reminder for Implementing Agent**:
> 1. Follow TDD Law: write failing tests first at the real seams (`OpticalCompilerDomain.compile`, `planTurnCommit`, `gemini` & `openrouter` wire builders on both server and client, `MessageBubble` thinking fold), verify RED, then implement to go GREEN.
> 2. Run gates in order: `npx vitest run` -> `npm run build` -> evidence pack.

---

## 1. Locked-In Design Rules (David, 2026-10-31)

1. **Which chapters are sent as real native API turns (`user` / `assistant`)?**
   - **Only the last 2 chapters** (the active/ongoing chapter and the immediately preceding chapter — the two chapters that cannot be compacted).
   - **All earlier chapters** (`chapters.slice(0, -2)`) stay in the `<conversation_chapters>` XML prefix block at their configured granularity (`title`, `description`, `summary`, or `full`).
2. **How Thinking / Reasoning is Stored & Displayed**:
   - **Persist thinking permanently on the assistant `Turn`**: When a stream finishes (or is stopped), save the accumulated `reasoning` text onto the assistant turn (`turn.thinking?: string` or `turn.meta.thinking?: string` — storing on `turn.meta.thinking` or top-level `turn.thinking` so it travels automatically in SQLite `meta_json`, IndexedDB, and plaintext export!).
   - **Display in Chat UI (`MessageBubble.tsx`)**: Every assistant message that has non-empty thinking renders a clean, **collapsed-by-default** thinking header at the top of the bubble (e.g. `▸ Thought (N words)` / `▾ Thought (N words)`), which expands on click to show the model's thinking in a recessed monospace/dimmed block.
3. **Which Thinking Steps Are Sent Back to the Model on Subsequent Turns?**
   - **Only for the LAST assistant turn** in the thread (i.e. the most recent assistant reply before the new user ask).
   - Older assistant turns in the last 2 chapters send their `content` (with `compileTurnContentForPrompt` applied so `<artifact_upsert>` bodies are compiler stubs and `<link>`/`<topic_shift>` stay in place), **without** their thinking steps.
   - The **last assistant turn** sends both its `thinking` (if present) and its compiled `content`.

---

## 2. Wire Format for Native Turns + Last-Turn Thinking

### 2.1 Provider-Neutral Turn Structure (`CompiledTurnMessage`)

Define a clean provider-neutral turn type in `shared/types/turnsWire.ts` (or `shared/prompts/prompt.ts`):

```ts
export interface WireChatMessage {
  role: 'user' | 'assistant';
  content: string;
  /**
   * Present ONLY on the most recent assistant turn before the current user ask
   * (David 2026-10-31: "only for the last turn for now").
   */
  thinking?: string;
}
```

### 2.2 How Context Prefix + Native Turns Map to the Wire

When `OpticalCompilerDomain.compile()` (and `buildCompiledPrompt`) runs for a chat send:

1. **System Instruction (`systemInstruction`)**:
   - Unchanged (voice + capability blocks).
2. **Context Prefix (`contextPrefix`: first `user` message, or combined into the first user turn if there are no prior turns)**:
   Contains the project's static/compacted context:
   - `<knowledge_substrate>...</knowledge_substrate>`
   - `<existing_links>...</existing_links>` (when `graphLinks` is enabled)
   - `<conversation_chapters>...</conversation_chapters>` containing **only `chapters.slice(0, -2)`** (the older chapters before the last 2 chapters). If there are `<= 2` chapters in the thread, `<conversation_chapters>` is omitted (or empty) because all turns are sent as native API turns!
3. **Native Conversation Turns (`turns: WireChatMessage[]`)**:
   - Gather all turns belonging to the **last 2 chapters** (`chapters.slice(-2)`).
   - For each turn `t` in those last 2 chapters:
     - If `t.role === 'user'`: emit `{ role: 'user', content: t.content }`.
     - If `t.role === 'assistant'`:
       - Compile `content` via `compileTurnContentForPrompt(t.content)` (so `<link>` / `<topic_shift>` stay verbatim and `<artifact_upsert>` bodies become the `<!-- MarkBrain compiler: ... -->` stub).
       - If this `t` is the **very last assistant turn** before the new ask AND `t.meta?.thinking` (or `t.thinking`) is non-empty, attach `thinking: t.meta.thinking`.
   - Finally, append the **new user ask** as the final turn:
     `{ role: 'user', content: askText }`.
   - **Prepending the Context Prefix cleanly**:
     - If there is at least one turn in `turns`, prepend the `contextPrefix` (`<knowledge_substrate>...`) either as a leading context block at the top of the first `user` message in the sequence (`${contextPrefix}\n\n${firstUserTurn.content}`), OR as an initial `{ role: 'user', content: contextPrefix }` followed by `{ role: 'assistant', content: 'Understood. Ready.' }` before the real turns so strict alternating-role APIs (like Gemini and some OpenRouter providers) always see valid `user` ↔ `assistant` alternation!
     - *(Note: prepending `contextPrefix` to the first `user` message or using a synthetic ack pair — check which is cleaner: putting `contextPrefix` as a dedicated first `user` turn + short `assistant` ack keeps the first real user message 100% pure and makes provider prefix-caching cache the entire substrate + older chapters separately from the active turns! If `turns` only has the single new user ask, `contextPrefix + "\n\n" + askText` in a single `user` turn is also completely valid.)*

### 2.3 Gemini Wire Mapping (`server/providers/gemini.ts` & `src/gateway/providers/gemini.ts`)

Gemini's `contents` array takes `{ role: 'user' | 'model', parts: Array<{ text: string; thought?: boolean }> }`:
- For each `msg` in `messages`:
  - `role`: `msg.role === 'assistant' ? 'model' : 'user'`
  - `parts`:
    - If `msg.role === 'assistant'` and `msg.thinking`:
      `[{ text: msg.thinking, thought: true }, { text: msg.content }]`
    - Otherwise:
      `[{ text: msg.content }]`

### 2.4 OpenRouter Wire Mapping (`server/providers/openrouter.ts` & `src/gateway/providers/openrouter.ts`)

OpenRouter's `messages` array takes OpenAI-compatible messages:
- `{ role: 'system', content: systemInstruction }`
- For each `msg` in `messages`:
  - If `msg.role === 'assistant'` and `msg.thinking`:
    `{ role: 'assistant', content: msg.content, reasoning: msg.thinking, reasoning_content: msg.thinking }`
  - Otherwise:
    `{ role: msg.role, content: msg.content }`

---

## 3. Persisting & Rendering Thinking on Every Assistant Turn

### 3.1 Storage (`TurnMeta.thinking` / `TurnCommitTelemetry.thinking`)
1. In `shared/types/timeline.ts`:
   Add `thinking?: string;` to `TurnMeta`.
2. In `shared/turnCommit/planTurnCommit.ts`:
   Add `thinking?: string;` to `TurnCommitTelemetry` and preserve it on `assistantTurn.meta.thinking`.
3. In `src/domains/03-stream-protocol/index.ts`, `src/application/sendQueue.ts`, `server/jobs/chatJobRunner.ts`, and `server/db/projectRepo.ts`:
   - Accumulate the streamed `reasoning` text during the turn (both in direct/client mode and in VPS job mode).
   - Pass `thinking: accumulatedReasoning || undefined` into `commitPair` / `commitRegenerate` / `commitJobPairTransaction` → `planTurnCommit` telemetry so every committed assistant turn permanently stores its `thinking` in `turn.meta.thinking`!
   - In `plaintextTree.ts` (markdown export/import of chat threads), ensure `meta.thinking` round-trips cleanly.

### 3.2 UI Display in `MessageBubble.tsx`
- Inside `MessageBubble.tsx`, right above `<MessageBody ... />`:
  If `!isUser && message.meta?.thinking`:
  - Render a compact, collapsible thinking disclosure (`data-testid="turn-thinking-toggle"`):
    - **Collapsed (default)**:
      `▸ Thought (${wordCount} words)` in subtle monospace (`text-10 font-mono text-[#758ca8] hover:text-ink`).
    - **Expanded**:
      `▾ Thought (${wordCount} words)` followed by a recessed box (`bg-surface-1/80 border-l-2 border-[#38bdf8]/40 rounded px-3 py-2 my-1.5 text-11 font-mono text-ink-dim whitespace-pre-wrap max-h-64 overflow-y-auto`) showing `message.meta.thinking`.

---

## 4. Inspector & Mirror Compatibility

- Keep `compiledPrompt` (the human-readable representation of substrate + chapters + turns) populated alongside `wireMessages: WireChatMessage[]` so the Mirror panel token breakdown and existing `parseCompiledSections` inspector view continue to work seamlessly, while the actual provider wire payload (`recordCallWire`) sends and records the real multi-turn `messages` / `contents` array!
