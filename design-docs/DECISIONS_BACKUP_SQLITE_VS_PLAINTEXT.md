# Decision Record — Backups, SQLite vs Plaintext, and the Two Problems

**Date of discussion:** 2026-10-26 evening → 2026-10-27. **Status of this file:**
reconstructed decision record, written 2026-10-28 from the *verbatim* transcript
(goose session `20261026_1`, messages 19261–19343 — David's own words quoted
below are exact, not paraphrased). The living docs (`00` Pillar 3, `02` §3)
state the outcomes; this file holds the reasoning and the rejected roads, so
nobody re-proposes them in six months.

---

## §1 The two problems (David's framing — the whole discussion hangs on this)

> "You are right, there are two different problems to solve. But define the
> problems well. One is for the service, backup-restore; and the other is for
> the user, which is guaranteeing their data stays with them even if the
> service provider shuts down. Don't intermix nor simplify with 'you're the
> only user'. I don't care, I might be a perfectionist. I want the stuff well done."

- **Problem A — Service backup/restore:** "My OVH VPS died / got wiped, and I
  want my server back up in 5 minutes with Ansible." Operator concern.
- **Problem B — User data sovereignty:** "I abandon MarkBrain in a year, or the
  app is broken right now, and I just want to read/grep/edit my Unhaunter
  design notes in VS Code or on GitHub." User concern — and it must keep
  working *through* the app, continuously, not at the admin's discretion.

The failure that set the tone for everything after: when the first proposal
blurred the two, David named it exactly —

> "This already points to something I said and you handwaved it — for whom is
> the backup strategy? And you basically went the 'we don't care' strategy.
> Disaster B is for users. This means a feature for users to continuously
> export the data out somewhere. So, in short, you ignored me, you
> oversimplifed, and then you got bitten back because to make it work as I
> need, then I need something overcomplicated."

Lesson recorded: never answer a durability question with "you're the only
user." The two problems get two answers, always.

## §2 The roads rejected, and why

### 2.1 Markdown+YAML Git repo as the *restore source* for the server

Rejected — a hand-written YAML→SQLite reconstruction path is "a second
database engine out of YAML parsers" and it rots: every schema change forces
two edits (exporter + importer) or a restore silently loses state. David
agreed — with a nuance that became the anti-rot law:

> "However proving that it's not rotting is kind of doable. You grab example
> data, load into SQLite, get a dump; assert that the dump has no empty
> fields, no null fields (prove that we used all tables and all fields at
> least once). Then export to plaintext export. Then parse it back to a new
> database. Do SQL export again — do they match?"

→ This is exactly the **bijective round-trip CI test** that shipped
(`plaintext-roundtrip.test.ts`, with the reflective rot-detector).

### 2.2 SQL dumps as the user-facing archive (the 10-year MySQL scar)

> "Because there are problems with standard tooling for SQL databases. You
> might try to restore and find out the backup was corrupted, or that the new
> version doesn't read the old one. They're either full of SQL commands, not
> really diffable, or binary, not diffable at all. Extracting data from them
> is hard to impossible, you need to restore them in full.
>
> Look, I have a MySQL dump from 10 years ago from that PHP website, and
> someone asked me for data on it, and basically I told them no. It means to
> restore the full 5GB of data into a real MySQL, and then see how do you
> extract from there, how do you locate the data exactly. Will that decade
> old backup work on a modern MySQL or will I need to patch the contents
> manually? Cause it's not the first time I had to patch a sql backup by hand."

Nuance kept honest:

> "and maybe it is an overreaction. Sqlite shouldn't be changing much
> nowadays.... unless the vibecoding crazyness gets onto them. But... doubt.
> But Git isn't a place to store dumps. My local computer? sure."

→ Consequence: binary `.sqlite` snapshots are for the **operator stream**
(home machine, rolling ring, out of Git). Git and user handouts get **plaintext
only**.

### 2.3 Dumps in the auto-pushed Git repo

> "NOPE, because backups change way too much in ways they're not diffable
> cleanly and it will grow out of hand inside Git."

### 2.4 Plaintext-as-the-runtime-store

David himself killed this one:

