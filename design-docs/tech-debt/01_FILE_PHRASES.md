# File Phrases — every file, one sentence

*2026-10-30 @ fe3fbdd. The law: **It [verb] [what] for [whom] — and nothing else.** If one phrase can't explain it, something is at fault. Verdicts: OK / AND (two tenants) / LEAK (facade bypassed or internals exposed) / JARGON (outsider can't parse the words) / ??? (unphrasable). Method: `00_METHOD.md`.*

---

## src/domains — 40 files, 5,381 LOC (30 OK / 7 AND / 1 LEAK)

| file | phrase | verdict | evidence | so-what |
|---|---|---|---|---|
| 00-workspace/index.ts (17) | It re-exports the workspace domain's files | LEAK | Defines a SECOND inline IWorkspaceDomain with `any` types, missing removeProject; real typed one in interface.ts | Two contracts for one domain; consumers through the door get `any` and lose the types the domain enforces |
| 00-workspace/interface.ts (18) | It states what you may ask of the workspace | OK | interface only | — |
| 00-workspace/types.ts (27) | It names the pieces of a workspace | OK | types only | — |
| 00-workspace/WorkspaceDomain.ts (138) | It holds the list of projects and which one is open | OK | 11 methods, one story | — |
| 01-artifact-document/index.ts (3) | It re-exports the note store | OK | 3-line re-export | — |
| 01-artifact-document/interface.ts (21) | It states what you may ask of the note store | OK | interface only | — |
| 01-artifact-document/types.ts (69) | It describes what one note is, layer by layer | OK | types + one predicate | — |
| 01-artifact-document/ArtifactDocumentDomain.ts (187) | It stores the notes and serves their text at the chosen cut | OK | 9 methods, one job; BUT its STALE_LAYERS_NOTICE is deep-imported by 03-optical-compiler across the domain boundary | the bypass means this file's real contract includes a constant nobody asked for |
| 01-artifact-versioning/index.ts (3) | It re-exports the version store | OK | re-export | — |
| 01-artifact-versioning/interface.ts (44) | It states what you may ask of the version store | OK | interface | — |
| 01-artifact-versioning/types.ts (33) | It describes one saved revision | OK | types | — |
| 01-artifact-versioning/ArtifactVersioningDomain.ts (133) | It keeps every past version of each note and can restore one | OK | 133 LOC, single tenant | — |
| 01-dialogue-timeline/index.ts (3) | It re-exports the conversation log | OK | re-export | — |
| 01-dialogue-timeline/interface.ts (15) | It states what you may ask of the conversation log | OK | interface | — |
| 01-dialogue-timeline/types.ts (73) | It describes one message of the conversation | OK | Turn + events | — |
| 01-dialogue-timeline/DialogueTimelineDomain.ts (83) | It keeps the conversation's messages in order | OK | 83 LOC, own files only | — |
| 02-chapter-segmentation/index.ts (4) | It re-exports the chapter list | OK | re-export | — |
| 02-chapter-segmentation/interface.ts (48) | It states what you may ask of the chapters | OK | interface | — |
| 02-chapter-segmentation/types.ts (33) | It describes one chapter | OK | types | — |
| 02-chapter-segmentation/ChapterSegmentationDomain.ts (241) | It splits the conversation into chapters and moves their boundaries | OK | 13 methods, one story | — |
| 02-chapter-segmentation/selectors.ts (153) | It answers read-only questions about chapters | OK | pure functions on reader inputs | — |
| 02-topological-graph/index.ts (3) | It re-exports the link map | OK | re-export | — |
| 02-topological-graph/interface.ts (16) | It states what you may ask of the link map | OK | interface | — |
| 02-topological-graph/types.ts (29) | It describes one link between two notes | OK | types | — |
| 02-topological-graph/TopologicalGraphDomain.ts (111) | It stores how notes point at each other | OK | 111 LOC CRUD + events | — |
| 03-chapter-recalibration/index.ts (48) | It re-summarizes a chapter by asking the model about that chapter's turns | OK | one method; no facade (impl IS index.ts) but harmless at 48 LOC | — |
| 03-optical-compiler/index.ts (454) | It packs the model's context payload AND names note files AND writes the system instruction AND renders XML | AND | exports artifactFileName/slugHandle/uniqueFileName next to compile(); tests import it just for filenames; impl IS index.ts | filename rules live in the send-path module; four concerns one edit away from each other |
| 03-stream-protocol/index.ts (396) | It strips hidden tags out of model replies AND runs the whole network turn AND broadcasts status events | AND | demux parsing + executeStreamingTurn (SSE reader, HTTP errors, aborts) + pub-sub in one class; imports chatStream so parser can't be imported without the network; impl IS index.ts | the demuxer (seam of the last escaped bug) is unreachable without the send machinery |
| 06-chat-threads/index.ts (1) | It re-exports the chat threads | OK | re-export | — |
| 06-chat-threads/types.ts (205) | It describes a chat thread AND merges capability flags AND builds titles AND derives queue state | AND | 205 LOC "types" with resolveCapabilities, titlePipelineStep, deriveThreadRuntime, queuePositionOf | policy (capability merging, title pipeline) in a file named types; deep-imported by 6+ files so all tenants are public |
| 06-chat-threads/ThreadRegistry.ts (789) | It keeps all chat threads AND folders AND staged attachments AND inactive-thread content AND auto-titles | AND (worst offender) | 789 LOC, ~45 public methods across 5 tenants | highest-churn file in the app; attachment-provenance laws buried mid-file; nobody can describe it, so nobody can safely refactor it |
| DomainRegistry.tsx (398) | It creates all the domains and hands them to React AND runs sign-in AND saving AND server sync AND thread switching | AND | imports all 10 domains plus 8 application/service modules; DomainContextValue has 27 fields | composition root fused with auth/sync/save orchestration; any change re-renders all useDomains consumers; classic stale-closure trap |
| granularity.ts (176) | It defines the four-level cut of a note AND paints the attachment buttons | AND | Granularity/cutIncludes next to ATTACHMENT_STATE_PALETTE/getGranularityChipClass (hardcoded styling in a domain vocabulary file) | restyling the attachment rail means editing a file ten domains import for its type |
| plaintextTree.ts (388) | It turns a workspace into a folder of readable markdown files and back | OK | round-trip is one contract | — |
| callLogTypes.ts (136) | It describes one recorded API call AND how logs are scrubbed/capped/expired AND how to read their timings | AND (mild) | "types" name but exports scrubRequestDeep, pruneCallLogIds, callDurations + TTL/caps; shared by server and client | retention policy lives where an outsider would never look |
| search/searchConfig.ts (121) | It loads and saves the search settings between sessions | OK | localStorage load/save + normalization | — |
| search/queryVectorCache.ts (198) | It remembers recent query embeddings so near-identical searches skip the network | OK | one class + supporting math | — |
| search/draftSearchEngine.ts (492) | It scores the draft's sentences against saved notes to say which notes back which sentence | OK | 492 LOC but one job (BM25/vector/QA are strategies of that one job) | — |
| search/ (no index) | — | (no facade) | App deep-imports all three files | no single door, but each file honest |

