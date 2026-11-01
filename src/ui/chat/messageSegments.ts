/**
 * In-place message segmentation (BUG-007/008/012).
 *
 * The model writes its operation sentinels (<link>, <unlink>,
 * <topic_shift>, <artifact_upsert>) mid-prose. This parser walks a message —
 * complete OR mid-stream — and returns the ordered segments so the renderer
 * can put a chip exactly where the model wrote the tag, and show a live
 * status chip while a tag is still being written (no raw half-written XML
 * ever leaks into the prose, and stripping never leaves blank holes).
 */

export type MessageSegment =
  | { kind: 'prose'; text: string }
  | {
      kind: 'attach';
      rawXml: string;
      file: string;
      level: string;
      streaming?: boolean;
    }
  | {
      kind: 'link';
      rawXml: string;
      action: 'link' | 'unlink';
      source: string;
      target: string;
      relKind: string;
      streaming?: boolean;
    }
  | {
      kind: 'topic_shift';
      rawXml: string;
      title: string;
      subtitle?: string;
      description?: string;
      summary?: string;
      streaming?: boolean;
    }
  | {
      kind: 'artifact_upsert';
      rawXml: string;
      id: string;
      file: string;
      title: string;
      type: string;
      innerXml: string;
      wordCount: number;
      streaming?: boolean;
    };

const attr = (s: string, name: string): string => {
  const m = new RegExp(`${name}=["']([^"']*)["']?`, 'i').exec(s);
  return m ? m[1] : '';
};
const countWords = (s: string): number => (s.trim() ? s.trim().split(/\s+/).length : 0);

/** Collapse the blank-line runs a stripped/replaced tag leaves behind. */
const trimBlankRuns = (text: string): string => text.replace(/\n{3,}/g, '\n\n');

/**
 * Does `region` (the text after the last complete tag) end with an OPENED but
 * UNCLOSED sentinel tag? Returns the streaming segment, or null.
 */
function streamingTail(region: string): MessageSegment | null {
  const openers: Array<{ tag: string; make: (attrs: string, raw: string) => MessageSegment }> = [
    {
      tag: 'artifact_upsert',
      make: (attrs, raw) => {
        const gt = raw.indexOf('>');
        const innerXml = gt >= 0 ? raw.slice(gt + 1) : '';
        const file = attr(attrs, 'file') || attr(attrs, 'id');
        return {
          kind: 'artifact_upsert',
          rawXml: raw,
          id: file.replace(/\.md$/i, ''),
          file,
          title: attr(attrs, 'title') || file.replace(/\.md$/i, '') || 'note',
          type: attr(attrs, 'type') || 'document',
          innerXml,
          wordCount: countWords(innerXml.replace(/<[^>]+>/g, ' ')),
          streaming: true,
        };
      },
    },
    {
      tag: 'link',
      make: (attrs, raw) => ({
        kind: 'link',
        rawXml: raw,
        action: 'link',
        source: attr(attrs, 'source'),
        target: attr(attrs, 'target'),
        relKind: attr(attrs, 'kind') || 'relates_to',
        streaming: true,
      }),
    },
    {
      tag: 'unlink',
      make: (attrs, raw) => ({
        kind: 'link',
        rawXml: raw,
        action: 'unlink',
        source: attr(attrs, 'source'),
        target: attr(attrs, 'target'),
        relKind: attr(attrs, 'kind') || '',
        streaming: true,
      }),
    },
    {
      tag: 'attach',
      make: (attrs, raw) => ({
        kind: 'attach',
        rawXml: raw,
        file: attr(attrs, 'file'),
        level: attr(attrs, 'level') || 'full',
        streaming: true,
      }),
    },
    {
      tag: 'topic_shift',
      make: (attrs, raw) => ({
        kind: 'topic_shift',
        rawXml: raw,
        title: attr(attrs, 'title'),
        subtitle: attr(attrs, 'subtitle') || undefined,
        description: attr(attrs, 'description') || undefined,
        summary: attr(attrs, 'summary') || undefined,
        streaming: true,
      }),
    },
  ];

  for (const opener of openers) {
    const from = region.lastIndexOf(`<${opener.tag}`);
    if (from === -1) continue;
    const tail = region.slice(from);
    if (opener.tag === 'artifact_upsert') {
      // Closed only by an explicit end tag.
      if (new RegExp(`</${opener.tag}>`, 'i').test(tail)) continue;
    } else {
      // Closed only by `/>`; an open `>` without the slash is still streaming.
      if (new RegExp(`<${opener.tag}[^>]*\\/\\s*>`, 'i').test(tail)) continue;
    }
    const gt = tail.indexOf('>');
    const attrs =
      gt >= 0
        ? tail.slice(0, gt).replace(/^<[a-z_]+\s*/i, '')
        : tail.slice(tail.indexOf(' ') + 1);
    return opener.make(attrs, tail);
  }
  return null;
}

