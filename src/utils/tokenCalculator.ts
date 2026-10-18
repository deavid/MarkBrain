import {
  Artifact,
  AbstractionLevel,
  ContextDepth,
  Chapter,
  Project,
  TokenGroupBreakdown,
} from '../types';
import YAML from 'yaml';

export interface TokenColorInfo {
  tier: '16k' | '32k' | '64k' | '128k' | '256k' | '512k';
  name: string;
  colorName: string;
  hex: string;
  glowHex: string;
  badgeBg: string;
  textClass: string;
  borderClass: string;
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
      badgeBg: 'bg-[#152033]',
      textClass: 'text-[#8ab1e0]',
      borderClass: 'border-[#293d5e]',
      bgClass: 'bg-[#152033]/70',
      barColor: '#3b82f6',
      description: 'Micro context footprint, minimal latency and low compute cost.',
    };
  } else if (tokens <= 32000) {
    return {
      tier: '32k',
      name: '16k – 32k (Streamlined Cyan)',
      colorName: 'cyan',
      hex: '#06b6d4',
      glowHex: 'rgba(6, 182, 212, 0.25)',
      badgeBg: 'bg-[#14262b]',
      textClass: 'text-[#7ec6cf]',
      borderClass: 'border-[#274b54]',
      bgClass: 'bg-[#14262b]/70',
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
      badgeBg: 'bg-[#16291c]',
      textClass: 'text-[#88c9a0]',
      borderClass: 'border-[#274d34]',
      bgClass: 'bg-[#16291c]/70',
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
      badgeBg: 'bg-[#2b2212]',
      textClass: 'text-[#e0b96c]',
      borderClass: 'border-[#544321]',
      bgClass: 'bg-[#2b2212]/70',
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
      badgeBg: 'bg-[#2e1a12]',
      textClass: 'text-[#e89468]',
      borderClass: 'border-[#593322]',
      bgClass: 'bg-[#2e1a12]/70',
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
      badgeBg: 'bg-[#2e1215]',
      textClass: 'text-[#f07a84]',
      borderClass: 'border-[#5e2229]',
      bgClass: 'bg-[#2e1215]/70',
      barColor: '#ef4444',
      description: 'Near boundary limit. High token consumption per turn.',
    };
  }
}

/**
 * Fast character-based token estimator (~3.8 chars per token for code & technical text)
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 3.8);
}

/**
 * Calculates token variants for an artifact across all abstraction levels
 */
export function getArtifactTokenVariants(artifact: Artifact): {
  current: number;
  full: number;
  summary: number;
  description: number;
  title: number;
  excluded: number;
} {
  const full = estimateTokens(artifact.current?.t3_body || '');
  const summary = estimateTokens(artifact.current?.t2_summary || artifact.current?.t1_abstract || '');
  const description = estimateTokens(artifact.current?.t1_abstract || '');
  const title = estimateTokens(artifact.title || '');
  const excluded = 0;

  const resolution = artifact.resolution || 'full';
  let current = full;
  switch (resolution) {
    case 'excluded':
      current = 0;
      break;
    case 'title':
      current = title;
      break;
    case 'description':
      current = description;
      break;
    case 'summary':
      current = summary;
      break;
    case 'full':
    default:
      current = full;
      break;
  }

  return {
    current,
    full,
    summary,
    description,
    title,
    excluded,
  };
}

/**
 * Extracts artifact text according to selected abstraction level
 */
export function getArtifactTextAtLevel(artifact: Artifact, level: AbstractionLevel): string {
  switch (level) {
    case 'excluded':
      return '';
    case 'title':
      return `[Artifact: ${artifact.title} (${artifact.code || artifact.id})]`;
    case 'description':
      return `[Artifact: ${artifact.title} (${artifact.code || artifact.id})]\nDescription: ${artifact.current?.t1_abstract}`;
    case 'summary':
      return `[Artifact: ${artifact.title} (${artifact.code || artifact.id})]\nSummary: ${artifact.current?.t2_summary || artifact.current?.t1_abstract}`;
    case 'full':
    default:
      return `# ${artifact.title} (${artifact.code || artifact.id})\nType: ${artifact.type}${artifact.category ? ` | Category: ${artifact.category}` : ''}\n\n${artifact.current?.t3_body}`;
  }
}

