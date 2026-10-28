# Execution Plan & Pseudo-Patch: Finishing the Backup / Storage / Bijection Architecture

> **Target branch:** `dev-orion` (or `dev-vega` / active desk)
> **Standing rules for the executing agent:**
> 1. **NEVER push to a remote** (`git push` is forbidden). Commit locally only. Never create git tags.
> 2. **NEVER hit external APIs** from tests.
> 3. **Gates before committing:**
>    - `npx tsc --noEmit`
>    - `npx vitest run`
>    - `npm run build`

---

## Why This Plan Exists (What Was Left Half-Baked)

When comparing our Oct 26–27 backup/storage discussion (`DECISIONS_BACKUP_SQLITE_VS_PLAINTEXT.md`) and `archive/28_EXECUTION_PACK_1.md` against the actual codebase, seven concrete gaps/violations remain:

1. **`plaintextTree.ts` hand-picks a hardcoded whitelist of keys** in `artifactToFrontmatter`, `parseArtifactMarkdown`, and `snapshotToTree` (`project.json`) — so any new field added to `UniversalArtifactDocument` or `ProjectSnapshot` is **silently dropped** on export/import!
2. **External `.md` body edit detection is missing (`[19293]`):** If a user edits `artifacts/CORE.md` in VS Code / Git and imports the plaintext tree back into MarkBrain, `plaintextTree.ts` does not detect that the body changed relative to the frontmatter's summary layers (`bodyHash` mismatch → set `layersStaleAt`).
3. **The bijection test (`plaintext-roundtrip.test.ts`) is memory-only and its `walkForUndefined` rot detector is incomplete:**
   - It does not test the full SQLite round-trip (`Seed DB_1 → assert zero NULL/empty columns across all domain tables in TABLES_SPEC → Export Plaintext Tree → Import into fresh DB_2 → assert SQL table dump equality`).
   - It does not check for `null` or empty values (`""`, `[]`, `{}`).
4. **The Relational Envelope + `doc_json` law (`[19286]`, `Pack 28 §5.3`) was violated in `projects`, `folders`, and `artifact_revisions`:**
   - `projects`, `folders`, and the brand-new `artifact_revisions` table still lack a canonical `doc_json` column and store domain fields as individual SQL columns.
   - `turns` and `chapters` in `schemaSpec.ts` still mark legacy columns (`role`, `content`, `timestamp`, `start_turn_id`, `title`) as `NOT NULL` without defaults, forcing `projectRepo.ts` to keep writing redundant domain fields into SQL columns.
5. **Single-project `.tar.gz` export in UI (`Pack 28 §3.5`):** `exportProjectTarGz` exists in `plaintextTree.ts` but is never wired into `ExportModal.tsx` (which still only offers the old one-way JSON/MD/YAML dump that cannot be re-imported).
6. **Offline Replica gaps (`Pack 28 §3.6`):**
   - `useVpsDeltaSync.ts` never calls `rememberReplica(baseUrl, email)` on successful sync.
   - `apiFetch` in `src/gateway/api.ts` does not short-circuit when `isOfflineReplica()` is true — it still fires network requests with an empty Bearer token.
7. **Stream A — Operator `.sqlite` snapshot pull & `restore_db` in Ansible (`[19286]` + `archive/27` §1):**
   - `deploy/ansible/playbook.yml` has no `restore_db` support to restore a `.sqlite` snapshot in one command, and there is no `npm run backup-sqlite` script using SQLite's online backup API (which also strips ephemeral 7-day `api_call_logs` from the backup copy if desired).

Execute the 7 steps below in order.

---

## Step 1: Make `src/domains/plaintextTree.ts` Future-Proof (Spread Unknown Keys + `bodyHash` External-Edit Detection)

