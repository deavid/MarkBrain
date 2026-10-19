import type { DomainContextValue } from '../../domains/DomainRegistry';
import type { ActiveView } from './Sidebar';

type WorkspaceContainer = NonNullable<ReturnType<DomainContextValue['workspace']['getProject']>>;

export interface WorkspaceHandlerParams {
  workspace: DomainContextValue['workspace'];
  currentContainer: WorkspaceContainer | null | undefined;
  triggerReRender: () => void;
  setActiveView: (view: ActiveView) => void;
  setIsProjectLauncherOpen: (open: boolean) => void;
}

// Workspace/project CRUD handlers (the optical-mode toggle died with Focus).
export function createWorkspaceHandlers(params: WorkspaceHandlerParams) {
  const {
    workspace,
    currentContainer,
    triggerReRender,
    setActiveView,
    setIsProjectLauncherOpen,
  } = params;

  // Select Project & Launch Chat
  const handleSelectProjectAndLaunchChat = (projId: string) => {
    workspace.setActiveProject(projId);
    setActiveView('chat');
    setIsProjectLauncherOpen(false);
  };

  // Create Project & Launch Chat
  const handleCreateProject = (
    name: string,
    description: string,
    codeName: string,
    color: string
  ) => {
    const meta = workspace.createProject(name, description, color, codeName);
    workspace.setActiveProject(meta.id);
    setActiveView('chat');
    setIsProjectLauncherOpen(false);
  };

  return {
    handleSelectProjectAndLaunchChat,
    handleCreateProject,
  };
}
