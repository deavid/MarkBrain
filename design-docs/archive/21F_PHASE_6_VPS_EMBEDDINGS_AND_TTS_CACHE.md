# 21F — Phase 6: VPS-Only Semantic Indexing & `ffmpeg` Ogg TTS Cache

> **Phase:** 6 of 7
> **Goal:**
> 1. Move semantic search indexing (`generate-qa` + `embedContent`) 100% onto the VPS SQLite daemon (`server/jobs/serverArtifactIndexer.ts`) so indexing happens once per note on the server and serves both PC and phone, while **Mode 1 (`local`)** uses fast, zero-quota lexical search only.
> 2. Upgrade `POST /api/tts` on the VPS to re-encode Gemini's 24kHz PCM audio via `ffmpeg` into compact **mono 22,050 Hz Ogg Vorbis (`-qscale:a -1`)** and cache the `.ogg` files on disk (`data/tts-cache/`) so repeated Read-Aloud playback on mobile transfers in ~1/12th the size and burns 0 repeat TTS quota.
> **Prerequisite:** Phase 5 committed and green.

---

## Part A — VPS-Only Semantic Indexing & Search

### 1. Disable Browser-Side Background Indexing in Mode 1 (`local`)
In `src/App.tsx` / `src/application/artifactIndexer.ts`:
- When `getWorkspaceMode() === 'local'`:
  - **Do NOT start `ArtifactIndexer` in the browser.**
  - Hide the semantic indexing progress counter / failure banner in Local mode (since Local mode does not build vector embeddings).
  - When the user types in the composer or searches notes in Local mode, `draftSearchEngine.ts` runs its **lexical / keyword scorer (`scoreLexical`)** over the in-memory `artifacts` list — instant, 0 network calls, 0 quota burned.

### 2. Server-Side Artifact Indexer (`server/jobs/serverArtifactIndexer.ts`)
Create `server/jobs/serverArtifactIndexer.ts`:
1. **Trigger points:**
   - Whenever an artifact is created or updated in `server/db/projectRepo.ts` (`applyProjectSnapshotDiff`, `applyAtomicMutation`, or after a `chatJobRunner` turn extracts an `<artifact>`), enqueue `(userId, projectId, artifactId)` into the server's single FIFO indexing queue.
   - Whenever an artifact is deleted, immediately delete its rows from `artifact_index_sections` (`DELETE FROM artifact_index_sections WHERE user_id = ? AND project_id = ? AND artifact_id = ?`).
2. **Section Diffing by `content_hash`:**
   - Chunk the artifact markdown into sections using `src/utils/sectionChunker.ts` (`chunkMarkdownIntoSections`).
   - Compare each section's `contentHash` against existing rows in `artifact_index_sections` for `(userId, projectId, artifactId)` where `model = EMBED_MODEL`.
   - Delete stale sections no longer present in the artifact.
   - If all sections already have matching `content_hash` and non-empty vectors → **0 API calls**.
3. **Metered Calls on Changed Sections Only:**
   - Resolve the user's unlocked key on the server (`resolveServerLaneKey(userId, 'qaGen', qaModel)` and `resolveServerLaneKey(userId, 'embed', embedModel)`). If the user's vault is locked or has no Gemini key configured, mark indexing status as paused without crashing.
   - Call Gemini `generate-qa` (1 LLM call for the changed sections of the note).
   - Call Gemini `batchEmbedContents` (`RETRIEVAL_DOCUMENT`, batched up to `EMBED_BATCH_LIMIT = 80`) for the section texts + generated QA questions.
   - Store the resulting `qa_json`, `section_vec_json`, and `qa_vecs_json` in `artifact_index_sections`.

