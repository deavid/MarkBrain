/**
 * Canonical plaintext tree (Package 3 §3.3) — pure, shared by browser & Node CLI.
 *
 * Layout (one folder per project):
 *   <project-code-or-id>/
 *     project.json                          — snapshot metadata (no turns/chapters/artifacts/edges/threads/folders/revisions)
 *     folders.json                          — ThreadFolder[] (only when present)
 *     threads/<thread-id>.json              — { thread, turns[], chapters[] }
 *     threads/_orphan.json                  — turns/chapters with no (or unknown) threadId, only when present
 *     artifacts/<code-or-id>.md             — YAML frontmatter + raw Markdown body
 *     artifacts/<code-or-id>.history.json   — ArtifactRevision[] for that artifact (only when present)
 *     edges.json                            — SemanticEdge[]
 *
 * The tree is BIJECTIVE with the snapshot: export → import → exact equality.
 * `yamlDocument`, `isHighConcept` and `workspaceId` travel in the frontmatter
 * so nothing is dropped (workspaceId is restored from the owning project).
 */
import YAML from 'yaml';
import { sanitizeTarPath, createTarGz, parseTarGz, type TarEntry } from '../utils/tarGz';
import type { ProjectSnapshot } from '../services/stores/projectStore';
import type { Turn } from './01-dialogue-timeline/types';
import type { ChapterPartition } from './02-chapter-segmentation/types';
import type { UniversalArtifactDocument } from './01-artifact-document/types';
import type { ArtifactRevision } from './01-artifact-versioning/types';
import type { SemanticEdge } from './02-topological-graph/types';
import type { ChatThread, ThreadFolder, ChatCapabilities } from './06-chat-threads/types';

const enc = new TextEncoder();
const dec = new TextDecoder();

function encodeUtf8(str: string): Uint8Array {
  return enc.encode(str);
}

function decodeUtf8(bytes: Uint8Array): string {
  return dec.decode(bytes);
}

// ---------------------------------------------------------------------------
// filename safety
// ---------------------------------------------------------------------------

/**
 * Filesystem-safe name for a tar entry segment: keeps [A-Za-z0-9._-], replaces
 * anything else with `_`, and neutralizes `..` so sanitizeTarPath never trips.
 */
export function safeFilename(name: string): string {
  let cleaned = name.replace(/[^A-Za-z0-9._-]/g, '_');
  while (cleaned.includes('..')) cleaned = cleaned.replace('..', '__');
  if (cleaned.startsWith('.')) cleaned = '_' + cleaned;
  return cleaned || '_';
}

function artifactFileBase(artifact: UniversalArtifactDocument): string {
  return safeFilename(artifact.code || artifact.id);
}

// ---------------------------------------------------------------------------
// YAML frontmatter (flat, kebab-case-ish keys per pack §3.3)
// ---------------------------------------------------------------------------

function artifactToFrontmatter(artifact: UniversalArtifactDocument): Record<string, unknown> {
  const fm: Record<string, unknown> = {
    id: artifact.id,
    workspaceId: artifact.workspaceId,
    code: artifact.code,
    title: artifact.title,
    type: artifact.type,
    category: artifact.category,
    isHighConcept: artifact.isHighConcept,
    tags: artifact.tags,
    createdAt: artifact.createdAt,
    updatedAt: artifact.updatedAt,
    subtitle: artifact.current.subtitle,
    description: artifact.current.description,
    summary: artifact.current.summary,
  };
  if (artifact.color !== undefined) fm.color = artifact.color;
  if (artifact.lifecycle !== undefined) fm.lifecycle = artifact.lifecycle;
  if (artifact.layersStaleAt !== undefined) fm.layersStaleAt = artifact.layersStaleAt;
  if (artifact.graph !== undefined) fm.graph = artifact.graph;
  if (artifact.yamlDocument !== undefined) fm.yamlDocument = artifact.yamlDocument;
  return fm;
}

