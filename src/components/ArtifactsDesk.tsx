import React, { useState } from 'react';
import { Project, Artifact, AbstractionLevel, ArtifactVersion } from '../types';
import { getArtifactTokenVariants, getTokenColor, getArtifactTextAtLevel } from '../utils/tokenCalculator';
import { serializeArtifactToYamlDoc } from '../utils/yamlArtifactParser';
import {
  Layers,
  Sliders,
  Eye,
  Edit3,
  ArrowLeft,
  Check,
  FileText,
  FileCode,
  History,
  GitCompare,
  RotateCcw,
  Copy,
  Download,
  Share2,
  Network,
} from 'lucide-react';

interface ArtifactsDeskProps {
  project: Project;
  selectedArtifact: Artifact | null;
  onSelectArtifact: (art: Artifact) => void;
  onUpdateArtifactResolution: (artifactId: string, resolution: AbstractionLevel) => void;
  onUpdateArtifactContent: (artifactId: string, newContent: string) => void;
  onRestoreArtifactVersion: (artifactId: string, targetVersion: ArtifactVersion) => void;
}

export const ArtifactsDesk: React.FC<ArtifactsDeskProps> = ({
  project,
  selectedArtifact,
  onSelectArtifact,
  onUpdateArtifactResolution,
  onUpdateArtifactContent,
  onRestoreArtifactVersion,
}) => {
  // Tabs: 'doc' (rich readable) | 'yaml' (single-file YAML+MD source) | 'history' (diffs & rollback) | 'graph' (topology)
  const [activeTab, setActiveTab] = useState<'doc' | 'yaml' | 'history' | 'graph'>('doc');
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [showDiffInline, setShowDiffInline] = useState(true);
  const [copiedYaml, setCopiedYaml] = useState(false);
  const [selectedHistoryVersion, setSelectedHistoryVersion] = useState<number | null>(null);

  const currentArtifact = selectedArtifact || project.artifacts[0] || null;

  const levels: AbstractionLevel[] = ['title', 'description', 'summary', 'full'];
  const getSliderIndex = (res: AbstractionLevel) => {
    if (res === 'excluded') return -1;
    return levels.indexOf(res);
  };

  const getLevelLabel = (lvl: AbstractionLevel) => {
    switch (lvl) {
      case 'excluded':
        return 'Excluded (0 tokens)';
      case 'title':
        return 'Title Only (~2% tokens)';
      case 'description':
        return 'Description (~10% tokens)';
      case 'summary':
        return 'Summary (~25% tokens)';
      case 'full':
        return 'Full Document (100% tokens)';
    }
  };

  const yamlSource = currentArtifact ? serializeArtifactToYamlDoc(currentArtifact) : '';

  const handleCopyYaml = () => {
    navigator.clipboard.writeText(yamlSource);
    setCopiedYaml(true);
    setTimeout(() => setCopiedYaml(false), 2000);
  };

  const handleDownloadYaml = () => {
    if (!currentArtifact) return;
    const blob = new Blob([yamlSource], { type: 'text/yaml;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentArtifact.code || currentArtifact.id}.markbrain.yaml`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Compute a simple line-by-line diff between previous version and current version
  const renderDiff = (prevContent: string, currentContent: string) => {
    const prevLines = prevContent.split('\n');
    const currLines = currentContent.split('\n');

    return (
      <div className="font-mono text-[11px] leading-relaxed bg-[#0a0e17] p-3 rounded-xl border border-[#080d15] overflow-x-auto space-y-0.5">
        <div className="text-[10px] text-[#7d93b3] mb-2 font-sans font-semibold">
          Opt-in Change Diff: Red (-) Before • Green (+) After
        </div>
        {currLines.map((line, idx) => {
          const isAdded = !prevLines.includes(line);
          return (
            <div
              key={idx}
              className={`px-1.5 py-0.5 rounded ${
                isAdded ? 'bg-[#102e1c] text-[#6ee7b7]' : 'text-[#c2d1e0]'
              }`}
            >
              <span className="text-[#4b5563] select-none mr-2">{idx + 1}</span>
              {isAdded ? '+ ' : '  '}
              {line}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="flex flex-col md:flex-row h-full bg-[#0d121c] text-[#e3edf7] overflow-hidden">
      {/* Left List of Artifacts */}
      <div
        className={`w-full md:w-80 lg:w-96 shrink-0 border-r border-[#080d15] flex flex-col h-full bg-[#101724] ${
          mobileDetailOpen ? 'hidden md:flex' : 'flex'
        }`}
      >
        <div className="p-3 border-b border-[#080d15] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-[#e05a66]" />
            <span className="font-bold text-xs uppercase tracking-wider text-[#eef4fc] font-mono">
              YAML Artifacts
            </span>
          </div>
          <span className="text-[10px] font-mono text-[#8ab1e0] bg-[#172133] px-2 py-0.5 rounded-full">
            {project.artifacts.length} Active
          </span>
        </div>

        {/* List Items */}
        <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
          {project.artifacts.map((art) => {
            const isSelected = currentArtifact?.id === art.id;
            const tokenVariants = getArtifactTokenVariants(art);
            const tokenColor = getTokenColor(tokenVariants.current);
            const versionCount = art.history?.length || 1;

            return (
              <div
                key={art.id}
                onClick={() => {
                  onSelectArtifact(art);
                  setMobileDetailOpen(true);
                }}
                className={`p-3 rounded-xl border transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-[#182338] border-[#e05a66] shadow-sm'
                    : 'bg-[#131b29] border-[#080d15] hover:border-[#1d293d]'
                }`}
              >
                {/* Header */}
                <div className="flex items-start justify-between gap-1 mb-1">
                  <div className="font-semibold text-xs text-[#eef4fc] truncate flex-1">
                    {art.title}
                  </div>
                  <span className="text-[9px] px-1.5 py-0.2 rounded bg-[#101929] text-[#8ab1e0] font-mono border border-[#090e18] shrink-0">
                    v{versionCount}
                  </span>
                </div>

                {/* Slug code & Category */}
                <div className="flex items-center gap-1.5 text-[10px] font-mono text-[#788fa8] mb-1">
                  <span className="text-[#e05a66]">#{art.code || art.id}</span>
                  <span>•</span>
                  <span className="capitalize">{art.category || art.type}</span>
                </div>

                {/* Token cost */}
                <div className="flex items-center justify-between text-[10px] font-mono text-[#788fa8]">
                  <span>{art.graph?.is_high_concept ? 'High Concept' : 'Detail Node'}</span>
                  <span className={`font-semibold ${tokenColor.textClass}`}>
                    {tokenVariants.current} tkns ({art.resolution})
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Right Detail / Editor Panel */}
      <div
        className={`flex-1 flex flex-col h-full bg-[#0d121c] overflow-hidden ${
          !mobileDetailOpen ? 'hidden md:flex' : 'flex'
        }`}
      >
        {currentArtifact ? (
          <>
            {/* Top Bar for Selected Artifact */}
            <div className="p-3 bg-[#111826] border-b border-[#080d15] flex items-center justify-between gap-2 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <button
                  onClick={() => setMobileDetailOpen(false)}
                  className="md:hidden p-1 rounded-lg hover:bg-[#1a2538] text-[#869ab8]"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono text-[#e05a66] uppercase font-bold">
                      Specification:
                    </span>
                    <span className="text-xs font-mono text-[#8ab1e0] bg-[#162236] px-1.5 py-0.2 rounded">
                      #{currentArtifact.code || currentArtifact.id}
                    </span>
                  </div>
                  <h2 className="text-sm font-bold text-[#eef4fc] truncate">
                    {currentArtifact.title}
                  </h2>
                </div>
              </div>

              {/* View Switchers */}
              <div className="flex items-center gap-1 shrink-0 bg-[#0d121c] p-1 rounded-xl border border-[#080d15]">
                <button
                  onClick={() => setActiveTab('doc')}
                  className={`px-2 py-1 rounded-lg text-xs font-mono transition-all flex items-center gap-1 ${
                    activeTab === 'doc'
                      ? 'bg-[#18253b] text-[#8ab1e0] font-bold'
                      : 'text-[#627794] hover:text-[#9bb0d1]'
                  }`}
                  title="Document view"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Doc</span>
                </button>

                <button
                  onClick={() => setActiveTab('yaml')}
                  className={`px-2 py-1 rounded-lg text-xs font-mono transition-all flex items-center gap-1 ${
                    activeTab === 'yaml'
                      ? 'bg-[#18253b] text-[#e05a66] font-bold'
                      : 'text-[#627794] hover:text-[#9bb0d1]'
                  }`}
                  title="Single-File YAML+MD"
                >
                  <FileCode className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">YAML+MD</span>
                </button>

                <button
                  onClick={() => setActiveTab('history')}
                  className={`px-2 py-1 rounded-lg text-xs font-mono transition-all flex items-center gap-1 ${
                    activeTab === 'history'
                      ? 'bg-[#18253b] text-[#6ee7b7] font-bold'
                      : 'text-[#627794] hover:text-[#9bb0d1]'
                  }`}
                  title="Version history and diffs"
                >
                  <History className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">History</span>
                </button>

                <button
                  onClick={() => setActiveTab('graph')}
                  className={`px-2 py-1 rounded-lg text-xs font-mono transition-all flex items-center gap-1 ${
                    activeTab === 'graph'
                      ? 'bg-[#18253b] text-[#fcd34d] font-bold'
                      : 'text-[#627794] hover:text-[#9bb0d1]'
                  }`}
                  title="Graph relationships"
                >
                  <Network className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Graph</span>
                </button>
              </div>
            </div>

            {/* Abstraction Slider Header Banner */}
            <div className="p-3 bg-[#141b29] border-b border-[#080d15] shrink-0">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
                <div>
                  <div className="text-xs font-semibold text-[#eef4fc] flex items-center gap-1.5 font-mono">
                    <Sliders className="w-3.5 h-3.5 text-[#e05a66]" />
                    <span>Chat Context Memory Slider:</span>
                    <strong className="text-[#f28894] uppercase font-bold">
                      {getLevelLabel(currentArtifact.resolution)}
                    </strong>
                  </div>
                  <p className="text-[11px] text-[#788fa8] mt-0.5">
                    Controls what portion of this YAML+MD specification enters the LLM prompt window.
                  </p>
                </div>

                <div className="font-mono text-xs text-[#8ab1e0] font-bold shrink-0">
                  {getArtifactTokenVariants(currentArtifact).current} tokens consumed
                </div>
              </div>

              {/* 5-Step Slider */}
              <div className="space-y-1">
                <input
                  type="range"
                  min="-1"
                  max="3"
                  step="1"
                  value={getSliderIndex(currentArtifact.resolution)}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    if (val === -1) {
                      onUpdateArtifactResolution(currentArtifact.id, 'excluded');
                    } else {
                      onUpdateArtifactResolution(currentArtifact.id, levels[val]);
                    }
                  }}
                  className="w-full accent-[#e05a66] h-2 bg-[#0e1421] rounded-lg cursor-pointer"
                />

                <div className="flex justify-between text-[9px] font-mono text-[#627794]">
                  <span className={currentArtifact.resolution === 'excluded' ? 'text-[#e05a66] font-bold' : ''}>
                    0. Exclude
                  </span>
                  <span className={currentArtifact.resolution === 'title' ? 'text-[#8ab1e0] font-bold' : ''}>
                    1. Title
                  </span>
                  <span className={currentArtifact.resolution === 'description' ? 'text-[#8ab1e0] font-bold' : ''}>
                    2. Description
                  </span>
                  <span className={currentArtifact.resolution === 'summary' ? 'text-[#8ab1e0] font-bold' : ''}>
                    3. Summary
                  </span>
                  <span className={currentArtifact.resolution === 'full' ? 'text-[#10b981] font-bold' : ''}>
                    4. Full (100%)
                  </span>
                </div>
              </div>
            </div>

            {/* Panel Tab Body */}
            <div className="flex-1 overflow-y-auto p-3 sm:p-5">
              {/* TAB 1: Clean Formatted Document View */}
              {activeTab === 'doc' && (
                <div className="max-w-3xl mx-auto space-y-4">
                  {/* Metadata Header Cards */}
                  <div className="bg-[#121926] p-3.5 rounded-xl border border-[#080d15] space-y-2">
                    <div>
                      <span className="text-[10px] font-mono text-[#8ab1e0] uppercase font-bold">
                        Short Description
                      </span>
                      <p className="text-xs text-[#c2d1e0] mt-0.5 leading-relaxed">
                        {currentArtifact.description}
                      </p>
                    </div>

                    <div className="pt-2 border-t border-[#090e18]">
                      <span className="text-[10px] font-mono text-[#e05a66] uppercase font-bold">
                        Contents Summary (Executive Abstract)
                      </span>
                      <p className="text-xs text-[#9bb0d1] mt-0.5 leading-relaxed">
                        {currentArtifact.summary}
                      </p>
                    </div>

                    {/* Tags row */}
                    {currentArtifact.tags && currentArtifact.tags.length > 0 && (
                      <div className="pt-2 border-t border-[#090e18]">
                        <span className="text-[10px] font-mono text-[#d48a37] uppercase font-bold block mb-1">
                          Tags (YAML Cross-Linking)
                        </span>
                        <div className="flex flex-wrap gap-1.5">
                          {currentArtifact.tags.map((tag) => (
                            <span
                              key={tag}
                              className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[#162236] text-[#8ab1e0] border border-[#090e18]"
                            >
                              #{tag}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Markdown Body */}
                  <div className="bg-[#0e1421] p-4 rounded-xl border border-[#080d15]">
                    <div className="text-[10px] font-mono text-[#627794] mb-3 pb-2 border-b border-[#080d15] flex items-center justify-between">
                      <span>Full Markdown Specification Body</span>
                      <span>v{currentArtifact.history?.length || 1} Active</span>
                    </div>

                    <div className="prose prose-invert max-w-none text-xs sm:text-sm text-[#d6e2f0] leading-relaxed whitespace-pre-wrap font-sans">
                      {currentArtifact.content}
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: Raw Single-File YAML + Markdown Source */}
              {activeTab === 'yaml' && (
                <div className="max-w-3xl mx-auto space-y-3">
                  <div className="flex items-center justify-between text-xs font-mono text-[#869ab8] pb-1">
                    <span>Single-File YAML Frontmatter + Markdown</span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleCopyYaml}
                        className="px-2.5 py-1 rounded bg-[#172236] hover:bg-[#202f4a] text-[#8ab1e0] text-xs flex items-center gap-1 cursor-pointer transition-colors"
                      >
                        {copiedYaml ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{copiedYaml ? 'Copied' : 'Copy Document'}</span>
                      </button>

                      <button
                        onClick={handleDownloadYaml}
                        className="px-2.5 py-1 rounded bg-[#172236] hover:bg-[#202f4a] text-[#e05a66] text-xs flex items-center gap-1 cursor-pointer transition-colors"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Download</span>
                      </button>
                    </div>
                  </div>

                  <pre className="font-mono text-xs text-[#c2d1e0] bg-[#090d15] p-4 rounded-xl border border-[#080d15] overflow-x-auto leading-relaxed select-all">
                    {yamlSource}
                  </pre>
                </div>
              )}

              {/* TAB 3: Version History, Diffs, and Rollback */}
              {activeTab === 'history' && (
                <div className="max-w-3xl mx-auto space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-xs font-bold font-mono text-[#eef4fc] uppercase flex items-center gap-1.5">
                        <History className="w-3.5 h-3.5 text-[#6ee7b7]" />
                        Recorded Modifications Safety Net
                      </h3>
                      <p className="text-[11px] text-[#7d93b3]">
                        No blocking approval gates: Changes write immediately, with non-destructive version rollbacks.
                      </p>
                    </div>

                    <button
                      onClick={() => setShowDiffInline(!showDiffInline)}
                      className="px-2.5 py-1 rounded bg-[#162235] text-[#8ab1e0] text-xs font-mono flex items-center gap-1 hover:bg-[#1d2d47]"
                    >
                      <GitCompare className="w-3.5 h-3.5" />
                      <span>{showDiffInline ? 'Hide Diffs' : 'Opt-in Diff View'}</span>
                    </button>
                  </div>

                  {/* Versions List */}
                  <div className="space-y-3">
                    {currentArtifact.history && currentArtifact.history.length > 0 ? (
                      currentArtifact.history.map((ver, idx) => {
                        const isLatest = idx === (currentArtifact.history?.length || 1) - 1;

                        return (
                          <div
                            key={ver.version}
                            className={`p-3.5 rounded-xl border space-y-2 ${
                              isLatest
                                ? 'bg-[#142033] border-[#080d15]'
                                : 'bg-[#101724] border-[#080d15]'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-xs font-bold text-[#eef4fc]">
                                  v{ver.version}
                                </span>
                                {isLatest && (
                                  <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-[#102e1c] text-[#6ee7b7] border border-[#0a2013] font-bold">
                                    CURRENT ACTIVE
                                  </span>
                                )}
                                <span className="text-[10px] text-[#7d93b3] font-mono">
                                  {new Date(ver.timestamp).toLocaleString()}
                                </span>
                              </div>

                              {!isLatest && (
                                <button
                                  onClick={() => onRestoreArtifactVersion(currentArtifact.id, ver)}
                                  className="px-2.5 py-1 rounded bg-[#e05a66]/20 hover:bg-[#e05a66] text-[#f28894] hover:text-white text-xs font-mono font-medium transition-all flex items-center gap-1 cursor-pointer"
                                  title="Mark this previous version as current without deleting history"
                                >
                                  <RotateCcw className="w-3 h-3" />
                                  <span>Undo & Restore This Version</span>
                                </button>
                              )}
                            </div>

                            <p className="text-xs text-[#b8cce6] font-mono bg-[#0c121e] p-2 rounded-lg border border-[#080d15]">
                              {ver.changeSummary}
                            </p>

                            {/* Diff View if opt-in */}
                            {showDiffInline && ver.previousContent && (
                              <div className="mt-2">
                                {renderDiff(ver.previousContent, ver.content)}
                              </div>
                            )}
                          </div>
                        );
                      })
                    ) : (
                      <div className="text-xs text-[#7d93b3] p-3 bg-[#111724] rounded-xl">
                        No previous versions recorded yet. Initial baseline is active.
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* TAB 4: Graph Topology */}
              {activeTab === 'graph' && (
                <div className="max-w-3xl mx-auto space-y-4">
                  <div className="bg-[#121926] p-4 rounded-xl border border-[#080d15] space-y-3">
                    <h3 className="text-xs font-bold font-mono text-[#fcd34d] uppercase flex items-center gap-1.5">
                      <Network className="w-3.5 h-3.5" />
                      Spatial Graph Links & Relationships
                    </h3>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs font-mono">
                      <div className="p-2.5 bg-[#0e1421] rounded-lg border border-[#080d15]">
                        <span className="text-[10px] text-[#7d93b3] block mb-1">Parent Node:</span>
                        <span className="text-[#8ab1e0] font-semibold">
                          {currentArtifact.graph?.parent || 'None (Root Node)'}
                        </span>
                      </div>

                      <div className="p-2.5 bg-[#0e1421] rounded-lg border border-[#080d15]">
                        <span className="text-[10px] text-[#7d93b3] block mb-1">Boundary Scope:</span>
                        <span className="text-[#e05a66] font-semibold">
                          {currentArtifact.graph?.is_high_concept ? 'High-Concept (Cross-Repo Bridge)' : 'Detail Node (Repo-Bounded)'}
                        </span>
                      </div>
                    </div>

                    <div className="p-2.5 bg-[#0e1421] rounded-lg border border-[#080d15] text-xs font-mono">
                      <span className="text-[10px] text-[#7d93b3] block mb-1">Child Nodes:</span>
                      {currentArtifact.graph?.children && currentArtifact.graph.children.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5 mt-1">
                          {currentArtifact.graph.children.map((c) => (
                            <span key={c} className="px-2 py-0.5 rounded bg-[#172235] text-[#8ab1e0]">
                              #{c}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-[#52657e]">No child nodes declared.</span>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex items-center justify-center h-full text-xs text-[#788fa8]">
            Select an artifact from the specification deck to inspect its YAML and Markdown contents.
          </div>
        )}
      </div>
    </div>
  );
};