### 3. Server-Side Semantic Search Endpoint (`POST /api/projects/:projectId/search`)
In `server/routes/searchIndex.ts` (protected by `requireAuth`):
- **Endpoint `POST /api/projects/:projectId/search`:**
  - Body: `{ query: string, topK?: number }`.
  - Loads all `artifact_index_sections` + `artifacts` for `(req.user.id, projectId)`.
  - Calls Gemini `embedContent` (`RETRIEVAL_QUERY`) once for `query` (and caches the last 64 query vectors in server RAM per user using `QueryVectorCache` so even if the user searches from two tabs, near-duplicate queries with `editDistance <= 1` or `Dice >= 0.95` reuse the cached query vector without calling Gemini!).
  - Runs the hybrid semantic cosine + lexical scorer (`draftSearchEngine.ts` math) against the SQLite section & QA vectors.
  - Returns:
    ```json
    {
      "results": [
        {
          "artifactId": "...",
          "title": "...",
          "sectionId": "...",
          "heading": "...",
          "snippet": "...",
          "score": 0.84,
          "matchedVia": "qa"
        }
      ],
      "indexStatus": {
        "indexedArtifacts": 24,
        "totalArtifacts": 24,
        "state": "idle"
      }
    }
    ```
- **Endpoint `GET /api/projects/:projectId/search/status`:**
  - Returns `{ indexedArtifacts, totalArtifacts, state: 'idle' | 'indexing' | 'error', lastError? }` so the UI can display the clean `24/24 indexed` indicator.

---

## Part B — VPS TTS Audio Re-encoding (`ogg`, 22kHz Mono, `q=-1`) & Disk Cache

### 1. Why We Re-encode & Cache on the VPS
Gemini's TTS endpoint returns raw 24,000 Hz 16-bit mono PCM (`audio/L16;rate=24000`), which is **48 KB per second of speech** (~1.5 MB for a 30-second reply).
By piping that raw PCM through `ffmpeg` into **Ogg Vorbis at 22,050 Hz, mono, quality `-1`** (`-ac 1 -ar 22050 -c:a libvorbis -qscale:a -1`), the file shrinks by **~10–12x** (down to ~4–5 KB/sec) and is cached on the VPS SSD (`data/tts-cache/<sha256>.ogg`).
- First listen on PC or phone: generated once, compressed to tiny `.ogg`, saved to disk.
- Second listen on phone on mobile data: **0 Gemini TTS quota used**, transfers in milliseconds.

### 2. Server TTS Cache & `ffmpeg` Pipeline (`server/lib/ttsCache.ts` & `server/routes/tts.ts`)

Create `server/lib/ttsCache.ts`:

1. **Cache Key Computation:**
   ```ts
   export function computeTtsCacheKey(model: string, voice: string, cleanedText: string): string {
     return crypto.createHash('sha256').update(`${model}|${voice}|${cleanedText}`).digest('hex');
   }
   ```
2. **Cache Directory:**
   - `const TTS_CACHE_DIR = process.env.MARKBRAIN_TTS_CACHE_DIR || path.resolve(process.cwd(), 'data', 'tts-cache');`
   - Ensure directory exists (`fs.mkdirSync(TTS_CACHE_DIR, { recursive: true })`).
3. **Cache Lookup (`getCachedTtsAudio(cacheKey)`):**
   - Checks SQLite `tts_cache` table and verifies `fs.existsSync(row.file_path)`.
   - If found, updates `last_accessed_at = Date.now()` in `tts_cache` and returns `{ filePath: row.file_path, contentType: 'audio/ogg' }`.
4. **`ffmpeg` Re-encoding (`encodePcmToOgg(pcmBuffer: Buffer, sampleRate = 24000): Promise<Buffer>`):**
   - Spawns `ffmpeg` via `child_process.spawn`:
     ```ts
     const args = [
       '-hide_banner',
       '-loglevel', 'error',
       '-f', 's16le',
       '-ar', String(sampleRate),
       '-ac', '1',
       '-i', 'pipe:0',
       '-ac', '1',
       '-ar', '22050',
       '-c:a', 'libvorbis',
       '-qscale:a', '-1',
       '-f', 'ogg',
       'pipe:1',
     ];
     ```
   - Writes `pcmBuffer` to `child.stdin` and collects `stdout` chunks into an Ogg `Buffer`.
   - *(Fallback if `libvorbis` is unavailable in a given `ffmpeg` build)*: falls back to `-c:a libopus -b:a 16k -vbr on -f ogg pipe:1`.