function artifactToMarkdown(artifact: UniversalArtifactDocument): string {
  const fm = artifactToFrontmatter(artifact);
  // sorted keys + no line wrapping: deterministic output, lossless round-trip
  const yaml = YAML.stringify(fm, { sortMapEntries: true, lineWidth: 0 });
  return `---\n${yaml}---\n${artifact.current.body}`;
}

function parseArtifactMarkdown(md: string, workspaceId: string): UniversalArtifactDocument {
  const lines = md.split('\n');
  if (lines[0] !== '---') throw new Error('Artifact .md missing YAML frontmatter');
  let endIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') {
      endIdx = i;
      break;
    }
  }
  if (endIdx === -1) throw new Error('Artifact .md has unclosed YAML frontmatter');
  const fmStr = lines.slice(1, endIdx).join('\n');
  const fm = (YAML.parse(fmStr) ?? {}) as Record<string, unknown>;
  const body = lines.slice(endIdx + 1).join('\n');

  const current = {
    subtitle: (fm.subtitle as string | undefined) ?? undefined,
    description: (fm.description as string) ?? '',
    summary: (fm.summary as string) ?? '',
    body,
  };
  return {
    id: fm.id as string,
    workspaceId: (fm.workspaceId as string) || workspaceId,
    code: fm.code as string,
    title: fm.title as string,
    type: fm.type as 'document' | 'chapter',
    category: fm.category as string,
    isHighConcept: fm.isHighConcept as boolean,
    color: fm.color as string | undefined,
    current,
    tags: (fm.tags as string[]) ?? [],
    createdAt: fm.createdAt as number,
    updatedAt: fm.updatedAt as number,
    layersStaleAt: fm.layersStaleAt as number | undefined,
    graph: fm.graph as UniversalArtifactDocument['graph'],
    yamlDocument: fm.yamlDocument as string | undefined,
    lifecycle: fm.lifecycle as UniversalArtifactDocument['lifecycle'],
  };
}

// ---------------------------------------------------------------------------
// snapshot → tree
// ---------------------------------------------------------------------------

export function snapshotToTree(snapshot: ProjectSnapshot): TarEntry[] {
  const root = safeFilename(snapshot.codeName || snapshot.projectId);
  const entries: TarEntry[] = [];

  // project.json — metadata + capabilities + granularityLaw
  const meta: Record<string, unknown> = {
    projectId: snapshot.projectId,
    updatedAt: snapshot.updatedAt,
  };
  if (snapshot.activeThreadId !== undefined) meta.activeThreadId = snapshot.activeThreadId;
  if (snapshot.name !== undefined) meta.name = snapshot.name;
  if (snapshot.codeName !== undefined) meta.codeName = snapshot.codeName;
  if (snapshot.description !== undefined) meta.description = snapshot.description;
  if (snapshot.color !== undefined) meta.color = snapshot.color;
  if (snapshot.granularityLaw !== undefined) meta.granularityLaw = snapshot.granularityLaw;
  if (snapshot.capabilities !== undefined) meta.capabilities = snapshot.capabilities;
  entries.push({ path: `${root}/project.json`, data: encodeUtf8(JSON.stringify(meta, null, 2) + '\n') });

  // folders.json
  if (snapshot.folders && snapshot.folders.length > 0) {
    entries.push({
      path: `${root}/folders.json`,
      data: encodeUtf8(JSON.stringify(snapshot.folders, null, 2) + '\n'),
    });
  }

  // threads/<thread-id>.json — thread + its turns + its chapters
  const threadIds = new Set((snapshot.threads ?? []).map((t) => t.id));
  for (const thread of snapshot.threads ?? []) {
    const turns = (snapshot.turns ?? []).filter((t) => t.threadId === thread.id);
    const chapters = (snapshot.chapters ?? []).filter((c) => c.threadId === thread.id);
    entries.push({
      path: `${root}/threads/${safeFilename(thread.id)}.json`,
      data: encodeUtf8(JSON.stringify({ thread, turns, chapters }, null, 2) + '\n'),
    });
  }
  // turns/chapters with no (or unknown) threadId
  const orphanTurns = (snapshot.turns ?? []).filter((t) => !t.threadId || !threadIds.has(t.threadId));
  const orphanChapters = (snapshot.chapters ?? []).filter((c) => !c.threadId || !threadIds.has(c.threadId));
  if (orphanTurns.length > 0 || orphanChapters.length > 0) {
    entries.push({
      path: `${root}/threads/_orphan.json`,
      data: encodeUtf8(JSON.stringify({ turns: orphanTurns, chapters: orphanChapters }, null, 2) + '\n'),
    });
  }

  // artifacts/<code-or-id>.md + .history.json
  const usedBases = new Set<string>();
  for (const artifact of snapshot.artifacts ?? []) {
    let base = artifactFileBase(artifact);
    while (usedBases.has(base)) {
      base = `${base}-2`; // rare collision; frontmatter carries the true id/code
    }
    usedBases.add(base);
    entries.push({ path: `${root}/artifacts/${base}.md`, data: encodeUtf8(artifactToMarkdown(artifact)) });
    const history = snapshot.revisions?.[artifact.id];
    if (history && history.length > 0) {
      entries.push({
        path: `${root}/artifacts/${base}.history.json`,
        data: encodeUtf8(JSON.stringify(history, null, 2) + '\n'),
      });
    }
  }

  // edges.json
  entries.push({
    path: `${root}/edges.json`,
    data: encodeUtf8(JSON.stringify(snapshot.edges ?? [], null, 2) + '\n'),
  });

  return entries;
}

