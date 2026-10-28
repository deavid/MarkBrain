/**
 * Package 1 (design-docs/28 §1.6/§1.9) — stale-layer guard.
 *
 * After a manual body edit the description/summary layers no longer match the
 * body. `layersStaleAt` must make the compiler:
 *   - at `full`: send Title + Body ONLY (the lying layers are dropped);
 *   - at description/summary: keep the layers but attach the explicit
 *     out-of-date notice instead of serving them as truth.
 * Plus the DOM-free handler test: a manual edit records the revision BEFORE
 * the upsert and marks stale only when the body actually moved.
 *
 * Pure Node, no happy-dom, no network (the manual-edit test never fetches).
 */
import { describe, it, expect, vi } from 'vitest';
import {
  getArtifactCut,
  artifactCutText,
  STALE_LAYERS_NOTICE,
} from '../domains/01-artifact-document/ArtifactDocumentDomain';
import { artifactXml } from '../domains/03-optical-compiler';
import { createArtifactHandlers } from '../ui/artifacts/createArtifactHandlers';
import { ArtifactVersioningDomain } from '../domains/01-artifact-versioning/ArtifactVersioningDomain';
import type { UniversalArtifactDocument } from '../domains/01-artifact-document/types';

function makeArt(layersStaleAt?: number): UniversalArtifactDocument {
  return {
    id: 'art-1',
    workspaceId: 'proj-1',
    code: 'note-one',
    title: 'My Note',
    type: 'document',
    category: 'note',
    isHighConcept: false,
    current: {
      subtitle: 'the hook',
      description: 'the description',
      summary: 'the summary',
      body: 'the edited body',
    },
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    ...(layersStaleAt !== undefined ? { layersStaleAt } : {}),
  };
}

describe('getArtifactCut / artifactCutText — stale layers', () => {
  it('fresh artifact: full cut carries description + summary + body as before', () => {
    const cut = getArtifactCut(makeArt(), 'full');
    expect(cut.description).toBe('the description');
    expect(cut.summary).toBe('the summary');
    expect(cut.body).toBe('the edited body');
    expect(cut.layersStale).toBeUndefined();
  });

  it('stale at full: description and summary are OMITTED, the body still travels', () => {
    const cut = getArtifactCut(makeArt(Date.now()), 'full');
    expect(cut.layersStale).toBe(true);
    expect(cut.description).toBeUndefined();
    expect(cut.summary).toBeUndefined();
    expect(cut.body).toBe('the edited body');
    const text = artifactCutText(makeArt(Date.now()), 'full');
    expect(text).toContain('My Note');
    expect(text).toContain('the edited body');
    expect(text).not.toContain('the description');
    expect(text).not.toContain('the summary');
  });

  it('stale at description/summary: layers still travel, labelled with the out-of-date notice', () => {
    for (const granularity of ['description', 'summary'] as const) {
      const text = artifactCutText(makeArt(Date.now()), granularity);
      expect(text).toContain(STALE_LAYERS_NOTICE);
    }
    // The notice rides the LAST line — the layers stay honest-labelled prose above it.
    expect(artifactCutText(makeArt(Date.now()), 'summary').endsWith(STALE_LAYERS_NOTICE)).toBe(true);
  });

  it('fresh artifact gets no notice at any granularity', () => {
    expect(artifactCutText(makeArt(), 'summary')).not.toContain('out of date');
  });
});

describe('artifactXml — stale layers', () => {
  it('stale at full: no <description>/<summary> elements, <content> still there', () => {
    const xml = artifactXml(makeArt(Date.now()), 'full');
    expect(xml).toContain('<content>');
    expect(xml).toContain('the edited body');
    expect(xml).not.toContain('<description>');
    expect(xml).not.toContain('<summary>');
  });

  it('stale at description/summary: a <notice> element carries the out-of-date marker', () => {
    for (const granularity of ['description', 'summary'] as const) {
      const xml = artifactXml(makeArt(Date.now()), granularity);
      expect(xml).toContain(`<notice>${STALE_LAYERS_NOTICE}</notice>`);
    }
  });

  it('fresh artifact: XML keeps description/summary and no notice', () => {
    const xml = artifactXml(makeArt(), 'full');
    expect(xml).toContain('<description>');
    expect(xml).toContain('<summary>');
    expect(xml).not.toContain('<notice>');
  });
});

describe('manual edit handler (DOM-free) — revision first, stale only when the body moved', () => {
  function makeHandlers(art: UniversalArtifactDocument) {
    const versioning = new ArtifactVersioningDomain();
    const upsertArtifact = vi.fn((doc: UniversalArtifactDocument) => doc);
    const handlers = createArtifactHandlers({
      artifactsDomain: {
        getArtifact: vi.fn(() => art),
        upsertArtifact,
        listArtifacts: vi.fn(() => []),
      } as never,
      versioning,
      graph: {} as never,
      workspace: { getProject: () => undefined } as never,
      threadRegistry: {} as never,
      activeThreadId: 'thread-1',
      activeProjectId: 'proj-1',
      currentContainer: null,
      triggerReRender: vi.fn(),
      selectedArtifactId: null,
      setSelectedArtifactId: vi.fn(),
      triageFocusId: null,
      setTriageFocusId: vi.fn(),
    } as never);
    return { handlers, versioning, upsertArtifact };
  }

  it('body-only edit: records the OLD full-state revision first, then marks the artifact stale', () => {
    const art = makeArt();
    const { handlers, versioning, upsertArtifact } = makeHandlers(art);
    handlers.handleManualArtifactEdit('art-1', {
      title: 'My Note',
      subtitle: 'the hook',
      body: 'the edited body PLUS a new paragraph',
    });

    const history = versioning.getHistory('art-1');
    expect(history).toHaveLength(1);
    expect(history[0].actor).toBe('user');
    expect(history[0].changeSummary).toBe('Manual edit');
    expect(history[0].title).toBe('My Note');
    expect(history[0].layers.body).toBe('the edited body'); // OLD state
    expect(history[0].timestamp).toBeLessThanOrEqual(Date.now());

    expect(upsertArtifact).toHaveBeenCalledTimes(1);
    const applied = upsertArtifact.mock.calls[0][0] as UniversalArtifactDocument;
    expect(applied.current.body).toBe('the edited body PLUS a new paragraph');
    expect(typeof applied.layersStaleAt).toBe('number'); // body moved, layers did not → stale
  });

  it('title-only tweak: no stale flag, but the pre-edit state is still recorded', () => {
    const art = makeArt();
    const { handlers, versioning, upsertArtifact } = makeHandlers(art);
    handlers.handleManualArtifactEdit('art-1', {
      title: 'Better Title',
      subtitle: 'the hook',
      body: 'the edited body',
    });
    expect(versioning.getHistory('art-1')).toHaveLength(1);
    const applied = upsertArtifact.mock.calls[0][0] as UniversalArtifactDocument;
    expect(applied.title).toBe('Better Title');
    expect(applied.layersStaleAt).toBeUndefined();
  });

  it('no-op edit records nothing and upserts nothing', () => {
    const art = makeArt();
    const { handlers, versioning, upsertArtifact } = makeHandlers(art);
    handlers.handleManualArtifactEdit('art-1', {
      title: 'My Note',
      subtitle: 'the hook',
      body: 'the edited body',
    });
    expect(versioning.getHistory('art-1')).toHaveLength(0);
    expect(upsertArtifact).not.toHaveBeenCalled();
  });
});
