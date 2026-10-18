/**
 * Minimal, dependency-free Markdown → HTML renderer for artifact previews.
 *
 * Design rules:
 * - Input is HTML-escaped before any formatting is applied, so untrusted
 *   artifact bodies can never inject markup (links are scheme-whitelisted).
 * - Single newlines inside paragraphs render as <br /> so the rendered view
 *   keeps visual parity with the "Raw" view authors are used to.
 * - Unsupported syntax degrades to literal text; the Raw view always shows
 *   the untouched source.
 *
 * Supported: ATX headings, hr, fenced code blocks, blockquotes, ordered /
 * unordered lists (with indentation-based nesting), pipe tables, paragraphs,
 * `code`, **bold**, *italic*, ~~strikethrough~~, [links](…), ![images](…).
 * Deliberately NOT supported: underscore emphasis (`t3_body` must stay
 * literal), raw HTML, reference-style links.
 */

const SLOT = '\u0000';

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(text: string): string {
  return escapeHtml(text).replace(/"/g, '&quot;');
}

/** Returns an attribute-safe URL, or null when the scheme is not allowed. */
function sanitizeUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed || /[<>"\u0000-\u001f]/.test(trimmed)) return null;
  const lower = trimmed.toLowerCase();
  const scheme = lower.match(/^[a-z][a-z0-9+.-]*:/);
  if (scheme) {
    if (!/^(https?|mailto|tel):/.test(lower)) return null;
  }
  return escapeAttr(trimmed);
}

function emphasis(text: string): string {
  let s = text.replace(/\*\*(?!\s)([\s\S]+?)(?<!\s)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(?<!\*)\*(?!\s)([\s\S]+?)(?<!\s)\*(?!\*)/g, '<em>$1</em>');
  s = s.replace(/(?<!~)~~(?!\s)([\s\S]+?)(?<!\s)~~(?!~)/g, '<del>$1</del>');
  return s;
}

/** Inline pipeline: extract raw slots → escape → emphasis → restore slots. */
function inline(raw: string): string {
  const slots: string[] = [];
  const slot = (html: string) => {
    slots.push(html);
    return `${SLOT}${slots.length - 1}${SLOT}`;
  };

  // 1. Code spans — content preserved raw, restored escaped at the end.
  let s = raw.replace(/`([^`]+)`/g, (_m, code) => slot(`<code>${escapeHtml(code)}</code>`));

  // 2. Images
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, url) => {
    const safe = sanitizeUrl(url);
    return safe ? slot(`<img src="${safe}" alt="${escapeAttr(String(alt))}" />`) : m;
  });

  // 3. Links
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text, url) => {
    const safe = sanitizeUrl(url);
    return safe
      ? slot(
          `<a href="${safe}" target="_blank" rel="noopener noreferrer">${emphasis(escapeHtml(String(text)))}</a>`
        )
      : m;
  });

  // 4. Escape everything that is not inside a slot.
  s = escapeHtml(s);

  // 5. Emphasis on the escaped text.
  s = emphasis(s);

  // 6. Restore slots.
  return s.replace(new RegExp(`${SLOT}(\\d+)${SLOT}`, 'g'), (_m, i) => slots[Number(i)] ?? '');
}

const isBlank = (l: string) => /^\s*$/.test(l);
const indentOf = (l: string) => l.match(/^ */)![0].length;

function isHardBlockStart(line: string): boolean {
  return (
    /^ {0,3}```/.test(line) ||
    /^ {0,3}#{1,6}\s/.test(line) ||
    /^ {0,3}([-*_])( *\1){2,} *$/.test(line) ||
    /^ {0,3}>/.test(line)
  );
}

function matchListItem(line: string): { indent: number; ordered: boolean; text: string } | null {
  const m = line.match(/^(\s*)(?:([-*+])|(\d+)[.)])\s+(.*)$/);
  if (!m) return null;
  return { indent: m[1].length, ordered: m[3] !== undefined, text: m[4] };
}

function isTableSeparator(line: string): boolean {
  return /^ {0,3}\|? *:?-+:? *(?:\| *:?-+:? *)*\|? *$/.test(line) && line.includes('-');
}

function splitTableRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, '|').trim());
}

