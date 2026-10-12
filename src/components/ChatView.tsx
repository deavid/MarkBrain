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
  Compass,
} from 'lucide-react';

interface ChatViewProps {
  project: Project;
  onSendMessage: (text: string) => Promise<void>;
  isLoading: boolean;
  onAddArtifactToProject: (artifact: Artifact) => void;
  onSummarizeChapter: (chapterId: string) => Promise<void>;
  onToggleChapterCompressionMode: (chapterId: string, mode: 'summary' | 'full' | 'dropped') => void;
  onDeclareChapter: (messageId: string, title: string) => void;
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

  // Accordion state for chapter folding
  const [collapsedChapterIds, setCollapsedChapterIds] = useState<Record<string, boolean>>({});
  const [expandedSummaryIds, setExpandedSummaryIds] = useState<Record<string, boolean>>({});

  // Inline "Split Chapter" form state
  const [declaringMessageId, setDeclaringMessageId] = useState<string | null>(null);
  const [newChapterTitle, setNewChapterTitle] = useState('');

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
    onDeclareChapter(msgId, newChapterTitle.trim());
    setDeclaringMessageId(null);
    setNewChapterTitle('');
  };

  return (
    <div className="flex flex-col h-full bg-[#0d121c] text-[#e3edf7] select-text overflow-hidden pt-0 mt-0">
      {/* Unified Vertical Chat Feed with Episodic Chapters */}
      <div className="flex-1 overflow-y-auto px-3 py-2 sm:px-6 sm:py-3 space-y-4">
        {project.chapters.map((chapter, chapterIndex) => {
          const isCollapsed = collapsedChapterIds[chapter.id] ?? false;
          const isSummaryExpanded = expandedSummaryIds[chapter.id] ?? false;
          const compression = chapter.compressionMode || (chapter.isSummarized ? 'summary' : 'full');
          const isLastChapter = chapterIndex === project.chapters.length - 1;
          const isOngoing = chapter.status === 'active' || isLastChapter;

          return (
            <section
              key={chapter.id}
              className={`transition-all duration-200 relative ${
                isOngoing
                  ? 'rounded-t-2xl rounded-b-none bg-[#0c1322]/85 border-t border-x border-[#1a293e] border-b-0 overflow-visible mt-2 mb-0'
                  : 'rounded-2xl bg-[#0c121e]/80 border border-[#162234] overflow-hidden mb-5 shadow-sm'
              }`}
            >
              {/* Chapter Header Ribbon */}
              <div
                className={`p-3 sm:p-3.5 border-b flex flex-wrap items-center justify-between gap-2.5 transition-colors ${
                  isOngoing
                    ? 'border-[#1a293e] bg-[#10192a]'
                    : 'border-[#162234] bg-[#0e1626]'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  {/* Status Indicator */}
                  {isOngoing ? (
                    <span className="w-2 h-2 rounded-full bg-[#38bdf8] shrink-0" title="Active Chapter" />
                  ) : (
                    <span className="w-2 h-2 rounded-full bg-[#475569] shrink-0" title="Completed Chapter" />
                  )}

                  <span
                    className={`text-[10px] font-mono uppercase tracking-wider shrink-0 font-semibold ${
                      isOngoing ? 'text-[#7e95b5]' : 'text-[#64748b]'
                    }`}
                  >
                    Chapter {chapterIndex + 1}
                  </span>

                  <h3 className="font-semibold text-xs sm:text-sm text-[#eef4fc] truncate font-mono">
                    {chapter.title}
                  </h3>

                  {chapter.topicShiftReason && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#131b29] text-[#7d93b3] font-mono border border-[#1b263b] shrink-0">
                      {chapter.topicShiftReason.length > 25 ? 'Shift' : chapter.topicShiftReason}
                    </span>
                  )}
                </div>

                {/* Chapter Actions: Abstract & Collapse */}
                <div className="flex items-center gap-1.5 shrink-0 ml-auto">
                  <span className="text-[10px] font-mono text-[#556985] hidden sm:inline mr-1">
                    {chapter.messages.length} msg{chapter.messages.length !== 1 ? 's' : ''}
                  </span>

                  <button
                    onClick={() => toggleExpandSummary(chapter.id)}
                    className={`px-2 py-1 rounded-lg text-[10px] font-mono transition-colors border ${
                      isSummaryExpanded
                        ? 'bg-[#182337] text-[#8ab1e0] border-[#223552]'
                        : 'bg-[#090d16] text-[#7d93b3] border-[#111929] hover:text-[#eef4fc]'
                    }`}
                    title="Toggle executive summary"
                  >
                    {isSummaryExpanded ? 'Hide Abstract' : 'Abstract'}
                  </button>

                  <button
                    onClick={() => toggleCollapseChapter(chapter.id)}
                    className="p-1 rounded-lg hover:bg-[#162134] text-[#8ca3c7] transition-colors"
                    title={isCollapsed ? 'Expand messages' : 'Collapse messages'}
                  >
                    {isCollapsed ? (
                      <ChevronDown className="w-4 h-4" />
                    ) : (
                      <ChevronUp className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              {/* Collapsible Executive Summary & Resolution Toggle */}
              {isSummaryExpanded && (
                <div className="p-3 sm:p-4 bg-[#0a0f19] border-b border-[#121b2d] space-y-2">
                  {chapter.summary ? (
                    <div className="text-xs text-[#b8cce6] leading-relaxed bg-[#0d1424] p-3 rounded-xl border border-[#141f33]">
                      <div className="font-semibold text-[10px] text-[#8ab1e0] mb-1 font-mono uppercase tracking-wider">
                        Executive Abstract & System Invariants:
                      </div>
                      <p>{chapter.summary}</p>
                      {chapter.keyPoints && chapter.keyPoints.length > 0 && (
                        <ul className="list-disc list-inside mt-2 space-y-0.5 text-[11px] text-[#9bb0d1]">
                          {chapter.keyPoints.map((kp, kIdx) => (
                            <li key={kIdx}>{kp}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center justify-between text-xs text-[#7d93b3] p-2.5 bg-[#0d1424] rounded-xl border border-[#141f33]">
                      <span>No summary compiled yet for this node.</span>
                      <button
                        onClick={() => onSummarizeChapter(chapter.id)}
                        className="text-[10px] font-mono px-2.5 py-1 rounded-lg bg-[#18263e] text-[#8ab1e0] hover:bg-[#203252] border border-[#233758] font-medium transition-colors"
                      >
                        Summarize with Gemini
                      </button>
                    </div>
                  )}

                  {/* Memory Depth Selector */}
                  <div className="flex items-center justify-between text-[10px] font-mono text-[#788fa8] pt-1">
                    <span>Context Ingestion State:</span>
                    <div className="flex items-center gap-1 bg-[#070b13] p-0.5 rounded-lg border border-[#0f1728]">
                      {(['summary', 'full', 'dropped'] as const).map((mode) => (
                        <button
                          key={mode}
                          onClick={() => onToggleChapterCompressionMode(chapter.id, mode)}
                          className={`px-2 py-0.5 rounded-md uppercase font-bold transition-all ${
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

              {/* Messages Enclosure (Subsumed strictly inside this Chapter boundary) */}
              {!isCollapsed && (
                <div
                  className={`p-3 sm:p-5 space-y-4 relative ${
                    isOngoing ? 'bg-transparent pb-6' : 'bg-[#090e18]/40'
                  }`}
                >
                  {/* Subtle continuous vertical spine connecting turns inside this chapter */}
                  <div className="absolute top-4 bottom-4 left-6 sm:left-8 w-[1px] bg-gradient-to-b from-transparent via-[#1a253b] to-transparent pointer-events-none" />
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
                                className="opacity-60 group-hover:opacity-100 hover:text-[#8ab1e0] transition-opacity flex items-center gap-1"
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
                                      ? 'bg-[#2563eb] text-white'
                                      : 'hover:bg-white/10 text-[#8ab1e0]'
                                  }`}
                                  title="Listen via voice audio"
                                >
                                  {isTTSLoading ? (
                                    <Loader2 className="w-3 h-3 animate-spin text-[#8ab1e0]" />
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
                                  <FileCode className="w-3.5 h-3.5 text-[#8ab1e0]" />
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
                                      const now = Date.now();
                                      const title = art.title || 'Synthesized Artifact';
                                      const desc = art.description || art.abstract || 'Generated artifact spec.';
                                      const summ = art.summary || art.abstract || 'Synthesized architectural summary.';
                                      const body = art.content || `# ${title}\n\nGenerated specification document.`;
                                      const fullArtifact: Artifact = {
                                        id: `art-${now}-${idx}`,
                                        workspace_id: project.id,
                                        projectId: project.id,
                                        type: 'document',
                                        created_at: now,
                                        updated_at: now,
                                        current: {
                                          t0_label: title,
                                          t1_abstract: desc,
                                          t2_summary: summ,
                                          t3_body: body,
                                        },
                                        revisions: [],
                                        relations: [],
                                        provenance: {
                                          origin_chapter_id: project.currentChapterId,
                                          mutation_chapter_ids: [],
                                        },
                                        code:
                                          art.code ||
                                          title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
                                        title,
                                        category: (art.category as Artifact['category']) || 'system-spec',
                                        isHighConcept: Boolean(art.isHighConcept),
                                        description: desc,
                                        summary: summ,
                                        content: body,
                                        resolution: 'full',
                                        history: [
                                          {
                                            version: 1,
                                            timestamp: new Date().toISOString(),
                                            changeSummary: 'Synthesized from chat brainstorming session',
                                            content: body,
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

                        {/* Inline "Split Chapter" Drawer */}
                        {declaringMessageId === message.id && (
                          <div className="w-full max-w-[92%] sm:max-w-[85%] mt-1.5 p-3 rounded-xl bg-[#111724] border border-[#1a293e] space-y-2 animate-in fade-in duration-150">
                            <div className="flex items-center justify-between text-[11px] font-mono text-[#8ab1e0]">
                              <span className="font-bold flex items-center gap-1.5 text-[#eef4fc]">
                                <BookmarkPlus className="w-3.5 h-3.5 text-[#38bdf8]" />
                                Split into New Chapter Here
                              </span>
                              <button
                                onClick={() => setDeclaringMessageId(null)}
                                className="text-[#64748b] hover:text-white text-xs cursor-pointer"
                              >
                                Cancel
                              </button>
                            </div>

                            <div className="flex flex-col sm:flex-row gap-2">
                              <input
                                type="text"
                                placeholder="New Chapter Title..."
                                value={newChapterTitle}
                                onChange={(e) => setNewChapterTitle(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    handleDeclareSubmit(message.id);
                                  }
                                }}
                                className="flex-1 bg-[#090d15] border border-[#162234] rounded-lg px-2.5 py-1.5 text-xs text-[#eef4fc] placeholder-[#50637f] focus:outline-none focus:border-[#38bdf8]/50"
                                autoFocus
                              />

                              <button
                                type="button"
                                onClick={() => handleDeclareSubmit(message.id)}
                                disabled={!newChapterTitle.trim()}
                                className="px-3.5 py-1.5 rounded-lg bg-[#2563eb] hover:bg-[#1d4ed8] disabled:opacity-40 text-white text-xs font-mono font-medium cursor-pointer transition-colors"
                              >
                                Split Chapter
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}

        {isLoading && (
          <div className="flex items-center gap-2 text-xs font-mono text-[#8ab1e0] bg-[#101623] p-3 rounded-xl border border-[#1a293e] w-fit">
            <Loader2 className="w-4 h-4 animate-spin text-[#38bdf8]" />
            <span>MarkBrain synthesizing architectural invariants...</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Chat Input Bar */}
      <div className="p-2.5 sm:p-3 bg-[#0d121c] border-t border-[#121c2c] shrink-0">
        <form onSubmit={handleSubmit} className="flex items-center gap-2 max-w-4xl mx-auto">
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder={`Brainstorm on ${project.name} (artifacts auto-extracted)...`}
            disabled={isLoading}
            className="flex-1 bg-[#090d15] border border-[#162234] rounded-xl px-3.5 py-2.5 text-xs sm:text-sm text-[#eef4fc] placeholder-[#50637f] focus:outline-none focus:border-[#3b82f6]/50 transition-colors"
          />

          <button
            type="submit"
            disabled={!inputText.trim() || isLoading}
            className="px-4 py-2.5 rounded-xl bg-[#2563eb] hover:bg-[#1d4ed8] disabled:opacity-40 disabled:hover:bg-[#2563eb] text-white transition-all shadow-md shadow-blue-900/25 flex items-center justify-center cursor-pointer"
            title="Send architectural query"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
};
