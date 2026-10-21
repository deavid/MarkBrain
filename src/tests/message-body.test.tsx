/**
 * The bubble body contract: markdown becomes elements, raw stays bytes, and
 * nothing the model (or the user) typed can inject markup.
 *
 * Rendered through react-dom/server — no DOM needed, and it exercises the real
 * component instead of a reimplementation of it.
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MessageBody } from '../ui/chat/MessageBody';

const render = (content: string, raw: boolean, tone?: 'raised' | 'sunken') =>
  renderToStaticMarkup(<MessageBody content={content} raw={raw} tone={tone} />);

describe('MessageBody — rendered', () => {
  it('renders headings, emphasis, lists and fences as elements', () => {
    const html = render(
      '## Heading\n\nSome **bold** and `inline`.\n\n- one\n- two\n\n```ts\nconst a = 1 < 2;\n```',
      false
    );
    expect(html).toContain('<h2>Heading</h2>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<code>inline</code>');
    expect(html).toContain('<li>one</li>');
    expect(html).toContain('<pre>');
    // The fence's `<` survived as text, not as an open tag.
    expect(html).toContain('const a = 1 &lt; 2;');
  });

  it('renders a link with a safe scheme', () => {
    const html = render('[docs](https://example.com/a?x=1&y=2)', false);
    expect(html).toContain('href="https://example.com/a?x=1&amp;y=2"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('never emits markup from the message text', () => {
    const html = render('hello <script>alert(1)</script> <img src=x onerror=alert(1)>', false);
    expect(html).not.toContain('<script');
    expect(html).not.toMatch(/<img[^>]*onerror/i);
    // Both arrive as literal text, which is the point.
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('drops a hostile link instead of rendering it', () => {
    const html = render('[click](javascript:alert(1))', false);
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain('<a ');
    // It degrades to the literal source rather than becoming a link.
    expect(html).toContain('[click](javascript:alert(1))');
  });

  it('keeps an unterminated fence (mid-stream) as text instead of throwing', () => {
    expect(() => render('```ts\nconst a = 1', false)).not.toThrow();
  });
});

describe('MessageBody — raw', () => {
  it('shows the source verbatim, unformatted', () => {
    const source = '## Heading\n\nSome **bold** and `inline`.\n\n```ts\nconst a = 1 < 2;\n```';
    const html = render(source, true);
    expect(html).toContain('**bold**');
    expect(html).toContain('## Heading');
    expect(html).toContain('```ts');
    expect(html).not.toContain('<strong>');
    expect(html).not.toContain('<h2>');
    expect(html).not.toContain('<pre>');
  });

  it('is still escaped text, not markup', () => {
    const html = render('<script>alert(1)</script>', true);
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;script&gt;');
  });

  it('is the same string Copy puts on the clipboard', () => {
    // Copy writes message.content, the raw branch prints message.content — if
    // these ever diverge, "what I copied" stops matching "what I can see".
    const source = 'trailing spaces   \n\n\nand blank lines\n';
    const html = render(source, true);
    expect(html).toContain('trailing spaces   ');
    expect(html).toContain('and blank lines');
  });
});

describe('MessageBody — tone', () => {
  it('marks the sunken (reply) bubble by default', () => {
    expect(render('x', false)).toContain('md-chat-sunken');
  });

  it('marks a raised (user) bubble so code steps the other way', () => {
    const html = render('x', false, 'raised');
    expect(html).toContain('md-chat-raised');
    expect(html).not.toContain('md-chat-sunken');
  });
});
