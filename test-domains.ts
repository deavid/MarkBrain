import assert from 'node:assert';
import { TopologicalGraphDomain } from './src/domains/02-topological-graph/TopologicalGraphDomain';
import { OpticalCompilerDomain } from './src/domains/03-optical-compiler/index';
import { ArtifactDocumentDomain } from './src/domains/01-artifact-document/ArtifactDocumentDomain';
import { ChapterSegmentationDomain } from './src/domains/02-chapter-segmentation/ChapterSegmentationDomain';
import { DialogueTimelineDomain } from './src/domains/01-dialogue-timeline/DialogueTimelineDomain';
import { StreamProtocolDomain, ExtractedArtifactUpsert, ExtractedTopicShift } from './src/domains/03-stream-protocol/index';
import { ArtifactVersioningDomain } from './src/domains/01-artifact-versioning/ArtifactVersioningDomain';

console.log('🧪 Running Domain Driven Design Architectural Unit Tests...');

// 1. Test Topological Graph BFS shortest hops
{
  const graph = new TopologicalGraphDomain();
  graph.addEdge('A', 'B', 'relates_to');
  graph.addEdge('B', 'C', 'relates_to');
  graph.addEdge('C', 'D', 'relates_to');

  assert.strictEqual(graph.getHopDistance('A', 'A'), 0, 'Self distance is 0');
  assert.strictEqual(graph.getHopDistance('A', 'B'), 1, '1-hop neighbor is 1');
  assert.strictEqual(graph.getHopDistance('A', 'C'), 2, '2-hop neighbor is 2');
  assert.strictEqual(graph.getHopDistance('A', 'D'), 3, '3-hop neighbor is 3');
  assert.strictEqual(graph.getHopDistance('A', 'Z'), Infinity, 'Unreachable node is Infinity');
  console.log('✅ 02-topological-graph: BFS distance assertions passed');
}

// 2. Test Stream Protocol Demuxing
{
  const stream = new StreamProtocolDomain();
  const raw = 'Hello world! <topic_shift title="Chapter 2: Physics" summary="Combat tick" /> <artifact_upsert id="art-1" title="Combat Spec"><abstract>120ms buffer</abstract><summary>Bullet 1</summary><content># Full Combat</content></artifact_upsert>';
  
  let upsertCaptured = false;
  let topicCaptured = false;

  stream.subscribe('onArtifactUpsertDetected', (art: ExtractedArtifactUpsert) => {
    assert.strictEqual(art.id, 'art-1');
    assert.strictEqual(art.content.t1_abstract, '120ms buffer');
    upsertCaptured = true;
  });

  stream.subscribe('onTopicShiftDetected', (shift: ExtractedTopicShift) => {
    assert.strictEqual(shift.title, 'Chapter 2: Physics');
    topicCaptured = true;
  });

  const parsed = stream.demuxFullTurn(raw);
  assert.strictEqual(parsed.cleanText, 'Hello world!', 'Stripped XML from visible prose');
  assert.strictEqual(upsertCaptured, true, 'Artifact upsert emitted via typed event');
  assert.strictEqual(topicCaptured, true, 'Topic shift emitted via typed event');
  console.log('✅ 03-stream-protocol: Streaming tag demuxer assertions passed');
}

// 3. Test Artifact Versioning append-only rollback
{
  const versioning = new ArtifactVersioningDomain();
  versioning.recordRevision('art-1', 'Initial Spec', 'v1 draft');
  versioning.recordRevision('art-1', 'Updated Spec', 'v2 update');
  assert.strictEqual(versioning.getLatestVersion('art-1'), 2);

  const restored = versioning.rollback('art-1', 1);
  assert.strictEqual(restored.version, 3, 'Non-destructive rollback creates Revision 3');
  assert.strictEqual(restored.content, 'Initial Spec', 'Restored content matches Revision 1');
  console.log('✅ 01-artifact-versioning: Append-only rollback assertions passed');
}

// 4. Test Optical Context Compiler with Mocked dependencies
{
  const graph = new TopologicalGraphDomain();
  graph.addEdge('focal-node', 'adjacent-node', 'relates_to');
  graph.addEdge('adjacent-node', 'distant-node', 'relates_to');

  const artifacts = new ArtifactDocumentDomain('test-workspace');
  artifacts.upsertArtifact({ id: 'focal-node', title: 'Focal Spec', current: { t0_label: 'Focal', t1_abstract: 'Focal abs', t2_summary: 'Focal sum', t3_body: '# Full Body Focal' } });
  artifacts.upsertArtifact({ id: 'adjacent-node', title: 'Adjacent Spec', current: { t0_label: 'Adj', t1_abstract: 'Adj abs', t2_summary: 'Adj sum', t3_body: '# Full Body Adj' } });
  artifacts.upsertArtifact({ id: 'distant-node', title: 'Distant Spec', current: { t0_label: 'Dist', t1_abstract: 'Dist abs', t2_summary: 'Dist sum', t3_body: '# Full Body Dist' } });

  const timeline = new DialogueTimelineDomain('test-workspace');
  const segmentation = new ChapterSegmentationDomain('test-workspace');
  segmentation.declareNewChapter('Chapter 1', 0);

  const compiler = new OpticalCompilerDomain(graph, artifacts, segmentation, timeline);
  const result = compiler.compile({ focalIds: ['focal-node'], opticalMode: 'autofocus' });

  assert.strictEqual(result.nodeTiers['focal-node'].tier, 3, 'Focal node is Tier 3 (Full Verbatim)');
  assert.strictEqual(result.nodeTiers['adjacent-node'].tier, 2, '1-hop neighbor is Tier 2 (Summary)');
  assert.strictEqual(result.nodeTiers['distant-node'].tier, 1, '2-hop neighbor is Tier 1 (Abstract)');

  assert(result.compiledPrompt.includes('tier="3" focus="true"'), 'Compiled XML has Tier 3 focal tag');
  assert(result.compiledPrompt.includes('tier="2" distance="1"'), 'Compiled XML has Tier 2 distance 1 tag');
  assert(result.compiledPrompt.includes('tier="1" distance="2"'), 'Compiled XML has Tier 1 distance 2 tag');
  console.log('✅ 03-optical-compiler: Depth-of-Field tier degradation assertions passed');
}

console.log('🎉 ALL DOMAIN-DRIVEN DESIGN ARCHITECTURE TESTS PASSED SUCCESSFULLY!');