/** Render a contiguous list block starting at `start` (stack-based nesting). */
function renderList(lines: string[], start: number): { html: string; next: number } {
  type Level = { indent: number; ordered: boolean; items: string[]; current: string | null };
  const first = matchListItem(lines[start])!;
  const root: Level = { indent: first.indent, ordered: first.ordered, items: [], current: null };
  const stack: Level[] = [root];
  let i = start;

  const closeCurrent = (lvl: Level) => {
    if (lvl.current !== null) {
      lvl.items.push(lvl.current);
      lvl.current = null;
    }
  };

  const popLevel = () => {
    const lvl = stack.pop()!;
    closeCurrent(lvl);
    const tag = lvl.ordered ? 'ol' : 'ul';
    const html = `<${tag}>${lvl.items.map((t) => `<li>${t}</li>`).join('')}</${tag}>`;
    const parent = stack[stack.length - 1];
    if (parent) {
      if (parent.current !== null) parent.current += html;
      else if (parent.items.length > 0) parent.items[parent.items.length - 1] += html;
      else parent.items.push(html);
    }
    return html;
  };

  const appendContinuation = (text: string): boolean => {
    const top = stack[stack.length - 1];
    const piece = `<br />${inline(text)}`;
    if (top.current !== null) top.current += piece;
    else if (top.items.length > 0) top.items[top.items.length - 1] += piece;
    else return false;
    return true;
  };

  while (i < lines.length) {
    const line = lines[i];

    if (isBlank(line)) {
      let k = i;
      while (k < lines.length && isBlank(lines[k])) k++;
      if (k >= lines.length) break;
      const m = matchListItem(lines[k]);
      const continues = (m !== null && m.indent >= root.indent) || indentOf(lines[k]) > root.indent;
      if (!continues || isHardBlockStart(lines[k])) break;
      stack.forEach(closeCurrent);
      i = k;
      continue;
    }

    const m = matchListItem(line);
    if (m) {
      if (m.indent < root.indent) break;
      while (stack.length > 1 && stack[stack.length - 1].indent > m.indent) popLevel();
      const top = stack[stack.length - 1];
      if (m.indent > top.indent) {
        stack.push({ indent: m.indent, ordered: m.ordered, items: [], current: null });
        stack[stack.length - 1].current = inline(m.text);
      } else {
        closeCurrent(top);
        top.current = inline(m.text);
      }
      i++;
      continue;
    }

    if (isHardBlockStart(line)) break;
    if (!appendContinuation(line)) break;
    i++;
  }

  while (stack.length > 1) popLevel();
  const html = popLevel(); // root level (no parent to append into)
  return { html, next: i };
}

function renderBlocks(lines: string[]): string {
  const out: string[] = [];
  let i = 0;
  const n = lines.length;

  while (i < n) {
    const line = lines[i];
    if (isBlank(line)) {
      i++;
      continue;
    }

    // Fenced code block
    const fence = line.match(/^ {0,3}```\s*([A-Za-z0-9_+#.-]*)\s*$/);
    if (fence) {
      const lang = fence[1];
      const buf: string[] = [];
      i++;
      while (i < n && !/^ {0,3}```\s*$/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      i++; // skip closing fence (or stop at EOF)
      const cls = lang ? ` class="language-${escapeHtml(lang.toLowerCase())}"` : '';
      out.push(`<pre><code${cls}>${escapeHtml(buf.join('\n'))}</code></pre>`);
      continue;
    }

    // ATX heading
    const h = line.match(/^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (h) {
      const level = h[1].length;
      out.push(`<h${level}>${inline(h[2])}</h${level}>`);
      i++;
      continue;
    }

    // Horizontal rule
    if (/^ {0,3}([-*_])( *\1){2,} *$/.test(line)) {
      out.push('<hr />');
      i++;
      continue;
    }

    // Blockquote
    if (/^ {0,3}>/.test(line)) {
      const buf: string[] = [];
      while (i < n && /^ {0,3}>/.test(lines[i])) {
        buf.push(lines[i].replace(/^ {0,3}> ?/, ''));
        i++;
      }
      out.push(`<blockquote>${renderBlocks(buf)}</blockquote>`);
      continue;
    }

    // Pipe table
    if (line.includes('|') && i + 1 < n && isTableSeparator(lines[i + 1])) {
      const header = splitTableRow(line);
      const alignments = splitTableRow(lines[i + 1]).map((c) => {
        if (c.startsWith(':') && c.endsWith(':')) return 'center';
        if (c.endsWith(':')) return 'right';
        if (c.startsWith(':')) return 'left';
        return '';
      });
      i += 2;
      const rows: string[][] = [];
      while (i < n && !isBlank(lines[i]) && lines[i].includes('|')) {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      const th = header
        .map((c, idx) => {
          const style = alignments[idx] ? ` style="text-align:${alignments[idx]}"` : '';
          return `<th${style}>${inline(c)}</th>`;
        })
        .join('');
      const body = rows
        .map(
          (r) =>
            `<tr>${r
              .map((c, idx) => {
                const style = alignments[idx] ? ` style="text-align:${alignments[idx]}"` : '';
                return `<td${style}>${inline(c)}</td>`;
              })
              .join('')}</tr>`
        )
        .join('');
      out.push(`<table><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table>`);
      continue;
    }

    // Lists
    if (matchListItem(line)) {
      const res = renderList(lines, i);
      if (res.html) out.push(res.html);
      i = res.next;
      continue;
    }

    // Paragraph — accumulates until a blank line or a new block start.
    const buf: string[] = [];
    while (
      i < n &&
      !isBlank(lines[i]) &&
      !isHardBlockStart(lines[i]) &&
      !matchListItem(lines[i])
    ) {
      buf.push(lines[i]);
      i++;
    }
    if (buf.length > 0) {
      out.push(`<p>${buf.map(inline).join('<br />')}</p>`);
    }
  }

  return out.join('\n');
}

/** Render markdown source to a safe HTML string. */
export function renderMarkdown(source: string): string {
  if (!source || !source.trim()) return '';
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  return renderBlocks(lines);
}