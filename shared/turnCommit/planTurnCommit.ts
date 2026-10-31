/**
 * THE TURN COMMIT PLANNER (Phase 3) — one pure decision engine for committing
 * an LLM reply, replacing the two divergent engines that used to live in
 * src/application/sendQueue.ts (client commitPair / commitRegenerate /
 * applyBufferedArtifacts / applyBufferedShifts) and
 * server/db/projectRepo.ts (commitJobPairTransaction).
 *
 * PURE: no DB, no domains, no clock, no I/O. It takes the world as the caller
 * sees it (TurnCommitState) plus what the attempt produced (TurnCommitRequest)
 * and returns a plan (TurnCommitPlan) that a thin applier — server
 * (projectRepo's transaction) or client (sendQueue's domain calls) — executes.
 * All ids the planner cannot know deterministically (chapter ids) are left ''
 * for the applier to assign.
 *
 * Unification notes (where the two engines disagreed, the BETTER behavior won):
 *   - Artifact color: the server hardcoded '#e05a66'; the client used the
 *     deterministic pastel. Unified on the client's getMellowPastelColor(code).
 *   - Artifact UPDATE path: the server only ever created (existing notes were
 *     re-created whole); the client updated in place and snapshotted the OLD
 *     state first. Unified on the client's create-vs-update behavior.
 *   - extractedArtifacts.turnIndex: the client omitted it on send; the server
 *     stamped it. Unified on stamping it (AI-attachment law needs the index).
 *   - Receipts (extractedLinks): the client never produced them; the server
 *     did. Unified on ALWAYS producing them (David's receipts law).
 */
import type { UniversalArtifactDocument, ArtifactLayers } from '../types/artifact';
import type { SemanticEdge } from '../types/graph';
import type { ChapterPartition } from '../types/chapters';
import type { Turn, ExtractedArtifact } from '../types/timeline';
import type { ChatAttachment, ChatCapabilities } from '../types/threads';
import type {
  ExtractedTopicShift,
  ExtractedArtifactUpsert,
  ExtractedLink,
  ExtractedUnlink,
} from '../stream/types';
import { artifactFileName } from '../artifactFileName';
import { getMellowPastelColor } from '../colors';

/** Turn-meta telemetry the attempt measured (client TurnMeta-compatible). */
export interface TurnCommitTelemetry {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  latencyMs?: number;
  timeToFirstChunkMs?: number;
  model?: string;
  isFallback?: boolean;
  /** Flight-recorder row id — the inspector opens THIS row from the turn. */
  callId?: string;
  /** Client TurnMeta extras ride along harmlessly (spread into the meta). */
  isStreaming?: boolean;
  streamState?: string;
}

/** The world as the caller sees it, gathered BEFORE anything is written. */
export interface TurnCommitState {
  /**
   * Artifacts visible to this commit — id/code/title is required (create-vs-
   * update + link slug resolution). Callers that HAVE the full doc (the
   * client domain) pass `current` too, so the update revision can snapshot
   * the OLD layers; callers that don't (the server's thin rows) omit it and
   * their applier snapshots from the DB instead.
   */
  artifacts: Array<Pick<UniversalArtifactDocument, 'id' | 'code' | 'title'> & Partial<Pick<UniversalArtifactDocument, 'current'>>>;
  /** Edges visible to this commit (unlink matching). */
  edges: SemanticEdge[];
  /** Turns ALREADY in the thread — only the COUNT is needed. */
  threadTurnsCount: number;
  /** The thread's existing chapters, for the topic-shift boundary law. */
  chapters: ChapterPartition[];
}

export interface TurnCommitRequest {
  kind: 'send' | 'regenerate';
  threadId: string;
  pairKey: string;
  /** The planner is pure but needs a projectId for new artifact docs. */
  projectId: string;
  /** Regenerate: the assistant turn being replaced. */
  targetTurnId?: string | null;
  /** Regenerate: the current turn doc (server: parsed row; client: the live turn). */
  existingAssistantTurn?: Turn | null;
  /**
   * Regenerate: the index of the target turn WITHIN the thread — the caller
   * computes it (server: seq-count; client: findIndex).
   */
  targetTurnIndex?: number;
  askText: string;
  /** Demuxed prose (tags already stripped); residual <link> tags are stripped again defensively. */
  cleanReply: string;
  artifactUpserts: ExtractedArtifactUpsert[];
  /** The LAST shift if several arrived — last-shift-wins is the caller's cut, the planner's law. */
  topicShift: ExtractedTopicShift | null;
  links: ExtractedLink[];
  unlinks: ExtractedUnlink[];
  /** Committed on the user turn (send only). */
  stagedAttachments: ChatAttachment[];
  /** RESOLVED capabilities. */
  capabilities: ChatCapabilities;
  telemetry?: TurnCommitTelemetry;
  now: number;
  /** Callers generate turn ids up front (server: `turn-user-${pairKey}` / `turn-ai-${pairKey}`). */
  ids: { userTurnId: string; assistantTurnId: string };
  state: TurnCommitState;
}

