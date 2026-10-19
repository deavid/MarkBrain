export interface ProjectMetadata {
  id: string;
  name: string;
  description: string;
  codeName?: string;
  color?: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * Project container. Context control does NOT live here: artifacts enter a
 * payload through a per-chat attachment (06-chat-threads), so a fresh chat is
 * genuinely empty. (`focalArtifactIds` / `tierOverrides` / `opticalMode` were
 * the Focus machinery and are gone — see design-docs/TERMINOLOGY.md.)
 */
export interface WorkspaceContainer {
  metadata: ProjectMetadata;
  activeChapterId: string;
  tokenCeiling: number;
}

export type WorkspaceEvent =
  | { type: 'workspaceLoaded'; activeProjectId: string }
  | { type: 'activeProjectChanged'; previousId: string; nextId: string }
  | { type: 'projectCreated'; project: ProjectMetadata }
  | { type: 'projectDeleted'; projectId: string };
