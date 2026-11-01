/**
 * BUG-007/008 seams: MessageBody renders the operations IN PLACE (rendered)
 * and shows the true raw with <artifact_upsert> collapsed by default (raw).
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MessageBody } from '../ui/chat/MessageBody';

const content = [
  'Here are the links:',
  '<link source="a.md" target="b.md" kind="relates_to" />',
  'Now the artifact:',
  '<artifact_upsert file="the-hook.md" title="The Hook"><subtitle>s</subtitle><content>' + 'body '.repeat(50) + '</content></artifact_upsert>',
  '<topic_shift title="Next Chapter" />',
  'Closing prose.',
].join('\n');

const render = (props: Record<string, unknown>) =>
  renderToStaticMarkup(React.createElement(MessageBody, { content, ...props } as any));

describe('MessageBody rendered mode (BUG-007)', () => {
  const html = render({ raw: false });

  it('never leaks raw XML into the rendered prose', () => {
    expect(html).not.toContain('<link source=');
    expect(html).not.toContain('<artifact_upsert');
    expect(html).not.toContain('<topic_shift');
  });

  it('renders the prose segments as markdown around the chips', () => {
    expect(html).toContain('Here are the links:');
    expect(html).toContain('Closing prose.');
  });

  it('renders the link chip in place with the relation kind', () => {
    expect(html).toContain('relates_to');
    expect(html).toContain('data-op="link"');
  });

  it('renders the artifact chip and chapter chip in place', () => {
    expect(html).toContain('data-op="artifact_upsert"');
    expect(html).toContain('The Hook');
    expect(html).toContain('data-op="topic_shift"');
    expect(html).toContain('Next Chapter');
  });

  it('renders a live streaming chip for a half-written tag', () => {
    const html = renderToStaticMarkup(
      React.createElement(
        MessageBody,
        { content: 'Writing now.\n<artifact_upsert file="the-hook.md" title="The Hook">\n<subtitle>par', raw: false } as any
      )
    );
    expect(html).toContain('data-streaming="true"');
    expect(html).toContain('The Hook');
    expect(html).not.toContain('<artifact_upsert');
  });
});

describe('MessageBody raw mode (BUG-008)', () => {
  const html = render({ raw: true });

  it('shows the raw XML of prose, link and topic_shift inline', () => {
    // react-dom/server escapes angle brackets and quotes; the bytes are still exact.
    expect(html).toContain('source=');
    expect(html).toContain('a.md');
    expect(html).toContain('Next Chapter');
    expect(html).toContain('relates_to');
  });

  it('collapses the artifact_upsert by default with an expandable marker', () => {
    expect(html).toContain('[+]');
    expect(html).toContain('words');
    expect(html).toContain('data-testid="message-raw"');
  });
});
