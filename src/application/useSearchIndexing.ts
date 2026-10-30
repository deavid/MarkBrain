/**
 * The search index runners: the bulk, abortable "Index All" job and the
 * single-document runner behind the detail modal's Q&A Index tab. Both
 * publish into the same read-only index map the scoring tier reads.
 */
import type React from 'react';
import { useRef, useState } from 'react';
import { logger } from '../utils/logger';
import { shouldIndexInBrowser } from './artifactIndexer';
import { indexProjectArtifacts, indexSingleArtifact } from './artifactIndexer';
import type { IndexAbortSignal } from './artifactIndexer';
import type { ArtifactSearchIndexRecord } from '../services/searchIndexStore';
import type { DomainContextValue } from '../domains/DomainRegistry';

export interface SearchIndexingParams {
  projectId: string;
  /** The artifacts to index. */
  artifactsDomain: DomainContextValue['artifacts'];
  setSearchIndexMap: React.Dispatch<React.SetStateAction<Map<string, ArtifactSearchIndexRecord>>>;
  searchIndexMap: Map<string, ArtifactSearchIndexRecord>;
}

export function useSearchIndexing(params: SearchIndexingParams) {
  const { projectId, artifactsDomain, setSearchIndexMap, searchIndexMap } = params;
  // The indexing runner: one document at a time, abortable, and the finished
  // map is swapped in as a NEW Map so the 350ms tier re-scores on completion.
  const [indexProgress, setIndexProgress] = useState<{
    done: number;
    total: number;
    stage: string;
  } | null>(null);
  const indexAbortRef = useRef<IndexAbortSignal | null>(null);
  // Failures stay on screen until the next run. A count that refuses to move is
  // indistinguishable from a save that never happens unless the app says which.
  const [indexFailures, setIndexFailures] = useState<{ title: string; message: string }[]>([]);

  const handleIndexAll = (force: boolean) => {
    if (!shouldIndexInBrowser()) return; // local mode: lexical only, 0 embed calls (21F §1)
    if (indexAbortRef.current) return;
    const signal: IndexAbortSignal = { aborted: false };
    indexAbortRef.current = signal;
    const arts = artifactsDomain.listArtifacts();
    const mapCopy = new Map(searchIndexMap);
    // Straggler guard. An overlapping step can still report AFTER this run has
    // settled (a fetch that was already in flight when a sibling failed), and
    // an unguarded setIndexProgress then repaints the line with nothing left to
    // ever clear it — that is what left the UI stuck on "Indexing 16/16" after
    // it had already gone back to normal.
    let live = true;
    setIndexFailures([]);
    setIndexProgress({ done: 0, total: arts.length, stage: force ? 'Re-index requested' : 'Index requested' });
    indexProjectArtifacts(projectId, arts, mapCopy, {
      force,
      signal,
      onProgress: (done, total, stage) => {
        if (live) setIndexProgress({ done, total, stage });
      },
      // Publish per DOCUMENT, not per run. `indexedCount` and the 350ms
      // re-score both key off the Map's identity, so a single swap at the end
      // froze the counter and the ranking for the entire job.
      onIndexed: (record) => {
        if (!live) return;
        setSearchIndexMap((prev) => {
          const next = new Map(prev);
          next.set(record.artifactId, record);
          return next;
        });
      },
      onFailure: (title, message) => {
        if (live) setIndexFailures((prev) => [...prev, { title, message }]);
      },
    })
      .then((updated) => {
        if (live) setSearchIndexMap(new Map(updated));
      })
      .catch((e) => logger.warn('App', 'indexProjectArtifacts failed', e))
      .finally(() => {
        live = false;
        indexAbortRef.current = null;
        setIndexProgress(null);
      });
  };

  const handleStopIndexing = () => {
    if (indexAbortRef.current) indexAbortRef.current.aborted = true;
  };
  // Single-document runner behind the detail modal's Q&A Index tab.
  const [indexArtifactProgress, setIndexArtifactProgress] = useState<string | null>(null);
  const handleIndexArtifact = (artifactId: string) => {
    if (!shouldIndexInBrowser()) return; // local mode: lexical only (21F §1)
    if (indexArtifactProgress || indexAbortRef.current) return;
    const art = artifactsDomain.getArtifact(artifactId);
    if (!art) return;
    // Take the SAME lock the bulk runner uses. Without it one document from the
    // detail modal could index alongside "Index All" — two writers on the same
    // progress line and two Map swaps fighting each other, which is how you get
    // a line that jumps backwards and then sticks.
    const signal: IndexAbortSignal = { aborted: false };
    indexAbortRef.current = signal;
    let live = true;
    setIndexArtifactProgress('Starting…');
    indexSingleArtifact(projectId, art, (stage) => {
      if (live) setIndexArtifactProgress(stage);
    }, signal, searchIndexMap.get(art.id))
      .then((record) => {
        if (!live) return;
        // Functional update: never clobber a concurrent bulk publish.
        setSearchIndexMap((prev) => {
          const next = new Map(prev);
          next.set(record.artifactId, record);
          return next;
        });
      })
      .catch((e) => logger.warn('App', 'indexSingleArtifact failed', e))
      .finally(() => {
        live = false;
        indexAbortRef.current = null;
        setIndexArtifactProgress(null);
      });
  };

  return {
    indexProgress,
    indexFailures,
    handleIndexAll,
    handleStopIndexing,
    indexArtifactProgress,
    handleIndexArtifact,
  };
}
