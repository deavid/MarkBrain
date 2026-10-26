/**
 * VPS delta sync poller (design-docs/21D §4.5).
 *
 * Connected mode only: whenever the tab regains focus (phone screen wake /
 * window focus) or every 10s while visible, ask the server for rows newer
 * than `lastRevisionRef.current`. A non-empty delta is merged straight into
 * the live domains and the cursor advances — sub-100-byte polls when nothing
 * changed (`since === revision` → empty arrays).
 *
 * No provider calls, no save triggered by the merge itself: the persist
 * worker only fires on real domain mutations, and the merged rows are
 * byte-identical to what the server holds, so the next debounced save
 * upserts nothing changed (hash compare keeps row revisions stable).
 */
import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import type { IDialogueTimelineDomain } from '../domains/01-dialogue-timeline';
import type { IArtifactDocumentDomain } from '../domains/01-artifact-document';
import type { IChapterSegmentationDomain } from '../domains/02-chapter-segmentation';
import type { ITopologicalGraphDomain } from '../domains/02-topological-graph';
import type { ThreadRegistry } from '../domains/06-chat-threads';
import { reconcileThreadAttachments } from '../domains/06-chat-threads';
import { flushServerMutations } from './serverMutationQueue';
import { setVaultLocked } from '../data/vaultReArm';
import { apiFetch } from '../gateway/api';
import { getWorkspaceMode } from '../services/workspaceSession';
import type { ProjectDeltaResponse } from '../../server/db/projectRepo';
import { logger } from '../utils/logger';

const POLL_MS = 10_000;

export interface VpsDeltaSyncDeps {
  activeProjectId: string | null;
  lastRevisionRef: RefObject<number>;
  timeline: IDialogueTimelineDomain;
  artifacts: IArtifactDocumentDomain;
  segmentation: IChapterSegmentationDomain;
  graph: ITopologicalGraphDomain;
  threadRegistry: ThreadRegistry;
}

/** test seam — exercised by src/tests/cuj-gap-sync.test.ts */
export function mergeDeltaIntoDomains(delta: ProjectDeltaResponse, deps: VpsDeltaSyncDeps): void {
  const { timeline, artifacts, segmentation, graph, threadRegistry } = deps;

  // Tombstones first — deletions win over same-batch upserts.
  for (const t of delta.tombstones) {
    if (t.entityType === 'artifact') artifacts.deleteArtifact(t.entityId);
    if (t.entityType === 'chapter') segmentation.loadChapters(segmentation.listChapters().filter((c) => c.id !== t.entityId));
    if (t.entityType === 'edge') graph.loadEdges(graph.listEdges().filter((e) => e.id !== t.entityId));
    if (t.entityType === 'thread') threadRegistry.deleteThread(t.entityId);
    if (t.entityType === 'folder') threadRegistry.deleteFolder(t.entityId);
  }

  // Artifacts: upsert by id.
  if (delta.artifacts.length > 0) {
    const merged = artifacts.listArtifacts();
    for (const incoming of delta.artifacts) {
      const idx = merged.findIndex((a) => a.id === incoming.id);
      if (idx >= 0) merged[idx] = incoming;
      else merged.push(incoming);
    }
    artifacts.loadArtifacts(merged);
  }

  // Chapters: upsert by id (delta rows are the server's current state) —
  // routed PER THREAD. Found live 2026-10-25: every thread's chapters were
  // loaded into the active thread's segmentation, so the strip rendered other
  // threads' windows against this timeline ("Genesis Chapter" twice with the
  // same contents — the second copy was another thread's chapter).
  if (delta.chapters.length > 0) {
    const activeThreadId = threadRegistry.getActiveThreadId();
    const own = delta.chapters.filter((c) => !c.threadId || c.threadId === activeThreadId);
    const others = new Map<string, Array<(typeof delta.chapters)[number]>>();
    for (const ch of delta.chapters) {
      if (ch.threadId && ch.threadId !== activeThreadId) {
        const list = others.get(ch.threadId) ?? [];
        list.push(ch);
        others.set(ch.threadId, list);
      }
    }
    if (own.length > 0) {
      const merged = [...segmentation.listChapters()];
      for (const incoming of own) {
        const idx = merged.findIndex((c) => c.id === incoming.id);
        if (idx >= 0) merged[idx] = incoming;
        else merged.push(incoming);
      }
      merged.sort((a, b) => a.startIndex - b.startIndex);
      segmentation.loadChapters(merged);
    }
    for (const [threadId, list] of others) {
      threadRegistry.mergeInactiveChapters(threadId, list);
    }
  }

  // Edges: upsert by id.
  if (delta.edges.length > 0) {
    const merged = [...graph.listEdges()];
    for (const incoming of delta.edges) {
      const idx = merged.findIndex((e) => e.id === incoming.id);
      if (idx >= 0) merged[idx] = incoming;
      else merged.push(incoming);
    }
    graph.loadEdges(merged);
  }

  // Turns: merge the active thread's list by id, preserving local order and
  // appending genuinely-new rows (server seq order arrives sorted).
  if (delta.turns.length > 0) {
    const activeThreadId = threadRegistry.getActiveThreadId();
    const local = timeline.getTurns();
    const merged = [...local];
    const additions = [];
    for (const incoming of delta.turns) {
      if ((incoming.threadId ?? activeThreadId) !== activeThreadId) continue; // other lane → registry cache on next hydrate
      const idx = merged.findIndex((t) => t.id === incoming.id);
      if (idx >= 0) merged[idx] = incoming;
      else additions.push(incoming);
    }
    additions.sort((a, b) => a.timestamp - b.timestamp);
    timeline.loadTurns([...merged, ...additions]);
  }

  // Attachment provenance from server-committed pairs (design 23 §2.5, live
  // 2026-10-25): the pair lands SERVER-side; the delta turn's meta.attachments
  // carry the turnId + turnIndex the server welded. The registry's staged
  // entries must follow, or the staged tray never empties ("attachments
  // didn't get removed when sent to the draft bin") and the chips never render
  // on the turn (they read the registry, not the turn meta).
  const weldProvenance = () => {
    for (const incoming of delta.turns) {
      const threadId = incoming.threadId ?? threadRegistry.getActiveThreadId();
      const atts = (incoming as { meta?: { attachments?: unknown } }).meta?.attachments;
      if (Array.isArray(atts)) {
        for (const att of atts as Array<{ artifactId?: unknown; turnIndex?: unknown; turnId?: unknown }>) {
          if (typeof att.artifactId !== 'string' || !att.artifactId) continue;
          const turnIndex =
            typeof att.turnIndex === 'number' && Number.isFinite(att.turnIndex) && att.turnIndex >= 0
              ? att.turnIndex
              : null;
          threadRegistry.commitAttachment(
            threadId,
            att.artifactId,
            turnIndex,
            typeof att.turnId === 'string' ? att.turnId : null
          );
        }
      }
      // AI-attachment law (2026-10-25): the reply's extracted artifacts are
      // attachments on the reply — committed, Full, steerable, compiled into
      // the next context calls, never re-staged. The server stamps turnIndex
      // on each extracted entry; the turn supplies the turnId.
      const extracted = (incoming as { extractedArtifacts?: unknown }).extractedArtifacts;
      if (Array.isArray(extracted)) {
        for (const ea of extracted as Array<{ id?: unknown; turnIndex?: unknown }>) {
          if (typeof ea.id !== 'string' || !ea.id) continue;
          const turnIndex =
            typeof ea.turnIndex === 'number' && Number.isFinite(ea.turnIndex) && ea.turnIndex >= 0
              ? ea.turnIndex
              : null;
          threadRegistry.ensureAttached(threadId, ea.id, turnIndex, incoming.id);
        }
      }
    }
  };
  weldProvenance(); // common case: the thread already exists

  // Threads / folders: patch existing rows, create missing ones.
  for (const incoming of delta.threads) {
    if (threadRegistry.getThread(incoming.id)) {
      // NEVER let a delta thread row downgrade attachment provenance (live
      // 2026-10-25): the thread doc's attachment list is the client's last
      // save — a VPS pair commits server-side while the thread row still says
      // staged. Patching it verbatim clobbered the weld this same merge just
      // applied from the turn meta, and the next save persisted the lie.
      const existing = threadRegistry.getThread(incoming.id)!;
      threadRegistry.patch(incoming.id, {
        ...incoming,
        attachments: reconcileThreadAttachments(existing.attachments ?? [], incoming.attachments ?? []),
      });
    } else {
      threadRegistry.createThread(incoming);
    }
  }
  weldProvenance(); // a createThread above may have arrived with stale staged entries
  const knownFolders = new Set(threadRegistry.getFolders().map((f) => f.id));
  for (const incoming of delta.folders) {
    if (!knownFolders.has(incoming.id)) threadRegistry.createFolder(incoming.name);
  }
}

