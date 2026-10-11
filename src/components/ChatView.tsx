import React, { useState, useRef, useEffect } from 'react';
import { Project, Chapter, ChatMessage, Artifact } from '../types';
import {
  Send,
  Sparkles,
  Volume2,
  VolumeX,
  FileCode,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Loader2,
  CornerDownRight,
  BookmarkPlus,
  Layers,
  Check,
  History,
  Sliders,
} from 'lucide-react';

interface ChatViewProps {
  project: Project;
  onSendMessage: (text: string) => Promise<void>;
  isLoading: boolean;
  onAddArtifactToProject: (artifact: Artifact) => void;
  onSummarizeChapter: (chapterId: string) => Promise<void>;
  onToggleChapterCompressionMode: (chapterId: string, mode: 'summary' | 'full' | 'dropped') => void;
  onDeclareChapter: (messageId: string, title: string, level: 1 | 2 | 3) => void;
  onNavigateToGraph: () => void;
}

export const ChatView: React.FC<ChatViewProps> = ({
  project,
  onSendMessage,
  isLoading,
  onAddArtifactToProject,
  onSummarizeChapter,
  onToggleChapterCompressionMode,
  onDeclareChapter,
  onNavigateToGraph,
}) => {
  const [inputText, setInputText] = useState('');
  const [showPrompts, setShowPrompts] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Audio / TTS State
  const [playingMessageId, setPlayingMessageId] = useState<string | null>(null);
  const [ttsLoadingId, setTtsLoadingId] = useState<string | null>(null);
  const [chosenVoice, setChosenVoice] = useState('Kore');
  const [voiceDropdownOpen, setVoiceDropdownOpen] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Accordion state for tree chapter folding
  const [collapsedChapterIds, setCollapsedChapterIds] = useState<Record<string, boolean>>({});
  const [expandedSummaryIds, setExpandedSummaryIds] = useState<Record<string, boolean>>({});

  // Inline "Declare Chapter / Subchapter" form state
  const [declaringMessageId, setDeclaringMessageId] = useState<string | null>(null);
  const [newChapterTitle, setNewChapterTitle] = useState('');
  const [newChapterLevel, setNewChapterLevel] = useState<1 | 2 | 3>(2);

  const toggleCollapseChapter = (id: string) => {
    setCollapsedChapterIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleExpandSummary = (id: string) => {
    setExpandedSummaryIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  // Auto-scroll on new message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [project.chapters, isLoading]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || isLoading) return;
    const msg = inputText;
    setInputText('');
    setShowPrompts(false);
    onSendMessage(msg);
  };

  // TTS Handler with explicit waiting indicator
  const handlePlayTTS = async (message: ChatMessage) => {
    if (playingMessageId === message.id) {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      setPlayingMessageId(null);
      return;
    }

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }

    setTtsLoadingId(message.id);

    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: message.content,
          voice: chosenVoice,
        }),
      });

      const data = await res.json();

      if (data.audioData) {
        const audioUrl = `data:${data.mimeType || 'audio/wav'};base64,${data.audioData}`;
        const audio = new Audio(audioUrl);
        audioRef.current = audio;
        audio.onended = () => {
          setPlayingMessageId(null);
          audioRef.current = null;
        };
        audio.onerror = () => {
          fallbackSpeech(data.cleanSpokenText || message.content, message.id);
        };
        await audio.play();
        setPlayingMessageId(message.id);
      } else {
        fallbackSpeech(data.cleanSpokenText || message.content, message.id);
      }
    } catch {
      fallbackSpeech(message.content, message.id);
    } finally {
      setTtsLoadingId(null);
    }
  };

  const fallbackSpeech = (text: string, msgId: string) => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(
        text.replace(/```[\s\S]*?```/g, '').slice(0, 1000)
      );
      utterance.rate = 1.0;
      utterance.pitch = 1.0;
      utterance.onend = () => setPlayingMessageId(null);
      utterance.onerror = () => setPlayingMessageId(null);
      window.speechSynthesis.speak(utterance);
      setPlayingMessageId(msgId);
    } else {
      setPlayingMessageId(null);
    }
  };

  const handleDeclareSubmit = (msgId: string) => {
    if (!newChapterTitle.trim()) return;
    onDeclareChapter(msgId, newChapterTitle.trim(), newChapterLevel);
    setDeclaringMessageId(null);
    setNewChapterTitle('');
  };

  return (
    <div className="flex flex-col h-full bg-[#0d121c] text-[#e3edf7] select-text overflow-hidden">
      {/* Top Bar with Project Focus & Audio Voice Switcher */}
      <div className="px-3 sm:px-4 py-2 border-b border-[#080d15] bg-[#0d121c] flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="w-2.5 h-2.5 rounded-full shrink-0"
            style={{ backgroundColor: project.color }}
          />
          <div className="min-w-0">
            <span className="text-xs font-bold text-[#eef4fc] font-mono truncate block">
              {project.name}
            </span>
            <span className="text-[10px] text-[#7d93b3] font-mono block truncate">
              Continuous Timeline • {project.chapters.length} Tree Chapters
            </span>
          </div>
        </div>

        {/* Audio TTS Voice Selector */}
        <div className="relative shrink-0">
          <button
            onClick={() => setVoiceDropdownOpen(!voiceDropdownOpen)}
            className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-[#121927] border border-[#090e18] text-[10px] font-mono text-[#8ab1e0] hover:bg-[#182236] transition-colors"
          >
            <Volume2 className="w-3 h-3 text-[#e05a66]" />
            <span>Voice: {chosenVoice}</span>
            <ChevronDown className="w-2.5 h-2.5" />
          </button>

          {voiceDropdownOpen && (
            <div className="absolute right-0 top-full mt-1 w-32 bg-[#111724] border border-[#080c14] rounded-xl shadow-xl p-1 z-30 space-y-0.5">
              {['Kore', 'Puck', 'Fenrir', 'Zephyr'].map((v) => (
                <button
                  key={v}
                  onClick={() => {
                    setChosenVoice(v);
                    setVoiceDropdownOpen(false);
                  }}
                  className={`w-full text-left px-2 py-1 rounded-md text-[11px] font-mono transition-colors ${
                    chosenVoice === v
                      ? 'bg-[#e05a66]/20 text-[#f28894] font-bold'
                      : 'text-[#9bb0d1] hover:bg-[#182133]'
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Unified Vertical Chat Feed with Inline 3-Level Tree Chapters */}
      <div className="flex-1 overflow-y-auto p-3 sm:p-5 space-y-4">
        {project.chapters.map((chapter, chapterIndex) => {
          const level = chapter.level || 1;
          const isCollapsed = collapsedChapterIds[chapter.id] ?? false;
          const isSummaryExpanded = expandedSummaryIds[chapter.id] ?? false;
          const compression = chapter.compressionMode || (chapter.isSummarized ? 'summary' : 'full');

          // Tree indentation visual
          const indentClass =
            level === 1
              ? 'pl-0'
              : level === 2
              ? 'pl-3 sm:pl-5 border-l border-[#121927] ml-1'
              : 'pl-6 sm:pl-8 border-l border-[#152033] ml-2';

          return (
            <div key={chapter.id} className={`space-y-3 ${indentClass}`}>
              {/* Compact Vertical Chapter / Subchapter Divider */}
              <div className="relative my-2 sm:my-3">
                <div className="bg-[#111724] border border-[#090e18] rounded-xl p-2.5 sm:p-3 shadow-sm">
                  {/* Header Row */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      {level === 1 ? (
                        <span className="w-2 h-2 rounded-full bg-[#e05a66] shrink-0" />
                      ) : level === 2 ? (
                        <CornerDownRight className="w-3.5 h-3.5 text-[#8ab1e0] shrink-0" />
                      ) : (
                        <span className="text-[10px] text-[#6c82a1] font-mono font-bold shrink-0">§</span>
                      )}

                      <span className="text-[10px] font-mono text-[#8ab1e0] uppercase tracking-wider shrink-0 font-bold">
                        {level === 1 ? 'Chapter' : level === 2 ? 'Subchapter' : 'Section'}
                      </span>

                      <span className="font-semibold text-xs sm:text-sm text-[#eef4fc] truncate font-mono">
                        {chapter.title}
                      </span>

                      {chapter.topicShiftReason && (
                        <span className="text-[9px] px-1.5 py-0.2 rounded bg-[#1e1014] text-[#f28894] font-mono border border-[#2b1016] shrink-0">
                          Shift
                        </span>
                      )}
                    </div>

                    {/* Actions: Collapse Chapter, Toggle Summary */}
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => toggleExpandSummary(chapter.id)}
                        className={`px-2 py-0.5 rounded text-[10px] font-mono transition-colors border ${
                          isSummaryExpanded
                            ? 'bg-[#182337] text-[#8ab1e0] border-[#0c1421]'
                            : 'bg-[#0d121c] text-[#6c82a1] border-[#080d16] hover:text-[#9bb0d1]'
                        }`}
                        title="Toggle executive summary"
                      >
                        {isSummaryExpanded ? 'Hide Abstract' : 'Abstract'}
                      </button>

                      <button
                        onClick={() => toggleCollapseChapter(chapter.id)}
                        className="p-1 rounded hover:bg-[#151e2e] text-[#8ca3c7] transition-colors"
                        title={isCollapsed ? 'Expand messages' : 'Collapse messages'}
                      >
                        {isCollapsed ? (
                          <ChevronDown className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronUp className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Collapsible Executive Summary & Resolution Toggle */}
                  {isSummaryExpanded && (
                    <div className="mt-2.5 pt-2.5 border-t border-[#090e18] space-y-2">
                      {chapter.summary ? (
                        <div className="text-xs text-[#b8cce6] leading-relaxed bg-[#0a0f18] p-2.5 rounded-lg border border-[#060a12]">
                          <div className="font-semibold text-[10px] text-[#8ab1e0] mb-0.5 font-mono">
                            Executive Abstract & Invariants:
                          </div>
                          <p>{chapter.summary}</p>
                          {chapter.keyPoints && chapter.keyPoints.length > 0 && (
                            <ul className="list-disc list-inside mt-1.5 space-y-0.5 text-[11px] text-[#9bb0d1]">
                              {chapter.keyPoints.map((kp, kIdx) => (
                                <li key={kIdx}>{kp}</li>
                              ))}
                            </ul>
                          )}
                        </div>
                      ) : (
                        <div className="flex items-center justify-between text-xs text-[#7d93b3] p-2 bg-[#0a0f18] rounded-lg">
                          <span>No summary compiled yet for this node.</span>
                          <button
                            onClick={() => onSummarizeChapter(chapter.id)}
                            className="text-[10px] font-mono px-2 py-1 rounded bg-[#e05a66]/20 text-[#f28894] hover:bg-[#e05a66]/30 font-bold"
                          >
                            Summarize with Gemini
                          </button>
                        </div>
                      )}

                      {/* Memory Depth Selector */}
                      <div className="flex items-center justify-between text-[10px] font-mono text-[#788fa8] pt-1">
                        <span>Context Ingestion State:</span>
                        <div className="flex items-center gap-1 bg-[#090e16] p-0.5 rounded-lg border border-[#060a12]">
                          {(['summary', 'full', 'dropped'] as const).map((mode) => (
                            <button
                              key={mode}
                              onClick={() => onToggleChapterCompressionMode(chapter.id, mode)}
                              className={`px-2 py-0.5 rounded uppercase font-bold transition-all ${
                                compression === mode
                                  ? 'bg-[#182338] text-[#8ab1e0] shadow-sm'
                                  : 'text-[#50637f] hover:text-[#8ca3c7]'
                              }`}
                            >
                              {mode}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Messages Timeline (Foldable) */}
              {!isCollapsed && (
                <div className="space-y-3">
                  {chapter.messages.map((message) => {
                    const isUser = message.role === 'user';
                    const isPlaying = playingMessageId === message.id;
                    const isTTSLoading = ttsLoadingId === message.id;

                    return (
                      <div
                        key={message.id}
                        className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} group`}
                      >
                        <div
                          className={`max-w-[92%] sm:max-w-[85%] rounded-2xl px-3.5 py-3 text-xs sm:text-sm leading-relaxed border transition-all ${
                            isUser
                              ? 'bg-[#162133] border-[#0c1421] text-[#f0f6fc] rounded-br-sm'
                              : 'bg-[#101623] border-[#090d16] text-[#d6e2f0] rounded-bl-sm'
                          }`}
                        >
                          {/* Message Header */}
                          <div className="flex items-center justify-between gap-3 mb-1.5 pb-1 border-b border-white/5 text-[10px] font-mono text-[#788fa8]">
                            <span className="font-semibold uppercase tracking-wider text-[#9bb0d1]">
                              {isUser ? 'You' : 'MarkBrain Architect'}
                            </span>

                            <div className="flex items-center gap-2">
                              {/* Inline Declare Chapter / Subchapter Trigger */}
                              <button
                                onClick={() =>
                                  setDeclaringMessageId(
                                    declaringMessageId === message.id ? null : message.id
                                  )
                                }
                                className="opacity-60 group-hover:opacity-100 hover:text-[#e05a66] transition-opacity flex items-center gap-1"
                                title="Split timeline: Declare new chapter or subchapter here"
                              >
                                <BookmarkPlus className="w-3 h-3" />
                                <span className="hidden sm:inline">Split Chapter</span>
                              </button>

                              {/* Voice TTS Button */}
                              {!isUser && (
                                <button
                                  onClick={() => handlePlayTTS(message)}
                                  disabled={isTTSLoading}
                                  className={`flex items-center gap-1 px-1.5 py-0.5 rounded transition-all ${
                                    isPlaying
                                      ? 'bg-[#e05a66] text-white animate-pulse'
                                      : 'hover:bg-white/10 text-[#8ab1e0]'
                                  }`}
                                  title="Listen via voice audio"
                                >
                                  {isTTSLoading ? (
                                    <Loader2 className="w-3 h-3 animate-spin text-[#e05a66]" />
                                  ) : isPlaying ? (
                                    <VolumeX className="w-3 h-3" />
                                  ) : (
                                    <Volume2 className="w-3 h-3" />
                                  )}
                                  <span className="text-[9px]">
                                    {isTTSLoading ? 'Synthesizing...' : isPlaying ? 'Playing' : 'Listen'}
                                  </span>
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Message Content */}
                          <div className="whitespace-pre-wrap font-sans space-y-2">
                            {message.content}
                          </div>

                          {/* Synthesized Artifacts / Updates (Single-File YAML+MD) */}
                          {message.extractedArtifacts && message.extractedArtifacts.length > 0 && (
                            <div className="mt-3 pt-2.5 border-t border-[#090e18] space-y-2">
                              <div className="text-[10px] font-semibold text-[#8ab1e0] flex items-center justify-between font-mono">
                                <div className="flex items-center gap-1.5">
                                  <FileCode className="w-3.5 h-3.5 text-[#e05a66]" />
                                  <span>Synthesized YAML Specification</span>
                                </div>
                                <span className="text-[9px] text-[#4f99a3] bg-[#0c1a20] px-1.5 py-0.2 rounded border border-[#081216]">
                                  Recorded in History
                                </span>
                              </div>

                              {message.extractedArtifacts.map((art, idx) => (
                                <div
                                  key={idx}
                                  className="bg-[#0a0e16] p-2.5 rounded-xl border border-[#060a10] flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                                >
                                  <div className="min-w-0">
                                    <div className="font-semibold text-xs text-[#eef4fc] flex items-center gap-1.5 truncate">
                                      <span>{art.title}</span>
                                      <span className="text-[9px] font-mono text-[#8ab1e0] bg-[#121a28] px-1.5 py-0.2 rounded">
                                        {art.code || 'spec'}
                                      </span>
                                    </div>
                                    <div className="text-[11px] text-[#869ab8] line-clamp-1 mt-0.5">
                                      {art.description || art.summary || art.abstract}
                                    </div>
                                  </div>

                                  <button
                                    onClick={() => {
                                      const fullArtifact: Artifact = {
                                        id: `art-${Date.now()}-${idx}`,
                                        projectId: project.id,
                                        code:
                                          art.code ||
                                          (art.title || 'spec').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
                                        title: art.title || 'Synthesized Artifact',
                                        type: (art.type as Artifact['type']) || 'architecture',
                                        category: (art.category as Artifact['category']) || 'system-spec',
                                        isHighConcept: Boolean(art.isHighConcept),
                                        description:
                                          art.description || art.abstract || 'Generated artifact spec.',
                                        summary:
                                          art.summary || art.abstract || 'Synthesized architectural summary.',
                                        content:
                                          art.content || `# ${art.title}\n\nGenerated specification document.`,
                                        resolution: 'full',
                                        history: [
                                          {
                                            version: 1,
                                            timestamp: new Date().toISOString(),
                                            changeSummary: 'Synthesized from chat brainstorming session',
                                            content: art.content || '',
                                          },
                                        ],
                                        tags: ['chat-synthesized', art.type || 'architecture'],
                                        createdAt: new Date().toISOString(),
                                        updatedAt: new Date().toISOString(),
                                      };
                                      onAddArtifactToProject(fullArtifact);
                                    }}
                                    className="px-2.5 py-1 rounded-lg bg-[#e05a66]/20 hover:bg-[#e05a66] text-[#f28894] hover:text-white text-xs font-mono font-medium transition-all shrink-0 flex items-center gap-1"
                                  >
                                    <FileCode className="w-3 h-3" />
                                    <span>Pin into Desk</span>
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Inline "Declare Chapter / Subchapter" Drawer */}
                        {declaringMessageId === message.id && (
                          <div className="w-full max-w-[92%] sm:max-w-[85%] mt-1.5 p-3 rounded-xl bg-[#111724] border border-[#080d16] space-y-2 animate-in fade-in duration-150">
                            <div className="flex items-center justify-between text-[11px] font-mono text-[#8ab1e0]">
                              <span className="font-bold flex items-center gap-1">
                                <BookmarkPlus className="w-3.5 h-3.5 text-[#e05a66]" />
                                Declare Chapter Boundary Here
                              </span>
                              <button
                                onClick={() => setDeclaringMessageId(null)}
                                className="text-[#64748b] hover:text-white"
                              >
                                Cancel
                              </button>
                            </div>

                            <div className="flex flex-col sm:flex-row gap-2">
                              <input
                                type="text"
                                placeholder="Chapter or Subchapter Title..."
                                value={newChapterTitle}
                                onChange={(e) => setNewChapterTitle(e.target.value)}
                                className="flex-1 bg-[#090d15] border border-[#060a10] rounded-lg px-2.5 py-1 text-xs text-[#eef4fc] focus:outline-none focus:border-[#e05a66]/50"
                              />

                              <div className="flex items-center gap-1">
                                {(
                                  [
                                    { label: 'Chapter (L1)', level: 1 },
                                    { label: 'Subchapter (L2)', level: 2 },
                                    { label: 'Section (L3)', level: 3 },
                                  ] as const
                                ).map((lvl) => (
                                  <button
                                    key={lvl.level}
                                    type="button"
                                    onClick={() => setNewChapterLevel(lvl.level)}
                                    className={`px-2 py-1 rounded text-[10px] font-mono ${
                                      newChapterLevel === lvl.level
                                        ? 'bg-[#e05a66] text-white font-bold'
                                        : 'bg-[#090d15] text-[#7d93b3] hover:text-white border border-[#060a10]'
                                    }`}
                                  >
                                    {lvl.label}
                                  </button>
                                ))}

                                <button
                                  type="button"
                                  onClick={() => handleDeclareSubmit(message.id)}
                                  className="px-3 py-1 rounded bg-[#3b82f6] hover:bg-[#2563eb] text-white text-xs font-mono font-medium"
                                >
                                  Save
                                </button>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {isLoading && (
          <div className="flex items-center gap-2 text-xs font-mono text-[#8ab1e0] bg-[#101623] p-3 rounded-2xl border border-[#080d15] w-fit">
            <Loader2 className="w-4 h-4 animate-spin text-[#e05a66]" />
            <span>MarkBrain synthesizing architectural invariants...</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Chat Input Bar */}
      <div className="p-2.5 sm:p-3 bg-[#0d121c] border-t border-[#080d15] shrink-0">
        <form onSubmit={handleSubmit} className="flex items-center gap-2 max-w-4xl mx-auto">
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder={`Brainstorm on ${project.name} (artifacts auto-extracted)...`}
            disabled={isLoading}
            className="flex-1 bg-[#090d15] border border-[#060a10] rounded-xl px-3.5 py-2.5 text-xs sm:text-sm text-[#eef4fc] placeholder-[#50637f] focus:outline-none focus:border-[#e05a66]/50 transition-colors"
          />

          <button
            type="submit"
            disabled={!inputText.trim() || isLoading}
            className="px-4 py-2.5 rounded-xl bg-[#e05a66] hover:bg-[#be3a49] disabled:opacity-40 disabled:hover:bg-[#e05a66] text-white transition-all shadow-md shadow-[#e05a66]/20 flex items-center justify-center cursor-pointer"
            title="Send architectural query"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
};
