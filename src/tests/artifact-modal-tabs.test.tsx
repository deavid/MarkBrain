/**
 * BUG-006 §3: the modal is restructured into six tabs — Body, Overview &
 * Layers, Relationships (N), Chats (N), History (N), Q&A Index (N) — with the
 * Layers & YAML tab removed, History ALWAYS visible, and `artifact.id` never
 * shown. Header shows Title + slug badge (`code.md`) + Category badge.
 *
 * Rendered through react-dom/server (no DOM in this repo's vitest).
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ArtifactDetailModal } from '../ui/artifacts/ArtifactDetailModal';
import type { Artifact } from '../types';
import type { ChatThread } from '../domains/06-chat-threads/types';

const art: Artifact = {
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
} as Artifact;

const thread: ChatThread = {
  id: 'thr-1',
  folderId: null,
  title: 'Design talk',
  titleState: 'manual',
  titleVersion: 1,
  createdAt: 1,
  updatedAt: 1,
  lastActivityAt: 1,
  lifecycle: 'active',
  lastOutcome: 'ok',
  preview: '',
  attachments: [],
} as unknown as ChatThread;

const base = {
  artifact: art,
  onClose: vi.fn(),
  attachmentGranularity: null,
  onAttach: vi.fn(),
  onSetAttachmentGranularity: vi.fn(),
  onSaveEdit: vi.fn(),
  edges: [
    {
      id: 'edge-1',
      sourceId: art.id,
      targetId: 'art-2',
      kind: 'relates_to',
      weight: 1,
    },
  ],
  onAddEdge: vi.fn(),
  onRemoveEdge: vi.fn(),
  artifacts: [art, { ...art, id: 'art-2', title: 'Second note', code: 'second-note' } as Artifact],
  onRenameCode: vi.fn(),
  onSetCategory: vi.fn(),
  onSetTags: vi.fn(),
  threads: [thread],
  chatAttachments: [
    {
      threadId: 'thr-1',
      artifactId: art.id,
      granularity: 'full' as const,
      addedAt: 1,
      turnIndex: 2,
    },
  ],
  otherCodes: ['second-note'],
};

describe('ArtifactDetailModal — six-tab structure', () => {
  const html = renderToStaticMarkup(React.createElement(ArtifactDetailModal, base as any));

  it('renders the six tabs with counts, no Layers & YAML', () => {
    expect(html).toContain('Body');
    // react-dom/server escapes the ampersand in the markup.
    expect(html).toContain('Overview &amp; Layers');
    expect(html).toMatch(/Relationships \(1\)/);
    expect(html).toMatch(/Chats \(1\)/);
    expect(html).toMatch(/A Index \(/);
    expect(html).not.toContain('Layers &amp; YAML');
  });

  it('always shows the History tab — a synthesized v1 when no revisions exist', () => {
    expect(html).toMatch(/History \(1\)/);
  });

  it('never shows the internal UUID', () => {
    expect(html).not.toContain('art-internal-uuid-1');
    expect(html).not.toContain('Artifact ID');
  });

  it('header shows the slug badge as a filename and the category badge', () => {
    expect(html).toContain('night-vision-design.md');
    expect(html).toContain('Spec');
  });

  it('default tab is Body, with the Rendered/Raw toggle', () => {
    expect(html).toContain('Rendered');
    expect(html).toContain('Raw');
  });
});

describe('ArtifactDetailModal — Chats tab', () => {
  const props = {
    ...base,
    initialTab: 'chats' as const,
  };
  const html = renderToStaticMarkup(React.createElement(ArtifactDetailModal, props as any));
  it('lists the threads this artifact is attached to, with provenance', () => {
    expect(html).toContain('Design talk');
    expect(html).toContain('msg #3');
  });
});

describe('ArtifactDetailModal — Relationships tab', () => {
  const baseEdges = base.edges as Array<{ id: string; sourceId: string; targetId: string; kind: string; weight: number }>;
  const bothWays = {
    ...base,
    edges: [
      ...baseEdges,
      // incoming: art-2 -> this artifact ("backward" link)
      { id: 'edge-2', sourceId: 'art-2', targetId: art.id, kind: 'refines', weight: 1 },
    ],
    artifacts: [...(base.artifacts as Artifact[]), { ...art, id: 'art-3', title: 'Third note', code: 'third-note' } as Artifact],
  };
  const html = renderToStaticMarkup(
    React.createElement(ArtifactDetailModal, { ...base, initialTab: 'relationships' } as any)
  );
  const htmlBoth = renderToStaticMarkup(
    React.createElement(ArtifactDetailModal, { ...bothWays, initialTab: 'relationships' } as any)
  );

  it('lists connected artifacts with direction and an Unlink control', () => {
    expect(html).toContain('Second note');
    expect(html).toContain('relates_to');
    expect(html).toContain('Unlink');
  });

  it('labels this document as a "self" chip instead of repeating its title', () => {
    expect(html).toContain('>self<');
  });

  it('always puts self on the LEFT, even for incoming (backward) links', () => {
    // incoming edge row: "self" must appear BEFORE the other end's title
    const selfIdx = htmlBoth.indexOf('>self<');
    const otherIdx = htmlBoth.indexOf('Second note');
    expect(selfIdx).toBeGreaterThan(-1);
    expect(otherIdx).toBeGreaterThan(-1);
    expect(selfIdx).toBeLessThan(otherIdx);
  });

  it('shows direction with a big-headed arrow, rotated for incoming links', () => {
    expect(html).toContain('➜'); // heavy round-tipped arrow
    // backward row flips the arrow to point at self
    expect(htmlBoth).toContain('rotate-180');
  });

  it('gives the other end room: full title on hover, flexible width', () => {
    expect(html).toContain('title="Second note"');
  });
});
