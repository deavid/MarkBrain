import { useCallback, useRef, useState } from 'react';
import { Artifact, ArtifactGraphData } from '../../../types';
import type { ProjectMetadata } from '../../../domains/00-workspace/types';
import { parseYamlArtifactDoc } from '../../../utils/yamlArtifactParser';
import { logger } from '../../../utils/logger';
import { ImportFlag, flagRelationship } from '../../../utils/importDetect';
import { BatchRules, EMPTY_BATCH_RULES, applyImportRules } from '../../../utils/importRules';
import { extractArtifactFromFile } from '../../../gateway/api';
import { contentHash } from '../../../utils/contentHash';
import { getModelForSlot } from '../../../data/modelConfig';

// The session lives ABOVE ImportModal (owned by App) so closing the modal keeps
// processing; rows land as artifacts one at a time.
// Instrumentation: one logger.action per add and per pump completion; per-row
// problems are logger.warn only.

export type ImportRowStatus = 'queued' | 'extracting' | 'landed' | 'failed' | 'canceled' | 'skipped';
export type ImportLane = 'frontmatter' | 'ai';

export interface ImportRow {
  id: string;
  fileName: string;
  content: string;
  words: number;
  status: ImportRowStatus;
  /** frontmatter = parsed instantly; ai = Gemini extraction lane */
  lane?: ImportLane;
  artifactId?: string;
  artifactTitle?: string;
  /** Landed artifact snapshot for in-place inspection (Raw YAML preview). */
  artifact?: Artifact;
  flag?: ImportFlag;
  parentOverride?: string;
  error?: string;
  /** Failure-aware retry: last extraction error + raw invalid model output. */
  lastExtractError?: string;
  lastExtractRaw?: string;
}

export interface ImportSessionApi {
  rows: ImportRow[];
  running: boolean;
  /** Batch rules are read at row-land via ref, so rules set mid-session still apply to rows not yet landed. */
  rules: BatchRules;
  setRules: React.Dispatch<React.SetStateAction<BatchRules>>;
  addFiles: (files: FileList | File[]) => void;
  retryRow: (rowId: string) => void;
  cancelRemaining: () => void;
  dismissRow: (rowId: string) => void;
  setParentOverride: (rowId: string, value: string) => void;
}

const MAX_FILE_BYTES = 5 * 1024 * 1024;

/** Gemini extraction — same endpoint as the single-file Drive flow, 120s cap
 *  so a slow model can never wedge the queue (observed 113–135s). */
async function extractFromGemini(
  content: string,
  filename: string,
  projectTitle: string,
  previous?: { error?: string; raw?: string }
): Promise<Record<string, any>> {
  const res = await extractArtifactFromFile(
    {
      content,
      filename,
      projectTitle,
      fileType: 'doc',
      // Failure-aware retry: give the model its last error + invalid output so
      // it can correct itself instead of deterministically re-failing.
      previousError: previous?.error,
      previousOutput: previous?.raw,
      model: getModelForSlot('extract'),
    },
    { signal: AbortSignal.timeout(120_000) }
  );
  if (!res.ok) {
    // Server wraps failures as {error: string} — surface the real reason
    // (e.g. Gemini quota text) instead of a bare HTTP code.
    let msg = `Extraction HTTP ${res.status}`;
    let rawOut: string | undefined;
    try {
      const body = await res.json();
      rawOut = typeof body?.raw === 'string' ? body.raw : undefined;
      const raw = typeof body?.error === 'string' ? body.error : body?.error?.message;
      if (typeof raw === 'string' && raw.trim()) {
        if (/quota|RESOURCE_EXHAUSTED/i.test(raw)) {
          // Server message can be the raw API JSON — keep only the human sentence.
          const human = raw.match(
            /You exceeded your current quota, please check your plan and billing details\.?/i
          )?.[0];
          msg = `Gemini quota exceeded — ${human || 'free tier limit reached, try again later'}`;
        } else {
          msg = raw.split('\n')[0].trim().slice(0, 300);
        }
      }
    } catch {
      /* keep the HTTP-code fallback */
    }
    const failure: Error & { raw?: string } = new Error(msg);
    if (rawOut) failure.raw = rawOut;
    throw failure;
  }
  const data = await res.json();
  if (!data.artifact) throw new Error(data.error || 'Extraction returned no artifact');
  return data.artifact;
}

const stripExt = (name: string) => name.replace(/\.[^/.]+$/, '');

/** Final id + flag-link applied to the row's artifact snapshot so the Raw YAML
 *  preview shows the same relationship edge the domain store received. */
function attachRowArtifact(base: Artifact, finalId: string, flag: ImportFlag | null): Artifact {
  const art: Artifact = { ...base, id: finalId };
  if (flag) {
    art.graph = {
      ...(art.graph || { children: [] }),
      relationships: [...(art.graph?.relationships || []), flagRelationship(flag)],
    };
  }
  return art;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);

