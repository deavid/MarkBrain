import React, { useState } from 'react';
import { Project, Artifact, Chapter, AbstractionLevel } from '../types';
import {
  computeTokenBreakdown,
  getTokenColor,
  getArtifactTextAtLevel,
  estimateTokens,
} from '../utils/tokenCalculator';
import {
  Sliders,
  Layers,
  BookOpen,
  Sparkles,
  X,
  Gauge,
} from 'lucide-react';

interface ContextInspectorProps {
  project: Project;
  onClose?: () => void;
  onUpdateAllArtifactsResolution: (level: AbstractionLevel) => void;
  onUpdateArtifactResolution: (artifactId: string, level: AbstractionLevel) => void;
  onToggleChapterCompression: (chapterId: string) => void;
}

export const ContextInspector: React.FC<ContextInspectorProps> = ({
  project,
  onClose,
  onUpdateAllArtifactsResolution,
  onUpdateArtifactResolution,
}) => {
  const [activeTab, setActiveTab] = useState<'budget' | 'payload'>('budget');

  const breakdown = computeTokenBreakdown(
    project.artifacts,
    project.chapters,
    project.currentChapterId
  );

  const overallColor = getTokenColor(breakdown.totalTokens);
  const artifactsColor = getTokenColor(breakdown.artifactsTokens);
  const activeChapterColor = getTokenColor(breakdown.activeChapterTokens);
  const olderChaptersColor = getTokenColor(breakdown.olderChaptersTokens);

  // Compile exact raw string that will be sent
  const compiledArtifactsString = project.artifacts
    .map((art) => getArtifactTextAtLevel(art, art.resolution))
    .filter((s) => s.trim().length > 0)
    .join('\n\n');

  const activeChap = project.chapters.find((c) => c.id === project.currentChapterId);
  const activeChapString = activeChap
    ? activeChap.messages.map((m) => `${m.role}: ${m.content}`).join('\n')
    : '';

  const olderChapSummaries = project.chapters
    .filter((c) => c.id !== project.currentChapterId)
    .map(
      (c) =>
        `[Chapter: ${c.title}]\nSummary: ${c.summary || '(unsummarized)'}\nInvariants: ${(c.keyPoints || []).join('; ')}`
    )
    .join('\n\n');

  const fullCompiledPrompt = `System Persona: MarkBrain\nProject: ${project.name} (${project.codeName})\n\n--- PREVIOUS CHAPTER SUMMARIES ---\n${olderChapSummaries}\n\n--- ACTIVE IN-MEMORY ARTIFACTS ---\n${compiledArtifactsString}\n\n--- CONVERSATION TRANSCRIPT ---\n${activeChapString}`;

  // Color Spectrum tiers reference with low-saturation OKLCH tones
  const tiers = [
    { label: '≤16k Blue', color: 'blue', hex: '#5d87b8', bg: 'bg-[#152033]', text: 'text-[#8ab1e0]' },
    { label: '32k Cyan', color: 'cyan', hex: '#4f99a3', bg: 'bg-[#14262b]', text: 'text-[#7ec6cf]' },
    { label: '64k Green', color: 'green', hex: '#5b9c73', bg: 'bg-[#16291c]', text: 'text-[#88c9a0]' },
    { label: '128k Yellow', color: 'yellow', hex: '#b89047', bg: 'bg-[#2b2212]', text: 'text-[#e0b96c]' },
    { label: '256k Orange', color: 'orange', hex: '#c46e43', bg: 'bg-[#2e1a12]', text: 'text-[#e89468]' },
    { label: '512k Red', color: 'red', hex: '#d44c58', bg: 'bg-[#2e1215]', text: 'text-[#f07a84]' },
  ];

  return (
    <div className="h-full flex flex-col bg-[#0d121c] text-[#e3edf7] overflow-hidden">
      {/* Header */}
      <div className="p-3.5 border-b border-[#080d15] flex items-center justify-between gap-3 bg-[#111826] shrink-0">
        <div className="flex items-center gap-2">
          <Gauge className="w-5 h-5 text-[#e05a66]" />
          <div>
            <h2 className="font-bold text-sm text-[#eef4fc]">
              Context Abstraction & Token Footprint Ledger
            </h2>
            <p className="text-[11px] text-[#788fa8]">
              Inspection of prompt resolution, token cost allocation, and color hierarchy
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center bg-[#0e1421] p-1 rounded-xl border border-[#080d15] text-xs">
            <button
              onClick={() => setActiveTab('budget')}
              className={`px-3 py-1 rounded-lg font-medium transition-colors ${
                activeTab === 'budget' ? 'bg-[#291418] text-[#f28894] font-semibold' : 'text-[#788fa8] hover:text-white'
              }`}
            >
              Token Ledger
            </button>
            <button
              onClick={() => setActiveTab('payload')}
              className={`px-3 py-1 rounded-lg font-medium transition-colors ${
                activeTab === 'payload' ? 'bg-[#291418] text-[#f28894] font-semibold' : 'text-[#788fa8] hover:text-white'
              }`}
            >
              Raw LLM Context
            </button>
          </div>

          {onClose && (
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg bg-[#141b29] hover:bg-[#1f2d45] text-[#9bb0d1]"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 max-w-4xl mx-auto w-full">
        {activeTab === 'budget' ? (
          <>
            {/* Total Context Footprint Card */}
            <div
              className={`p-5 rounded-2xl border ${overallColor.bgClass} ${overallColor.borderClass} shadow-lg`}
            >
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                  <span className="text-xs font-mono uppercase tracking-wider text-[#9e90ad] block mb-1">
                    Total Active Memory Footprint
                  </span>
                  <div className="flex items-baseline gap-3">
                    <span className={`text-3xl sm:text-4xl font-extrabold font-mono ${overallColor.textClass}`}>
                      {breakdown.totalTokens.toLocaleString()}
                    </span>
                    <span className="text-[#8c7d9e] text-xs sm:text-sm font-sans font-medium">
                      tokens / 1M window
                    </span>
                  </div>
                  <div className="text-xs text-[#d1c5db] mt-1.5 flex items-center gap-2">
                    <div
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: overallColor.hex }}
                    />
                    <span>Tier: <strong>{overallColor.name}</strong></span>
                    <span className="text-[#594c69]">•</span>
                    <span className="text-[#998da3]">{overallColor.description}</span>
                  </div>
                </div>

                {/* Preset Switcher */}
                <div className="bg-[#181421] p-3 rounded-xl border border-[#0d0914] text-xs shrink-0">
                  <span className="text-[10px] font-mono text-[#8f829e] block mb-1.5">
                    Master Abstraction Strategy
                  </span>
                  <div className="flex items-center gap-1">
                    {(['title', 'description', 'summary', 'full'] as AbstractionLevel[]).map((lvl) => (
                      <button
                        key={lvl}
                        onClick={() => onUpdateAllArtifactsResolution(lvl)}
                        className="px-2.5 py-1 rounded-md bg-[#251f2e] hover:bg-[#432d57] text-[#cbbdd9] hover:text-white text-[11px] font-mono capitalize transition-colors"
                      >
                        {lvl}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Color Hierarchy Spectrum */}
              <div className="mt-5 pt-4 border-t border-[#0d0914]">
                <div className="text-[10px] font-mono text-[#8f829e] uppercase tracking-wider mb-2 flex items-center justify-between">
                  <span>Color Hierarchy (16k to 512k):</span>
                  <span>Blue → Cyan → Green → Yellow → Orange → Red</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
                  {tiers.map((t) => (
                    <div
                      key={t.label}
                      className={`p-2 rounded-lg border text-center transition-all ${
                        overallColor.tier === t.label.split(' ')[0]
                          ? `${t.bg} border-[#baa3cc] shadow-md`
                          : 'bg-[#15121c] border-[#0d0914] opacity-60'
                      }`}
                    >
                      <div
                        className="w-2 h-2 rounded-full mx-auto mb-1"
                        style={{ backgroundColor: t.hex }}
                      />
                      <div className={`text-[10px] font-mono font-bold ${t.text}`}>
                        {t.label}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Breakdown Cards */}
            <div>
              <h3 className="font-bold text-xs uppercase tracking-wider text-[#9e90ad] mb-3 font-mono">
                Token Cost Breakdown by Group
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="bg-[#181421] p-4 rounded-xl border border-[#0d0914] flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between text-xs text-[#8f829e] mb-1">
                      <span className="flex items-center gap-1.5 font-medium text-[#d9cde3]">
                        <Layers className="w-3.5 h-3.5 text-[#b88ec7]" />
                        Artifacts Memory
                      </span>
                      <span className={`font-mono text-[10px] ${artifactsColor.textClass}`}>
                        {artifactsColor.tier}
                      </span>
                    </div>
                    <div className="text-2xl font-bold font-mono text-white mt-1">
                      {breakdown.artifactsTokens.toLocaleString()}
                    </div>
                    <p className="text-[11px] text-[#8f829e] mt-1">
                      {project.artifacts.filter((a) => a.resolution !== 'excluded').length} of {project.artifacts.length} artifacts active
                    </p>
                  </div>
                  <div className="mt-3 pt-2 border-t border-[#0d0914] text-[10px] text-[#7a6f87] font-mono">
                    {Math.round((breakdown.artifactsTokens / (breakdown.totalTokens || 1)) * 100)}% of total prompt
                  </div>
                </div>

                <div className="bg-[#181421] p-4 rounded-xl border border-[#0d0914] flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between text-xs text-[#8f829e] mb-1">
                      <span className="flex items-center gap-1.5 font-medium text-[#d9cde3]">
                        <BookOpen className="w-3.5 h-3.5 text-[#9e7cb5]" />
                        Active Chapter
                      </span>
                      <span className={`font-mono text-[10px] ${activeChapterColor.textClass}`}>
                        {activeChapterColor.tier}
                      </span>
                    </div>
                    <div className="text-2xl font-bold font-mono text-white mt-1">
                      {breakdown.activeChapterTokens.toLocaleString()}
                    </div>
                    <p className="text-[11px] text-[#8f829e] mt-1">
                      Current topic transcript
                    </p>
                  </div>
                  <div className="mt-3 pt-2 border-t border-[#0d0914] text-[10px] text-[#7a6f87] font-mono">
                    {Math.round((breakdown.activeChapterTokens / (breakdown.totalTokens || 1)) * 100)}% of total prompt
                  </div>
                </div>

                <div className="bg-[#181421] p-4 rounded-xl border border-[#0d0914] flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between text-xs text-[#8f829e] mb-1">
                      <span className="flex items-center gap-1.5 font-medium text-[#d9cde3]">
                        <Sparkles className="w-3.5 h-3.5 text-[#d6b769]" />
                        Older Chapters
                      </span>
                      <span className={`font-mono text-[10px] ${olderChaptersColor.textClass}`}>
                        {olderChaptersColor.tier}
                      </span>
                    </div>
                    <div className="text-2xl font-bold font-mono text-white mt-1">
                      {breakdown.olderChaptersTokens.toLocaleString()}
                    </div>
                    <p className="text-[11px] text-[#8f829e] mt-1">
                      Compressed into executive abstracts
                    </p>
                  </div>
                  <div className="mt-3 pt-2 border-t border-[#0d0914] text-[10px] text-[#7a6f87] font-mono">
                    {Math.round((breakdown.olderChaptersTokens / (breakdown.totalTokens || 1)) * 100)}% of total prompt
                  </div>
                </div>
              </div>
            </div>

            {/* Granular Sliders Table */}
            <div>
              <h3 className="font-bold text-xs uppercase tracking-wider text-[#9e90ad] mb-3 font-mono">
                Granular Abstraction Sliders by Artifact
              </h3>
              <div className="space-y-2">
                {project.artifacts.map((art) => {
                  const tokens = estimateTokens(getArtifactTextAtLevel(art, art.resolution));
                  const artColor = getTokenColor(tokens);

                  return (
                    <div
                      key={art.id}
                      className="p-3 bg-[#181421] rounded-xl border border-[#0d0914] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-xs text-[#f2ebf7] truncate">
                            {art.title}
                          </span>
                          {art.isHighConcept && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#2e2413] text-[#d6b769] font-mono">
                              ⭐ High Concept
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-[#8f829e] line-clamp-1 mt-0.5">
                          {art.description}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <div className="flex items-center bg-[#110e17] p-1 rounded-lg border border-[#0d0914] text-[11px]">
                          {(['excluded', 'title', 'description', 'summary', 'full'] as AbstractionLevel[]).map(
                            (lvl) => (
                              <button
                                key={lvl}
                                onClick={() => onUpdateArtifactResolution(art.id, lvl)}
                                className={`px-2 py-0.5 rounded font-mono capitalize transition-colors ${
                                  art.resolution === lvl
                                    ? lvl === 'excluded'
                                      ? 'bg-[#8c3e3e] text-white'
                                      : 'bg-[#5c3e78] text-[#f2e6fa] font-bold'
                                    : 'text-[#847794] hover:text-white'
                                }`}
                              >
                                {lvl === 'excluded' ? 'Stop' : lvl}
                              </button>
                            )
                          )}
                        </div>

                        <span className={`w-16 text-right font-mono text-xs font-bold ${artColor.textClass}`}>
                          {tokens} tkns
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs text-[#caa1e0] font-mono">
              <span>Exact Prompt Sent to LLM:</span>
              <span className="text-[#8c7e9c]">
                {fullCompiledPrompt.length} chars • ~{estimateTokens(fullCompiledPrompt)} tokens
              </span>
            </div>
            <pre className="p-4 bg-[#14101a] border border-[#0d0914] rounded-xl font-mono text-xs text-[#d1c5db] whitespace-pre-wrap leading-relaxed max-h-[500px] overflow-y-auto">
              {fullCompiledPrompt}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
};