/**
 * Extracts artifact text based on chosen context depth (alias supporting extended depths)
 */
export function getArtifactTextAtDepth(
  artifact: Artifact,
  depth: ContextDepth | AbstractionLevel,
  allArtifacts?: Artifact[]
): string {
  if (depth === 'off' || depth === 'excluded') return '';
  if (depth === 'name' || depth === 'title') return `[Artifact: ${artifact.title} (${artifact.code || artifact.id})]`;
  if (depth === 'description') return `[Artifact: ${artifact.title} (${artifact.code || artifact.id})]\nDescription: ${artifact.current?.t1_abstract}`;
  if (depth === 'summary') return `[Artifact: ${artifact.title} (${artifact.code || artifact.id})]\nSummary: ${artifact.current?.t2_summary || artifact.current?.t1_abstract}`;
  if (depth === 'children-summaries') {
    let text = `# ${artifact.title} (${artifact.code || artifact.id})\n${artifact.current?.t3_body}`;
    const childCodes = artifact.graph?.children || [];
    if (allArtifacts && childCodes.length > 0) {
      text += '\n\n## Sub-Artifacts (Summaries):\n';
      for (const childCode of childCodes) {
        const child = allArtifacts.find((a) => a.code === childCode || a.id === childCode);
        if (child) {
          text += `- **${child.title}** (${child.code || child.id}): ${child.current?.t2_summary || child.current?.t1_abstract}\n`;
        }
      }
    }
    return text;
  }
  return `# ${artifact.title} (${artifact.code || artifact.id})\nType: ${artifact.type}\n\n${artifact.current?.t3_body}`;
}

/**
 * Computes exact breakdown of tokens for the active project context
 */
export function computeTokenBreakdown(
  artifacts: Artifact[],
  chapters: Chapter[],
  currentChapterId: string
): TokenGroupBreakdown {
  // 1. Artifacts in memory
  let artifactsTokens = 0;
  let activeArtifactsCount = 0;

  for (const art of artifacts) {
    const res = art.resolution || 'full';
    if (res !== 'excluded') {
      activeArtifactsCount++;
      const text = getArtifactTextAtLevel(art, res);
      artifactsTokens += estimateTokens(text);
    }
  }

  // 2. Active Chapter messages
  let activeChapterTokens = 0;
  const activeChapter = chapters.find((c) => c.id === currentChapterId);
  if (activeChapter) {
    for (const msg of activeChapter.messages) {
      activeChapterTokens += estimateTokens(`${msg.role}: ${msg.content}\n`);
    }
  }

  // 3. Older Chapter summaries
  let olderChaptersTokens = 0;
  const olderChapters = chapters.filter((c) => c.id !== currentChapterId);
  for (const chap of olderChapters) {
    const mode = chap.compressionMode || (chap.isSummarized ? 'summary' : 'full');
    if (mode === 'drop' || chap.depth === 'off') {
      continue;
    } else if (mode === 'summary' || chap.depth === 'summary') {
      const summaryText = `[Chapter: ${chap.title}]\nSummary: ${chap.summary || chap.shortSummary || ''}\nInvariants: ${(chap.keyPoints || []).join('; ')}`;
      olderChaptersTokens += estimateTokens(summaryText);
    } else {
      // Full
      for (const msg of chap.messages) {
        olderChaptersTokens += estimateTokens(`${msg.role}: ${msg.content}\n`);
      }
    }
  }

  // 4. System prompt baseline
  const systemPromptTokens = 450;
  const totalTokens = artifactsTokens + activeChapterTokens + olderChaptersTokens + systemPromptTokens;

  // Approximate cost calculation ($0.15 per 1M tokens)
  const cost = ((totalTokens / 1_000_000) * 0.15).toFixed(4);

  return {
    artifactsTokens,
    activeChapterTokens,
    olderChaptersTokens,
    systemPromptTokens,
    totalTokens,
    artifactsCount: activeArtifactsCount,
    activeChaptersCount: activeChapter ? 1 : 0,
    olderChaptersCount: olderChapters.length,
    estimatedCost: `$${cost}`,
  };
}

/**
 * Backward compatibility alias for computeTokenBreakdown
 */
