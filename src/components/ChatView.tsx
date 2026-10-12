import React, { useState, useRef, useEffect } from 'react';
import { Project, ChatMessage, Artifact, Chapter, getMellowPastelColor } from '../types';
import {
  Send,
  Loader2,
  FileCode,
  Volume2,
  VolumeX,
  ChevronDown,
  ChevronUp,
  BookmarkPlus,
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

// Consistent mellow dark pastel palette for chapters
const CHAPTER_PASTEL_COLORS = [
  { border: 'border-[#2d3a4f]', bgHeader: 'bg-[#121a28]', dot: '#7093be', text: 'text-[#8ab1e0]' }, // slate steel blue
  { border: 'border-[#2b3a36]', bgHeader: 'bg-[#111c18]', dot: '#5da88b', text: 'text-[#7ec2a6]' }, // mellow sage green
  { border: 'border-[#3a3345]', bgHeader: 'bg-[#1a1523]', dot: '#9d80ba', text: 'text-[#b9a1d4]' }, // dark muted mauve
  { border: 'border-[#3d3428]', bgHeader: 'bg-[#1c1710]', dot: '#b59765', text: 'text-[#d6be94]' }, // mellow dark amber
  { border: 'border-[#243745]', bgHeader: 'bg-[#101b24]', dot: '#64a3ba', text: 'text-[#8ac5db]' }, // dark muted teal
];

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
  const prevMessagesCountRef = useRef<number>(0);

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

  // Total messages count across chapters
  const totalMessagesCount = project.chapters.reduce(
    (acc, chap) => acc + (chap.messages ? chap.messages.length : 0),
    0
  );

  // Auto-scroll ONLY when a new message is appended (NOT on summary toggles or loading state)
  const isFirstMount = useRef(true);
  useEffect(() => {
    if (isFirstMount.current) {
      isFirstMount.current = false;
      prevMessagesCountRef.current = totalMessagesCount;
      messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
      return;
    }
    if (totalMessagesCount > prevMessagesCountRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
    prevMessagesCountRef.current = totalMessagesCount;
  }, [totalMessagesCount]);

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
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.05;
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

          // Pick mellow dark pastel color for nuance
          const chapColor = chapter.color || getMellowPastelColor(chapter.id || chapterIndex);
          const pastel = CHAPTER_PASTEL_COLORS[chapterIndex % CHAPTER_PASTEL_COLORS.length];

          return (
            <section
              key={chapter.id}
              style={{
                borderColor: `${chapColor}55`,
                boxShadow: `0 4px 24px -4px ${chapColor}15`,
              }}
              className={`transition-all duration-200 relative border ${
                isOngoing
                  ? `rounded-t-2xl rounded-b-none bg-[#0c1322]/90 border-b-0 overflow-visible mt-2 mb-0`
                  : `rounded-2xl bg-[#0c121e]/85 overflow-hidden mb-5 shadow-sm`
              }`}
            >
              {/* Chapter Header Ribbon */}
              <div
                style={{
                  backgroundColor: `${chapColor}18`,
                  borderBottomColor: `${chapColor}40`,
                }}
                className="p-3 sm:p-3.5 border-b flex flex-wrap items-center justify-between gap-2.5 transition-colors"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  {/* Status Indicator Dot with pastel nuance */}
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0 shadow-xs"
                    style={{ backgroundColor: chapColor }}
                    title={isOngoing ? 'Active Chapter' : 'Completed Chapter'}
                  />

                  <span
                    style={{ color: chapColor }}
                    className="text-[10px] font-mono uppercase tracking-wider shrink-0 font-semibold"
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
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      toggleExpandSummary(chapter.id);
                    }}
                    className={`px-2 py-1 rounded-lg text-[10px] font-mono transition-colors border cursor-pointer ${
                      isSummaryExpanded
                        ? 'bg-[#182337] text-[#8ab1e0] border-[#223552]'
                        : 'bg-[#090d16] text-[#7d93b3] border-[#111929] hover:text-[#eef4fc]'
                    }`}
                    title="Toggle executive summary"
                  >
                    {isSummaryExpanded ? 'Hide Abstract' : 'Abstract'}
                  </button>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      toggleCollapseChapter(chapter.id);
                    }}
                    className="p-1 rounded-lg hover:bg-[#162134] text-[#8ca3c7] transition-colors cursor-pointer"
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
                <div className="p-3 sm:p-4 bg-[#0a0f19] border-b border-[#121c2d] space-y-2">
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
                        className="text-[10px] font-mono px-2.5 py-1 rounded-lg bg-[#18263e] text-[#8ab1e0] hover:bg-[#203252] border border-[#233758] font-medium transition-colors cursor-pointer"
                      >
                        Summarize with Gemini
                      </button>
                    </div>
                  )}

                  {/* Memory Depth Selector */}
                  <div className="flex items-center justify-between text-[10px] font-mono text-[#788fa8] pt-1">
                    <span>Context Ingestion State:</span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => onToggleChapterCompressionMode(chapter.id, 'full')}
                        className={`px-2 py-0.5 rounded transition-colors cursor-pointer ${
                          compression === 'full'
                            ? 'bg-[#182338] text-[#8ab1e0] font-semibold border border-[#243552]'
                            : 'bg-[#090d15] text-[#556985] hover:text-[#9bb0d1]'
                        }`}
                      >
                        Full Verbatim
                      </button>
                      <button
                        onClick={() => onToggleChapterCompressionMode(chapter.id, 'summary')}
                        className={`px-2 py-0.5 rounded transition-colors cursor-pointer ${
                          compression === 'summary'
                            ? 'bg-[#182338] text-[#8ab1e0] font-semibold border border-[#243552]'
                            : 'bg-[#090d15] text-[#556985] hover:text-[#9bb0d1]'
                        }`}
                      >
                        Summary (T2)
                      </button>
                      <button
                        onClick={() => onToggleChapterCompressionMode(chapter.id, 'dropped')}
                        className={`px-2 py-0.5 rounded transition-colors cursor-pointer ${
                          compression === 'dropped'
                            ? 'bg-[#29171b] text-[#f28894] font-semibold border border-[#4d2229]'
                            : 'bg-[#090d15] text-[#556985] hover:text-[#9bb0d1]'
                        }`}
                      >
                        Drop
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Messages Container */}
              {!isCollapsed && (
                <div className="p-3 sm:p-5 space-y-4">
                  {chapter.messages.map((message) => {
                    const isUser = message.role === 'user';
                    const isPlaying = playingMessageId === message.id;
                    const isTtsLoading = ttsLoadingId === message.id;

                    return (
                      <div
                        key={message.id}
                        className={`flex flex-col group ${isUser ? 'items-end' : 'items-start'}`}
                      >
                        {/* Speaker & Timestamp Header */}
                        <div className="flex items-center gap-2 mb-1 text-[11px] font-mono text-[#627794]">
                          <span className={isUser ? 'text-[#8ab1e0]' : 'text-[#e05a66] font-semibold'}>
                            {isUser ? 'Architect' : 'MarkBrain Engine'}
                          </span>
                          <span>•</span>
                          <span>{new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>

                          {/* TTS Audio Button */}
                          <button
                            onClick={() => handlePlayTTS(message)}
                            disabled={isTtsLoading}
                            className={`p-1 rounded hover:bg-[#141b29] transition-colors cursor-pointer ${
                              isPlaying ? 'text-[#38bdf8]' : 'text-[#50637f] hover:text-[#9bb0d1]'
                            }`}
                            title={isPlaying ? 'Stop playback' : 'Play audio (Kokoro-82M TTS)'}
                          >
                            {isTtsLoading ? (
                              <Loader2 className="w-3 h-3 animate-spin text-[#38bdf8]" />
                            ) : isPlaying ? (
                              <VolumeX className="w-3 h-3" />
                            ) : (
                              <Volume2 className="w-3 h-3" />
                            )}
                          </button>

                          {/* Timeline Split Button (Declare Chapter Boundary) */}
                          <button
                            onClick={() => {
                              setDeclaringMessageId(
                                declaringMessageId === message.id ? null : message.id
                              );
                              setNewChapterTitle('');
                            }}
                            className="p-1 rounded hover:bg-[#141b29] text-[#50637f] hover:text-[#8ab1e0] transition-colors opacity-40 group-hover:opacity-100 cursor-pointer"
                            title="Split into new chapter starting at this message"
                          >
                            <BookmarkPlus className="w-3 h-3" />
                          </button>
                        </div>

                        {/* Inline Timeline Split Form */}
                        {declaringMessageId === message.id && (
                          <div className="w-full max-w-lg my-2 p-3 bg-[#0a0f19] border border-[#1a293e] rounded-xl shadow-xl space-y-2 animate-in fade-in duration-150">
                            <div className="text-[10px] font-mono text-[#38bdf8] uppercase tracking-wider font-semibold">
                              Declare Chapter Split at this Message
                            </div>
                            <input
                              type="text"
                              value={newChapterTitle}
                              onChange={(e) => setNewChapterTitle(e.target.value)}
                              placeholder="New Chapter Title (e.g. Chapter 4: Combat Roll)"
                              className="w-full bg-[#080d16] border border-[#162438] rounded-lg px-2.5 py-1.5 text-xs text-[#eef4fc] placeholder-[#556985] focus:outline-none focus:border-[#38bdf8]"
                            />
                            <div className="flex items-center justify-end gap-2 pt-1">
                              <button
                                onClick={() => setDeclaringMessageId(null)}
                                className="px-2.5 py-1 text-xs font-mono text-[#7185a3] hover:text-white cursor-pointer"
                              >
                                Cancel
                              </button>
                              <button
                                onClick={() => handleDeclareSubmit(message.id)}
                                disabled={!newChapterTitle.trim()}
                                className="px-3 py-1 bg-[#2563eb] hover:bg-[#1d4ed8] disabled:opacity-40 text-white rounded-lg text-xs font-mono font-medium shadow-md transition-colors cursor-pointer"
                              >
                                Split Chapter
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Bubble Content */}
                        <div
                          className={`max-w-[92%] sm:max-w-[85%] rounded-2xl p-3 sm:p-4 text-xs sm:text-sm leading-relaxed shadow-sm ${
                            isUser
                              ? 'bg-[#182338] text-[#eef4fc] border border-[#243552]'
                              : 'bg-[#0f1624] text-[#d6e3f5] border border-[#172235]'
                          }`}
                        >
                          <div className="whitespace-pre-wrap font-sans space-y-2">
                            {message.content}
                          </div>

                          {/* Synthesized Artifacts */}
                          {message.extractedArtifacts && message.extractedArtifacts.length > 0 && (
                            <div className="mt-3 pt-2.5 border-t border-[#090e18] space-y-2">
                              <div className="text-[10px] font-semibold text-[#8ab1e0] flex items-center justify-between font-mono">
                                <div className="flex items-center gap-1.5">
                                  <FileCode className="w-3.5 h-3.5 text-[#8ab1e0]" />
                                  <span>Synthesized Architectural Specification</span>
                                </div>
                                <span className="text-[9px] text-[#4f99a3] bg-[#0c1a20] px-1.5 py-0.2 rounded border border-[#081216]">
                                  Ingested in Knowledge Substrate
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
                                        color: '#5d87b8',
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
                                            changeSummary: 'Manually pinned from chat',
                                            content: body,
                                          },
                                        ],
                                        tags: ['manual-pin'],
                                        createdAt: new Date().toISOString(),
                                        updatedAt: new Date().toISOString(),
                                      };
                                      onAddArtifactToProject(fullArtifact);
                                    }}
                                    className="px-2.5 py-1 rounded-lg bg-[#1a2538] hover:bg-[#23334d] text-xs font-mono text-[#8ab1e0] border border-[#233550] shrink-0 transition-colors cursor-pointer"
                                  >
                                    Save as Artifact
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
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