/**
 * Build a complete Artifact from an AI extraction result.
 * The body is the file text the user picked, never the model's retelling of it:
 * a generated body lost 41% of the source across the imports measured on
 * 2026-10-21 (one kept 5%), and the server no longer returns one.
 */
function buildArtifactFromExtraction(
  ex: Record<string, any>,
  fallbackBody: string,
  fallbackTitle: string,
  projectId: string
): Artifact {
  const now = Date.now();
  const title: string = ex.title || fallbackTitle || 'Imported document';
  const graph: ArtifactGraphData = {
    children: [],
    relationships: Array.isArray(ex.graph?.relationships) ? ex.graph.relationships : [],
    is_high_concept: Boolean(ex.graph?.is_high_concept),
  };
  if (typeof ex.graph?.parent === 'string' && ex.graph.parent) graph.parent = ex.graph.parent;
  // Never materialize undefined x/y — Firestore rejects undefined fields
  // (the storage boundary sanitizes, but only what we don't send at all is safe).
  if (typeof ex.graph?.x === 'number') graph.x = ex.graph.x;
  if (typeof ex.graph?.y === 'number') graph.y = ex.graph.y;

  return {
    id: `art-${now}-${Math.floor(Math.random() * 10000)}`,
    workspaceId: projectId,
    code: ex.code || slug(title) || 'imported-note',
    title,
    type: ex.type === 'chapter' ? 'chapter' : 'document',
    category: ex.category || 'note',
    isHighConcept: Boolean(ex.graph?.is_high_concept),
    current: {
      subtitle: ex.current?.subtitle || ex.subtitle || '',
      description: ex.current?.description || ex.description || '',
      summary: ex.current?.summary || ex.summary || '',
      body: fallbackBody || ex.current?.body || ex.content || '',
    },
    tags: Array.isArray(ex.tags) && ex.tags.length > 0 ? ex.tags : ['imported', 'note'],
    createdAt: now,
    updatedAt: now,
    graph,
  };
}

export interface ImportLandResult {
  id: string;
  flag: ImportFlag | null;
}

