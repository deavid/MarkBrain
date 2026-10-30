/**
 * The draft-proximity search testbed (design-docs/15): the query override, the
 * search configuration, the read-only search index view, the two scoring
 * tiers (local re-score + one embed per typing pause) and the match count.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { logger } from '../utils/logger';
import { getModelForSlot } from '../data/modelConfig';
import { embedTexts } from '../gateway/api';
import { loadSearchConfig, saveSearchConfig } from '../domains/search/searchConfig';
import type { SearchTestbedConfig } from '../domains/search/searchConfig';
import {
  scoreArtifactsAgainstDraft,
  countMissingMatches,
  splitDraftIntoClauses,
  l2Normalize,
} from '../domains/search/draftSearchEngine';
import { QueryVectorCache } from '../domains/search/queryVectorCache';
import type { QueryCacheHit } from '../domains/search/queryVectorCache';
import type { ArtifactMatchResult } from '../domains/search/draftSearchEngine';
import { loadProjectSearchIndex } from '../services/searchIndexStore';
import type { ArtifactSearchIndexRecord } from '../services/searchIndexStore';
import { isAttachmentStaged } from '../domains/06-chat-threads';
import type { ChatAttachment } from '../domains/06-chat-threads';
import type { DomainContextValue } from '../domains/DomainRegistry';

export interface DraftProximitySearchParams {
  /** The chat draft (LAW 4) — the default query, overridden by searchQueryOverride. */
  draftText: string;
  /** The artifacts to score. */
  artifactsDomain: DomainContextValue['artifacts'];
  /** The project whose search index (IndexedDB) is read. */
  projectId: string;
  /** The active chat's attachments — already-attached artifacts score lower. */
  activeAttachments: ChatAttachment[];
  /** Re-render trigger; re-scores when the domain state moved. */
  tick: number;
}

