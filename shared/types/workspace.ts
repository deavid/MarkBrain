import type { ChatCapabilities } from './threads';

export interface ProjectMetadata {
  id: string;
  name: string;
  description: string;
  codeName?: string;
  color?: string;
  createdAt: number;
  updatedAt: number;
  /** Project-default chat capabilities (Package 2 §2.2); lives on the project so "all chats" has a home. */
  capabilities?: Partial<ChatCapabilities>;
}

/** Project metadata and token ceiling. Context membership lives per-chat in `06-chat-threads`, never on the project. */
export interface WorkspaceContainer {
  metadata: ProjectMetadata;
  activeChapterId: string;
  tokenCeiling: number;
}

export type WorkspaceEvent =
  | { type: 'workspaceLoaded'; activeProjectId: string }
  | { type: 'activeProjectChanged'; previousId: string; nextId: string }
  | { type: 'projectCreated'; project: ProjectMetadata }
  | { type: 'projectDeleted'; projectId: string }
  | { type: 'projectMetaChanged'; projectId: string };
