/**
 * BUG-001 / BUG-002 / BUG-005: graph node cards are lean (Title + Type only),
 * select on click, open on double-click; selection highlight is sky/cyan, not
 * red; per-artifact color halos/dots are gone; the selected-node detail card
 * lives bottom-RIGHT raised to bottom-16 (64px) — clear of BOTH the lens pill
 * (Folders/Graph/Proximity) and the "go to chat" bubble, which sit at bottom-4
 * and reach ~54-56px up — and carries the migrated tag pills + Link/Open
 * actions, with no red button.
 *
 * Rendered through react-dom/server — no DOM needed, exercises the real
 * component.
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { SpatialGraph } from '../ui/graph/SpatialGraph';
import type { Artifact } from '../types';

const art = (over: Partial<Artifact>): Artifact => ({
  id: 'art-1',
  workspaceId: 'p',
  title: 'Night Vision Design',
  type: 'document',
  category: 'note',
  color: '#e05a66',
  tags: ['vision', 'design'],
  createdAt: 1,
  updatedAt: 1,
  ...over,
} as Artifact);

const baseProps = {
  projectId: 'p',
  artifacts: [art({ id: 'art-1' }), art({ id: 'art-2', title: 'Second', color: '#5d87b8' })],
  edges: [],
  onSelectArtifact: vi.fn(),
  onAddEdge: vi.fn(),
  onUpdateNodePosition: vi.fn(),
  onBatchUpdateNodePositions: vi.fn(),
  onFilterByTag: vi.fn(),
};

describe('SpatialGraph node cards (lean)', () => {
  it('renders Type + Title only — no tag pills, Link or Spec buttons on canvas cards', () => {
    const html = renderToStaticMarkup(React.createElement(SpatialGraph, baseProps));
    expect(html).toContain('Night Vision Design');
    expect(html).toContain('document');
    // Migrated off the canvas card:
    expect(html).not.toContain('#vision');
    expect(html).not.toContain('#design');
    expect(html).not.toContain('Spec');
    expect(html).not.toContain('Link');
  });

  it('never shows the per-artifact color (halo, dot, or hex) on a node card', () => {
    const html = renderToStaticMarkup(React.createElement(SpatialGraph, baseProps));
    expect(html).not.toContain('#e05a66');
    expect(html).not.toContain('#e65a6c');
  });

  it('has no red Open button (#a33945) anywhere in the graph view', () => {
    const html = renderToStaticMarkup(React.createElement(SpatialGraph, baseProps));
    expect(html).not.toContain('a33945');
  });

  it('pins the selected-node detail card to bottom-16 right-3 (clears the bottom control row)', () => {
    // Positional concern: renderToStaticMarkup drops absolutely-positioned
    // wrappers' layout context, so pin the source directly.
    const src = readFileSync('src/ui/graph/SpatialGraph.tsx', 'utf8');
    expect(src).toContain('absolute bottom-16 right-3');
    expect(src).not.toContain('absolute bottom-3 left-3');
  });
});