export function useDraftProximitySearch(params: DraftProximitySearchParams) {
  const { draftText, artifactsDomain, projectId, activeAttachments, tick } = params;
  // A test query that is NOT the chat draft. Empty = "use the chat draft"
  // (the default); anything typed here overrides it WITHOUT touching what is
  // in the composer, so you can probe the library while a message is half-written.
  // This is the fix for the proximity box: it used to bind straight to the
  // draft and swap to a read-only <p> the instant it held a single character,
  // which made it uneditable after the first keystroke.
  const [searchQueryOverride, setSearchQueryOverride] = useState('');
  const searchQuery = searchQueryOverride.trim() || draftText;

  const [searchConfig, setSearchConfigState] = useState<SearchTestbedConfig>(() =>
    loadSearchConfig()
  );
  const handleSearchConfigChange = (patch: Partial<SearchTestbedConfig>) => {
    setSearchConfigState((prev) => {
      const next = { ...prev, ...patch };
      saveSearchConfig(next);
      return next;
    });
  };

  // LAW 2: records live in IndexedDB (markbrain-search-index), never in the
  // project snapshot — this map is a read-only view of that database.
  const [searchIndexMap, setSearchIndexMap] = useState<Map<string, ArtifactSearchIndexRecord>>(
    () => new Map()
  );
  useEffect(() => {
    let alive = true;
    loadProjectSearchIndex(projectId)
      .then((map) => {
        if (alive) setSearchIndexMap(map);
      })
      .catch((e) => logger.warn('App', 'loadProjectSearchIndex failed', e));
    return () => {
      alive = false;
    };
  }, [projectId]);

  const attachedArtifactIds = useMemo(
    // "Already attached" means COMMITTED (design 15, live 2026-10-26): staged
    // rows are not attached yet — David clicked attach-next and the row
    // teleported to the ALREADY ATTACHED bucket. A staged row keeps its
    // position in the suggested list (it wears the 'next send' badge) and
    // only descends when the send commits it.
    () => new Set(activeAttachments.filter((a) => !isAttachmentStaged(a)).map((a) => a.artifactId)),
    [activeAttachments]
  );

  const [draftResults, setDraftResults] = useState<ArtifactMatchResult[]>([]);
  // Query vectors keyed by the clause text they were embedded from: editing
  // the draft invalidates them without an API call; typing back into cached
  // text is a cache hit. The cache itself survives thread switches.
  const [queryVectors, setQueryVectors] = useState<{
    key: string;
    vectors: Float32Array[];
  } | null>(null);
  // Near-duplicate rejection: the last few queries and their vectors. Two
  // spellings of the same question must not cost two embed calls on a
  // 1,000-request/day budget.
  const queryVecCacheRef = useRef(new QueryVectorCache());
  /** What the last query-embed decision was, so the panel can show its work. */
  const [queryEmbedNote, setQueryEmbedNote] = useState<{
    match: 'exact' | 'near' | 'fresh';
    similarity?: number;
    sourceText?: string;
  } | null>(null);

  const clauseKey = useMemo(
    () => splitDraftIntoClauses(searchQuery, searchConfig.splitClauses).join('\n'),
    [searchQuery, searchConfig.splitClauses]
  );
  const clauseVectors =
    queryVectors && queryVectors.key === clauseKey ? queryVectors.vectors : null;
  const needsQueryVec = searchConfig.vecSections || searchConfig.vecQa;

  // Tier 1 — local re-score 350ms after the draft / flags / threshold / index /
  // attachment set last moved. No API calls on this path, ever.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!searchQuery.trim()) {
        setDraftResults([]);
        return;
      }
      setDraftResults(
        scoreArtifactsAgainstDraft({
          draftText: searchQuery,
          clauseVectors,
          artifacts: artifactsDomain.listArtifacts(),
          indexMap: searchIndexMap,
          attachedArtifactIds,
          config: searchConfig,
        })
      );
    }, 350);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, searchConfig, searchIndexMap, attachedArtifactIds, clauseVectors, tick]);

  // Tier 2 — one embed per 5s typing pause, only when a vec flag is on, the
  // draft is long enough to be a real query, and its clause text is uncached.
  useEffect(() => {
    if (!needsQueryVec) return;
    if (searchQuery.trim().length < 12) return;
    const clauses = splitDraftIntoClauses(searchQuery, searchConfig.splitClauses);
    if (clauses.length === 0) return;
    const key = clauses.join('\n');
    // 1. Exact, or 2. close enough to reuse on purpose. Only 3. costs a request.
    const cached: QueryCacheHit | null = queryVecCacheRef.current.get(key, getModelForSlot('embed'));
    if (cached) {
      setQueryEmbedNote({
        match: cached.match,
        similarity: cached.similarity,
        sourceText: cached.sourceText,
      });
      setQueryVectors((prev) => (prev && prev.key === key ? prev : { key, vectors: cached.vectors }));
      return;
    }
    setQueryEmbedNote(null);
    let cancelled = false;
    const timer = window.setTimeout(() => {
      // Say it the moment it is SENT, not when it succeeds. A request that
      // 429s still cost the budget — reporting only success would make a spent
      // request look like no request at all.
      if (!cancelled) setQueryEmbedNote({ match: 'fresh' });
      embedTexts({ texts: clauses, taskType: 'RETRIEVAL_QUERY' })
        .then(async (res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = (await res.json()) as { embeddings?: number[][] };
          const vectors = (data.embeddings ?? []).map((v) => new Float32Array(l2Normalize(v)));
          if (cancelled || vectors.length === 0) return;
          queryVecCacheRef.current.set(key, vectors, getModelForSlot('embed'));
          setQueryVectors({ key, vectors });
        })
        .catch((e) => {
          if (!cancelled) logger.warn('App', 'Draft query embed failed', e);
        });
    }, 5000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, needsQueryVec, searchConfig.splitClauses]);

  const missingMatchCount = countMissingMatches(draftResults);

  return {
    searchQueryOverride,
    setSearchQueryOverride,
    searchConfig,
    handleSearchConfigChange,
    searchIndexMap,
    setSearchIndexMap,
    draftResults,
    queryEmbedNote,
    missingMatchCount,
  };
}