// ---------------------------------------------------------------------------
// tree → snapshot
// ---------------------------------------------------------------------------

export function treeToSnapshot(entries: TarEntry[], fallbackProjectId?: string): ProjectSnapshot {
  const projEntry = entries.find((e) => e.path === 'project.json' || e.path.endsWith('/project.json'));
  if (!projEntry) {
    throw new Error('Plaintext tree has no project.json');
  }
  const slashIdx = projEntry.path.lastIndexOf('/');
  const root = slashIdx === -1 ? '' : projEntry.path.slice(0, slashIdx);

  const rel = (entry: TarEntry): string =>
    root === '' ? entry.path : entry.path.startsWith(`${root}/`) ? entry.path.slice(root.length + 1) : '';

  const readJson = <T,>(path: string): T | undefined => {
    const entry = entries.find((e) => rel(e) === path);
    if (!entry) return undefined;
    try {
      return JSON.parse(decodeUtf8(entry.data)) as T;
    } catch (err) {
      throw new Error(`Corrupt JSON in ${path}: ${(err as Error).message}`);
    }
  };

  const meta = readJson<Record<string, unknown>>('project.json');
  const projectId = (meta?.projectId as string) || fallbackProjectId;
  if (!projectId) throw new Error('Plaintext tree project.json has no projectId (and no fallback)');

  const folders = readJson<ThreadFolder[]>('folders.json');
  const edges = readJson<SemanticEdge[]>('edges.json') ?? [];

  // thread files
  const threads: ChatThread[] = [];
  const turns: Turn[] = [];
  const chapters: ChapterPartition[] = [];
  // thread files — thread files first, `_orphan.json` LAST regardless of
  // entry order. The writer emits orphan turns/chapters after the threaded
  // ones, and a real filesystem (readdirSync().sort()) lists `_orphan.json`
  // BEFORE thread-*.json ('_' sorts below letters); parsing in entry order
  // would silently reorder orphan turns and break the bijection.
  const orphanEntry = entries.find((e) => rel(e) === 'threads/_orphan.json');
  const orphan = orphanEntry
    ? readJson<{ turns: Turn[]; chapters: ChapterPartition[] }>('threads/_orphan.json')
    : undefined;
  for (const entry of entries) {
    const p = rel(entry);
    if (!p.startsWith('threads/') || !p.endsWith('.json') || p === 'threads/_orphan.json') continue;
    const data = readJson<{ thread: ChatThread; turns: Turn[]; chapters: ChapterPartition[] }>(p);
    if (!data) continue;
    threads.push(data.thread);
    turns.push(...data.turns);
    chapters.push(...data.chapters);
  }
  turns.push(...(orphan?.turns ?? []));
  chapters.push(...(orphan?.chapters ?? []));

  // artifacts: .md first (builds base → id map), then .history.json
  const artifacts: UniversalArtifactDocument[] = [];
  const baseToArtifactId = new Map<string, string>();
  const historyByName = new Map<string, ArtifactRevision[]>();
  for (const entry of entries) {
    const p = rel(entry);
    if (p.startsWith('artifacts/') && p.endsWith('.history.json')) {
      const name = p.slice('artifacts/'.length, -'.history.json'.length);
      const revs = readJson<ArtifactRevision[]>(p);
      if (revs) historyByName.set(name, revs);
    }
  }
  for (const entry of entries) {
    const p = rel(entry);
    if (!p.startsWith('artifacts/') || !p.endsWith('.md')) continue;
    const name = p.slice('artifacts/'.length, -'.md'.length);
    const artifact = parseArtifactMarkdown(decodeUtf8(entry.data), projectId);
    artifacts.push(artifact);
    baseToArtifactId.set(name, artifact.id);
  }

  const revisions: Record<string, ArtifactRevision[]> = {};
  for (const [name, revs] of historyByName) {
    const artifactId = baseToArtifactId.get(name);
    if (artifactId) revisions[artifactId] = revs;
    // history file with no matching artifact: dropped (cannot exist from our export)
  }

  return {
    projectId,
    turns,
    chapters,
    artifacts,
    edges,
    updatedAt: (meta?.updatedAt as number) ?? 0,
    threads: threads.length > 0 ? threads : undefined,
    folders: folders && folders.length > 0 ? folders : undefined,
    activeThreadId: meta?.activeThreadId as string | undefined,
    name: meta?.name as string | undefined,
    codeName: meta?.codeName as string | undefined,
    description: meta?.description as string | undefined,
    color: meta?.color as string | undefined,
    granularityLaw: meta?.granularityLaw as ProjectSnapshot['granularityLaw'],
    revisions: Object.keys(revisions).length > 0 ? revisions : undefined,
    capabilities: meta?.capabilities as Partial<ChatCapabilities> | undefined,
  };
}

