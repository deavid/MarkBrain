/**
 * The payload projections: one memo per readout the UI shows, derived from the
 * compiled payload and the artifact domain. Same memo dependencies App had.
 */
import { useMemo } from 'react';
import type { DomainContextValue } from '../domains/DomainRegistry';
import type { ChatAttachment } from '../domains/06-chat-threads';
import type { Granularity } from '../domains/granularity';
import { estimateArtifactCutTokens } from '../domains/03-optical-compiler';

type ArtifactsDomain = DomainContextValue['artifacts'];
type Compiler = DomainContextValue['compiler'];
type CompiledContext = ReturnType<Compiler['compile']>;

export interface ProjectProjectionsParams {
  artifactsDomain: ArtifactsDomain;
  compiledContext: CompiledContext;
  /** The ACTIVE chat's attachments. */
  activeAttachments: ChatAttachment[];
  /** Bumped whenever artifacts mutate, to force a re-derivation. */
  tick: number;
}

export function useProjectProjections(params: ProjectProjectionsParams) {
  const { artifactsDomain, compiledContext, activeAttachments, tick } = params;

  // One measurer: the folder row, the chat tray and the chapter header all read
  // the counts the compiler assembles — never a second estimator. Rows for
  // artifacts already in this payload read live telemetry; untouched library
  // artifacts are measured at Full, i.e. what staging them would cost.
  const attachmentGranularityById = useMemo(() => {
    const map = new Map<string, Granularity>();
    for (const a of activeAttachments) map.set(a.artifactId, a.granularity);
    return map;
  }, [activeAttachments]);

  const artifactTitles = useMemo(() => {
    const map: Record<string, string> = {};
    for (const a of artifactsDomain.listArtifacts()) map[a.id] = a.title;
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artifactsDomain, tick]);

  const artifactSubtitles = useMemo(() => {
    const map: Record<string, string> = {};
    for (const a of artifactsDomain.listArtifacts()) {
      // A note without a hook still shows something useful: the old one-line
      // description is what a reader recognises it by.
      map[a.id] = a.current?.subtitle || a.current?.description || '';
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artifactsDomain, tick]);

  const tokensByArtifact = useMemo(() => {
    const map: Record<string, number> = {};
    for (const entry of compiledContext.telemetry.attachmentBreakdown ?? []) {
      map[entry.artifactId] = entry.tokens;
    }
    // Artifacts not in this chat's payload: what staging them at Full would cost.
    for (const art of artifactsDomain.listArtifacts()) {
      if (map[art.id] !== undefined) continue;
      map[art.id] = estimateArtifactCutTokens(art, 'full');
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compiledContext, artifactsDomain, tick]);

  const chapterTokens = useMemo(() => {
    const map: Record<string, number> = {};
    for (const entry of compiledContext.telemetry.chapterBreakdown ?? []) {
      map[entry.chapterId] = entry.tokens;
    }
    return map;
  }, [compiledContext]);

  return { attachmentGranularityById, artifactTitles, artifactSubtitles, tokensByArtifact, chapterTokens };
}
