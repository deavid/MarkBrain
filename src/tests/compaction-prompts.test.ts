/**
 * The compaction contract: sentinel blocks instead of JSON, a subtitle that
 * travels with the title, and three layers that are read as one briefing.
 *
 * Why this file exists, measured on the 2026-10-21 export: descriptions came
 * back at 31 tokens and summaries at 151, 33 of 41 summaries opened by
 * restating the description, and the imported bodies had kept 59% of their
 * source files. Each assertion below is one of those failures.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  isSentinelEmpty,
  parseSentinelBlocks,
  parseSentinelList,
} from '../utils/sentinelParser';
import {
  DEFAULT_SYSTEM_INSTRUCTION,
  buildExtractPrompt,
  buildSummarizePrompt,
  readSentinelArtifact,
} from '../../src/prompts/prompt';
import { artifactXml } from '../domains/03-optical-compiler';
import { getArtifactCut } from '../domains/01-artifact-document/ArtifactDocumentDomain';
import { StreamProtocolDomain } from '../domains/03-stream-protocol';
import { hydrateArtifact } from '../services/stores/hydrate';
import type { UniversalArtifactDocument } from '../domains/01-artifact-document/types';

const art = (
  layers: Partial<UniversalArtifactDocument['current']> = {},
  title = 'Escape Game Mode'
): UniversalArtifactDocument =>
  ({
    id: 'a1',
    workspaceId: 'p',
    code: 'escape-game-mode',
    title,
    type: 'document',
    category: 'note',
    isHighConcept: false,
    current: { subtitle: '', description: '', summary: '', body: '', ...layers },
    tags: [],
    createdAt: 0,
    updatedAt: 0,
  }) as UniversalArtifactDocument;

describe('sentinel blocks are the LLM contract', () => {
  it('parses every section, including markdown the JSON string would have broken', () => {
    const reply = `=== TITLE ===
Escape Game Mode

=== SUBTITLE ===
Unhaunter's v1.0 loop drops the repellent for an anchor extraction arc.

=== DESCRIPTION ===
The five phases land in 1.0.

The ritual path lost to extraction.

=== SUMMARY ===
## Phases
- Survey
- Setup

## Rejected
> "banish on the spot", in the designer's words
\`\`\`ts
const x = { a: 1 };
\`\`\`

=== TAGS ===
game-loop, v1-0
extraction`;

    const blocks = parseSentinelBlocks(reply);
    expect(blocks.title).toBe('Escape Game Mode');
    expect(blocks.subtitle).toContain('anchor extraction arc');
    expect(blocks.description).toContain('The ritual path lost to extraction.');
    expect(blocks.summary).toContain('## Phases');
    expect(blocks.summary).toContain('"banish on the spot"');
    expect(blocks.summary).toContain('const x = { a: 1 };');
    expect(parseSentinelList(blocks.tags)).toEqual(['game-loop', 'v1-0', 'extraction']);
  });

  it('reads a reply the model wrapped in a code fence anyway', () => {
    const blocks = parseSentinelBlocks('```markdown\n=== TITLE ===\nWrapped\n```');
    expect(blocks.title).toBe('Wrapped');
  });

  it('keeps every section when one is missing, and knows an empty marker', () => {
    const blocks = parseSentinelBlocks('=== TITLE ===\nOnly a title\n=== PARENT ===\nnone');
    expect(blocks.title).toBe('Only a title');
    expect(blocks.description).toBeUndefined();
    expect(isSentinelEmpty(blocks.parent)).toBe(true);
  });

  it('reads an import reply into fields', () => {
    const read = readSentinelArtifact(
      `=== TITLE ===\nEscape Game Mode\n=== SUBTITLE ===\nThe hook.\n=== DESCRIPTION ===\nThe thesis.\n=== SUMMARY ===\nThe digest.\n=== HIGH_CONCEPT ===\ntrue\n=== RELATIONSHIPS ===\nanchor-design | implements | the anchor needs it`,
      'fallback.md'
    );
    expect(read.title).toBe('Escape Game Mode');
    expect(read.subtitle).toBe('The hook.');
    expect(read.description).toBe('The thesis.');
    expect(read.summary).toBe('The digest.');
    expect(read.isHighConcept).toBe(true);
    expect(read.relationships).toEqual([
      { target: 'anchor-design', type: 'implements', note: 'the anchor needs it' },
    ]);
    expect(read.hasLayers).toBe(true);
  });
});

describe('every prompt states the layer contract', () => {
  const prompts = [
    DEFAULT_SYSTEM_INSTRUCTION,
    buildExtractPrompt({ content: '# Doc\n\nBody text.' }),
    buildSummarizePrompt({ title: 'Genesis', messages: [{ role: 'user', content: 'hi' }] }),
  ];

  it('never asks for JSON', () => {
    for (const text of prompts) {
      expect(text).not.toMatch(/responseMimeType|STRICT JSON|"summary":/);
      expect(text).toMatch(/no JSON/i);
    }
  });

  it('says the layers are read together, in order, and never repeat', () => {
    for (const text of prompts) {
      expect(text).toMatch(/continues where the previous|continuing from the (subtitle|description)/);
      expect(text).toMatch(/NEVER repeat|never re-introduce/);
    }
  });

  it('bans the book-report opener by name', () => {
    for (const text of prompts) {
      expect(text).toMatch(/This document outlines/);
      expect(text).toMatch(/This note describes/);
    }
  });

  it('gives each layer a size and a different job', () => {
    const extract = buildExtractPrompt({ content: 'x'.repeat(4000) });
    expect(extract).toMatch(/SUBTITLE[\s\S]{0,80}~40 tokens/);
    expect(extract).toMatch(/DESCRIPTION[\s\S]{0,120}~200 tokens/);
    expect(extract).toMatch(/SUMMARY[\s\S]{0,120}~800 to 1500 tokens/);
  });

  it('never asks the model to write the body', () => {
    const extract = buildExtractPrompt({ content: 'x'.repeat(4000) });
    expect(extract).toContain('The app stores the source document below verbatim');
    expect(extract).not.toContain('=== CONTENT ===');
  });

  it('still carries the user steering prompt', () => {
    const prompt = buildSummarizePrompt({
      title: 'Genesis',
      messages: [{ role: 'user', content: 'hi' }],
      steeringPrompt: 'focus on the border law',
    });
    expect(prompt).toContain('focus on the border law');
  });
});

describe('the title cut carries the subtitle', () => {
  it('sends title and hook together, so a four-word name is not the whole payload', () => {
    const withHook = art({ subtitle: 'Drops the repellent for an anchor extraction arc.' });
    const xml = artifactXml(withHook, 'title');
    expect(xml).toContain('Escape Game Mode — Drops the repellent for an anchor extraction arc.');
    expect(xml).not.toContain('<description>');
    expect(xml).not.toContain('<summary>');
  });

  it('degrades to the bare title when there is no hook', () => {
    expect(artifactXml(art(), 'title')).toContain('<title>Escape Game Mode</title>');
    expect(getArtifactCut(art(), 'title').title).toBe('Escape Game Mode');
  });

  it('reads back as one plain-text cut', () => {
    const cut = getArtifactCut(art({ subtitle: 'The hook.' }), 'title');
    expect(cut.title).toBe('Escape Game Mode — The hook.');
  });
});

describe('the body is spliced, never generated', () => {
  it('the import prompt asks for layers only', () => {
    const prompt = buildExtractPrompt({ content: 'x'.repeat(4000) });
    expect(prompt).toContain('=== SUBTITLE ===');
    expect(prompt).not.toContain('"content"');
  });

  // Both splices are one line inside an HTTP route and a React hook, so they are
  // read from source: a regression here is silent data loss, not a type error.
  it('the route overwrites whatever body the model returned with the file itself', () => {
    const route = readFileSync(join(process.cwd(), 'server/routes/extract.ts'), 'utf8');
    expect(route).toContain('content,');
    expect(route).not.toContain('parseModelJson');
    expect(route).not.toContain("responseMimeType: 'application/json'");
  });

  it('the import row prefers the picked file text over the model body', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/ui/artifacts/import/useImportSession.ts'),
      'utf8'
    );
    expect(src).toContain('body: fallbackBody || ex.current?.body || ex.content');
  });
});

describe('a layer the model did not write stays empty', () => {
  it('never copies the description into the summary', () => {
    const stream = new StreamProtocolDomain();
    const result = stream.demuxFullTurn(
      '<artifact_upsert id="a1" title="Only content"><content># Note\n\nbody</content></artifact_upsert>'
    );
    expect(result.artifactUpserts[0].content.subtitle).toBe('');
    expect(result.artifactUpserts[0].content.description).toBe('');
    expect(result.artifactUpserts[0].content.summary).toBe('');
  });

  it('reads a subtitle out of the XML block', () => {
    const stream = new StreamProtocolDomain();
    const result = stream.demuxFullTurn(
      '<artifact_upsert id="a1" title="T"><subtitle>The hook.</subtitle><description>The thesis.</description><summary>The digest.</summary><content>Body.</content></artifact_upsert>'
    );
    expect(result.artifactUpserts[0].content).toEqual({
      subtitle: 'The hook.',
      description: 'The thesis.',
      summary: 'The digest.',
      body: 'Body.',
    });
  });

  it('keeps a fenced subtitle out of the body', () => {
    const stream = new StreamProtocolDomain();
    const result = stream.demuxFullTurn(
      ['```artifact', 'title: A handle', 'subtitle: The hook.', 'type: note', '# A handle', '', 'The note.', '```'].join('\n')
    );
    const { subtitle, body } = result.artifactUpserts[0].content;
    expect(subtitle).toBe('The hook.');
    expect(body).not.toContain('subtitle:');
  });

  it('reads the topic_shift subtitle attribute', () => {
    const stream = new StreamProtocolDomain();
    const result = stream.demuxFullTurn(
      '<topic_shift title="Optics" subtitle="Where the lens work went." />'
    );
    expect(result.topicShift?.title).toBe('Optics');
    expect(result.topicShift?.subtitle).toBe('Where the lens work went.');
  });
});

describe('legacy notes get the two-line display for free', () => {
  it('copies a short one-line description up into the subtitle', () => {
    const hydrated = hydrateArtifact(
      {
        id: 'a1',
        title: 'Unhaunter Vision v3',
        current: { description: 'Core vision for the game.', summary: 'Long recap.' },
      },
      'p'
    );
    expect(hydrated.current.subtitle).toBe('Core vision for the game.');
    expect(hydrated.current.description).toBe('Core vision for the game.');
  });

  it('leaves a real multi-paragraph description alone', () => {
    const long = 'x'.repeat(400);
    const hydrated = hydrateArtifact(
      { id: 'a1', title: 'T', current: { description: long, summary: 's' } },
      'p'
    );
    expect(hydrated.current.subtitle).toBe('');
    expect(hydrated.current.description).toBe(long);
  });
});
