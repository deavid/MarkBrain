/**
 * BUG-006.2: the artifact title must be the markdown `# H1` verbatim, never
 * the LLM's paraphrase of it. Regression: an import of "# Night Vision
 * Acoustic-Visual Synesthesia Design Document" landed as "...Design" because
 * ex.title (AI extraction) beat the document's own heading.
 */
import { describe, it, expect } from 'vitest';
import { extractLeadingMarkdownH1 } from '../utils/yamlArtifactParser';
// buildArtifactFromExtraction is module-private; exported for this pin.
import { buildArtifactFromExtractionForTest } from '../ui/artifacts/import/useImportSession';

describe('extractLeadingMarkdownH1', () => {
  it('returns the first H1 verbatim', () => {
    expect(
      extractLeadingMarkdownH1('# Night Vision Acoustic-Visual Synesthesia Design Document\n\nBody')
    ).toBe('Night Vision Acoustic-Visual Synesthesia Design Document');
  });

  it('skips YAML frontmatter', () => {
    expect(
      extractLeadingMarkdownH1('---\ntitle: Whatever\n---\n\n# The Real Heading\n\nbody')
    ).toBe('The Real Heading');
  });

  it('strips trailing hashes and inline bold markers', () => {
    expect(extractLeadingMarkdownH1('# A Bold **Title** ##')).toBe('A Bold **Title**');
  });

  it('falls back to the first lower heading when no H1 exists', () => {
    expect(extractLeadingMarkdownH1('intro para\n\n## Second Level\n\ntext')).toBe('Second Level');
  });

  it('returns null when there is no heading at all', () => {
    expect(extractLeadingMarkdownH1('just words\nmore words')).toBeNull();
  });
});

describe('buildArtifactFromExtraction title precedence', () => {
  it('uses the markdown H1 verbatim over the AI extraction title', () => {
    const body =
      '# Night Vision Acoustic-Visual Synesthesia Design Document\n\nBody of the doc.';
    const art = buildArtifactFromExtractionForTest(
      { title: 'Night Vision Acoustic-Visual Synesthesia Design' },
      body,
      'fallback-name.md',
      'proj-1'
    );
    expect(art.title).toBe('Night Vision Acoustic-Visual Synesthesia Design Document');
  });

  it('falls back to ex.title when the body has no heading', () => {
    const art = buildArtifactFromExtractionForTest(
      { title: 'AI Title' },
      'no headings here',
      'fallback-name.md',
      'proj-1'
    );
    expect(art.title).toBe('AI Title');
  });
});
