/**
 * Artifact detail modal — one slim pinned row (David, 2026-11-01).
 *
 * Mobile-first law: the modal previously pinned ~222px of chrome on a phone
 * portrait (61 header + 75 attach bar + 34 tabs + 52 Done bar) and 207px on a
 * landscape phone — 59% of the screen. Approved design: ONE pinned row
 * (title + slug badge + Edit/Download/Fullscreen/Close). The attach bar, the
 * category badge, the tab strip and the tab content all live inside the one
 * scroll container. The Done bar is gone (✕ and Esc close; a fixed bar for a
 * duplicate button is chrome).
 *
 * Rendered through react-dom/server (no DOM in this repo's vitest).
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { ArtifactDetailModal } from '../ui/artifacts/ArtifactDetailModal';

const art = {
  id: 'art-internal-uuid-1',
  workspaceId: 'p',
  code: 'night-vision-design',
  title: 'Night Vision Design',
  type: 'document',
  category: 'spec',
  isHighConcept: false,
  current: {
    subtitle: 'The hook',
    description: 'The overview',
    summary: 'The digest',
    body: '# Body\n\nText.',
  },
  tags: ['vision'],
  createdAt: 1,
  updatedAt: 1,
} as any;

const base = {
  artifact: art,
  onClose: vi.fn(),
  attachmentGranularity: null,
  onAttach: vi.fn(),
  onSetAttachmentGranularity: vi.fn(),
  onSaveEdit: vi.fn(),
  edges: [],
  onAddEdge: vi.fn(),
  onRemoveEdge: vi.fn(),
  artifacts: [art],
  onRenameCode: vi.fn(),
  onSetCategory: vi.fn(),
  onSetTags: vi.fn(),
  threads: [],
  chatAttachments: [],
  otherCodes: [],
} as any;

function render() {
  return renderToStaticMarkup(React.createElement(ArtifactDetailModal, base));
}

describe('modal — ONE pinned row only', () => {
  it('pins title + slug badge + the four icons, and nothing else', () => {
    const html = render();
    const pinnedRow = html.match(/<div class="[^"]*p-2 sm:p-3 bg-surface-3[^"]*"/);
    expect(pinnedRow).not.toBeNull();
    expect(html).toContain('title="Edit this note"');
    expect(html).toContain('title="Download this note as a .md file"');
    expect(html).toContain('title="Close modal (Esc)"');
    // The slug badge rides the pinned row (identity law) but the category
    // badge scrolls — it lives with the attach strip now.
    expect(html).toContain('night-vision-design.md');
    expect(html).not.toMatch(/<div class="[^"]*bg-surface-2 flex items-center justify-end"/);
  });

  it('the Done bar is gone — no Done button anywhere', () => {
    expect(render()).not.toContain('>Done<');
  });

  it('attach bar, category badge, tabs and content all scroll together', () => {
    const html = render();
    // The attach strip and the tab strip must NOT be siblings of the pinned
    // header anymore: they render inside the single scroll container, which
    // keeps flex-1 overflow-y-auto.
    const scrollDiv = html.match(/<div class="[^"]*flex-1 overflow-y-auto[^"]*">/);
    expect(scrollDiv).not.toBeNull();
    const tail = html.slice(scrollDiv!.index!);
    expect(tail).toContain('Stage for next message');
    expect(tail).toContain('Overview &amp; Layers'); // entity-escaped in static markup
    expect(tail).toContain('History');
  });

  it('the fullscreen button stays for desktop but frees a slot on phones', () => {
    const html = render();
    // The modal boots fullscreen, so the rendered title is the restore branch;
    // the class is what the assertion cares about: hidden on phones.
    expect(html).toMatch(/hidden sm:flex[^>]*title="Restore standard view"/);
  });
});

describe('modal — wiring (source scan)', () => {
  const src = readFileSync('src/ui/artifacts/ArtifactDetailModal.tsx', 'utf8');

  it('switching tabs scrolls the content back to the top (no disorientation)', () => {
    expect(src).toContain('scrollTo({ top: 0');
  });

  it('the slug badge truncates instead of squeezing the title off-screen', () => {
    expect(src).toMatch(/max-w-\[30%\][^"]*truncate|truncate[^"]*max-w-\[30%\]/);
  });
});