**Facades verdict:** the six numbered domains with `index.ts` re-exports are honest — but bypassed by deep `types.ts` imports in UI/application code. `00-workspace/index.ts` is dishonest (duplicate untyped interface at the front door). `03-stream-protocol`, `03-optical-compiler`, `03-chapter-recalibration` have NO facade (implementation lives in index.ts). `granularity/plaintextTree/callLogTypes/DomainRegistry/search` have no facade notion at all.

---

## src/ui — 43 files, 14,192 LOC (33 OK / 7 AND / 2 LEAK / 1 ???-adjacent)

| file | phrase | verdict | evidence | so-what |
|---|---|---|---|---|
| artifacts/ArtifactDetailModal.tsx | It opens one artifact in full—every field, its revision history, its Q&A pairs—for the person inspecting it. | OK | 781 LOC, one subject throughout; deep-looking imports all pass through exported facades | — |
| artifacts/ArtifactsLibraryView.tsx | It lists the project's artifacts for browsing, and also runs the search-tuning workbench. | AND | 716 LOC; imports three search-machinery modules directly + embeds SpatialGraph and AttachmentControls | Library browsing and a search-experiment bench are two tenants; the tuning controls drag search internals into a browsing view |
| artifacts/ExportModal.tsx | It saves the whole project to a file in the format you pick. | OK | 181 LOC, single export contract | — |
| artifacts/ImportModal.tsx | It brings artifacts into the project from files. | OK | 340 LOC, one job; session delegated to useImportSession | — |
| artifacts/RevisionTriageModal.tsx | It sorts out newly imported artifacts that look like duplicates, one flagged pair at a time. | OK | 238 LOC, single triage screen | — |
| artifacts/createArtifactHandlers.ts | It performs the actions on artifacts—create, rename, delete, import-flagging—for the rest of the app. | OK | 492 LOC, one contract; deletion delegated to purgeArtifact | — |
| artifacts/import/ImportSessionList.tsx | It shows the progress of the files being imported, row by row. | OK | 372 LOC, pure progress list | — |
| artifacts/import/useImportSession.ts | It runs a multi-file import, turning each file into artifacts one at a time. | OK | 423 LOC, one session lifecycle | — |
| artifacts/purgeArtifact.ts | It removes an artifact everywhere it is mentioned, for the whole app. | LEAK | 55 LOC; imports five domains' interfaces + serverMutationQueue; its doc comment enumerates the five storage places it scrubs by hand | A ui/ file doing cross-domain surgery: it knows where every domain hides a reference — add a sixth reference holder and this file silently rots |
| chat/CapabilitiesPopover.tsx | It lets you turn on or off what each chat sends to the AI. | OK | 106 LOC; its only domain import is re-exported by the domain's index — no facade bypass | — |
| chat/ChatView.tsx | It shows the conversation plus the composer, and also the drafts tray, the chapter controls, and read-aloud playback. | AND | **2,341 LOC**, ~45 props, ~12 tenants (feed, composer, receipts, TTS, title editing, chapter headers, attachments, capabilities, vault padlock, clipboard, streaming, enter-send); directly orchestrates device TTS caching, vault unlock, send readiness | Message feed, composer, drafts, chapter editing and audio playback are separate tenants; every recent feature (receipts, TTS) landed here by default — the riskiest file in ui/ is the most-edited |
| chat/MessageBody.tsx | It renders one chat message, formatted or as raw source. | OK | 46 LOC | — |
| chat/ThreadSwitcher.tsx | It lets you switch which chat you are talking in. | OK | 171 LOC | — |
| chat/chatRenderMode.ts | It remembers whether you read messages formatted or as raw source, for this browser. | OK | 54 LOC, zero imports | — |
| chat/createChapterHandlers.ts | It fills in the sealed summary of a finished chapter. | OK | 219 LOC, one job | — |
| chat/createSuggestTitle.ts | It suggests a name for a chat from what was said in it. | OK | 42 LOC | — |
| chat/sendOnEnter.ts | It remembers whether pressing Enter sends the message or starts a new line. | OK | 81 LOC, zero imports — header comment IS the contract | — |
| chat/useThreadSwitcher.ts | It connects the chat picker's choices to the rest of the app. | OK | 44 LOC | — |
| chat/useThreadUi.ts | It works out how every chat currently stands—running, queued, unread. | OK | 69 LOC, one derived-state contract | — |
| cleanup/CleanupModal.tsx | It shows exactly what a cleanup would remove, for your confirmation. | OK | 465 LOC, one confirm-screen contract | — |
| cleanup/createCleanupHandlers.ts | It carries out the cleanup you approved, in the safe order. | OK | 58 LOC | — |
| context/AttachmentControls.tsx | It is the one widget for attachments, everywhere attachments appear. | OK | 415 LOC, single widget reused by library and mirror | — |
| context/EdgeHeatStrip.tsx | It draws the strip showing everything that will be sent, piece by piece. | OK | 57 LOC | — |
| context/MirrorPanel.tsx | It shows the exact message that would be sent right now, word for word. | OK | 436 LOC; domain imports are facade-level and exist so the preview is the real compiled payload | — |
| context/SaturationOrb.tsx | It shows, as one colored orb, how close to the limit the conversation is. | OK | 39 LOC | — |
| context/ambientTelemetry.ts | It computes the fullness figures behind the two context gauges. | OK | 68 LOC, one computation serving both gauges | — |
| context/ttsTransport.ts | It is the single player for read-aloud audio—play, pause, resume, seek—for the whole app. | OK | 284 LOC, one transport contract; zero external imports beyond React and WebAudio | — |
| context/useContextPayload.ts | It builds the exact text that would be sent right now, for the mirror panel. | OK | 99 LOC | — |
| graph/SpatialGraph.tsx | It draws the interactive map of artifacts for the person exploring how they connect. | OK | 755 LOC, one canvas contract; no domain internals | — |
| graph/createGraphHandlers.ts | It applies map edits—node positions, new links—for the graph view. | LEAK | 45 LOC; stores a node's position by rewriting the whole artifact record — the UI knows node positions live inside the artifact, not behind the graph domain | If positions move to the graph domain, this file breaks first |
| system/CriticalNotifications.tsx | It shows the one red banner when something serious failed. | OK | 54 LOC | — |
| uiFontScale.ts | It remembers how big the interface text is, for this browser. | OK | 54 LOC, zero imports | — |
| workspace/AuthGate.tsx | It is the front door—server sign-in, this device, or a saved offline copy. | OK | 320 LOC; three entry paths but one contract (getting in) | — |
| workspace/BootSplash.tsx | It shows the opening splash while the app starts up. | OK | 19 LOC | — |
| workspace/ChatErrorBoundary.tsx | It contains a crashed chat screen, offering a restart. | OK | 96 LOC | — |
| workspace/ModelSettingsModal.tsx | It is the screen for choosing which AI model to use, and also for keys, account settings, and admin users. | AND | **1,091 LOC**; six modules' concerns (gateway account + admin endpoints, modelConfig, keySlots, localKeyVault, vaultReArm, workspaceSession) in one modal | Model choice, key management, account/password and admin-user administration share one screen — historically where external-API incidents lived |
| workspace/ProjectGenesis.tsx | It is the starting screen for creating a brand-new workspace. | OK | 217 LOC | — |
| workspace/ProjectLauncher.tsx | It is the screen for choosing among your projects or starting one. | OK | 519 LOC, one choosing screen | — |
| workspace/ReadAloudControls.tsx | It is the play–pause–volume panel for read-aloud, in the sidebar. | OK | 94 LOC; all state from the ttsTransport facade | — |
| workspace/ServerLogsModal.tsx | It replays what the server actually did, for the person debugging. | OK | 486 LOC, one diagnostics contract | — |
| workspace/Sidebar.tsx | It holds navigation and settings at once—the chat list, the model choice, the reading preferences, the voice. | AND | **1,506 LOC**; ActiveView switching + model picker + three reading preferences + TTS voice list + embedded ReadAloudControls + connectivity status | Navigation, model selection, three preferences and the audio panel share a 1.5k-line nav file |
| workspace/UserAvatar.tsx | It shows the signed-in person's picture or initial. | OK | 40 LOC | — |
| workspace/createWorkspaceHandlers.ts | It launches the app into a chosen project. | OK | 48 LOC | — |
| workspace/useDatabaseTransfer.tsx | It moves a whole workspace in or out of the app as a single file. | OK | 156 LOC | — |