### 1.1. Why
- If someone adds `altitude` or `state` to `UniversalArtifactDocument` or a new setting to `ProjectSnapshot`, `plaintextTree.ts` must preserve it automatically without needing a parser update.
- If a human edits the Markdown body of `artifacts/FOO.md` in VS Code / Git and imports the tree, `parseArtifactMarkdown` must detect that the body no longer matches the `bodyHash` written into the frontmatter when the layers were fresh, and automatically set `layersStaleAt = Date.now()` so stale summaries never lie to the LLM.

### 1.2. Exact Changes in `src/domains/plaintextTree.ts`

1. Import `contentHash` from `../utils/contentHash`:
   ```ts
   import { contentHash } from '../utils/contentHash';
   ```
2. Replace `artifactToFrontmatter` and `parseArtifactMarkdown` (`src/domains/plaintextTree.ts:62-135`) with:
   ```ts
   function artifactToFrontmatter(artifact: UniversalArtifactDocument): Record<string, unknown> {
     // Spread all top-level artifact properties EXCEPT `current` (whose body
     // becomes the Markdown body and whose subtitle/description/summary sit at
     // top level of the frontmatter). Any future field on UniversalArtifactDocument
     // is preserved automatically without touching this serializer.
     const { current, ...rest } = artifact as UniversalArtifactDocument & Record<string, unknown>;
     const fm: Record<string, unknown> = {};
     for (const [k, v] of Object.entries(rest)) {
       if (v !== undefined) fm[k] = v;
     }
     fm.subtitle = current.subtitle;
     fm.description = current.description;
     fm.summary = current.summary;
     fm.bodyHash = contentHash(current.body ?? '');
     return fm;
   }

   function parseArtifactMarkdown(md: string, workspaceId: string): UniversalArtifactDocument {
     const lines = md.split('\n');
     if (lines[0] !== '---') throw new Error('Artifact .md missing YAML frontmatter');
     let endIdx = -1;
     for (let i = 1; i < lines.length; i++) {
       if (lines[i] === '---') {
         endIdx = i;
         break;
       }
     }
     if (endIdx === -1) throw new Error('Artifact .md has unclosed YAML frontmatter');
     const fmStr = lines.slice(1, endIdx).join('\n');
     const fm = (YAML.parse(fmStr) ?? {}) as Record<string, unknown>;
     const body = lines.slice(endIdx + 1).join('\n');

     const {
       subtitle,
       description,
       summary,
       bodyHash,
       ...rest
     } = fm;

     const current = {
       subtitle: (subtitle as string | undefined) ?? undefined,
       description: (description as string) ?? '',
       summary: (summary as string) ?? '',
       body,
     };

     // External edit detection ([19293]): if the Markdown body was edited in
     // VS Code / Git outside MarkBrain, its hash no longer matches `bodyHash`
     // from when the file was exported, while description/summary are non-empty.
     // Mark the summary layers stale so the compiler omits them at `full` cut.
     let layersStaleAt = rest.layersStaleAt as number | undefined;
     const actualHash = contentHash(body);
     const hasSummaryLayers = Boolean(current.description || current.summary);
     if (typeof bodyHash === 'string' && bodyHash !== actualHash && hasSummaryLayers && !layersStaleAt) {
       layersStaleAt = Date.now();
     }

     const doc: Record<string, unknown> = {
       ...rest,
       id: rest.id as string,
       workspaceId: (rest.workspaceId as string) || workspaceId,
       code: rest.code as string,
       title: rest.title as string,
       type: rest.type as 'document' | 'chapter',
       category: rest.category as string,
       isHighConcept: Boolean(rest.isHighConcept),
       current,
       tags: (rest.tags as string[]) ?? [],
       createdAt: rest.createdAt as number,
       updatedAt: rest.updatedAt as number,
     };
     if (layersStaleAt !== undefined) {
       doc.layersStaleAt = layersStaleAt;
     }
     return doc as unknown as UniversalArtifactDocument;
   }
   ```