export function useImportSession(
  project: ProjectMetadata,
  landArtifact: (artifact: Artifact) => ImportLandResult,
  /** Pre-LLM dedup: has this exact content been landed before? (content hash
   *  against the project's artifacts — the body IS the file text). */
  isAlreadyImported: (content: string) => boolean
): ImportSessionApi {
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [running, setRunning] = useState(false);
  const [rules, setRules] = useState<BatchRules>(EMPTY_BATCH_RULES);

  // Single source of truth: the ref is updated synchronously by commit() so the
  // pump loop can see rows appended a moment ago without waiting a render.
  const rowsRef = useRef<ImportRow[]>([]);
  const busyRef = useRef(false);
  const cancelRef = useRef(false);
  const seqRef = useRef(0);
  const projectRef = useRef(project);
  const landRef = useRef(landArtifact);
  const rulesRef = useRef(rules);
  const alreadyRef = useRef(isAlreadyImported);
  projectRef.current = project;
  landRef.current = landArtifact;
  rulesRef.current = rules;
  alreadyRef.current = isAlreadyImported;

  const commit = useCallback((updater: (rs: ImportRow[]) => ImportRow[]) => {
    rowsRef.current = updater(rowsRef.current);
    setRows(rowsRef.current);
  }, []);

  const pump = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setRunning(true);
    const seen = new Set<string>();
    let landed = 0;
    let flagged = 0;
    let failed = 0;
    let skipped = 0;
    try {
      for (;;) {
        if (cancelRef.current) break;
        const next = rowsRef.current.find((r) => r.status === 'queued' && !seen.has(r.id));
        if (!next) break;
        seen.add(next.id);

        try {
          // Skip before ANY model call: identical content was already landed,
          // and burning an LLM round-trip to re-discover that is waste.
          if (alreadyRef.current(next.content)) {
            skipped += 1;
            commit((rs) =>
              rs.map((r) => (r.id === next.id ? { ...r, status: 'skipped' as const } : r))
            );
            continue;
          }
          const proj = projectRef.current;
          const parsed = parseYamlArtifactDoc(next.content, proj.id);

          if (parsed.hasFrontmatter) {
            const prepared = applyImportRules(parsed.artifact, rulesRef.current, next.parentOverride);
            const res = landRef.current(prepared);
            if (res.flag) flagged += 1;
            landed += 1;
            commit((rs) =>
              rs.map((r) =>
                r.id === next.id
                  ? {
                      ...r,
                      status: 'landed' as const,
                      lane: 'frontmatter' as const,
                      artifactId: res.id,
                      artifactTitle: prepared.title,
                      artifact: attachRowArtifact(prepared, res.id, res.flag),
                      ...(res.flag ? { flag: res.flag } : {}),
                    }
                  : r
              )
            );
          } else {
            commit((rs) =>
              rs.map((r) =>
                r.id === next.id ? { ...r, status: 'extracting' as const, lane: 'ai' as const } : r
              )
            );
            const ex = await extractFromGemini(next.content, next.fileName, proj.name, {
              error: next.lastExtractError,
              raw: next.lastExtractRaw,
            });
            const built = buildArtifactFromExtraction(
              ex,
              next.content,
              stripExt(next.fileName),
              proj.id
            );
            const prepared = applyImportRules(built, rulesRef.current, next.parentOverride);
            const res = landRef.current(prepared);
            if (res.flag) flagged += 1;
            landed += 1;
            commit((rs) =>
              rs.map((r) =>
                r.id === next.id
                  ? {
                      ...r,
                      status: 'landed' as const,
                      artifactId: res.id,
                      artifactTitle: prepared.title,
                      artifact: attachRowArtifact(prepared, res.id, res.flag),
                      ...(res.flag ? { flag: res.flag } : {}),
                    }
                  : r
              )
            );
          }
        } catch (err) {
          failed += 1;
          const timedOut = err instanceof DOMException && err.name === 'TimeoutError';
          const msg = timedOut
            ? 'Gemini extraction timed out after 120s'
            : err instanceof Error
              ? err.message
              : 'Import failed';
          logger.warn('ImportSession', `${next.fileName}: ${msg}`, timedOut ? undefined : err);
          const errRaw = err instanceof Error ? (err as { raw?: string }).raw : undefined;
          commit((rs) =>
            rs.map((r) =>
              r.id === next.id
                ? {
                    ...r,
                    status: 'failed' as const,
                    error: msg,
                    // Failure context for the next Retry (failure-aware loop).
                    lastExtractError: msg,
                    ...(errRaw ? { lastExtractRaw: errRaw } : {}),
                  }
                : r
            )
          );
        }
      }
    } finally {
      busyRef.current = false;
      cancelRef.current = false;
      setRunning(false);
      if (seen.size > 0) {
        logger.action(
          'ImportSession',
          `Session processed ${seen.size} file(s): ${landed} landed, ${flagged} flagged, ${skipped} skipped, ${failed} failed`
        );
      }
    }
  }, [commit]);

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const list = Array.from(files);
      if (list.length === 0) return;
      const proj = projectRef.current;
      void (async () => {
        const newRows: ImportRow[] = [];
        for (const f of list) {
          seqRef.current += 1;
          const id = `row-${Date.now()}-${seqRef.current}`;
          if (f.size > MAX_FILE_BYTES) {
            newRows.push({
              id,
              fileName: f.name,
              content: '',
              words: 0,
              status: 'failed',
              error: `File exceeds the 5MB limit (${Math.round(f.size / 1024)}KB)`,
            });
            continue;
          }
          try {
            const content = await f.text();
            newRows.push({
              id,
              fileName: f.name,
              content,
              words: content.split(/\s+/).filter(Boolean).length,
              status: 'queued',
            });
          } catch {
            newRows.push({
              id,
              fileName: f.name,
              content: '',
              words: 0,
              status: 'failed',
              error: 'Could not read file',
            });
          }
        }
        const queued = newRows.filter((r) => r.status === 'queued').length;
        commit((rs) => [...rs, ...newRows]);
        logger.action(
          'ImportSession',
          `Queued ${queued} file(s) for import into "${proj.name}" (${list
            .slice(0, 3)
            .map((f) => f.name)
            .join(', ')}${list.length > 3 ? '…' : ''})`
        );
        if (queued > 0) void pump();
      })();
    },
    [commit, pump]
  );

  const retryRow = useCallback(
    (rowId: string) => {
      commit((rs) =>
        rs.map((r) => (r.id === rowId ? { ...r, status: 'queued', error: undefined } : r))
      );
      logger.action('ImportSession', 'Retry queued for a failed row');
      void pump();
    },
    [commit, pump]
  );

  const cancelRemaining = useCallback(() => {
    const pending = rowsRef.current.filter((r) => r.status === 'queued').length;
    if (pending === 0) return;
    cancelRef.current = true;
    commit((rs) =>
      rs.map((r) => (r.status === 'queued' ? { ...r, status: 'canceled' as const } : r))
    );
    logger.action('ImportSession', `Canceled ${pending} queued import(s) (in-flight row finishes)`);
    if (!busyRef.current) cancelRef.current = false;
  }, [commit]);

  const dismissRow = useCallback(
    (rowId: string) => {
      commit((rs) => rs.filter((r) => r.id !== rowId));
    },
    [commit]
  );

  const setParentOverride = useCallback(
    (rowId: string, value: string) => {
      commit((rs) => rs.map((r) => (r.id === rowId ? { ...r, parentOverride: value } : r)));
    },
    [commit]
  );

  return { rows, running, rules, setRules, addFiles, retryRow, cancelRemaining, dismissRow, setParentOverride };
}