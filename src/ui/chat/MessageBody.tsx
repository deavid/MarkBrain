import React, { useMemo } from 'react';
import { renderMarkdown } from '../../utils/markdown';

interface MessageBodyProps {
  content: string;
  /** Show the untouched source instead of the rendered document. */
  raw: boolean;
  /**
   * Which way the host bubble moved. Code blocks step the opposite way, so a
   * fence stays visible on both a user bubble (raised) and a reply (sunken).
   */
  tone?: 'raised' | 'sunken';
}

/**
 * One bubble's text. Markdown renders through the same `renderMarkdown()` the
 * artifact body uses, so a reply's code fences, lists and tables look the same
 * wherever they land; `raw` is the escape hatch that always shows exactly the
 * bytes the model produced (and that Copy puts on the clipboard).
 */
export const MessageBody: React.FC<MessageBodyProps> = React.memo(({ content, raw, tone = 'sunken' }) => {
  const html = useMemo(() => (raw ? '' : renderMarkdown(content)), [content, raw]);

  if (raw) {
    return (
      <div
        data-testid="message-raw"
        className="whitespace-pre-wrap break-words font-mono text-[11px] sm:text-xs leading-relaxed"
      >
        {content}
      </div>
    );
  }

  return (
    <div
      data-testid="message-markdown"
      className={`md-body md-chat md-chat-${tone}`}
      // Safe because renderMarkdown() escapes its input before formatting —
      // see the security note on that file. Never bypass it.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
});

MessageBody.displayName = 'MessageBody';