3. In `snapshotToTree` (`src/domains/plaintextTree.ts:142-155`), spread all metadata keys of `ProjectSnapshot` (excluding the collection arrays `turns`, `chapters`, `artifacts`, `edges`, `threads`, `folders`, `revisions`, and server-only `revision`) into `project.json`, and in `treeToSnapshot` (`src/domains/plaintextTree.ts:236-305`), spread `meta` back into the returned `ProjectSnapshot` so any future project-level field round-trips automatically:
   ```ts
   // In snapshotToTree:
   const COLLECTION_KEYS = new Set([
     'turns', 'chapters', 'artifacts', 'edges', 'threads', 'folders', 'revisions', 'revision',
   ]);
   const meta: Record<string, unknown> = {};
   for (const [k, v] of Object.entries(snapshot)) {
     if (!COLLECTION_KEYS.has(k) && v !== undefined) {
       meta[k] = v;
     }
   }
   entries.push({ path: `${root}/project.json`, data: encodeUtf8(JSON.stringify(meta, null, 2) + '\n') });
   ```
   And in `treeToSnapshot` (around line 290 where `out: ProjectSnapshot` is built):
   ```ts
   const out: ProjectSnapshot = {
     ...(meta ?? {}),
     projectId,
     updatedAt: (meta?.updatedAt as number) ?? Date.now(),
     turns,
     chapters,
     artifacts,
     edges,
   };
   ```

---

## Step 2: Finish the Relational Envelope + `doc_json` Cleanup (`server/db/schemaSpec.ts` & `server/db/projectRepo.ts`)

### 2.1. Why
In `[19286]` and `archive/27` §1, we locked the rule that **every domain entity table** (`projects`, `threads`, `folders`, `turns`, `chapters`, `artifacts`, `artifact_revisions`, `edges`) carries a canonical `doc_json` column (or `edge_json`), and `projectRepo.ts` reads from `doc_json` first so adding new fields to any TypeScript domain interface requires **zero** SQL migrations.

### 2.2. Changes in `server/db/schemaSpec.ts`

1. **`PROJECTS` (`schemaSpec.ts:117-145`):** Add `doc_json TEXT NOT NULL DEFAULT '{}'` to `createSql` and `columns`:
   ```ts
   { name: 'doc_json', ddl: "doc_json TEXT NOT NULL DEFAULT '{}'" },
   ```
2. **`FOLDERS` (`schemaSpec.ts:182-201`):** Add `doc_json TEXT NOT NULL DEFAULT '{}'` to `createSql` and `columns`:
   ```ts
   { name: 'doc_json', ddl: "doc_json TEXT NOT NULL DEFAULT '{}'" },
   ```
3. **`ARTIFACT_REVISIONS` (`schemaSpec.ts:456-486`):** Add `doc_json TEXT NOT NULL DEFAULT '{}'` to `createSql` and `columns`:
   ```ts
   { name: 'doc_json', ddl: "doc_json TEXT NOT NULL DEFAULT '{}'" },
   ```
4. **`TURNS` (`schemaSpec.ts:209-238`) and `CHAPTERS` (`schemaSpec.ts:248-283`):** Give the legacy columns safe defaults in `createSql` and `columns` (`role TEXT NOT NULL DEFAULT 'user'`, `content TEXT NOT NULL DEFAULT ''`, `timestamp INTEGER NOT NULL DEFAULT 0`, `start_turn_id TEXT NOT NULL DEFAULT '0'`, `title TEXT NOT NULL DEFAULT ''`) so the SQL schema never forces callers to duplicate `doc_json` fields just to satisfy `NOT NULL`.

### 2.3. Changes in `server/db/projectRepo.ts`

1. **`SELECT_PROJECT` & `ProjectRow` (`projectRepo.ts:75-104`):** Include `doc_json` in `ProjectRow` and `SELECT_PROJECT`:
   ```ts
   interface ProjectRow {
     project_id: string;
     user_id: number;
     name: string;
     code_name: string;
     description: string;
     color: string;
     active_thread_id: string | null;
     granularity_law: string;
     capabilities_json: string | null;
     doc_json?: string;
     revision: number;
     updated_at: number;
   }

   const SELECT_PROJECT = `SELECT project_id, user_id, name, code_name, description, color,
     active_thread_id, granularity_law, capabilities_json, doc_json, revision, updated_at
     FROM projects WHERE user_id = ? AND project_id = ?`;
   ```
   (Also add `doc_json` to the `SELECT` in `listProjectsForUser` at line 550.)
