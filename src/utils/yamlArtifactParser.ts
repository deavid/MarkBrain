import YAML from 'yaml';
import { Artifact, ArtifactGraphData, ArtifactVersion, ArtifactType, ArtifactCategory } from '../types';

export interface ParsedYamlArtifact {
  artifact: Artifact;
  rawYaml: string;
  rawMarkdown: string;
  hasFrontmatter: boolean;
}

/**
 * Serializes an Artifact into a single YAML-frontmatter + Markdown file
 * Formats:
 * ---
 * title: ...
 * description: ...
 * summary: ...
 * graph: ...
 * ---
 * # Markdown contents
 */
export function serializeArtifactToYamlDoc(art: Artifact): string {
  const frontmatterData: Record<string, unknown> = {
    id: art.id,
    code: art.code || art.id,
    title: art.title,
    type: art.type || 'architecture',
    category: art.category || 'system-spec',
    description: art.description || '',
    summary: art.summary || '',
    graph: {
      parent: art.graph?.parent || art.relationships?.parent || null,
      children: art.graph?.children || art.relationships?.children || [],
      relationships: art.graph?.relationships || [],
      is_high_concept: art.graph?.is_high_concept ?? art.isHighConcept ?? false,
      x: art.graph?.x ?? 0,
      y: art.graph?.y ?? 0,
    },
    resolution: art.resolution || 'full',
    updated_at: art.updatedAt || new Date().toISOString(),
  };

  if (art.tags && art.tags.length > 0) {
    frontmatterData.tags = art.tags;
  }

  if (art.history && art.history.length > 0) {
    frontmatterData.history = art.history.map((h) => ({
      version: h.version,
      timestamp: h.timestamp,
      change_summary: h.changeSummary,
    }));
  }

  const yamlString = YAML.stringify(frontmatterData).trim();
  const markdownBody = (art.content || '').trim();

  return `---\n${yamlString}\n---\n\n${markdownBody}\n`;
}

/**
 * Parses a combined YAML + Markdown document
 */
export function parseYamlArtifactDoc(
  rawText: string,
  fallbackProjectId: string = 'proj-default'
): ParsedYamlArtifact {
  const trimmed = rawText.trim();
  const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;
  const match = trimmed.match(frontmatterRegex);

  if (match) {
    const yamlPart = match[1];
    const markdownPart = match[2].trim();

    try {
      const parsedData = YAML.parse(yamlPart) || {};
      const id = parsedData.id || `art-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      const title = parsedData.title || 'Imported Artifact';
      const code = parsedData.code || title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30);
      const graphData: ArtifactGraphData = {
        parent: parsedData.graph?.parent || undefined,
        children: Array.isArray(parsedData.graph?.children) ? parsedData.graph.children : [],
        relationships: Array.isArray(parsedData.graph?.relationships) ? parsedData.graph.relationships : [],
        is_high_concept: Boolean(parsedData.graph?.is_high_concept ?? parsedData.isHighConcept),
        x: typeof parsedData.graph?.x === 'number' ? parsedData.graph.x : undefined,
        y: typeof parsedData.graph?.y === 'number' ? parsedData.graph.y : undefined,
      };

      const history: ArtifactVersion[] = Array.isArray(parsedData.history)
        ? parsedData.history.map((h: any, idx: number) => ({
            version: h.version || idx + 1,
            timestamp: h.timestamp || new Date().toISOString(),
            changeSummary: h.change_summary || h.changeSummary || 'Recorded modification',
            content: h.content || markdownPart,
          }))
        : [
            {
              version: 1,
              timestamp: new Date().toISOString(),
              changeSummary: 'Initial ingestion',
              content: markdownPart,
            },
          ];

      const now = Date.now();
      const artDesc = parsedData.description || `Imported specification: ${title}`;
      const artSumm = parsedData.summary || parsedData.description || 'Imported architectural artifact summary.';

      const artifact: Artifact = {
        id,
        workspace_id: fallbackProjectId,
        projectId: fallbackProjectId,
        code,
        title,
        type: 'document',
        category: (parsedData.category as ArtifactCategory) || 'system-spec',
        description: artDesc,
        summary: artSumm,
        content: markdownPart,
        created_at: now,
        updated_at: now,
        current: {
          t0_label: title,
          t1_abstract: artDesc,
          t2_summary: artSumm,
          t3_body: markdownPart,
        },
        revisions: [],
        relations: [],
        provenance: {
          origin_chapter_id: 'chap-import',
          mutation_chapter_ids: [],
        },
        graph: graphData,
        isHighConcept: graphData.is_high_concept,
        resolution: parsedData.resolution || 'full',
        history,
        tags: Array.isArray(parsedData.tags) ? parsedData.tags : ['yaml-imported'],
        createdAt: parsedData.created_at || new Date().toISOString(),
        updatedAt: parsedData.updated_at || new Date().toISOString(),
        relationships: {
          parent: graphData.parent,
          children: graphData.children,
        },
      };

      return {
        artifact,
        rawYaml: yamlPart,
        rawMarkdown: markdownPart,
        hasFrontmatter: true,
      };
    } catch (e) {
      console.warn('Failed to parse YAML frontmatter, treating as plain markdown:', e);
    }
  }

  // Fallback for plain Markdown or plain TXT without frontmatter
  const lines = trimmed.split('\n');
  let firstHeading = 'Imported Document';
  for (const line of lines) {
    const headingMatch = line.match(/^#+\s+(.+)$/);
    if (headingMatch) {
      firstHeading = headingMatch[1].trim();
      break;
    }
  }

  const generatedCode = firstHeading.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30);
  const firstParagraph = lines.filter((l) => l.trim().length > 0 && !l.startsWith('#'))[0] || 'Specification document';

  const now = Date.now();
  const desc = firstParagraph.slice(0, 160);
  const summ = trimmed.slice(0, 400);

  const artifact: Artifact = {
    id: `art-${now}-${Math.floor(Math.random() * 1000)}`,
    workspace_id: fallbackProjectId,
    projectId: fallbackProjectId,
    code: generatedCode,
    title: firstHeading,
    type: 'document',
    category: 'system-spec',
    description: desc,
    summary: summ,
    content: trimmed,
    created_at: now,
    updated_at: now,
    current: {
      t0_label: firstHeading,
      t1_abstract: desc,
      t2_summary: summ,
      t3_body: trimmed,
    },
    revisions: [],
    relations: [],
    provenance: {
      origin_chapter_id: 'chap-import',
      mutation_chapter_ids: [],
    },
    graph: {
      children: [],
      relationships: [],
      is_high_concept: false,
    },
    isHighConcept: false,
    resolution: 'full',
    history: [
      {
        version: 1,
        timestamp: new Date().toISOString(),
        changeSummary: 'Initial ingestion from raw file',
        content: trimmed,
      },
    ],
    tags: ['raw-import'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  return {
    artifact,
    rawYaml: '',
    rawMarkdown: trimmed,
    hasFrontmatter: false,
  };
}