5. **Atomic Write to Disk (`storeCachedTtsAudio(cacheKey, model, voice, oggBuffer)`):**
   - Writes to `data/tts-cache/${cacheKey}.ogg.tmp` then renames to `data/tts-cache/${cacheKey}.ogg`.
   - Upserts metadata row into SQLite `tts_cache (cache_key, model, voice, file_path, byte_size, created_at, last_accessed_at)`.

### 3. Update `server/routes/tts.ts` and Client `src/ui/context/ttsTransport.ts`
- **`server/routes/tts.ts`:**
  1. Normalizes text via `cleanTtsText(text)` and clamps `voice`.
  2. Computes `cacheKey = computeTtsCacheKey(targetModel, voice, cleanedText)`.
  3. **If `getCachedTtsAudio(cacheKey)` hits:** logs `TTS cache HIT (${cacheKey.slice(0, 8)})`, sets headers `Content-Type: audio/ogg` and `X-Tts-Cache: HIT`, and sends the cached `.ogg` file! Zero Gemini API call!
  4. **If cache misses:** resolves user's Gemini key via `resolveServerLaneKey(req.user.id, 'tts', targetModel)`, calls Gemini TTS, decodes the base64 PCM bytes, encodes to Ogg via `encodePcmToOgg`, stores in `tts_cache`, and sends the `.ogg` bytes with `Content-Type: audio/ogg` and `X-Tts-Cache: MISS`.
- **`src/ui/context/ttsTransport.ts`:**
  - Inspect response `Content-Type` (or JSON vs binary response):
    - When `Content-Type` starts with `audio/ogg` (or JSON contains `mimeType: 'audio/ogg'`): decode via `audioContext.decodeAudioData(arrayBuffer)` (supported natively by Chrome, Firefox, Android WebView, and desktop browsers) and play through the `AudioBufferSourceNode`.
    - When `mimeType` is raw `audio/pcm` / `audio/L16` (used in Mode 1 Local direct browser calls): keep the existing `Int16Array → Float32Array` PCM playback path.

---

## Part C — Phase 6 Unit & Integration Tests (`src/tests/vps-embeddings-and-tts-cache.test.ts`)

Create `src/tests/vps-embeddings-and-tts-cache.test.ts` testing:
1. **Mode 1 (`local`) lexical-only guarantee:**
   - In `local` mode, creating/editing artifacts fires **0** `/api/search-index/*` or `generativelanguage.googleapis.com` embedding requests, and lexical search still finds matching sections by keyword.
2. **Mode 2 (`vps`) server indexing & deduplication:**
   - Saving an artifact on the VPS indexes its sections into `artifact_index_sections`.
   - Saving the artifact again without changing section content makes **0** new `generate-qa` or `embedContent` calls (`content_hash` match).
   - `POST /api/projects/:id/search` returns ranked matches and reuses cached query vectors for near-duplicate queries (`editDistance <= 1`).
3. **TTS Ogg Re-encoding & Disk Cache Hit:**
   - Mock the upstream Gemini TTS call to return synthetic 1-second 24kHz PCM sine-wave bytes.
   - First `POST /api/tts` call returns `200`, `Content-Type: audio/ogg`, `X-Tts-Cache: MISS`, valid Ogg header (`OggS` magic bytes `0x4f 0x67 0x67 0x53`), and calls upstream Gemini **1** time.
   - Second `POST /api/tts` call with identical `(text, voice, model)` returns `200`, `Content-Type: audio/ogg`, `X-Tts-Cache: HIT`, and calls upstream Gemini **0** additional times!

---

## Phase 6 Verification Gate

```bash
npm run lint
npm test
npm run build
```

Commit Phase 6:
```bash
git add -A
git commit -m "Phase 6: VPS SQLite semantic indexer/search and ffmpeg 22kHz mono Ogg TTS disk cache"
```
