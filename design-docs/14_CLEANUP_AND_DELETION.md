# 14 — Cleanup: archiving, permanent deletion, and the referential law

> Added 2026-10-21. Implements David's ask: *"add ways to permanently delete
> artifacts and chats… somewhat hard to trigger… a multiselect… cleanup would
> only allow to delete from those [archived]… deleting permanently needs a
> confirmation on top. Artifacts can't be deleted unless no chat points to them,
> so the chats must go first."*

## 1. The model

Two states, one direction:

```
active ──archive──▶ archived ──delete (typed confirm)──▶ gone
   ◀────unarchive────
```

**Nothing is ever deleted from `active`.** Archive is the door, and it is the
only state permanent deletion accepts. Deleting is not a per-row reflex; it
happens in exactly one place (the Cleanup tool), behind a review step *and* a
typed `DELETE`.

**Archive is not a visibility switch.** An archived artifact is still attachable,
still compiled into context when it is attached, still in the graph, still in
the mirror. Chats behave the same way (archived threads already appear dimmed in
the sidebar). Archive means "parked, and eligible for the cleanup tool" — never
"hidden from the LLM". Keeping those two ideas apart is what stops a future
agent from quietly turning archive into an exclusion filter, which would change
what the model sees without the user asking for it.

## 2. The referential law (artifacts)

An artifact is referenced by a chat when that chat holds it as an attachment
(`ChatAttachment.artifactId` — provenance is per chat, never on the artifact).

1. An artifact pointed at by an **active** chat can never be deleted. The tool
   names those chats and offers to archive them; archiving them is the only way
   forward — that is "the chats must go first", made concrete.
2. An artifact pointed at by **archived** chats only is deletable. By default
   those chats survive and simply lose the attachment. A second, explicit
   checkbox ("also delete the N archived chats that use these artifacts") turns
   the deletion into a cascade — the recursive option David asked for.
3. Chats have no referential rules of their own: a thread's turns, chapters and
   cached content die with it, and the registry hands back a fallback thread
   (`Main`) if the deleted chat happened to be the live one.

## 3. The tool

`src/ui/cleanup/CleanupModal.tsx` — reached from the sidebar's *Import / Export
I/O* accordion (`Cleanup · archive → delete`), deliberately not a top-level
button: archiving is routine, destroying is not.

- **Two tabs** (chats / artifacts), title-tab counts of what is archived.
- **Filter**: `archived` (default) / `active` / `all`, plus *select all shown*.
- **Multiselect** with checkboxes; the footer reports `N selected · M deletable`.
- **Bulk verbs**: `Archive` · `Unarchive` · `Delete…`. The Delete button is
  disabled until at least one *archived* row is selected (its tooltip says why).
- **Review step**: what dies (chats with their messages/chapters; artifacts with
  their revision history, graph edges and attachments), what is *kept back* and
  why, the cascade checkbox, and the typed `DELETE` gate.

## 4. What a permanent delete actually removes

`src/ui/artifacts/purgeArtifact.ts` is the one door an artifact leaves through —
five places hold its id and all five are swept: surviving artifacts'
relationship edges (with their `yamlDocument` regenerated), the semantic graph's
edges (`graph.removeNode`), every thread's attachments
(`threadRegistry.purgeArtifact` — garbage collection, not a user-facing detach),
the revision history (`versioning.purgeArtifact`), and the artifact map itself.
The post-import triage path now goes through the same door, so there is no
second, weaker deletion path.

Chats go through `deleteThread` (registry + live-domain swap) so deleting the
live thread unloads it and loads the fallback, exactly like the sidebar's own
delete.

## 5. Where the law lives

| Piece | File |
|---|---|
| The decision (pure, unit-tested) | `src/application/cleanupPlan.ts` |
| The cascade | `src/ui/artifacts/purgeArtifact.ts` |
| Action handlers | `src/ui/cleanup/createCleanupHandlers.ts` |
| The tool | `src/ui/cleanup/CleanupModal.tsx` |
| Rules under test | `src/tests/cleanup.test.ts` |
| End-to-end acceptance | `scripts/cleanup-tool-test.cjs` (fixture boot, 18 checks) |
| Artifact lifecycle | `UniversalArtifactDocument.lifecycle` + `setArtifactLifecycle` |

`planCleanup` decides; the caller destroys. Every rule in §2 is a test in
`cleanup.test.ts`, so the law cannot drift without a red suite.

## 6. Deliberately not done (yet)

- **No per-artifact Archive button** outside the tool. One door for the moment;
  a quiet archive control in the artifact detail modal would be the natural next
  step, not a bulk-tool duplicate.
- **No undo, no trash bin, no retention window.** Writes are snapshots, not
  event logs; a real trash would need tombstoned records in the snapshot format.
  If it ever lands, it belongs here first: the law above is what a trash would
  have to preserve (archived-only, referential, confirmed).
- **No count of turns per chat in the tool.** Chats keep turns in the registry's
  inactive cache and in the live domains; the tool shows attachment counts and
  last-activity dates rather than inventing a number it cannot read cheaply.
- **Archive does not touch chapters** — a chapter is not an item in this tool.
