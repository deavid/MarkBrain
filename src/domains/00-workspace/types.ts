export interface ProjectMetadata {
  id: string;
  name: string;
  description: string;
  codeName?: string;
  color?: string;
  createdAt: number;
  updatedAt: number;
}

export interface WorkspaceContainer {
  metadata: ProjectMetadata;
  activeChapterId: string;
  focalArtifactIds: string[];
  opticalMode: 'autofocus' | 'manual' | 'myopia';
  tokenCeiling: number;
  tierOverrides: Record<string, number>;
}

export type WorkspaceEvent =
  | { type: 'workspaceLoaded'; activeProjectId: string }
  | { type: 'activeProjectChanged'; previousId: string; nextId: string }
  | { type: 'projectCreated'; project: ProjectMetadata }
  | { type: 'projectDeleted'; projectId: string };