export function useVpsDeltaSync(deps: VpsDeltaSyncDeps): void {
  const { activeProjectId, lastRevisionRef } = deps;
  const depsRef = useRef(deps);
  depsRef.current = deps;
  const inFlight = useRef(false);

  useEffect(() => {
    if (getWorkspaceMode() !== 'vps' || !activeProjectId) return;

    // New project → start the cursor at 0 so the first pull is a full catch-up.
    lastRevisionRef.current = 0;
    let cancelled = false;

    const pull = async () => {
      if (cancelled || inFlight.current) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      inFlight.current = true;
      try {
        // Explicit deletes queued since the last tick go out BEFORE the pull —
        // the tombstones they create then ride back in the same merge.
        await flushServerMutations(activeProjectId);
        const since = lastRevisionRef.current;
        const res = await apiFetch(
          `/api/projects/${encodeURIComponent(activeProjectId)}/delta?since=${since}`
        );
        if (!res.ok) return; // 401/404 etc. — next tick retries; boot load owns first hydration
        const delta = (await res.json()) as ProjectDeltaResponse;
        if (cancelled) return;
        if (delta.revision > lastRevisionRef.current) {
          mergeDeltaIntoDomains(delta, depsRef.current);
          lastRevisionRef.current = delta.revision;
          logger.info('VpsDeltaSync', `Merged delta → revision ${delta.revision}`);
        }
        // design 25: piggyback the lock-state check onto this poll — no new
        // poller, one cheap GET per tick. Catches a server restart's vault
        // lock BEFORE the user finds out through a failed send.
        try {
          const sess = await apiFetch('/api/auth/session');
          if (sess.ok) {
            const body = (await sess.json()) as { user?: { vaultUnlocked?: boolean } };
            setVaultLocked(body.user?.vaultUnlocked === false);
          } else if (sess.status === 401) {
            setVaultLocked(true); // session gone — nothing will send anyway
          }
        } catch {
          /* offline — padlock state stays as-is */
        }
      } catch {
        /* offline — mirror + next wake retry */
      } finally {
        inFlight.current = false;
      }
    };

    const onVisible = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') void pull();
    };
    const onFocus = () => void pull();

    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
    if (typeof window !== 'undefined') window.addEventListener('focus', onFocus);
    const timer = setInterval(() => void pull(), POLL_MS);
    void pull(); // immediate catch-up on project open

    return () => {
      cancelled = true;
      clearInterval(timer);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
      if (typeof window !== 'undefined') window.removeEventListener('focus', onFocus);
    };
  }, [activeProjectId, lastRevisionRef]);
}