/** Entries grouped by their top-level project folder (for multi-project archives). */
export function groupEntriesByProject(entries: TarEntry[]): Map<string, TarEntry[]> {
  const groups = new Map<string, TarEntry[]>();
  for (const entry of entries) {
    const path = sanitizeTarPath(entry.path);
    const slashIdx = path.indexOf('/');
    const root = slashIdx === -1 ? '_' : path.slice(0, slashIdx);
    let group = groups.get(root);
    if (!group) {
      group = [];
      groups.set(root, group);
    }
    group.push({ ...entry, path });
  }
  return groups;
}

// ---------------------------------------------------------------------------
// archive-level helpers
// ---------------------------------------------------------------------------

/** One project → tar.gz bytes. */
export async function exportProjectTarGz(snapshot: ProjectSnapshot): Promise<Uint8Array> {
  return createTarGz(snapshotToTree(snapshot));
}

/** Several projects → one tar.gz with a folder per project (Sidebar "Plaintext backup"). */
export async function exportProjectsTarGz(snapshots: ProjectSnapshot[]): Promise<Uint8Array> {
  const entries: TarEntry[] = [];
  const usedRoots = new Set<string>();
  for (const snapshot of snapshots) {
    let root = safeFilename(snapshot.codeName || snapshot.projectId);
    while (usedRoots.has(root)) root = `${root}-2`;
    usedRoots.add(root);
    entries.push(...snapshotToTree(snapshot).map((e) => ({ ...e, path: `${root}/${e.path}` })));
  }
  return createTarGz(entries);
}

/** tar.gz bytes → every project found inside, as full snapshots. */
export async function importProjectTarGz(bytes: Uint8Array): Promise<ProjectSnapshot[]> {
  const entries = await parseTarGz(bytes);
  const groups = groupEntriesByProject(entries);
  const snapshots: ProjectSnapshot[] = [];
  for (const group of groups.values()) {
    snapshots.push(treeToSnapshot(group));
  }
  return snapshots;
}
