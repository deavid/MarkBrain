/**
 * The one door an artifact leaves a project through.
 *
 * Five places hold a reference to an artifact id: surviving artifacts'
 * relationship edges, the semantic graph's edges, every thread's attachments,
 * the revision history, and the artifact map itself. Deleting out of the
 * artifact map alone leaves the other four pointing at a ghost.
 */
import type { IArtifactDocumentDomain } from '../../domains/01-artifact-document';
import type { IArtifactVersioningDomain } from '../../domains/01-artifact-versioning';
import type { ITopologicalGraphDomain } from '../../domains/02-topological-graph';
import type { ThreadRegistry } from '../../domains/06-chat-threads';
import type { Artifact } from '../../types';
import { serializeArtifactToYamlDoc } from '../../utils/yamlArtifactParser';

export interface PurgeDeps {
  artifactsDomain: IArtifactDocumentDomain;
  versioning: IArtifactVersioningDomain;
  graph: ITopologicalGraphDomain;
  threadRegistry: ThreadRegistry;
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
  artifactsDomain.deleteArtifact(artifactId);
}