export function computeContextPackBreakdown(
  artifacts: Artifact[],
  chapters: Chapter[],
  currentChapterId: string
) {
  const breakdown = computeTokenBreakdown(artifacts, chapters, currentChapterId);
  return {
    artifactsTokens: breakdown.artifactsTokens,
    chaptersTokens: breakdown.activeChapterTokens + breakdown.olderChaptersTokens,
    totalTokens: breakdown.totalTokens,
    activeArtifactsCount: breakdown.artifactsCount,
    activeChaptersCount: breakdown.activeChaptersCount + breakdown.olderChaptersCount,
    estimatedCost: breakdown.estimatedCost,
  };
}

/**
 * Export to JSON
 */
export function exportToJSON(projects: Project[] | Project, activeProject?: Project): string {
  return JSON.stringify(
    {
      appName: 'MarkBrain',
      version: '2.0.0',
      exportedAt: new Date().toISOString(),
      activeProject: activeProject || (Array.isArray(projects) ? projects[0] : projects),
      projects: Array.isArray(projects) ? projects : [projects],
    },
    null,
    2
  );
}

/**
 * Export to Markdown
 */
export function exportToMarkdown(project: Project): string {
  let md = `# MarkBrain — Project: ${project.name} (${project.codeName || project.id})\n\n`;
  md += `> ${project.description}\n\n`;
  if (project.boundaryRules) {
    md += `**Boundary Rules:** ${project.boundaryRules}\n\n`;
  }
  md += `Exported: ${new Date().toLocaleString()}\n\n`;
  md += `---\n\n`;

  md += `## Durable Artifacts (${project.artifacts.length})\n\n`;
  for (const art of project.artifacts) {
    md += `### ${art.title} (\`${art.code || art.id}\`)\n`;
    md += `**Type:** ${art.type} | **High Concept:** ${art.isHighConcept ? 'Yes' : 'No'} | **Resolution:** ${art.resolution}\n\n`;
    md += `**Description:** ${art.current?.t1_abstract}\n\n`;
    md += `**Summary:** ${art.current?.t2_summary}\n\n`;
    md += `\`\`\`markdown\n${art.current?.t3_body}\n\`\`\`\n\n`;
  }

  md += `---\n\n## Project Chapters & History\n\n`;
  for (const chap of project.chapters) {
    md += `### ${chap.title}\n`;
    if (chap.summary || chap.shortSummary) {
      md += `> **Executive Summary:** ${chap.summary || chap.shortSummary}\n\n`;
    }
    if (chap.keyPoints && chap.keyPoints.length > 0) {
      md += `**Key Invariants:**\n`;
      for (const kp of chap.keyPoints) {
        md += `- ${kp}\n`;
      }
      md += `\n`;
    }
    for (const msg of chap.messages) {
      md += `**${msg.role === 'user' ? 'User' : 'MarkBrain'}** (${new Date(msg.timestamp).toLocaleTimeString()}):\n`;
      md += `${msg.content}\n\n`;
    }
  }

  return md;
}

/**
 * Export to YAML
 */
export function exportToYAML(project: Project): string {
  return YAML.stringify({
    markbrain_project: {
      id: project.id,
      name: project.name,
      code_name: project.codeName || project.id,
      description: project.description,
      boundary_rules: project.boundaryRules || null,
      artifacts_count: project.artifacts.length,
      artifacts: project.artifacts.map((a) => ({
        id: a.id,
        code: a.code || a.id,
        title: a.title,
        type: a.type,
        is_high_concept: a.isHighConcept ?? false,
        resolution: a.resolution,
        description: a.current?.t1_abstract,
        summary: a.current?.t2_summary,
        content: a.current?.t3_body,
      })),
      chapters: project.chapters.map((c) => ({
        id: c.id,
        title: c.title,
        summary: c.summary || c.shortSummary || null,
        key_points: c.keyPoints || [],
        messages_count: c.messages.length,
      })),
      spatial_graph: {
        nodes_count: project.nodes.length,
        edges_count: project.edges.length,
      },
    },
  });
}

// Aliases for any existing callers
export const exportProjectToJSON = exportToJSON;
export const exportProjectToMarkdown = exportToMarkdown;
export const exportProjectToYAML = exportToYAML;
