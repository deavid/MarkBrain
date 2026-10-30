/**
 * The receipts row: every parsed action of one reply, rendered as chips —
 * the chapter it opened, the artifacts it created or linked, and the graph
 * links it applied (or had ignored).
 */
import React from 'react';
import { BookmarkPlus, FilePlus2, Link2, Unlink2 } from 'lucide-react';
import type { ChapterTurns, Turn } from '../../types';

  /* ── receipts (2026-10-30): every parsed action of a reply is VISIBLE ──────
   * The raw stream contains sentinels (<artifact_upsert>, <topic_shift>) that
   * the pipeline strips and turns into real actions. Stripping them silently
   * means two different raw messages can render as the same chat bubble —
   * unacceptable: the proof of what the model DID lives here, as chips.
   * Data is whatever the turn already carries (extractedArtifacts, meta
   * attachments, chapter starts) — no extra fetch, works offline. */
  export const receiptsFor = (message: Turn, chapters: ChapterTurns[]) => {
    const created = message.extractedArtifacts ?? [];
    const linked = (message.meta?.attachments ?? [])
      .map((a) => a.artifactId)
      .filter((id, i, all) => all.indexOf(id) === i)
      .filter((id) => !created.some((a) => a.id === id));
    const chapter = chapters.find((c) => c.turns[0]?.id === message.id);
    return { created, linked, chapter };
  };
/** The VPS job behind a turn pair: turn ids embed it (turn-ai-job-…). */
export const jobIdFor = (message: Turn): string | null =>
    message.id.includes('-job-') ? message.id.replace(/^turn-(user|ai)-/, '') : null;

export const TurnReceiptsRow: React.FC<{
  message: Turn;
  /** The thread's chapters — a reply can be the one that opened a chapter. */
  chapters: ChapterTurns[];
  isUser: boolean;
  artifactTitles: Record<string, string>;
  onOpenArtifact?: (artifactId: string) => void;
}> = ({ message, chapters, isUser, artifactTitles, onOpenArtifact }) => {
  const { created, linked, chapter } = receiptsFor(message, chapters);
  if (isUser || (!created.length && !linked.length && !chapter && !(message.extractedLinks ?? []).length)) return null;
  return (
  <div className="mt-2 pt-2 flex flex-wrap items-center gap-1.5" data-testid="turn-receipts">
    {chapter && (
      <span
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-surface-3 text-10 font-mono text-[#d6be94]"
        title={`This reply opened the chapter "${chapter.chapter.title}"`}
      >
        <BookmarkPlus className="w-3 h-3" /> Chapter: {chapter.chapter.title}
      </span>
    )}
    {created.map((a) => (
      <button
        key={a.id}
        type="button"
        onClick={() => a.id && onOpenArtifact?.(a.id)}
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-surface-3 hover:bg-surface-4 text-10 font-mono text-[#5ad49b] transition-colors cursor-pointer"
        title={`This reply created the artifact "${a.title}" — click to open it`}
      >
        <FilePlus2 className="w-3 h-3" /> Created: {a.title}
      </button>
    ))}
    {linked.map((id) => (
      <button
        key={id}
        type="button"
        onClick={() => onOpenArtifact?.(id)}
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-surface-3 hover:bg-surface-4 text-10 font-mono text-[#8ab1e0] transition-colors cursor-pointer"
        title={`This reply is attached to "${artifactTitles?.[id] ?? id}" — click to open it`}
      >
        <Link2 className="w-3 h-3" /> Linked: {artifactTitles?.[id] ?? `${id.slice(0, 10)}…`}
      </button>
    ))}
    {(message.extractedLinks ?? []).map((l, i) => {
      const from = (l.sourceId && artifactTitles?.[l.sourceId]) || l.sourceFile;
      const to = (l.targetId && artifactTitles?.[l.targetId]) || l.targetFile;
      const unresolved = !l.sourceId || !l.targetId;
      const isUnlink = l.action === 'unlink';
      const ignored = !l.applied;
      return (
        <button
          key={`${l.action ?? 'link'}-${l.sourceFile}-${l.targetFile}-${l.kind}-${i}`}
          type="button"
          onClick={() => l.sourceId && onOpenArtifact?.(l.sourceId)}
          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-surface-3 text-10 font-mono transition-colors cursor-pointer ${
            ignored ? 'text-[#7185a3]' : isUnlink ? 'text-[#f28894]' : 'text-[#b59765]'
          }`}
          title={
            ignored
              ? isUnlink
                ? `The model asked to UNLINK ${l.sourceFile} → ${l.targetFile}, but it was IGNORED — 'Link artifacts' is OFF in Chat behavior`
                : `The model asked to link ${l.sourceFile} → ${l.targetFile} (${l.kind}), but it was IGNORED — 'Link artifacts' is OFF in Chat behavior`
              : unresolved
                ? `The model asked to link ${l.sourceFile} → ${l.targetFile} (${l.kind}), but one side is not an artifact in this project`
                : isUnlink
                  ? `This reply BROKE the link between "${from}" and "${to}" — click to open the source`
                  : `This reply linked "${from}" → ${l.kind} → "${to}" in the graph — click to open the source`
          }
        >
          {isUnlink ? <Unlink2 className="w-3 h-3" /> : <Link2 className="w-3 h-3" />}
          {isUnlink ? '' : unresolved ? '? ' : ignored ? '⨯ ' : ''}{from} {isUnlink ? '⫯' : '→'} {to}
        </button>
      );
    })}
  </div>
  );
};
