import { IWorkspaceDomain } from './interface';
import { ProjectMetadata, WorkspaceContainer, WorkspaceEvent } from './types';

export class WorkspaceDomain implements IWorkspaceDomain {
  private projects: Map<string, WorkspaceContainer> = new Map();
  private activeProjectId: string = '';
  private listeners: Set<(event: WorkspaceEvent) => void> = new Set();
  private storageKey: string;

  constructor(storageKey = 'markbrain_workspace_registry') {
    this.storageKey = storageKey;
    this.loadFromStorage();
  }

  private loadFromStorage() {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const raw = window.localStorage.getItem(this.storageKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed.projects)) {
            parsed.projects.forEach((c: WorkspaceContainer) => this.projects.set(c.metadata.id, c));
          }
          if (parsed.activeProjectId && this.projects.has(parsed.activeProjectId)) {
            this.activeProjectId = parsed.activeProjectId;
          }
        }
      }
    } catch {
      // Storage unavailable or disabled
    }

    if (this.projects.size === 0) {
      this.initDefaultProject();
    }
  }

  private persist() {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const payload = {
          activeProjectId: this.activeProjectId,
          projects: Array.from(this.projects.values()),
        };
        window.localStorage.setItem(this.storageKey, JSON.stringify(payload));
      }
    } catch {
      // ignore
    }
  }

  private initDefaultProject() {
    const defaultMeta: ProjectMetadata = {
      id: 'proj-unhaunter',
      name: 'Unhaunter Game Architecture',
      description: 'Real-time combat loop, tick decoupling, and spectral state machines.',
      codeName: 'unhaunter',
      color: '#be3a49',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const container: WorkspaceContainer = {
      metadata: defaultMeta,
      activeChapterId: 'chap-un-3',
      focalArtifactIds: ['art-combat-loop', 'art-tick-rate'],
      opticalMode: 'autofocus',
      tokenCeiling: 32000,
      tierOverrides: {},
    };
    this.projects.set(defaultMeta.id, container);
    this.activeProjectId = defaultMeta.id;
    this.persist();
  }

  getActiveProjectId(): string {
    return this.activeProjectId;
  }

  getProject(id: string): WorkspaceContainer | null {
    return this.projects.get(id) || null;
  }

  listProjects(): ProjectMetadata[] {
    return Array.from(this.projects.values()).map((p) => p.metadata);
  }

  exportWorkspaceJson(id: string): string {
    const c = this.projects.get(id);
    if (!c) throw new Error(`Project ${id} not found.`);
    return JSON.stringify(c, null, 2);
  }

  setActiveProject(id: string): void {
    if (!this.projects.has(id)) return;
    const prev = this.activeProjectId;
    this.activeProjectId = id;
    this.persist();
    this.emit({ type: 'activeProjectChanged', previousId: prev, nextId: id });
  }

  createProject(name: string, description: string, color = '#3b82f6', codeName?: string): ProjectMetadata {
    const id = `proj-${Date.now()}`;
    const meta: ProjectMetadata = {
      id,
      name,
      description,
      color,
      codeName: codeName || name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const container: WorkspaceContainer = {
      metadata: meta,
      activeChapterId: `chap-${Date.now()}-1`,
      focalArtifactIds: [],
      opticalMode: 'autofocus',
      tokenCeiling: 32000,
      tierOverrides: {},
    };
    this.projects.set(id, container);
    this.persist();
    this.emit({ type: 'projectCreated', project: meta });
    return meta;
  }

  importWorkspaceJson(jsonStr: string): ProjectMetadata {
    const parsed = JSON.parse(jsonStr) as WorkspaceContainer;
    if (!parsed.metadata || !parsed.metadata.id) {
      throw new Error('Invalid workspace JSON payload.');
    }
    this.projects.set(parsed.metadata.id, parsed);
    this.persist();
    this.emit({ type: 'projectCreated', project: parsed.metadata });
    return parsed.metadata;
  }

  updateMetadata(id: string, partial: Partial<ProjectMetadata>): void {
    const container = this.projects.get(id);
    if (!container) return;
    container.metadata = { ...container.metadata, ...partial, updatedAt: Date.now() };
    this.persist();
  }

  saveContainer(container: WorkspaceContainer): void {
    this.projects.set(container.metadata.id, { ...container });
    this.persist();
  }

  loadUserProjects(cloudProjects: any[]): void {
    this.projects.clear();
    if (cloudProjects.length === 0) {
      const prev = this.activeProjectId;
      this.activeProjectId = '';
      this.persist();
      this.emit({ type: 'activeProjectChanged', previousId: prev, nextId: '' });
      return;
    }

    cloudProjects.forEach((snap) => {
      const id = snap.projectId || snap.id;
      const meta: ProjectMetadata = {
        id,
        name: snap.name || id,
        codeName: snap.codeName || id.slice(0, 4).toUpperCase(),
        description: snap.description || '',
        color: snap.color || '#3b82f6',
        createdAt: snap.updatedAt || Date.now(),
        updatedAt: snap.updatedAt || Date.now(),
      };
      const container: WorkspaceContainer = {
        metadata: meta,
        activeChapterId: snap.chapters?.[0]?.id || `chap-${id}-1`,
        focalArtifactIds: [],
        opticalMode: 'autofocus',
        tokenCeiling: 32000,
        tierOverrides: {},
      };
      this.projects.set(id, container);
    });

    const firstId = cloudProjects[0].projectId || cloudProjects[0].id;
    const prev = this.activeProjectId;
    this.activeProjectId = firstId;
    this.persist();
    this.emit({ type: 'activeProjectChanged', previousId: prev, nextId: firstId });
  }

  subscribe(callback: (event: WorkspaceEvent) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  private emit(event: WorkspaceEvent) {
    this.listeners.forEach((l) => l(event));
  }
}
