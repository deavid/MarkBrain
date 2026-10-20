import type { Artifact, ChapterTurns, SemanticEdge } from '../types';
import type { UniversalArtifactDocument } from '../domains/01-artifact-document/types';
import type { ProjectMetadata } from '../domains/00-workspace/types';
import { estimateTokens } from './estimateTokens';
import YAML from 'yaml';

export interface TokenColorInfo {
  tier: '16k' | '32k' | '64k' | '128k' | '256k' | '512k';
  name: string;
  colorName: string;
  hex: string;
  glowHex: string;
  badgeBg: string;
  textClass: string;
  bgClass: string;
  barColor: string;
  description: string;
}

/**
 * Assigns colors to token sizes as requested:
 * - 16k is blue
 * - 32k is cyan
 * - 64k is green
 * - 128k is yellow
 * - 256k is orange
 * - 512k is red
 * Calibrated in OKLCH muted/tasteful palette with blue shadows and subtle ruby highlights
 */
export function getTokenColor(tokens: number): TokenColorInfo {
  if (tokens <= 16000) {
    return {
      tier: '16k',
      name: '≤ 16k (Ultra-Lean Blue)',
      colorName: 'blue',
      hex: '#3b82f6',
      glowHex: 'rgba(59, 130, 246, 0.25)',
      badgeBg: 'bg-surface-2',
      textClass: 'text-[#8ab1e0]',
      bgClass: 'bg-surface-2/70',
      barColor: '#3b82f6',
      description: 'Micro context footprint, minimal latency and low compute cost.',
    };
  } else if (tokens <= 32000) {
    return {
      tier: '32k',
      name: '16k – 32k (Streamlined Cyan)',
      colorName: 'cyan',
      hex: '#06b6d4',
      glowHex: 'rgba(6, 180, 212, 0.25)',
      badgeBg: 'bg-surface-3',
      textClass: 'text-[#7ec6cf]',
      bgClass: 'bg-surface-3/70',
      barColor: '#06b6d4',
      description: 'Optimal engineering balance with clear boundary focus.',
    };
  } else if (tokens <= 64000) {
    return {
      tier: '64k',
      name: '32k – 64k (Balanced Green)',
      colorName: 'green',
      hex: '#10b981',
      glowHex: 'rgba(16, 185, 129, 0.25)',
      badgeBg: 'bg-surface-3',
      textClass: 'text-[#88c9a0]',
      bgClass: 'bg-surface-3/70',
      barColor: '#10b981',
      description: 'Moderate context depth, retaining multi-component contracts.',
    };
  } else if (tokens <= 128000) {
    return {
      tier: '128k',
      name: '64k – 128k (Dense Yellow)',
      colorName: 'yellow',
      hex: '#eab308',
      glowHex: 'rgba(234, 179, 8, 0.25)',
      badgeBg: 'bg-surface-3',
      textClass: 'text-[#e0b96c]',
      bgClass: 'bg-surface-3/70',
      barColor: '#eab308',
      description: 'Lots of memory — consider summarizing older chapters.',
    };
  } else if (tokens <= 256000) {
    return {
      tier: '256k',
      name: '128k – 256k (Heavy Orange)',
      colorName: 'orange',
      hex: '#f97316',
      glowHex: 'rgba(249, 115, 22, 0.25)',
      badgeBg: 'bg-surface-2',
      textClass: 'text-[#e89468]',
      bgClass: 'bg-surface-2/70',
      barColor: '#f97316',
      description: 'High overhead. Recommend lowering artifact depth or compressing chapters.',
    };
  } else {
    return {
      tier: '512k',
      name: '256k – 512k+ (Max Red)',
      colorName: 'red',
      hex: '#ef4444',
      glowHex: 'rgba(239, 68, 68, 0.3)',
      badgeBg: 'bg-surface-2',
      textClass: 'text-[#f07a84]',
      bgClass: 'bg-surface-2/70',
      barColor: '#ef4444',
      description: 'Near boundary limit. High token consumption per turn.',
    };
  }
}

// THE client-side estimator lives in estimateTokens.ts — re-exported here for
// existing importers. One implementation, so mirror rows and compiler totals
// cannot drift.
export { estimateTokens };

// ── Export (domain shapes — chapters arrive as the chapter-turns selector) ──

/** Everything an export needs from one project — domain types + selector output. */
export interface ProjectExportInput {
  meta: Pick<ProjectMetadata, 'id' | 'name' | 'codeName' | 'description'>;
  artifacts: UniversalArtifactDocument[];
  chapters: ChapterTurns[];
  edges: SemanticEdge[];
}

/**
 * Export to JSON
 */
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

/**
 * Export to Markdown
 */
export function exportToMarkdown(project: ProjectExportInput): string {
  let md = `# MarkBrain — Project: ${project.meta.name} (${project.meta.codeName || project.meta.id})\n\n`;
  md += `> ${project.meta.description}\n\n`;
  md += `Exported: ${new Date().toLocaleString()}\n\n`;
  md += `---\n\n`;

  md += `## Durable Artifacts (${project.artifacts.length})\n\n`;
  for (const art of project.artifacts) {
    md += `### ${art.title} (\`${art.code || art.id}\`)\n`;
    md += `**Type:** ${art.type} | **High Concept:** ${art.isHighConcept ? 'Yes' : 'No'}\n\n`;
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

/**
 * Export to YAML
 */
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
        description: a.current?.description,
        summary: a.current?.summary,
        content: a.current?.body,
      })),
      chapters: project.chapters.map(({ chapter, turns }) => ({
        id: chapter.id,
        title: chapter.title,
        description: chapter.description || null,
        summary: chapter.summary || null,
        granularity: chapter.granularity || null,
        messages_count: turns.length,
      })),
      spatial_graph: {
        // Artifacts ARE the graph nodes (the view derives x/y from artifact.graph).
        nodes_count: project.artifacts.length,
        edges_count: project.edges.length,
      },
    },
  });
}

// Aliases for any existing callers
export const exportProjectToJSON = exportToJSON;
export const exportProjectToMarkdown = exportToMarkdown;
export const exportProjectToYAML = exportToYAML;
