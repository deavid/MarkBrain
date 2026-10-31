/**
 * The compiled-prompt section parser (plan doc 30 Phase 3).
 *
 * The inspector's "By section" view splits a compiled prompt at its known
 * structural markers so David can see at a glance WHAT ate the context
 * window and by how much. Two payload dialects exist:
 *
 *  - the client optical compiler: <knowledge_substrate> (with per-note
 *    <artifact file="…"> children), optional <existing_links>, and
 *    <conversation_chapters> (with per-chapter children);
 *  - the server fallback builder: `--- MARKER ---` headers (PREVIOUS CHAPTER
 *    SUMMARIES, ACTIVE-IN-MEMORY ARTIFACTS, CONVERSATION TRANSCRIPT).
 *
 * PURE: string in, sections out. An unrecognised payload stays ONE raw
 * section — never silently chopped into a wrong shape.
 */

export interface CompiledSection {
  title: string;
  text: string;
  chars: number;
  /** Sub-blocks (the individual artifacts / chapters), when the section has them. */
  items: CompiledSection[];
}

const BLOCK_TITLES: Record<string, string> = {
  knowledge_substrate: 'Knowledge substrate — attached notes',
  existing_links: 'Existing links (graph)',
  memory_graph: 'Memory graph',
  conversation_chapters: 'Conversation chapters',
};

const ITEM_RES: Record<string, RegExp> = {
  knowledge_substrate: /<artifact\s+file="([^"]+)"[\s\S]*?<\/artifact>/g,
  conversation_chapters: /<chapter\s+name="([^"]+)"[\s\S]*?<\/chapter>/g,
};

const HEADER_DASH_RE = /^-{3,}\s*(.+?)\s*-{3,}\s*$/gm;

function itemize(name: string, inner: string): CompiledSection[] {
  const re = ITEM_RES[name];
  if (!re) return [];
  const items: CompiledSection[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(inner)) !== null) {
    items.push({ title: m[1], text: m[0], chars: m[0].length, items: [] });
  }
  return items;
}

export function parseCompiledSections(text: string): CompiledSection[] {
  if (!text) return [];

  type Marker = { start: number; end: number; title: string; inner: string; items: CompiledSection[] };
  const markers: Marker[] = [];

  // Top-level XML blocks, in order of appearance.
  const blockRe = /<(knowledge_substrate|existing_links|memory_graph|conversation_chapters)>([\s\S]*?)<\/\1>/g;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(text)) !== null) {
    markers.push({
      start: m.index,
      end: m.index + m[0].length,
      title: BLOCK_TITLES[m[1]],
      inner: m[2],
      items: itemize(m[1], m[2]),
    });
  }

  // `--- MARKER ---` headers (server fallback dialect).
  HEADER_DASH_RE.lastIndex = 0;
  while ((m = HEADER_DASH_RE.exec(text)) !== null) {
    const title = m[1].trim();
    const known = BLOCK_TITLES[m[1]];
    markers.push({
      start: m.index,
      end: m.index + m[0].length,
      title: known ?? title,
      inner: '',
      items: [],
    });
  }

  if (markers.length === 0) {
    return [{ title: 'Raw compiled prompt', text, chars: text.length, items: [] }];
  }

  markers.sort((a, b) => a.start - b.start);

  const sections: CompiledSection[] = [];
  let cursor = 0;
  for (const marker of markers) {
    // Text between markers = the conversation transcript / ask (client
    // dialect) or the header line (server dialect: "Project: …").
    if (marker.start > cursor) {
      const between = text.slice(cursor, marker.start).trim();
      if (between) {
        const isHeaderLine = !marker.title.startsWith('Knowledge') && marker.inner === '' && cursor === 0;
        sections.push({
          title: isHeaderLine ? 'Header' : 'Conversation transcript & ask',
          text: between,
          chars: between.length,
          items: [],
        });
      }
    }
    // For a `---` marker the section BODY runs until the next marker.
    if (marker.inner === '' && !BLOCK_TITLES[marker.title]) {
      const next = markers[markers.indexOf(marker) + 1];
      const body = text.slice(marker.end, next ? next.start : text.length).trim();
      if (body) {
        sections.push({ title: marker.title, text: body, chars: body.length, items: [] });
      }
    } else {
      sections.push({ title: marker.title, text: text.slice(marker.start, marker.end), chars: text.slice(marker.start, marker.end).length, items: marker.items });
    }
    cursor = marker.inner === '' && !BLOCK_TITLES[marker.title] ? (markers[markers.indexOf(marker) + 1]?.start ?? text.length) : marker.end;
  }
  // Trailing text after the last block = the ask + transcript.
  if (cursor < text.length) {
    const tail = text.slice(cursor).trim();
    if (tail) {
      sections.push({ title: 'Conversation transcript & ask', text: tail, chars: tail.length, items: [] });
    }
  }

  return sections;
}
