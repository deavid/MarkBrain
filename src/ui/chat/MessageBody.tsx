import React, { useMemo, useState } from 'react';
import { renderMarkdown } from '../../utils/markdown';
import {
  parseMessageSegments,
  type MessageSegment,
} from './messageSegments';
import type { Turn } from '../../types';
import { FilePlus2, Link2, Unlink2, BookmarkPlus, Loader2 } from 'lucide-react';

interface MessageBodyProps {
  content: string;
  /** Show the untouched source instead of the rendered document. */
  raw: boolean;
  /**
   * Which way the host bubble moved. Code blocks step the opposite way, so a
   * fence stays visible on both a user bubble (raised) and a reply (sunken).
   */
  tone?: 'raised' | 'sunken';
  /** Receipts for resolving link chips to artifact titles (and 'applied' state). */
  linkReceipts?: Turn['extractedLinks'];
  /** Artifact titles by id, for naming chip endpoints. */
  artifactTitles?: Record<string, string>;
  /** Opens an artifact from a chip. */
  onOpenArtifact?: (artifactId: string) => void;
}

/**
 * One bubble's text. In rendered mode the operation sentinels the model wrote
 * (<link>, <unlink>, <topic_shift>, <artifact_upsert>) render as chips IN
 * PLACE, exactly where they sit in the prose — never dumped at the bottom,
 * never leaked as raw XML (BUG-007). In raw mode the bytes are the real,
 * unprocessed model output; huge <artifact_upsert> bodies collapse by default
 * behind a [+] toggle (BUG-008).
 */
export const MessageBody: React.FC<MessageBodyProps> = React.memo(
  ({ content, raw, tone = 'sunken', linkReceipts, artifactTitles, onOpenArtifact }) => {
    const segments = useMemo(() => parseMessageSegments(content), [content]);
    const hasOps = useMemo(() => segments.some((s) => s.kind !== 'prose'), [segments]);

    if (raw) {
      return (
        <div
          data-testid="message-raw"
          className="whitespace-pre-wrap break-words font-mono text-11 sm:text-xs leading-relaxed"
        >
          {hasOps ? (
            segments.map((seg, i) => <RawSegment key={i} seg={seg} />)
          ) : (
            content
          )}
        </div>
      );
    }

    if (hasOps) {
      return (
        <div
          data-testid="message-markdown"
          className={`md-body md-chat md-chat-${tone}`}
        >
          {segments.map((seg, i) =>
            seg.kind === 'prose' ? (
              <div
                key={i}
                // Safe because renderMarkdown() escapes its input before formatting —
                // see the security note on that file. Never bypass it.
                dangerouslySetInnerHTML={{ __html: renderMarkdown(seg.text) }}
              />
            ) : (
              <InlineOpChip key={i} seg={seg} linkReceipts={linkReceipts} artifactTitles={artifactTitles} onOpenArtifact={onOpenArtifact} />
            )
          )}
        </div>
      );
    }

    return (
      <div
        data-testid="message-markdown"
        className={`md-body md-chat md-chat-${tone}`}
        // Safe because renderMarkdown() escapes its input before formatting —
        // see the security note on that file. Never bypass it.
        dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
      />
    );
  }
);

MessageBody.displayName = 'MessageBody';

/* ── Rendered-mode inline chips (BUG-007) ─────────────────────────────────── */

