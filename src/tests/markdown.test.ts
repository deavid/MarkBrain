/**
 * Markdown renderer suite — guards the artifact detail "Rendered" view.
 *
 * Load-bearing invariants:
 * - untrusted artifact bodies can never inject HTML (escape-first pipeline)
 * - underscore identifiers like `body` must stay literal (no _em_ rules)
 * - unsafe link schemes (javascript:, data:) are never emitted as anchors
 */
import { describe, it, expect } from 'vitest';
import { renderMarkdown } from '../utils/markdown';

describe('renderMarkdown', () => {
  it('renders headings, paragraphs and hard line breaks', () => {
    const html = renderMarkdown('# Title\nline one\nline two\n\nSecond para');
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<p>line one<br />line two</p>');
    expect(html).toContain('<p>Second para</p>');
  });

  it('renders bold, italic, strikethrough and inline code', () => {
    const html = renderMarkdown('**bold** *it* ~~gone~~ `x < y`');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>it</em>');
    expect(html).toContain('<del>gone</del>');
    expect(html).toContain('<code>x &lt; y</code>');
  });

  it('keeps underscore identifiers literal (no italic false-positives)', () => {
    const html = renderMarkdown('Use body and description fields.');
    expect(html).not.toContain('<em>');
    expect(html).toContain('body and description');
  });

  it('escapes raw HTML in paragraphs', () => {
    const html = renderMarkdown('hello <script>alert(1)</script> world');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>');
  });

  it('renders fenced code blocks with escaped content and language class', () => {
    const html = renderMarkdown('```ts\nconst a = 1 < 2;\n```');
    expect(html).toContain('<pre><code class="language-ts">');
    expect(html).toContain('const a = 1 &lt; 2;');
    expect(html).not.toContain('< 2;');
  });

  it('refuses unsafe link schemes but keeps safe ones', () => {
    const bad = renderMarkdown('[click](javascript:alert(1))');
    expect(bad).not.toContain('<a ');
    expect(bad).toContain('[click](javascript:alert(1))');

    const good = renderMarkdown('[docs](https://example.com/a?x=1&y=2)');
    expect(good).toContain('<a href="https://example.com/a?x=1&amp;y=2"');
    expect(good).toContain('rel="noopener noreferrer"');
  });

  it('renders flat and nested lists', () => {
    const html = renderMarkdown('- a\n- b\n  - b1\n- c');
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>a</li>');
    expect(html).toContain('<li>b<ul><li>b1</li></ul></li>');
    expect(html).toContain('<li>c</li>');

    const ordered = renderMarkdown('1. one\n2. two');
    expect(ordered).toContain('<ol><li>one</li><li>two</li></ol>');
  });

  it('renders blockquotes and horizontal rules', () => {
    const html = renderMarkdown('> quoted text\n\n---');
    expect(html).toContain('<blockquote><p>quoted text</p></blockquote>');
    expect(html).toContain('<hr />');
  });

  it('renders pipe tables with alignment', () => {
    const html = renderMarkdown('| a | b |\n|:--|--:|\n| 1 | 2 |');
    expect(html).toContain('<table>');
    expect(html).toContain('<th style="text-align:left">a</th>');
    expect(html).toContain('<th style="text-align:right">b</th>');
    expect(html).toContain('<td style="text-align:left">1</td>');
    expect(html).toContain('<td style="text-align:right">2</td>');
  });

  it('returns empty string for empty input', () => {
    expect(renderMarkdown('')).toBe('');
    expect(renderMarkdown('   \n\n')).toBe('');
  });
});