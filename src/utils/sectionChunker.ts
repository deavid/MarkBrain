/**
 * Section chunker — the unit of retrieval for the draft-proximity testbed.
 *
 * A 10–200 KiB design note cannot be searched as one string: it would match
 * every draft by sheer word volume, and it busts gemini-embedding-001's
 * 2,048-token input cap. So every artifact is split into passages that stay
 * well under that cap and keep their heading breadcrumb, which is also what
 * the Library's X-Ray diagnostic line prints on a hit.
 *
 * Dependency-free and synchronous: this runs on every keystroke once the draft
 * settles, so it must never touch the network, the DOM, or a store.
 */
import type { UniversalArtifactDocument } from '../domains/01-artifact-document/types';

export interface DocSection {
  /** Stable within one artifact: 'sec-meta', 'sec-1', 'sec-2', … */
  id: string;
  /** Breadcrumb heading, e.g. 'Vision > Motto' or 'Vision > Motto (part 2)'. */
  heading: string;
  /** Section body. Body sections are prefixed with title + heading by the caller. */
  text: string;
}

/** ~450 tokens at the repo's 3.8 chars/token estimate — safely under 2,048. */
export const DEFAULT_MAX_SECTION_CHARS = 1800;

const HEADING_RE = /^#{1,4}\s+(.+)$/;

/**
 * FNV-1a 32-bit over the searchable text of an artifact, returned as
 * `${hex}-${length}`. The length suffix means two different documents that
 * collide on 32 bits still differ. Used as the staleness key for the IndexedDB
 * search index: if this hash moved, the stored Q&A and vectors are out of date.
 *
 * Memoised on `updatedAt` + body length: this concatenates and scans ~200 KiB
 * per artifact, and `scoreArtifactsAgainstDraft` asks every artifact for its
 * hash on every debounced keystroke. 100 notes x 200 KiB would otherwise be
 * 20 MB of charCodeAt per score run — more than the whole debounce budget.
 * Both guards are O(1). An edit bumps `updatedAt`; a same-length in-place body
 * rewrite that also forgot to bump it is a bug elsewhere, not a risk worth
 * 20 MB per keystroke.
 */
const hashCache = new Map<string, { updatedAt: number; bodyLen: number; hash: string }>();

export function computeArtifactContentHash(art: UniversalArtifactDocument): string {
  const bodyLen = (art.current?.body || '').length;
  const cached = hashCache.get(art.id);
  if (cached && cached.updatedAt === art.updatedAt && cached.bodyLen === bodyLen) {
    return cached.hash;
  }

  const raw = [
    art.title || '',
    art.current?.subtitle || '',
    (art.tags || []).join(','),
    art.current?.description || '',
    art.current?.summary || '',
    art.current?.body || '',
  ].join('\n§\n');

  let h = 0x811c9dc5;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  const hash = `${(h >>> 0).toString(16)}-${raw.length}`;
  hashCache.set(art.id, { updatedAt: art.updatedAt, bodyLen, hash });
  return hash;
}

/** Test hook: the memo is keyed on artifact identity, so fixtures that mutate an id in place must clear it. */
export function clearSectionChunkerCache(): void {
  hashCache.clear();
}

/** Split on double newlines, keeping any single piece under the cap. */
function splitLongProse(block: string, maxChars: number): string[] {
  if (block.length <= maxChars) return [block];

  const paras = block.split(/\n{2,}/);
  const out: string[] = [];
  let buf = '';
  const flush = () => {
    if (buf.trim()) out.push(buf.trimEnd());
    buf = '';
  };
  for (const p of paras) {
    if (!buf) {
      if (p.length <= maxChars) {
        buf = p;
        continue;
      }
      // A single enormous paragraph with no double newlines — force-chunk it.
      for (let i = 0; i < p.length; i += maxChars) out.push(p.slice(i, i + maxChars));
      continue;
    }
    if (buf.length + p.length + 2 <= maxChars) {
      buf = `${buf}\n\n${p}`;
      continue;
    }
    flush();
    if (p.length <= maxChars) {
      buf = p;
      continue;
    }
    for (let i = 0; i < p.length; i += maxChars) out.push(p.slice(i, i + maxChars));
  }
  flush();
  return out;
}