**Verdict:** src/ui respects "facade simple, complexity internal" on average (77% clean), but the tail is heavy — the extraction habit that produced the exemplary small files **stops being applied once a file passes ~700 lines**, which is exactly where recent feature work accumulated.

---

## src/{application, services, data, gateway, prompts, utils, types} + App/main — 56 files (40 OK / 11 AND / 5 LEAK / 7 more LEAK-adjacent in data+gateway)

| file | phrase | verdict | evidence | so-what |
|---|---|---|---|---|
| application/cleanupPlan.ts | It plans which artifacts can be safely deleted without breaking chats that still use them. | OK | 137 LOC, pure planning, no I/O | — |
| application/snapshotLoader.ts | It fills the app's working memory with a saved project so everything reopens where it was. | OK | 124 LOC, all downward imports | — |
| application/artifactIndexer.ts | It builds the searchable index of a project's notes. | AND | 516 LOC; also exports `mapLimit`, a generic concurrency utility unrelated to indexing | A generic concurrency helper rides along in the indexing file |
| application/draftQueue.ts | It keeps the list of messages being sent, tracking progress, retries, and edits. | OK | 381 LOC, one tenant | — |
| application/serverMutationQueue.ts | It holds changes made while offline so they can be sent to the server later. | LEAK | 109 LOC; line 66 branches `if (isCaptureMode()) return;` inside production queueing logic | In capture mode real mutations silently don't queue — a dev seam inside the queue's path |
| application/composerDrafts.ts | It remembers unfinished text you typed in the message box, per chat. | OK | 111 LOC, one tenant | — |
| application/connectivity.ts | It knows whether the browser currently has internet. | LEAK | 62 LOC; exports `setOnlineForTests` — a test seam mutating module state in production code | Tests can flip connectivity for every consumer |
| application/sessionMachine.ts | It runs the sign-in session, including unlocking the key vault on the way in. | OK | 309 LOC, one session lifecycle | — |
| application/useVpsDeltaSync.ts | It applies changes that happened on the server to your currently open project. | LEAK | 306 LOC; line 29 imports `ProjectDeltaResponse` from `../../server/db/projectRepo` — the client reaches into the server's database module for its type | The client's data contract is owned by server code |
| application/persistWorker.ts | It saves the whole project in the background on a schedule. | LEAK | 195 LOC; line 79 branches on `isCaptureMode() && !isSlowSaveSeam()` inside the save path | Whether the project saves at all depends on hidden dev flags |
| application/sendQueue.ts | It carries an outgoing message from queue to finished reply, saving whatever the reply produced along the way. | AND | **1,387 LOC**; also owns reply artifact application, auto-retitling, vault-locked recovery, and server job reconciliation | At least three tenants in one class — too big to test or change safely in one place |
| App.tsx | It is the app's single screen, wiring every view, modal, and button to the machinery underneath. | AND | **1,315 LOC**, ~80 imports; root component plus settings state, search indexing, cache management, handler factories | The root screen doubles as the state hub for models, search, indexing, and preferences — every feature change lands here |
| main.tsx | It boots the app. | OK | 26 LOC | — |
| services/stores/hydrate.ts | It repairs old saved project files into the shapes the app now expects. | OK | 178 LOC, one tenant | — |
| services/stores/localStore.ts | It is the browser-local version of project storage. | OK | 44 LOC, thin adapter | — |
| services/stores/projectStore.ts | It defines what a saved project looks like. | OK | 50 LOC, pure contract definition | — |
| services/stores/vpsStore.ts | It is the server version of project storage, holding writes when offline. | OK | 219 LOC, one backend implementation | — |
| services/searchIndexStore.ts | It keeps generated questions and search vectors in their own throwaway browser database. | OK | 161 LOC, zero imports | — |
| services/localBackend.ts | It reads and writes whole projects in the browser's local database. | OK | 116 LOC, one tenant | — |
| services/persistenceService.ts | It saves and loads the project through whichever backend is active. | LEAK | 328 LOC; exports `isFixtureMode`/`isCaptureMode`/`isSlowSaveSeam` — three dev seams living in production code — and imports the fake dataset `HEADLESS_FIXTURE` from `data/headlessFixture` | Test/dev modes woven into the storage service every feature touches |
| services/offlineOutbox.ts | It remembers which project changes still need sending when you're offline. | OK | 268 LOC, one tenant | — |
| services/vpsSync.ts | It brings the server's latest project state into the app, replaying changes made offline. | LEAK | 198 LOC; line 30 imports `flushServerMutations` from `../application/serverMutationQueue` — a service reaching UP into the application layer | Sync calls back up into orchestration; the replay trigger should be handed in from above |
| services/callLogStore.ts | It logs every AI call from start to finish. | OK | 168 LOC, one tenant | — |
| services/workspaceSession.ts | It remembers which workspace you're in — and every server you've ever used. | AND | 272 LOC; tenants: mode + VPS session state, a known-replicas registry, and `getScopedStorageKey` naming | Three contracts in one file; consumers import whichever they need and the seams blur |
| data/headlessFixture.ts | It holds a made-up project used by automated runs. | LEAK | 136 LOC; test fixture data shipped in production source, importing upward from services | Fake data compiled into the app |
| data/models.ts | It provides the fallback model shown when the model list can't load. | OK | 12 LOC | — |
| data/byokFlag.ts | It says whether the bring-your-own-key feature exists in this build. | LEAK | 23 LOC; exports `setByokEnabledForTests` | A security-relevant feature flag can be silently flipped at runtime |
| data/keySlots.ts | It decides which API key signs each kind of AI request. | LEAK | 212 LOC; imports `getWorkspaceMode` from services — data reaching UPWARD into services to make its decisions | Key selection depends on session state owned two layers up |
| data/modelConfig.ts | It stores which AI model fills each job. | LEAK | 159 LOC; imports from services for storage naming and mode | Model config storage is coupled to session internals |
| data/localKeyVault.ts | It stores API keys encrypted behind your passphrase. | LEAK | 231 LOC; exports `setPbkdf2IterationsForTests` — a test seam weakening the key-derivation strength at runtime | A test hook can dial down encryption cost inside the shipped vault module |
| data/vaultReArm.ts | It keeps your unlock key in memory so a locked vault doesn't strand the session. | LEAK | 74 LOC; imports `apiFetch` from gateway — a storage-layer module performing network calls | The unlock request should be driven from a layer that owns network access |
| data/ttsDeviceCache.ts | It caches spoken-audio files so the same text isn't regenerated. | OK | 83 LOC, one tenant | — |
| data/sendReadiness.ts | It decides whether sending a message is possible right now. | LEAK | 100 LOC; imports upward from services + a dev-seam branch at line 89 (`if (isCaptureMode()) return { ok: true ...}`) | The send gate silently approves every send in capture mode — a hidden bypass in a security-ish check |
| gateway/providers/types.ts | It defines what every AI provider adapter must provide. | OK | 132 LOC, zero imports | — |
| gateway/providers/gemini.ts | It speaks Gemini's language on the app's behalf. | LEAK | 279 LOC; imports `recordCallStart/.../recordCallEnd` from services — gateway reaching upward while translating for Gemini | The provider translator writes into an app-level log store |
| gateway/providers/openrouter.ts | It speaks OpenRouter's language on the app's behalf. | LEAK | 237 LOC; same upward reach as the Gemini adapter | Adding a provider means copying the upward dependency again |
| gateway/direct.ts | It hands each AI job to the provider adapter that should run it, with the right key. | LEAK | 333 LOC; imports `recordCallStart/recordCallEnd` from services (upward) | The router between app and providers writes the app's call log itself |
| gateway/api.ts | It is the app's single door to the server and the AI providers. | LEAK | 601 LOC; imports upward from three services, re-exports a services type, and lines 39–156 embed the capture-mode fixture stream (a fake provider) inside production code | The one file every network call crosses carries three layers' concerns with it |
| prompts/prompt.ts | It composes the instructions given to the AI for each job. | OK | 228 LOC, one tenant | — |
| prompts/lanes.ts | It writes the prompts for naming chats and quizzing notes — and scrubs text for speech output. | LEAK | 174 LOC; imports a services type (reverse dependency), and carries TTS text cleanup beside title/QA prompt building | Prompt text depends on a storage service's type; speech-text handling is an unrelated tenant |
| utils/estimateTokens.ts | It guesses how many tokens a piece of text will use. | OK | 13 LOC | — |
| utils/contentHash.ts | It fingerprints text so identical content can be recognized. | OK | 17 LOC | — |
| utils/storageSanitize.ts | It cleans values so they survive being saved and read back. | OK | 19 LOC | — |
| utils/contextWindow.ts | It computes how full the AI's memory window is. | OK | 22 LOC | — |
| utils/clipboard.ts | It copies text to the clipboard and tells you if it worked. | OK | 35 LOC | — |
| utils/deadline.ts | It abandons slow operations after a time limit. | OK | 44 LOC | — |
| utils/sentinelParser.ts | It reads the marked sections the AI was told to include in its reply. | OK | 44 LOC | — |
| utils/importRules.ts | It applies your import preferences to newly imported notes. | OK | 68 LOC | — |
| utils/importDetect.ts | It spots when an imported note duplicates or updates one you already have. | OK | 84 LOC | — |
| utils/lineDiff.ts | It shows what changed between two versions of a text. | OK | 86 LOC | — |
| utils/logger.ts | It collects the app's own log messages in one place. | OK | 125 LOC | — |
| utils/markdown.ts | It turns note text into safe HTML for display. | OK | 302 LOC, XSS-safe by design | — |
| utils/sectionChunker.ts | It cuts a long note into sections so search can work piece by piece. | OK | 227 LOC, one job | — |
| utils/tokenCalculator.ts | It sizes text in tokens for the saturation display — and exports the whole project as files. | AND | 206 LOC; also exports `getTokenColor` (UI coloring) and `exportToJSON/Markdown/YAML` (project export) | A UI color helper and a project-export feature share a file named after math |
| utils/yamlArtifactParser.ts | It converts notes between the app's objects and YAML text. | OK | 162 LOC | — |
| utils/tarGz.ts | It packs files into compressed archives and reads them back. | OK | 217 LOC, one codec | — |
| types/index.ts | It collects the app's shared type definitions — and also ships a UI color palette. | AND | line 43 exports `MELLOW_DARK_PASTELS`, a runtime color array, alongside the type hub | Importing "just types" pulls styling decisions into every consumer |

