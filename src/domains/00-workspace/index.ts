export interface IWorkspaceDomain {
  getActiveProjectId(): string;
  getProject(id: string): any | null;
  listProjects(): any[];
  exportWorkspaceJson(id: string): string;
  setActiveProject(id: string): void;
  createProject(name: string, description: string, color?: string, codeName?: string): any;
  importWorkspaceJson(jsonStr: string): any;
  updateMetadata(id: string, partial: any): void;
  saveContainer(container: any): void;
  subscribe(callback: (event: any) => void): () => void;
}

export * from './types';
export * from './interface';
export * from './WorkspaceDomain';