2. **`upsertProjectMeta` (`projectRepo.ts:240-265`):** Write the project metadata envelope into `doc_json` alongside the envelope columns, and in `assembleProject` (`projectRepo.ts:212-235`), spread any extra fields from `parseJson(row.doc_json, {})` first so future project-level fields survive SQLite round-trips without SQL changes.
3. **`upsertFolder` (`projectRepo.ts:328-335`) & `assembleProject` / `getProjectDelta` folders read:**
   - In `upsertFolder`, write `JSON.stringify(folder)` into `doc_json`.
   - In `assembleProject` (line 138) and `getProjectDelta` (line 1190), `SELECT folder_id, name, order_index, doc_json FROM folders ...` and prefer `parseJson<ThreadFolder | null>(f.doc_json, null) ?? { id: f.folder_id, name: f.name, order: f.order_index }`.
4. **`upsertArtifactRevision`, `loadArtifactRevisions`, `getProjectDelta` (`projectRepo.ts:403-475`, `1212-1241`):**
   - In `upsertArtifactRevision`, write `JSON.stringify(revision)` into `doc_json`.
   - In `loadArtifactRevisions` and `getProjectDelta`, `SELECT artifact_id, version, timestamp, actor, change_summary, provenance_json, title, layers_json, doc_json FROM artifact_revisions ...` and prefer `parseJson<ArtifactRevision | null>(r.doc_json, null)` when present and valid (`doc?.version !== undefined`), falling back to the legacy columns only when `doc_json` is `'{}'` or empty.

---

## Step 3: Upgrade `plaintext-roundtrip.test.ts` to Prove the Full SQLite Dump Bijection (`[19277]`)

### 3.1. Why
In `[19277]`, David specified the exact proof that prevents export/import rot:
> *"You grab example data, load into SQLite, get a dump; assert that the dump has no empty fields, no null fields (prove that we used all tables and all fields at least once). Then export to plaintext export. Then parse it back to a new database. Do SQL export again - do they match?"*

### 3.2. Exact Additions to `src/tests/plaintext-roundtrip.test.ts`

Add two new tests to `src/tests/plaintext-roundtrip.test.ts`:

1. **`it('full SQLite round-trip: DB_1 → Plaintext TarGz → DB_2 produces identical SQL dumps across all domain tables, with zero NULL or empty columns in DB_1')`:**
   - Initialize `:memory:` DB 1 (`initDb(':memory:')`), create a user (`createUser`), and seed the full fixture via `applyProjectSnapshotDiff(user1.id, makeSnapshot())` (plus a tombstone row so `tombstones` is non-empty too, or assert across the 8 project domain tables: `projects`, `threads`, `folders`, `turns`, `chapters`, `artifacts`, `artifact_revisions`, `edges`).
   - **Schema reflection check against `TABLES_SPEC`:**
     - Query `PRAGMA table_info(table)` for every project domain table (`projects`, `threads`, `folders`, `turns`, `chapters`, `artifacts`, `artifact_revisions`, `edges`).
     - Assert every table has `>= 1` row in `DB_1`.
     - Assert that across the rows of each table in `DB_1`, **every column** in `PRAGMA table_info(table)` has at least one row where the value is **non-null and non-empty (`!== ''` and `!== '{}'`)**. (If anyone ever adds a column to `TABLES_SPEC` and forgets to populate it, this assertion fails immediately!)
     - Also walk the parsed `doc_json` / `edge_json` objects in `DB_1` and assert zero `undefined`, zero `null`, and (on the primary seeded entity of each table) zero empty strings/arrays.
   - **Export `DB_1` → `.tar.gz` → Import into fresh `DB_2`:**
     - Load snapshot from `DB_1` via `loadProjectForUser(user1.id, P_ID)`.
     - Export via `const archive = await exportProjectTarGz(loaded1!)`.
     - Initialize a fresh `:memory:` `DB_2` (`initDb(':memory:')`), create a user, and import `const [imported] = await importProjectTarGz(archive)` via `applyProjectSnapshotDiff(user2.id, imported)`.
   - **Assert SQL dump equality (`dump(DB_1) === dump(DB_2)`):**
     - Dump all rows of all 8 domain tables from `DB_1` and `DB_2` (normalizing only `user_id` and `revision` if needed) and assert `expect(dumpDb2).toEqual(dumpDb1)`.

