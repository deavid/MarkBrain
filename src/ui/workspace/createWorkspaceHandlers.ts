import type { DomainContextValue } from '../../domains/DomainRegistry';
import type { ActiveView } from './Sidebar';

type WorkspaceContainer = NonNullable<ReturnType<DomainContextValue['workspace']['getProject']>>;

export interface WorkspaceHandlerParams {
  workspace: DomainContextValue['workspace'];
  currentContainer: WorkspaceContainer | null | undefined;
  triggerReRender: () => void;
  setActiveView: (view: ActiveView) => void;
  setIsProjectLauncherOpen: (open: boolean) => void;
  opticalMode: 'autofocus' | 'manual' | 'myopia';
}

// Workspace/project CRUD + optical-mode handlers.
// Moved verbatim from App.tsx — same names, same signatures.
export function createWorkspaceHandlers(params: WorkspaceHandlerParams) {
  const {
    workspace,
    currentContainer,
    triggerReRender,
    setActiveView,
    setIsProjectLauncherOpen,
    opticalMode,
  } = params;

  const setOpticalMode = (mode: 'autofocus' | 'manual' | 'myopia') => {
    if (currentContainer) {
      workspace.saveContainer({
        ...currentContainer,
        opticalMode: mode,
      });
      triggerReRender();
    }
  };

  const cycleOpticalMode = () => {
    const next =
      opticalMode === 'autofocus'
        ? 'manual'
        : opticalMode === 'manual'
        ? 'myopia'
        : 'autofocus';
    setOpticalMode(next);
  };

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
    setOpticalMode,
    cycleOpticalMode,
    handleSelectProjectAndLaunchChat,
    handleCreateProject,
  };
}