/**
 * Split an artifact into searchable passages.
 *
 * Section 0 is ALWAYS the metadata block (title, subtitle, tags, description,
 * summary) so a hit on the index-card hook still points at the right document.
 * The body then splits on `#`…`####` headings with a breadcrumb; any block over
 * the cap sub-splits on paragraph boundaries and keeps the heading with a
 * `(part N)` suffix so the diagnostic can still name where the hit was.
 */
export function splitArtifactIntoSections(
  art: UniversalArtifactDocument,
  maxCharsPerSection: number = DEFAULT_MAX_SECTION_CHARS
): DocSection[] {
  const out: DocSection[] = [];

  const metaParts: string[] = [];
  if (art.title) metaParts.push(art.title);
  if (art.current?.subtitle) metaParts.push(art.current.subtitle);
  if (art.tags?.length) metaParts.push(`Tags: ${art.tags.join(', ')}`);
  if (art.current?.description) metaParts.push(art.current.description);
  if (art.current?.summary) metaParts.push(art.current.summary);

  if (metaParts.length > 0) {
    const meta = metaParts.join('\n');
    if (meta.length <= maxCharsPerSection) {
      out.push({ id: 'sec-meta', heading: `${art.title || art.id} — Overview`, text: meta.trim() });
    } else {
      splitLongProse(meta, maxCharsPerSection).forEach((chunk, i) => {
        out.push({
          id: 'sec-meta',
          heading: `${art.title || art.id} — Overview${i > 0 ? ` (part ${i + 1})` : ''}`,
          text: chunk.trim(),
        });
      });
    }
  }

  const body = art.current?.body || '';
  if (!body.trim()) return out.filter((s) => s.text.trim().length > 0);

  // Split on markdown headings, keeping the heading line with its block.
  const lines = body.split('\n');
  const blocks: Array<{ heading: string; text: string }> = [];
  const crumbs: string[] = [];
  let current: string[] = [];
  const titleOf = (text: string) => text.replace(/^#{1,4}\s+/, '').trim();
  const flushBlock = (heading: string) => {
    const text = current.join('\n').trim();
    current = [];
    if (text) blocks.push({ heading, text });
  };

  for (const line of lines) {
    const m = HEADING_RE.exec(line);
    if (m) {
      const depth = (line.match(/^#+/) || ['#'])[0].length;
      const title = titleOf(line);
      flushBlock(crumbs.join(' > ') || art.title || art.id);
      crumbs.length = Math.max(0, depth - 1);
      crumbs[depth - 1] = title;
      if (depth > crumbs.length) crumbs.push(title);
      crumbs.length = depth;
      continue;
    }
    current.push(line);
  }
  flushBlock(crumbs.join(' > ') || art.title || art.id);

  let n = 0;
  for (const block of blocks) {
    const heading = block.heading || art.title || art.id;
    const pieces = splitLongProse(block.text, maxCharsPerSection);
    pieces.forEach((piece, idx) => {
      if (!piece.trim()) return;
      n += 1;
      out.push({
        id: `sec-${n}`,
        heading: pieces.length > 1 ? `${heading} (part ${idx + 1})` : heading,
        text: piece.trim(),
      });
    });
  }

  return out.filter((s) => s.text.trim().length > 0);
}

/**
 * The string that gets embedded: title and heading ride along so a vector chunk
 * never floats free of its document.
 */
export function sectionEmbeddingText(
  title: string,
  section: DocSection,
  isMeta: boolean
): string {
  if (isMeta) return section.text;
  return `${title} — ${section.heading}\n${section.text}`;
}

/**
 * The string keyword search runs over. Deliberately does NOT prepend the
 * artifact title, unlike `sectionEmbeddingText`: putting the title into every
 * body passage means a title-word query matches all of them identically, which
 * flattens which passage wins and inflates BM25's raw score for free. The title
 * is still reachable because `sec-meta`'s own text carries it, and `bestFts`
 * adds a flat title/tag bonus once per artifact.
 */
export function sectionSearchText(section: DocSection): string {
  return `${section.heading}\n${section.text}`;
}

/** First ~220 chars, whitespace collapsed — what the Library diagnostic shows. */
export function sectionSnippet(text: string, maxChars = 220): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= maxChars ? flat : `${flat.slice(0, maxChars - 1)}…`;
}
