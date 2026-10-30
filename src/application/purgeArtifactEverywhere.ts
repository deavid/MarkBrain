/**
 * The one door an artifact leaves a project through — EVERYWHERE at once.
 * (Phase 4: moved out of src/ui — cross-domain deletion surgery is not the
 * UI's job; the UI handlers just call it.)
 *
 * Five places hold a reference to an artifact id: surviving artifacts'
 * relationship edges, the semantic graph's edges, every thread's attachments,
 * the revision history, and the artifact map itself. Deleting out of the
 * artifact map alone leaves the other four pointing at a ghost.
 */
import type { IArtifactDocumentDomain } from '../domains/01-artifact-document';
import type { IArtifactVersioningDomain } from '../domains/01-artifact-versioning';
import type { ITopologicalGraphDomain } from '../domains/02-topological-graph';
import type { ThreadRegistry } from '../domains/06-chat-threads';
import type { IWorkspaceDomain } from '../domains/00-workspace';
import type { Artifact } from '../types';
import { serializeArtifactToYamlDoc } from '../utils/yamlArtifactParser';
import { queueServerMutation } from './serverMutationQueue';

export interface PurgeDeps {
  artifactsDomain: IArtifactDocumentDomain;
  versioning: IArtifactVersioningDomain;
  graph: ITopologicalGraphDomain;
  threadRegistry: ThreadRegistry;
  workspace?: IWorkspaceDomain;
}

export function purgeArtifact(deps: PurgeDeps, artifactId: string): void {
  const { artifactsDomain, versioning, graph, threadRegistry } = deps;

  artifactsDomain.listArtifacts().forEach((a) => {
    const rels = a.graph?.relationships;
    if (!rels || !rels.some((r) => r.target === artifactId)) return;
    const next: Artifact = {
      ...a,
      graph: {
        ...(a.graph || {}),
        relationships: rels.filter((r) => r.target !== artifactId),
      },
    };
    artifactsDomain.upsertArtifact({
      ...next,
      ...(a.yamlDocument !== undefined ? { yamlDocument: serializeArtifactToYamlDoc(next) } : {}),
    });
  });

  graph.removeNode(artifactId);
  // Garbage collection, not a user-facing detach: every chat loses the reference.
  threadRegistry.purgeArtifact(artifactId);
  versioning.purgeArtifact(artifactId);
  // Explicit delete must reach the VPS — snapshot saves are upsert-only, so
  // without this the artifact resurrects on refresh (live 2026-10-26).
  if (deps.workspace) {
    queueServerMutation(deps.workspace.getActiveProjectId(), { op: 'deleteArtifact', artifactId });
  }
  artifactsDomain.deleteArtifact(artifactId);
}