export function parseMessageSegments(content: string): MessageSegment[] {
  const segments: MessageSegment[] = [];

  // Ordered scan: every sentinel tag in appearance order.
  const pattern =
    /<link\s+[^>]*?\/>|<unlink\s+[^>]*?\/>|<topic_shift\s+[^>]*?\/>|<attach\s+[^>]*?\/>|<(?:artifact_upsert|artifact)\b[^>]*>[\s\S]*?<\/(?:artifact_upsert|artifact)>/gi;
  let last = 0;
  let m: RegExpExecArray | null;
  const pushProse = (text: string) => {
    const t = trimBlankRuns(text);
    if (t) segments.push({ kind: 'prose', text: t });
  };

  while ((m = pattern.exec(content)) !== null) {
    if (m.index > last) pushProse(content.slice(last, m.index));
    const raw = m[0];
    const lower = raw.toLowerCase();
    if (lower.startsWith('<link')) {
      segments.push({
        kind: 'link',
        rawXml: raw,
        action: 'link',
        source: attr(raw, 'source'),
        target: attr(raw, 'target'),
        relKind: attr(raw, 'kind') || 'relates_to',
      });
    } else if (lower.startsWith('<unlink')) {
      segments.push({
        kind: 'link',
        rawXml: raw,
        action: 'unlink',
        source: attr(raw, 'source'),
        target: attr(raw, 'target'),
        relKind: attr(raw, 'kind') || '',
      });
    } else if (lower.startsWith('<attach')) {
      segments.push({
        kind: 'attach',
        rawXml: raw,
        file: attr(raw, 'file'),
        level: attr(raw, 'level') || 'full',
      });
    } else if (lower.startsWith('<topic_shift')) {
      segments.push({
        kind: 'topic_shift',
        rawXml: raw,
        title: attr(raw, 'title'),
        subtitle: attr(raw, 'subtitle') || undefined,
        description: attr(raw, 'description') || undefined,
        summary: attr(raw, 'summary') || undefined,
      });
    } else {
      const gt = raw.indexOf('>');
      const attrs = raw.slice(1, gt);
      const innerXml = raw.slice(gt + 1, raw.toLowerCase().lastIndexOf('</'));
      const file = attr(attrs, 'file') || attr(attrs, 'id');
      segments.push({
        kind: 'artifact_upsert',
        rawXml: raw,
        id: file.replace(/\.md$/i, ''),
        file,
        title: attr(attrs, 'title') || file.replace(/\.md$/i, '') || 'Extracted note',
        type: attr(attrs, 'type') || 'document',
        innerXml,
        wordCount: countWords(innerXml.replace(/<[^>]+>/g, ' ')),
      });
    }
    last = m.index + raw.length;
  }

  if (last < content.length) {
    const region = content.slice(last);
    const tail = streamingTail(region);
    if (tail) {
      const rawXml = 'rawXml' in tail ? tail.rawXml : '';
      const head = rawXml ? region.slice(0, region.lastIndexOf(rawXml)) : region;
      pushProse(head);
      segments.push(tail);
    } else {
      pushProse(region);
    }
  }

  return segments;
}