/** Revision recorded BEFORE the upsert: update → the OLD state; create → the birth state. */
export interface TurnCommitArtifactRevision {
  actor: 'ai';
  changeSummary: string;
  provenance: { threadId: string; turnId: string; turnIndex: number | null };
  title: string;
  layers: ArtifactLayers;
}

export interface TurnCommitArtifactOp {
  /** FULL doc ready to upsert (create or update shape). */
  artifact: UniversalArtifactDocument;
  isNew: boolean;
  revision: TurnCommitArtifactRevision;
}

export interface TurnCommitPlan {
  /** null on regenerate. */
  userTurn: Turn | null;
  /** Full doc to upsert; on regenerate the merged doc. */
  assistantTurn: Turn;
  /** send: index of the user turn = threadTurnsCount; regenerate: targetTurnIndex. */
  userTurnIndex: number;
  /** send: threadTurnsCount + 1; regenerate: targetTurnIndex. */
  assistantTurnIndex: number;
  artifactOps: TurnCommitArtifactOp[];
  chapterOp: null | {
    shift: ExtractedTopicShift;
    /** max(0, threadTurnsCount) on send; max(0, threadTurnsCount - 2) on regenerate. */
    askIndex: number;
    /** Existing chapter at askIndex, ALREADY retitled — upsert it, never duplicate. */
    boundaryToRetitle: ChapterPartition | null;
    /** Last active chapter still running past the ask → completed at askIndex. */
    chapterToSeal: { id: string; endIndex: number } | null;
    /** New chapter doc when no boundary exists. id is '' — the APPLIER assigns it. */
    create: ChapterPartition | null;
  };
  /** id = `edge-${sourceId}-${targetId}-${kind}`. */
  edgeUpserts: SemanticEdge[];
  /** Edge ids to delete (the server applier tombstones them). */
  edgeDeletes: string[];
  /** Rides the assistant turn REGARDLESS of capability (receipts law). */
  receipts: NonNullable<Turn['extractedLinks']>;
  threadTouch: { lastOutcome: 'ok'; lastActivityAt: number; preview: string };
}

/** The artifact code rule BOTH engines used: lowercase, separators → '-', 30 chars. */
function artifactCode(title: string): string {
  return (title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30);
}

/** How the substrate NAMES notes — the model links by these exact names. */
function fileKey(s: string): string {
  return s.trim().replace(/\.md$/i, '').toLowerCase();
}

/** Defensive strip: the demuxer normally removed these already. */
function stripLinkTags(text: string): string {
  return text.replace(/<link\b[^>]*>(?:\s*<\/link>)?\s*/gi, '');
}

