import { ProjectMetadata, WorkspaceContainer, WorkspaceEvent } from './types';

export interface IWorkspaceDomain {
  // Queries
  getActiveProjectId(): string;
  getProject(id: string): WorkspaceContainer | null;
  listProjects(): ProjectMetadata[];
  exportWorkspaceJson(id: string): string;

  // Commands
  setActiveProject(id: string): void;
  createProject(name: string, description: string, color?: string, codeName?: string): ProjectMetadata;
  importWorkspaceJson(jsonStr: string): ProjectMetadata;
  updateMetadata(id: string, partial: Partial<ProjectMetadata>): void;
  saveContainer(container: WorkspaceContainer): void;
  loadUserProjects(cloudProjects: any[]): void;
  removeProject(id: string): void;

  // Subscriptions
  subscribe(callback: (event: WorkspaceEvent) => void): () => void;
}