2. **`it('future-field survival + external body edit detection (bodyHash)')`:**
   - Attach an unknown future field `(snapshot.artifacts[0] as any).futureAltitude = 'canopy'` and `(snapshot as any).futureProjectSetting = 'enabled'`.
   - Run `snapshotToTree` → `treeToSnapshot`: assert both `futureAltitude` and `futureProjectSetting` survive intact!
   - Modify the Markdown body of `FIXTURE/artifacts/CORE.md` inside the `TarEntry[]` (simulating a user editing the `.md` file in VS Code / Git without updating the YAML frontmatter's `description`/`summary`), run `treeToSnapshot`, and assert that `restored.artifacts[0].layersStaleAt` is now set to a timestamp (`typeof layersStaleAt === 'number'`).

---

## Step 4: Wire Single-Project `.tar.gz` Export in `src/ui/artifacts/ExportModal.tsx` (`Pack 28 §3.5`)

### 4.1. Why
Pack 28 §3.5 required single-project `.tar.gz` export in `ExportModal.tsx` (or next to the project row). Currently `ExportModal.tsx` only offers one-way JSON/MD/YAML text dumps that cannot be imported back.

### 4.2. Exact Changes in `src/ui/artifacts/ExportModal.tsx` (and `src/App.tsx` if needed)
- Add a prominent **"Download Plaintext Archive (.tar.gz)"** button in the header/footer of `ExportModal.tsx` (or as the default `'plaintext'` format tab in `ExportModal.tsx`) that calls `exportProjectTarGz(snapshot)` for the active project and downloads `${activeProject.meta.codeName || activeProject.meta.id}.tar.gz`.
- In `src/App.tsx` where `<ExportModal>` is rendered (line 1214), pass an `onExportProjectTarGz` callback (or pass the active `ProjectSnapshot` assembled via the same domain getters `persistWorker` uses) that invokes `exportProjectTarGz(snapshot)` and triggers the `.tar.gz` download.

---

## Step 5: Fix the Two Offline-Replica Gaps (`useVpsDeltaSync.ts` & `src/gateway/api.ts`)

### 5.1. Call `rememberReplica` on Delta Sync (`src/application/useVpsDeltaSync.ts`)
- In `src/application/useVpsDeltaSync.ts`, import `getVpsSession, isOfflineReplica, rememberReplica` from `../services/workspaceSession`.
- At the top of `useEffect` (line 206):
  ```ts
  if (getWorkspaceMode() !== 'vps' || isOfflineReplica() || !activeProjectId) return;
  ```
- Inside `pull()`, right after `if (!res.ok) return;` (around line 225):
  ```ts
  const session = getVpsSession();
  if (session?.email) {
    rememberReplica(session.baseUrl, session.email);
  }
  ```

### 5.2. Short-Circuit `apiFetch` in Offline Replica Mode (`src/gateway/api.ts`)
- In `src/gateway/api.ts`, import `isOfflineReplica` from `../services/workspaceSession`.
- In `apiFetch` (`src/gateway/api.ts:169`):
  ```ts
  export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
    if (isOfflineReplica()) {
      return new Response(JSON.stringify({ error: 'Offline replica mode', offline: true }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const session = getWorkspaceMode() === 'vps' ? getVpsSession() : null;
    ...
  ```
- Add a unit test in `src/tests/offline-replica.test.ts` asserting that when `isOfflineReplica()` is true, `apiFetch('/api/projects')` returns HTTP `503` with `{ offline: true }` without invoking global `fetch`.

---

## Step 6: Stream A — Operator Online Backup Script & Ansible `restore_db` (`deploy/ansible/playbook.yml` + `scripts/backup-sqlite.ts`)

### 6.1. Why
In `[19286]` and `archive/27` §1, Stream A (Service Backup/Restore) was specified as:
1. A clean online backup command (`db.backup(...)`) that snapshots `markbrain.sqlite` safely while the server is running and strips ephemeral 7-day `api_call_logs` from the snapshot copy so backups stay small and don't archive transient wire logs.
2. `ansible-playbook deploy/ansible/playbook.yml -e restore_db=/path/to/snapshot.sqlite` so a dead VPS can be restored in 60 seconds.

### 6.2. Create `scripts/backup-sqlite.ts` + `package.json` script
- Add `"backup-sqlite": "tsx scripts/backup-sqlite.ts"` to `package.json`.
- Create `scripts/backup-sqlite.ts`:
  - Usage: `npx tsx scripts/backup-sqlite.ts --out /path/to/markbrain-snapshot.sqlite [--keep-call-logs]`
  - Opens the source DB at `process.env.MARKBRAIN_DB_PATH || 'data/markbrain.sqlite'` using `better-sqlite3`.
  - Uses `await db.backup(outPath)` (SQLite's online backup API — safe while the server is live).
  - Opens the newly written `outPath` DB and (unless `--keep-call-logs` is passed) runs `DELETE FROM api_call_logs; VACUUM;` so Tier-3 disposable wire logs are not carried into operator backups.
  - Add a fast test in `src/tests/plaintext-cli.test.ts` (or `backup-sqlite.test.ts`) verifying `backup-sqlite` copies a live DB and clears `api_call_logs` in the snapshot while leaving the source DB's `api_call_logs` untouched.

### 6.3. Add `restore_db` to `deploy/ansible/playbook.yml` & `deploy/RUNBOOK.md`
- In `deploy/ansible/playbook.yml`:
  - Add `restore_db: ""` to `vars:`.
  - Add tasks before starting `markbrain.service`:
    ```yaml
    - name: 7b. Stop markbrain service before restoring database snapshot (when restore_db is set)
      when: restore_db | length > 0
      systemd:
        name: markbrain.service
        state: stopped
      failed_when: false

    - name: 7c. Remove stale WAL/SHM files before restoring database snapshot
      when: restore_db | length > 0
      file:
        path: "{{ item }}"
        state: absent
      loop:
        - "{{ data_dir }}/markbrain.sqlite-wal"
        - "{{ data_dir }}/markbrain.sqlite-shm"

    - name: 7d. Copy local restore_db snapshot to VPS
      when: restore_db | length > 0
      copy:
        src: "{{ restore_db }}"
        dest: "{{ data_dir }}/markbrain.sqlite"
        owner: markbrain
        group: markbrain
        mode: "0600"
    ```
- Document both `npm run backup-sqlite` (plus a 1-line `cron` / `scp` pull example for the home Ubuntu machine's rolling ring) and `ansible-playbook -i deploy/ansible/inventory.ini deploy/ansible/playbook.yml -e restore_db=/path/to/snapshot.sqlite` in `deploy/RUNBOOK.md`.

---

## Step 7: Update `design-docs/DECISIONS_BACKUP_SQLITE_VS_PLAINTEXT.md` & `design-docs/STATUS.md`

- Once Steps 1–6 are green, update `design-docs/DECISIONS_BACKUP_SQLITE_VS_PLAINTEXT.md` §7 and `design-docs/STATUS.md` so the status table reflects the completed implementation accurately (leaving only the genuinely open Horizon items: `File System Access API` live folder mirror, non-admin continuous export UX exploration, and WASM embeddings).
- Run all three gates (`npx tsc --noEmit`, `npx vitest run`, `npm run build`) and commit cleanly on the current branch.
