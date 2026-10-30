/**
 * It serializes a whole project (meta, artifacts, chapters, graph) into one
 * export document — JSON, Markdown, or YAML — for saving or moving elsewhere.
 *
 * Extracted from utils/tokenCalculator.ts (Phase 1 hygiene, tech-debt audit):
 * a token-size measurer must not also own the project-export feature.
 */
import type { Artifact, ChapterTurns, SemanticEdge } from '../types';
import type { UniversalArtifactDocument } from '../domains/01-artifact-document/types';
import type { ProjectMetadata } from '../domains/00-workspace/types';
import YAML from 'yaml';

export interface ProjectExportInput {
  meta: Pick<ProjectMetadata, 'id' | 'name' | 'codeName' | 'description'>;
  artifacts: UniversalArtifactDocument[];
  chapters: ChapterTurns[];
  edges: SemanticEdge[];
}

export function exportToJSON(
  projects: ProjectMetadata[],
  activeProject: ProjectExportInput
): string {
  return JSON.stringify(
    {
      appName: 'MarkBrain',
      // 3.0.0: breaking shape — Project aggregate (boundaryRules) dropped in the type collapse.
      version: '3.0.0',
      exportedAt: new Date().toISOString(),
      activeProject,
      projects: Array.isArray(projects) ? projects : [projects],
    },
    null,
    2
  );
}

export function exportToMarkdown(project: ProjectExportInput): string {
  let md = `# MarkBrain — Project: ${project.meta.name} (${project.meta.codeName || project.meta.id})\n\n`;
  md += `> ${project.meta.description}\n\n`;
  md += `Exported: ${new Date().toLocaleString()}\n\n`;
  md += `---\n\n`;

  md += `## Durable Artifacts (${project.artifacts.length})\n\n`;
  for (const art of project.artifacts) {
    md += `### ${art.title} (\`${art.code || art.id}\`)\n`;
    md += `**Type:** ${art.type} | **High Concept:** ${art.isHighConcept ? 'Yes' : 'No'}\n\n`;
    md += `**Subtitle:** ${art.current?.subtitle}\n\n`;
    md += `**Description:** ${art.current?.description}\n\n`;
    md += `**Summary:** ${art.current?.summary}\n\n`;
    md += `\`\`\`markdown\n${art.current?.body}\n\`\`\`\n\n`;
  }

  md += `---\n\n## Project Chapters & History\n\n`;
  for (const { chapter, turns } of project.chapters) {
    md += `### ${chapter.title}\n`;
    if (chapter.summary) {
      md += `> **Executive Summary:** ${chapter.summary}\n\n`;
    }
    for (const turn of turns) {
      md += `**${turn.role === 'user' ? 'User' : 'MarkBrain'}** (${new Date(turn.timestamp).toLocaleTimeString()}):\n`;
      md += `${turn.content}\n\n`;
    }
  }

  return md;
}

export function exportToYAML(project: ProjectExportInput): string {
  return YAML.stringify({
    markbrain_project: {
      id: project.meta.id,
      name: project.meta.name,
      code_name: project.meta.codeName || project.meta.id,
      description: project.meta.description,
      artifacts_count: project.artifacts.length,
      artifacts: project.artifacts.map((a) => ({
        id: a.id,
        code: a.code || a.id,
        title: a.title,
        type: a.type,
        is_high_concept: a.isHighConcept ?? false,
        subtitle: a.current?.subtitle,
        description: a.current?.description,
        summary: a.current?.summary,
        content: a.current?.body,
      })),
      chapters: project.chapters.map(({ chapter, turns }) => ({
        id: chapter.id,
        title: chapter.title,
        subtitle: chapter.subtitle || null,
        description: chapter.description || null,
        summary: chapter.summary || null,
        granularity: chapter.granularity || null,
        messages_count: turns.length,
      })),
      spatial_graph: {
        nodes_count: project.artifacts.length,
        edges_count: project.edges.length,
      },
    },
  });
}