**Verdict:** `src/utils` is NOT a junk drawer (15/17 single-phrase; the fan-in 107 is healthy leaf-magnetism). `src/data` is the least healthy layer — 7 of its 9 files reach upward into services/gateway or carry test seams. The gateway writes the app's call log from inside its adapters. Dev/test seams live inside five production files, including one that silently approves sends and one that weakens the KDF.

---

## server/ — 31 files, 7,309 LOC (24 OK / 5 AND / 1 pure LEAK / 6 LEAK side-notes)

| file | phrase | verdict | evidence | so-what |
|---|---|---|---|---|
| app.ts | It assembles and starts the web server: routes, auth gate, security headers, database. | OK | 151 LOC; composition root — assembly IS the one job | — |
| db/index.ts | It opens the project's SQLite database and hands everyone the same connection. | OK | 63 LOC | — |
| db/schemaSpec.ts | It declares every database table in one list and creates anything missing at boot. | OK | 610 LOC; 17 TableSpecs + idempotent annealer; duplication (createSql *and* column list) is internal | — |
| db/projectRepo.ts | It saves and loads everything inside a project — and also commits finished chat replies into it. | **AND → ???** | **1,501 LOC; ~10 tenants**: snapshot assembly, 8 row-writer families, revision history, snapshot-diff merge, atomic mutations, a ~500-line `commitJobPairTransaction` (artifacts + topic-shift chapters + link/unlink graph edits + tombstones + capability gating + telemetry), delta query, import, delete. Imports **9 modules from `../../src/**`**, incl. `ProjectSnapshot` from a **client store file**. Also imports **upward** into `jobs/` (db→jobs) | The one file every feature must touch to persist anything: merge-conflict magnet, and the chat-commit *business logic* hides inside a file named "repo" — nobody reads a repo looking for commit policy, so a bug there ships silently |
| jobs/chatJobRunner.ts | It runs background chat jobs from queue to saved reply — and afterward also auto-titles threads and fills chapter summaries. | AND | 792 LOC; queue + provider streaming + SSE fan-out + job persistence + stop/retry + **two chore features** (title chore, chapter-summarize chore), each with its own prompt and SQL | The chores are a *second, parallel* implementation of titling/summarizing — different prompts and rules from routes/title.ts and routes/summarize.ts. Two titling systems that can disagree, in one file |
| jobs/serverArtifactIndexer.ts | It builds the search index for each note in the background. | OK | 320 LOC; hash-gated diffing (0 provider calls when unchanged). Smells: RAM-only queue (lost on restart), and a lazy `require('../routes/account')` purely to dodge a circular import | — |
| lib/accountVault.ts | It keeps each user's API keys encrypted and locked until their password unlocks them — and also hashes passwords, routes which key signs which request, and builds the AI clients. | AND | 385 LOC; four tenants: scrypt hashing, RAM vault + unlock, AES-256-GCM storage, key-slot resolution + client factory | The most security-critical file is also the busiest: product key-routing sits meters from must-never-break AES-GCM code, so every routing tweak forces a full crypto re-review |
| lib/callRecorder.ts | It writes one record per AI call — what was sent, what came back, how long each step took. | OK (+LEAK) | 228 LOC; one law kept: recorder never breaks the call. Imports runtime scrubbing from `src/domains/callLogTypes` | — |
| lib/csp.ts | It builds the browser security header deciding what page content may load. | OK | 44 LOC | — |
| lib/env.ts | It loads the server's settings files at startup. | OK | 21 LOC | — |
| lib/log.ts | It keeps the last server log lines in memory and pushes them to anyone watching. | OK | 41 LOC | — |
| lib/models.ts | It owns the list of models this deployment offers. | OK | 243 LOC; hard-error validation. Note: carries client display copy and an unused `quotaNote` field despite the explicit "we are not the source of truth for provider quotas" law | — |
| lib/prompt.ts | It re-exports the AI prompt builders that live in the client source tree. | **LEAK** | 1 LOC: `export * from '../../src/prompts/prompt'` — 100% of the file is a client import | The server's prompt wording lives in the client's folder; the shared boundary is defined by directory accident |
| lib/tokens.ts | It guesses a text's token count when the provider doesn't report one. | OK | 4 LOC | — |
| lib/ttsCache.ts | It stores read-aloud audio on disk so the same text is never synthesized twice. | OK | 263 LOC; all complexity internal behind one contract | — |
| lib/users.ts | It manages user accounts: creating them, signing them in, disabling them, rotating passwords. | OK | 244 LOC, one domain | — |
| providers/gemini.ts | It connects the server to Google's Gemini AI. | OK | 34 LOC | — |
| providers/lane.ts | It defines the one call shape every AI provider must answer with. | OK | 48 LOC, pure interface | — |
| providers/openrouter.ts | It speaks to OpenRouter and translates its answers into the common provider shape. | OK | 207 LOC | — |
| routes/account.ts | It handles signing in, staying signed in, account settings, saved keys, and the owner's user administration. | AND | 487 LOC; login (+ rate limiter + timing-equalizer), sessions (+ sliding renewal), vault unlock/re-arm, settings, key PUT, password change, owner-only user admin | Auth (security-critical, changes rarely) and key/settings CRUD (product surface, changes often) share handlers |
| routes/chat.ts | It streams a live reply from the model to the browser. | OK | 230 LOC; SSE ladder, telemetry, flight recorder — all internal to one promise | — |
| routes/extract.ts | It turns an uploaded document into a structured note. | OK | 141 LOC | — |
| routes/health.ts | It answers a simple "is the server alive" check. | OK | 15 LOC | — |
| routes/jobs.ts | It lets the browser start, watch, stop, retry, or discard a background chat job. | OK | 172 LOC; thin router — delegates everything | — |
| routes/logs.ts | It serves the log views: the owner's server log and each user's AI-call history. | OK | 54 LOC | — |
| routes/models.ts | It serves the list of available models. | OK | 11 LOC | — |
| routes/projects.ts | It receives project sync requests and passes them to the project repository. | OK | 119 LOC; thin handlers | — |
| routes/searchIndex.ts | It answers search over indexed notes — and also generates the Q&A and embeddings the index is built from, with its own offline fallbacks. | AND + LEAK | 542 LOC; **local re-implementations of `buildQaPrompt`/`parseQaPairs`** duplicating `src/prompts/lanes`; imports **runtime client code**: `QueryVectorCache` and `tokenizeForFts`/`cosineSimilarity` from the client's search engine | The search feature's brain lives in a route file; prompt/format drift between the two parser copies is already possible; a client refactor of `src/domains/search` breaks production search |
| routes/summarize.ts | It writes a chapter's recap with the AI. | OK (+LEAK) | 111 LOC. Imports `parseSentinelBlocks` from `src/utils` | — |
| routes/title.ts | It asks the AI for a short conversation title. | OK | 94 LOC; always answers 200, best-effort by contract | — |
| routes/tts.ts | It turns text into spoken audio, serving a cached copy when one exists. | OK (+LEAK) | 133 LOC. Imports `cleanTtsText`/`clampTtsVoice` from `src/prompts/lanes` (client prompt helpers doing server text sanitization) | — |

**Client/server boundary verdict:** the src/-imports are **half-deliberate** — a real shared-contract layer exists in *spirit* (callLogTypes, the demuxer, domain entity types, prompt builders), and one-parser-no-drift is defensible. But there is **no neutral home**: everything lives under `src/`, the client's root. `ProjectSnapshot` — the server's core contract — is defined inside a client *store* file; searchIndex imports client runtime code; projectRepo pulls runtime behavior from domain modules. The boundary today is a convention enforced by habit, not a designed seam — and the two duplicated prompt/parser copies prove the drift the missing layer allows.
