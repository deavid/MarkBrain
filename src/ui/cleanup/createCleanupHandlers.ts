import type { DomainContextValue } from '../../domains/DomainRegistry';
import type { IWorkspaceDomain } from '../../domains/00-workspace';
import type { CleanupPlan } from '../../application/cleanupPlan';
import type { ArtifactLifecycle } from '../../domains/01-artifact-document';
import { purgeArtifact } from '../../application/purgeArtifactEverywhere';
import { logger } from '../../utils/logger';

export interface CleanupHandlerParams {
  artifactsDomain: DomainContextValue['artifacts'];
  versioning: DomainContextValue['versioning'];
  graph: DomainContextValue['graph'];
  threadRegistry: DomainContextValue['threadRegistry'];
  /** REQUIRED for purgeArtifact — the VPS delete mutation (live 2026-10-30). */
  workspace: IWorkspaceDomain;
  /** Registry delete + live-domain swap (DomainRegistry.deleteThread). */
  deleteThread: (threadId: string) => void;
  triggerReRender: () => void;
  onArtifactPurged: (artifactId: string) => void;
}

export function createCleanupHandlers(params: CleanupHandlerParams) {
  const {
    artifactsDomain,
    versioning,
    graph,
    threadRegistry,
    workspace,
    deleteThread,
    triggerReRender,
    onArtifactPurged,
  } = params;

  const setThreadsLifecycle = (ids: string[], lifecycle: ArtifactLifecycle) => {
    ids.forEach((id) => threadRegistry.setThreadLifecycle(id, lifecycle));
    logger.action('App', `Cleanup: ${lifecycle} ${ids.length} chat(s)`);
    triggerReRender();
  };

  const setArtifactsLifecycle = (ids: string[], lifecycle: ArtifactLifecycle) => {
    ids.forEach((id) => artifactsDomain.setArtifactLifecycle(id, lifecycle));
    logger.action('App', `Cleanup: ${lifecycle} ${ids.length} artifact(s)`);
    triggerReRender();
  };

  const applyPlan = (plan: CleanupPlan) => {
    // Artifacts first: purging drops their attachments everywhere, so the chat
    // deletions that follow can never unload a live thread into a half-purged
    // reference. A plan that is already empty is a no-op by construction.
    plan.artifactsToDelete.forEach((id) => {
      purgeArtifact({ artifactsDomain, versioning, graph, threadRegistry, workspace }, id);
      onArtifactPurged(id);
    });
    [...plan.threadsToDelete, ...plan.cascadeThreads].forEach((id) => deleteThread(id));
    logger.action(
      'App',
      `Cleanup: permanently deleted ${plan.artifactsToDelete.length} artifact(s), ${plan.threadsToDelete.length + plan.cascadeThreads.length} chat(s)`
    );
    triggerReRender();
  };

  return { setThreadsLifecycle, setArtifactsLifecycle, applyPlan };
}