const InlineOpChip: React.FC<{
  seg: MessageSegment;
  linkReceipts?: Turn['extractedLinks'];
  artifactTitles?: Record<string, string>;
  onOpenArtifact?: (artifactId: string) => void;
}> = ({ seg, linkReceipts, artifactTitles, onOpenArtifact }) => {
  if (seg.kind === 'link') {
    if (seg.streaming) {
      return (
        <span
          data-op="link"
          data-streaming="true"
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-surface-3 text-10 font-mono text-[#38bdf8] animate-pulse align-middle"
        >
          <Link2 className="w-3 h-3" />
          Linking {seg.source || '…'} → {seg.target || '…'}…
        </span>
      );
    }
    // Resolve both endpoints against the receipts, then titles.
    const receipt = (linkReceipts ?? []).find(
      (r) =>
        (r.sourceFile === seg.source && r.targetFile === seg.target) ||
        (r.sourceFile.endsWith(seg.source.replace(/\.md$/i, '')) &&
          r.targetFile.endsWith(seg.target.replace(/\.md$/i, '')))
    );
    const endpoint = (file: string, id: string | null | undefined) => {
      const label = (id && artifactTitles?.[id]) || file.replace(/\.md$/i, '');
      if (!id) {
        return (
          <span
            className="text-[#f0c674]"
            title={`"${file}" — not found in this project, so the link was not created`}
          >
            ⚠ {label}
          </span>
        );
      }
      return (
        <button
          type="button"
          onClick={() => onOpenArtifact?.(id)}
          className="hover:underline cursor-pointer"
          title={`Open "${label}" (${file})`}
        >
          {label}
        </button>
      );
    };
    return (
      <span
        data-op="link"
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-surface-3 text-10 font-mono text-[#67e8f9] align-middle"
      >
        {seg.action === 'unlink' ? <Unlink2 className="w-3 h-3" /> : <Link2 className="w-3 h-3" />}
        {seg.action === 'unlink' && <span>Unlinked:</span>}
        {endpoint(seg.source, receipt?.sourceId)}
        <span className="text-[#556985]">── {seg.relKind || receipt?.kind || 'relates_to'} ──▶</span>
        {endpoint(seg.target, receipt?.targetId)}
        {receipt && !receipt.applied && (
          <span className="text-[#556985]" title="Capabilities: Link artifacts was off">
            (ignored)
          </span>
        )}
      </span>
    );
  }

  if (seg.kind === 'attach') {
    if (seg.streaming) {
      return (
        <span
          data-op="attach"
          data-streaming="true"
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-surface-3 text-10 font-mono text-[#67e8f9] animate-pulse align-middle"
        >
          Attaching {seg.file || '…'}…
        </span>
      );
    }
    return (
      <span
        data-op="attach"
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-surface-3 text-10 font-mono text-[#67e8f9] align-middle"
        title={`This message attaches "${seg.file}" at the ${seg.level} cut`}
      >
        <Link2 className="w-3 h-3" />
        {seg.file.replace(/\.md$/i, '')} · {seg.level}
      </span>
    );
  }

  if (seg.kind === 'artifact_upsert') {
    if (seg.streaming) {
      return (
        <span
          data-op="artifact_upsert"
          data-streaming="true"
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-surface-3 text-10 font-mono text-[#5ad49b] animate-pulse align-middle"
        >
          <Loader2 className="w-3 h-3 animate-spin" />
          Writing artifact "{seg.title || seg.file || 'note'}"…{seg.wordCount > 0 && ` (${seg.wordCount} words)`}
        </span>
      );
    }
    return (
      <button
        type="button"
        data-op="artifact_upsert"
        onClick={() => seg.id && onOpenArtifact?.(seg.id)}
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-surface-3 hover:bg-surface-4 text-10 font-mono text-[#5ad49b] align-middle cursor-pointer transition-colors"
        title={`Saved as "${seg.file}" — click to open it`}
      >
        <FilePlus2 className="w-3 h-3" />
        {seg.title} ({seg.file})
      </button>
    );
  }

  if (seg.kind === 'topic_shift') {
    if (seg.streaming) {
      return (
        <span
          data-op="topic_shift"
          data-streaming="true"
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-surface-3 text-10 font-mono text-[#d6be94] animate-pulse align-middle"
        >
          <Loader2 className="w-3 h-3 animate-spin" />
          Starting new chapter…
        </span>
      );
    }
    return (
      <span
        data-op="topic_shift"
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-surface-3 text-10 font-mono text-[#d6be94] align-middle"
        title="This reply opened a new chapter"
      >
        <BookmarkPlus className="w-3 h-3" />
        Chapter: {seg.title}
      </span>
    );
  }
  return null;
};

/* ── Raw mode with collapsible artifact_upsert (BUG-008) ──────────────────── */

const RawSegment: React.FC<{ seg: MessageSegment }> = ({ seg }) => {
  const [expanded, setExpanded] = useState(false);
  if (seg.kind !== 'artifact_upsert') {
    return <>{seg.kind === 'prose' ? seg.text : seg.rawXml}</>;
  }
  if (seg.streaming) {
    return <>{seg.rawXml}</>;
  }
  const words = seg.wordCount.toLocaleString('en-US');
  if (expanded) {
    return (
      <span data-op="artifact_upsert">
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="text-[#67e8f9] cursor-pointer font-bold"
          title="Collapse the artifact body"
        >
          [-]
        </button>{' '}
        {seg.rawXml}
      </span>
    );
  }
  return (
    <button
      type="button"
      data-op="artifact_upsert"
      onClick={() => setExpanded(true)}
      className="block text-left text-[#5ad49b] cursor-pointer hover:underline w-full"
      title="Click to expand the full artifact body"
    >
      [+] {'<artifact_upsert file="' + seg.file + '" title="' + seg.title + '" …> … (' + words +
        ' words — click to expand) </artifact_upsert>'}
    </button>
  );
};