export function planTurnCommit(req: TurnCommitRequest): TurnCommitPlan {
  const caps = req.capabilities;
  const state = req.state;
  const now = req.now;
  const isRegen = req.kind === 'regenerate';
  const assistantTurnId = isRegen ? req.targetTurnId || req.ids.assistantTurnId : req.ids.assistantTurnId;
  const assistantTurnIndex = isRegen
    ? (req.targetTurnIndex ?? Math.max(0, state.threadTurnsCount - 1))
    : state.threadTurnsCount + 1;
  const userTurnIndex = isRegen ? assistantTurnIndex : state.threadTurnsCount;

  /* ── Rule 1: artifact ops (create vs update), gated on writeArtifacts ── */
  const artifactOps: TurnCommitArtifactOp[] = [];
  if (caps.writeArtifacts) {
    for (const u of req.artifactUpserts) {
      const code = u.id || artifactCode(u.title);
      const existing =
        state.artifacts.find((a) => a.code === code) || state.artifacts.find((a) => a.id === u.id);
      const provenance = { threadId: req.threadId, turnId: assistantTurnId, turnIndex: assistantTurnIndex };
      if (existing) {
        // Update in place; revision snapshot = the OLD state, recorded first.
        // The state carries only the Pick (id/code/title); the applier that
        // holds full docs (client: the live domain; server: the DB row) merges
        // this op's changed keys over the stored doc before upserting.
        const doc = {
          ...existing,
          title: u.title || existing.title,
          current: {
            subtitle: u.content.subtitle,
            description: u.content.description,
            summary: u.content.summary,
            body: u.content.body,
          },
          updatedAt: now,
          // The AI rewrote every layer, so nothing is stale anymore.
          layersStaleAt: undefined,
        } as UniversalArtifactDocument;
        artifactOps.push({
          artifact: doc,
          isNew: false,
          revision: {
            actor: 'ai',
            changeSummary: `Update from chat: ${u.content.description}`,
            provenance,
            title: existing.title,
            layers: {
              subtitle: existing.current?.subtitle ?? '',
              description: existing.current?.description ?? '',
              summary: existing.current?.summary ?? '',
              body: existing.current?.body ?? '',
            },
          },
        });
      } else {
        const doc: UniversalArtifactDocument = {
          id: u.id || `art-${now}`,
          workspaceId: req.projectId,
          code,
          title: u.title || 'Extracted note',
          type: u.type === 'chapter' ? 'chapter' : 'document',
          category: u.type === 'chapter' ? 'chapter' : 'note',
          color: getMellowPastelColor(code),
          isHighConcept: false,
          current: {
            subtitle: u.content.subtitle || '',
            description: u.content.description || '',
            summary: u.content.summary || '',
            body: u.content.body || `# ${u.title}`,
          },
          tags: ['chat-extracted', u.type || 'note'],
          createdAt: now,
          updatedAt: now,
          graph: { is_high_concept: false, x: 300, y: 200 },
        };
        artifactOps.push({
          artifact: doc,
          isNew: true,
          revision: {
            actor: 'ai',
            changeSummary: `Created from chat: ${u.content.description}`,
            provenance,
            title: doc.title,
            layers: { ...doc.current },
          },
        });
      }
    }
  }

  /* ── Rule 4: topic-shift chapter law ── */
  let chapterOp: TurnCommitPlan['chapterOp'] = null;
  if (caps.autoChapter && req.topicShift) {
    const shift = req.topicShift;
    // The cut applies at the human ask that caused the change.
    //   send:        askIndex = threadTurnsCount (count BEFORE the commit —
    //                both old engines agreed: server turnCount-2 after insert,
    //                client userTurnIndex after append).
    //   regenerate:  the replaced pair's ask = count - 2 (no turns appended).
    const askIndex = isRegen ? Math.max(0, state.threadTurnsCount - 2) : Math.max(0, state.threadTurnsCount);
    const boundary = state.chapters.find((c) => c.startIndex === askIndex);
    if (boundary) {
      // A cut already exists here — the shift RETITLES it, nothing opens.
      chapterOp = {
        shift,
        askIndex,
        boundaryToRetitle: {
          ...boundary,
          title: shift.title,
          subtitle: shift.subtitle ?? boundary.subtitle ?? '',
          description: shift.description ?? boundary.description ?? '',
          summary: shift.summary ?? boundary.summary ?? '',
          status: 'active',
          endIndex: undefined,
        },
        chapterToSeal: null,
        create: null,
      };
    } else {
      // Seal the LAST active chapter still running past the ask…
      let seal: ChapterPartition | null = null;
      for (const c of state.chapters) {
        if (c.status === 'active' && (c.endIndex ?? Infinity) > askIndex) seal = c;
      }
      // …and open the new one (id assigned by the applier).
      chapterOp = {
        shift,
        askIndex,
        boundaryToRetitle: null,
        chapterToSeal: seal ? { id: seal.id, endIndex: askIndex } : null,
        create: {
          id: '',
          workspaceId: req.projectId,
          threadId: req.threadId,
          title: shift.title,
          subtitle: shift.subtitle,
          description: shift.description,
          summary: shift.summary,
          status: 'active',
          startIndex: askIndex,
          createdAt: now,
        },
      };
    }
  }

  /* ── Rule 5: link/unlink resolution + receipts (ALWAYS emitted) ── */
  const idByFile = new Map<string, string>();
  const indexNames = (a: { id: string; code?: string; title?: string }) => {
    idByFile.set(fileKey(artifactFileName({ code: a.code ?? '', title: a.title ?? '' })), a.id);
    if (a.code) idByFile.set(fileKey(a.code), a.id);
  };
  for (const a of state.artifacts) indexNames(a);
  // A reply may create AND link a note in the same breath — planned docs resolve too.
  for (const op of artifactOps) indexNames(op.artifact);

  const edgeUpserts: SemanticEdge[] = [];
  const edgeDeletes: string[] = [];
  const receipts: NonNullable<Turn['extractedLinks']> = [];
  for (const l of req.links) {
    const sourceId = idByFile.get(fileKey(l.source)) ?? null;
    const targetId = idByFile.get(fileKey(l.target)) ?? null;
    const applied = Boolean(caps.graphLinks && sourceId && targetId && sourceId !== targetId);
    receipts.push({
      action: 'link',
      sourceFile: l.source,
      targetFile: l.target,
      kind: l.kind,
      sourceId,
      targetId,
      applied,
    });
    if (applied) {
      edgeUpserts.push({
        id: `edge-${sourceId}-${targetId}-${l.kind}`,
        sourceId: sourceId!,
        targetId: targetId!,
        kind: l.kind,
      });
    }
  }
  for (const u of req.unlinks) {
    const sourceId = idByFile.get(fileKey(u.source)) ?? null;
    const targetId = idByFile.get(fileKey(u.target)) ?? null;
    let applied = false;
    if (caps.graphLinks && sourceId && targetId) {
      for (const e of state.edges) {
        if (e.sourceId !== sourceId || e.targetId !== targetId) continue;
        if (u.kind && e.kind !== u.kind) continue;
        edgeDeletes.push(e.id);
        applied = true;
      }
    }
    receipts.push({
      action: 'unlink',
      sourceFile: u.source,
      targetFile: u.target,
      kind: u.kind ?? '',
      sourceId,
      targetId,
      applied,
    });
  }

  /* ── Rules 3/6/8: turn construction ── */
  const cleanedReply = stripLinkTags(req.cleanReply);
  const extractedArtifacts: ExtractedArtifact[] = req.artifactUpserts.map((u) => ({
    id: u.id,
    title: u.title,
    type: u.type,
    code: u.id || artifactCode(u.title),
    category: u.type === 'chapter' ? 'chapter' : 'note',
    subtitle: u.content.subtitle,
    description: u.content.description,
    summary: u.content.summary,
    content: u.content.body,
    isHighConcept: false,
    turnIndex: assistantTurnIndex,
  }));

  const userTurn: Turn | null = isRegen
    ? null
    : {
        id: req.ids.userTurnId,
        role: 'user',
        content: req.askText,
        timestamp: now,
        threadId: req.threadId,
        // Attachment provenance: index WITHIN the thread + the user turn id.
        // Without these the message renders with NO attachment chips while the
        // LLM clearly got the context (found live 2026-10-25).
        meta: req.stagedAttachments.length
          ? ({
              attachments: req.stagedAttachments.map((a) => ({
                ...a,
                turnIndex: userTurnIndex,
                turnId: req.ids.userTurnId,
              })),
            } as Turn['meta'])
          : undefined,
      };

  const { model: _m, isFallback: _f, isStreaming: _s, streamState: _st, ...telRest } = req.telemetry ?? {};
  const meta: Turn['meta'] = isRegen
    ? { ...(req.existingAssistantTurn?.meta ?? {}), ...req.telemetry }
    : {
        ...telRest,
        model: req.telemetry?.model,
        isFallback: req.telemetry?.isFallback ?? false,
        isStreaming: false,
        streamState: 'completed',
      };

  const assistantTurn: Turn = isRegen
    ? {
        ...(req.existingAssistantTurn ?? {
          id: assistantTurnId,
          role: 'assistant' as const,
          content: '',
          timestamp: now,
          threadId: req.threadId,
        }),
        id: assistantTurnId,
        role: 'assistant' as const,
        content: cleanedReply,
        timestamp: now,
        threadId: req.threadId,
        extractedArtifacts,
        // New receipts replace old ones; with nothing new asked, the existing
        // receipts stay (the replaced reply's ask happened, its receipts hold).
        extractedLinks: receipts.length > 0 ? receipts : req.existingAssistantTurn?.extractedLinks,
        meta,
      }
    : {
        id: assistantTurnId,
        role: 'assistant' as const,
        content: cleanedReply,
        timestamp: now + 1,
        threadId: req.threadId,
        extractedArtifacts,
        extractedLinks: receipts.length > 0 ? receipts : undefined,
        meta,
      };

  return {
    userTurn,
    assistantTurn,
    userTurnIndex,
    assistantTurnIndex,
    artifactOps,
    chapterOp,
    edgeUpserts,
    edgeDeletes,
    receipts,
    threadTouch: { lastOutcome: 'ok', lastActivityAt: now, preview: req.askText.slice(0, 100) },
  };
}