> "the problem with plaintext storage isn't collisions... the problem is
> security. And performance to some degree. But security — the way each OS
> treats paths... one could maybe inject something to make you write something
> where it does not belong, or read outside from where you're supposed to. ...
> it feels like a minefield between performance and security traps. ... the OS
> does not treat the FS like a database and as it grows, it is very
> inefficient caching it, making it really slow."

→ SQLite stays the runtime store (battle-tested, OS page-cache friendly,
WAL for crash consistency). Plaintext is an *export/import format*, never the
store.

## §3 The schema-change fear → Declarative Annealing

> "on SQL - I am scared of schema changes. We need to add more features, then
> I deploy the new binary.... how do you get the schema changed? reliably?
> Because 20 years ago, for work, I got to make a python program that was
> enforcing database schemas from config definition, no migration sql. That
> was a thing. At least that was workable. The djano's way of database
> migrations are... very flaky. If anything is different or unexpected, you're
> stuck. Whereas the 'intent' vs 'production' annealing approach is much more
> robust.
>
> And I don't like NoSQL, I think it's mostly pure theater. However, for the
> most part it sidesteps the schema problem? Or am I wrong here..."

Answer given and accepted: NoSQL sidesteps the migration problem by giving up
the query model — not worth it. The 20-years-ago pattern is the right one:
**intent (TABLES_SPEC) vs production (live DB) annealed on every boot**
(`server/db/schemaSpec.ts`, `annealDatabase()`), plus the envelope law
(`doc_json` is canonical; legacy columns survive; never DROP) so most feature
work needs zero schema change at all.

## §4 The locked combination

Presented as one block and answered with "That IS fantastic, and that IS where
we need to go. Please record all of this down in files.":

1. **SQLite at runtime** — security + OS caching. (§2.4)
2. **Envelope columns + `doc_json` payload + Declarative Annealing on boot** —
   no brittle migration ladder. (§3)
3. **Bijective, CI-proven Plaintext Tree export/import** — for Git-diffable
   backups and user sovereignty; **binary `.sqlite` snapshots stay out of Git**
   and live on the home machine for 60-second Ansible restore. (§2.1–2.2)

## §5 The hole David named in the same breath (still open)

> "However, the 'hole' is — can we make this continuous plaintext export
> available for users that are not the admin? Can a user import a whole
> project directly into a different provider from one of the continuous
> exports? This is something to think way more carefully — in the full UX, on
> what's the promise, what's the actual want. I am not clear on what I want.
> And it might be either not doable, or just overengineering for zero benefit.
> I know that for me, it would enter the zero benefit area since I could
> short-circuit it as owner. But I would like to explore it (mentally) to see
> if it is doable."

**OPEN.** Not designed, not built, deliberately. The three export "Ways"
considered the next day got verdicts (§6), but the *promise* of non-admin
continuous export — what the user is actually being handed — is undecided.

## §6 Related locks that came out of the same exchange

- **Format: `tar.gz`, period.**
  > "Windows users can install Linux and start learning how a computer works,
  > thanks. tar.gz. I'm not making my life more complicated for Windows users."
- **"VPS Light as a Feather"** (standing architecture law):
  > "No, cause this burns my VPS resources. Oh, note this down: VPS backend
  > needs to be light as a feather. Everything in the client as much as
  > possible. The backend must stay super light, zero resources used."
