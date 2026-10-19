import type { Express, Request, Response } from 'express';
import { ai } from '../providers/gemini';
import { logServer } from '../lib/log';

export function registerExtractRoutes(app: Express): void {
// API: Extract structured YAML + Markdown artifact from raw TXT, MD, or Google Docs export
app.post('/api/extract-artifact-from-file', async (req: Request, res: Response) => {
  try {
    const { content, filename = 'document.md', projectTitle = 'Project', fileType = 'doc' } = req.body;
    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Content is required' });
    }

    if (ai) {
      const prompt = `You are MarkBrain, importing a document into a thinking workbench.
Analyze the following document (imported from ${fileType === 'gdoc' ? 'Google Docs' : 'file'}: "${filename}") for the project "${projectTitle}".
Synthesize it into a MarkBrain note with YAML frontmatter metadata and structured Markdown content.

Requirements:
1. Title: A concise title (few words).
2. Code: A clean, memorable kebab-case identifier/nickname (e.g., "reading-list", "garden-plan", "pricing-notes").
3. Type: One of ["note", "decision-record", "research-note", "summary", "reference", "topic"].
4. Description: A short description (a few phrases).
5. Summary: A summary of the contents in a few paragraphs — what it says, what matters, why it might matter later.
6. Tags: 4 to 8 highly relevant, lowercase, kebab-case tags (e.g., ["pricing", "family", "reading", "garden"]). These tags will be embedded in the YAML header to tentatively and automatically cross-link related notes.
7. Graph:
   - parent: A parent note code if this belongs under one, or null.
   - children: Array of child note codes if identified, or [].
   - relationships: Array of tentative relational objects: [{"target": "other-note-code", "type": "depends_on" | "implements" | "bridges", "note": "Tentative cross-link"}]
   - is_high_concept: boolean (true if this is a core thread tying many other thoughts together, false for a regular note).
8. Content: The full, clean Markdown content with clear hierarchy (headings, bullet lists, code blocks).

Respond ONLY with a JSON object in this exact schema:
{
  "title": "Short title in a few words",
  "code": "unique-slug-or-nickname",
  "type": "note",
  "category": "note",
  "description": "Short description in a few phrases",
  "summary": "Summary of contents in a few paragraphs",
  "tags": ["tag1", "tag2", "tag3", "tag4"],
  "graph": {
    "parent": null,
    "children": [],
    "relationships": [],
    "is_high_concept": true
  },
  "content": "Full markdown specification body"
}

Raw Input Document (${filename}):
${content.slice(0, 24000)}`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.5-flash-lite',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          temperature: 0.2,
        },
      });

      const parsed = JSON.parse(response.text || '{}');
      if (!Array.isArray(parsed.tags) || parsed.tags.length === 0) {
        parsed.tags = ['google-docs', 'imported-note', parsed.code || 'note'];
      }

      return res.json({
        artifact: parsed,
      });
    }

    // High quality deterministic fallback when AI key is absent
    const lines = content.split('\n');
    let title = filename.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');
    for (const l of lines) {
      const hMatch = l.match(/^#+\s+(.+)$/);
      if (hMatch) {
        title = hMatch[1].trim();
        break;
      }
    }
    const code = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30);
    const nonHeaders = lines.filter((l: string) => l.trim().length > 0 && !l.startsWith('#'));
    const description = nonHeaders[0]?.slice(0, 160) || `Imported Google Doc specification: ${title}`;
    const summary = nonHeaders.slice(0, 4).join(' ').slice(0, 400) || 'Imported note summary.';

    // Generate tentative tags from words in title and content
    const rawTokens = (title + ' ' + description).toLowerCase().match(/[a-z]{4,}/g) || [];
    const uniqueTokens = Array.from(new Set(rawTokens)).slice(0, 5);
    const tags = ['imported-doc', 'google-docs', ...uniqueTokens];

    return res.json({
      artifact: {
        title,
        code,
        type: 'note',
        category: 'note',
        description,
        summary,
        tags,
        graph: {
          parent: null,
          children: [],
          relationships: [],
          is_high_concept: false,
        },
        content,
      },
    });
  } catch (err: unknown) {
    logServer('error', 'API:EXTRACT', `Error in /api/extract-artifact-from-file: ${err instanceof Error ? err.message : err}`, err);
    const errorMessage = err instanceof Error ? err.message : 'Extraction error';
    res.status(500).json({ error: errorMessage });
  }
});
}
