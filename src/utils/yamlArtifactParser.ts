import YAML from 'yaml';
import { Artifact, ArtifactGraphData, ArtifactType, ArtifactCategory } from '../types';
import { logger } from './logger';

export interface ParsedYamlArtifact {
  artifact: Artifact;
  rawYaml: string;
  rawMarkdown: string;
  hasFrontmatter: boolean;
}

/** Serializes an Artifact into YAML frontmatter (`title`, `description`, `summary`, `graph`) plus Markdown body. */
export function serializeArtifactToYamlDoc(art: Artifact): string {
  const frontmatterData: Record<string, unknown> = {
    id: art.id,
    code: art.code || art.id,
    title: art.title,
    type: art.type || 'note',
    category: art.category || 'note',
    description: art.current?.description || '',
    summary: art.current?.summary || '',
    graph: {
      parent: art.graph?.parent || null,
      children: art.graph?.children || [],
      relationships: art.graph?.relationships || [],
      is_high_concept: art.graph?.is_high_concept ?? art.isHighConcept ?? false,
      x: art.graph?.x ?? 0,
      y: art.graph?.y ?? 0,
    },
    updated_at: art.updatedAt ?? Date.now(),
  };

  if (art.tags && art.tags.length > 0) {
    frontmatterData.tags = art.tags;
  }

  const yamlString = YAML.stringify(frontmatterData).trim();
  const markdownBody = (art.current?.body || '').trim();

  return `---\n${yamlString}\n---\n\n${markdownBody}\n`;
}

/** Parses YAML frontmatter plus Markdown body into artifact fields. */
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

      const now = Date.now();
      const artDesc = parsedData.description || `Imported note: ${title}`;
      const artSumm = parsedData.summary || parsedData.description || 'Imported note summary.';
      const parseTime = (v: unknown, fallback: number): number =>
        typeof v === 'number'
          ? v
          : typeof v === 'string' && !isNaN(Date.parse(v))
            ? Date.parse(v)
            : fallback;

      const artifact: Artifact = {
        id,
        workspaceId: fallbackProjectId,
        code,
        title,
        type: 'document',
        category: (parsedData.category as ArtifactCategory) || 'note',
        isHighConcept: Boolean(graphData.is_high_concept),
        current: {
          description: artDesc,
          summary: artSumm,
          body: markdownPart,
        },
        tags: Array.isArray(parsedData.tags) ? parsedData.tags : ['yaml-imported'],
        createdAt: parseTime(parsedData.created_at, now),
        updatedAt: parseTime(parsedData.updated_at, now),
        graph: graphData,
      };

      return {
        artifact,
        rawYaml: yamlPart,
        rawMarkdown: markdownPart,
        hasFrontmatter: true,
      };
    } catch (e) {
      logger.warn('YamlParser', 'Failed to parse YAML frontmatter, treating as plain markdown', e);
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
  const firstParagraph = lines.filter((l) => l.trim().length > 0 && !l.startsWith('#'))[0] || '';

  const now = Date.now();
  const desc = firstParagraph.slice(0, 160);
  const summ = trimmed.slice(0, 400);

  const artifact: Artifact = {
    id: `art-${now}-${Math.floor(Math.random() * 1000)}`,
    workspaceId: fallbackProjectId,
    code: generatedCode,
    title: firstHeading,
    type: 'document',
    category: 'note',
    isHighConcept: false,
    current: {
      description: desc,
      summary: summ,
      body: trimmed,
    },
    tags: ['raw-import'],
    createdAt: now,
    updatedAt: now,
    graph: {
      children: [],
      relationships: [],
      is_high_concept: false,
    },
  };

  return {
    artifact,
    rawYaml: '',
    rawMarkdown: trimmed,
    hasFrontmatter: false,
  };
}