- **The three Ways for user-side export** (solutions to §5's hole):
  Way 1 (server pushes to user's GitHub) — "This sounds like a PIA. Skip."
  Way 2 (browser writes the Plaintext Tree to a local folder via File System
  Access API; each device becomes its own replica) — "THIS is genius. The only
  thing I see here is that they need to be able to access to the local data
  without requiring login from the VPS backend." → that last requirement is
  the **offline replica** feature that shipped in Pack 1. Way 3 (authenticated
  pull endpoint) — killed by the feather law above. A local operator CLI was
  accepted because "this isn't externally called, I don't care if it spends
  resources."
- **WASM browser embeddings** (same conversation, same two-problems habit):
  > "1) Embedding quota isn't exactly free. Doing it locally makes the quota
  > infinite. As long as you have CPU. ... 2) On airplane mode, I can search
  > still using my embeddings!"

## §7 Where each piece stands today (verified against code 2026-10-28; fix plan `BACKUP_DISCUSSION_FIX_PLAN.md` EXECUTED same day — all gates green: tsc clean, 689 tests / 77 files, build + secret scan clean)

| Piece | Reality in Code Today |
|---|---|
| Two-problems framing (service vs user) | DECIDED — standing law |
| Declarative schema annealing (`TABLES_SPEC` + `annealDatabase`) | BUILT (`server/db/schemaSpec.ts`) |
| **Relational Envelope + `doc_json` across all domain tables** | **SOLVED (Step 2 executed 2026-10-28):** every domain table now carries a canonical `doc_json` (`projects`, `folders`, `artifact_revisions` added; `edges` keeps `edge_json`); `turns`/`chapters` legacy columns have safe defaults; reads prefer `doc_json` and fall back to legacy columns only for pre-envelope rows; writes keep the legacy columns honest. Known honest limits: (a) folder change detection still compares `name`/`order_index` only, so a folder whose ONLY change is a future field won't be re-upserted; (b) `getProjectDelta.projectMeta` is a fixed-shape object (no extras) AND the client never reads `delta.projectMeta` at all — so future project-level fields survive full loads but do not ride the delta sync. |
| **Bijective plaintext tree (`plaintextTree.ts`)** | **SOLVED (Step 1):** `artifactToFrontmatter`/`parseArtifactMarkdown` spread ALL properties instead of a hardcoded whitelist (only `current` is split into frontmatter + Markdown body), and `snapshotToTree`/`treeToSnapshot` spread all `project.json` meta. A new field on `UniversalArtifactDocument` or `ProjectSnapshot` round-trips automatically. |
| **External `.md` edit detection (`bodyHash` → `layersStaleAt`)** | **SOLVED (Step 1):** export writes `bodyHash` into the frontmatter; on import a hash mismatch (with non-empty description/summary) sets `layersStaleAt` so stale summaries never reach the LLM. Old archives without `bodyHash` import unchanged. |
| **100%-coverage SQLite round-trip bijection test (`[19277]`)** | **SOLVED (Step 3):** `plaintext-roundtrip.test.ts` seeds DB_1, asserts `PRAGMA table_info` coverage (every column of all 8 domain tables carries at least one non-null/non-empty/non-'{}' value), exports `DB_1 → tar.gz → DB_2` and asserts SQL dump equality, plus future-field survival and external-edit tests. |
| **Client `.tar.gz` export/import (`Pack 28 §3.5`)** | **SOLVED (Step 4):** `ExportModal` has a "Download Plaintext Archive (.tar.gz) — re-importable backup" button; `App.tsx` assembles the live snapshot exactly like the persist worker and downloads `<codeName>.tar.gz` via `exportProjectTarGz`. (All-projects sidebar backup already existed.) |
| **Offline replica (`Pack 28 §3.6`)** | **SOLVED (Step 5):** `useVpsDeltaSync` calls `rememberReplica(baseUrl, email)` after a successful delta pull and skips polling entirely in offline mode; `apiFetch` short-circuits to HTTP 503 `{offline:true}` without touching the network when `isOfflineReplica()` (unit-tested). |
| **Stream A: Operator `.sqlite` online backup + Ansible `restore_db`** | **SOLVED (Step 6):** `npm run backup-sqlite` (SQLite online backup API, strips `api_call_logs` + VACUUM from the snapshot unless `--keep-call-logs`; source untouched — tested); `playbook.yml` gained `restore_db` (stop service → remove WAL/SHM → copy snapshot with `markbrain:markbrain 0600`); RUNBOOK documents the cron+scp rolling ring and the one-command restore. |
| Operator Plaintext CLI (`scripts/plaintext-cli.ts`) | BUILT (Pack 6) |
| WASM browser embeddings | **OPEN** — locked direction, spike pending (`07`) |

*Full verbatim transcript: goose sessions DB, session `20261026_1`,
messages 19261–19343 (2026-10-26 20:39 → 2026-10-27 22:12).*
