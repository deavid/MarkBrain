import React, { useState, useMemo, useEffect } from 'react';
import {
  Project,
  Artifact,
  GraphNode,
  GraphEdge,
  Chapter,
  ChatMessage,
  ModelOption,
  AbstractionLevel,
  ArtifactVersion,
} from './types';
import { INITIAL_PROJECTS, AVAILABLE_MODELS } from './data/initialData';
import { computeTokenBreakdown } from './utils/tokenCalculator';
import { serializeArtifactToYamlDoc } from './utils/yamlArtifactParser';
import { Header, ActiveView } from './components/Header';
import { SpatialGraph } from './components/SpatialGraph';
import { ChatView } from './components/ChatView';
import { ArtifactsDesk } from './components/ArtifactsDesk';
import { ContextInspector } from './components/ContextInspector';
import { ImportModal } from './components/ImportModal';
import { ExportModal } from './components/ExportModal';
import { ProjectLauncher } from './components/ProjectLauncher';
import { MobileNav } from './components/MobileNav';

const STORAGE_PROJECTS_KEY = 'markbrain_projects_v2';
const STORAGE_ACTIVE_PROJECT_KEY = 'markbrain_active_project_id_v2';

const getStoredProjects = (): Project[] => {
  try {
    const raw = localStorage.getItem(STORAGE_PROJECTS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (e) {
    console.warn('Could not read projects from localStorage:', e);
  }
  return INITIAL_PROJECTS;
};

const getStoredActiveProjectId = (initialList: Project[]): string => {
  try {
    const saved = localStorage.getItem(STORAGE_ACTIVE_PROJECT_KEY);
    if (saved && initialList.some((p) => p.id === saved)) {
      return saved;
    }
  } catch (e) {
    // fallback
  }
  return initialList[0]?.id || INITIAL_PROJECTS[0].id;
};

export default function App() {
  const [projects, setProjects] = useState<Project[]>(getStoredProjects);
  const [activeProjectId, setActiveProjectId] = useState<string>(() =>
    getStoredActiveProjectId(projects)
  );
  const [selectedModel, setSelectedModel] = useState<ModelOption>(AVAILABLE_MODELS[1]); // Gemini 3.8 Flash

  // Persist projects to localStorage whenever changed
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_PROJECTS_KEY, JSON.stringify(projects));
    } catch (e) {
      console.warn('Could not persist projects to localStorage:', e);
    }
  }, [projects]);

  // Persist active project selection
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_ACTIVE_PROJECT_KEY, activeProjectId);
    } catch (e) {
      // ignore
    }
  }, [activeProjectId]);

  // Single-Task Focused View: 'chat' | 'graph' | 'artifacts' | 'tokens'
  const [activeView, setActiveView] = useState<ActiveView>('chat');

  // Modals & Project Launcher
  const [isProjectLauncherOpen, setIsProjectLauncherOpen] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);

  // Chat loading state
  const [isChatLoading, setIsChatLoading] = useState(false);

  // Active Project Reference
  const activeProject = useMemo(() => {
    return projects.find((p) => p.id === activeProjectId) || projects[0];
  }, [projects, activeProjectId]);

  // Selected Artifact Reference
  const selectedArtifact = useMemo(() => {
    return (
      activeProject.artifacts.find((a) => a.id === selectedArtifactId) ||
      activeProject.artifacts[0] ||
      null
    );
  }, [activeProject, selectedArtifactId]);

  // Total Token Footprint
  const tokenBreakdown = useMemo(() => {
    return computeTokenBreakdown(
      activeProject.artifacts,
      activeProject.chapters,
      activeProject.currentChapterId
    );
  }, [activeProject]);

  // 1. Select Project & Immediately Go to Chat
  const handleSelectProjectAndLaunchChat = (projId: string) => {
    setActiveProjectId(projId);
    setActiveView('chat');
    setIsProjectLauncherOpen(false);
  };

  // 2. Create Project & Launch Chat
  const handleCreateProject = (
    name: string,
    description: string,
    codeName: string,
    color: string
  ) => {
    const newId = `proj-${Date.now()}`;
    const initialChapterId = `chap-${Date.now()}-1`;

    const initialChapter: Chapter = {
      id: initialChapterId,
      projectId: newId,
      level: 1,
      title: 'Chapter 1: Architectural Foundations',
      summary: `Initial brainstorming kick-off for ${name}.`,
      keyPoints: ['Establish core boundaries and domain invariants'],
      isSummarized: false,
      compressionMode: 'full',
      status: 'active',
      createdAt: new Date().toISOString(),
      messages: [
        {
          id: `msg-${Date.now()}`,
          chapterId: initialChapterId,
          role: 'assistant',
          content: `Welcome to **${name}**! This project workspace is ready for architectural brainstorming.\n\nAll specifications formulated here will automatically generate single-file YAML+Markdown documents with graph relationships. Where shall we begin?`,
          timestamp: new Date().toISOString(),
        },
      ],
    };

    const newProject: Project = {
      id: newId,
      name,
      codeName,
      description,
      color,
      icon: 'Layers',
      boundaryRules: 'Cross-repo linking bridges high-concept architecture specs.',
      currentChapterId: initialChapterId,
      chapters: [initialChapter],
      artifacts: [],
      nodes: [],
      edges: [],
      lastActivity: new Date().toISOString(),
    };

    setProjects((prev) => [newProject, ...prev]);
    setActiveProjectId(newId);
    setActiveView('chat');
    setIsProjectLauncherOpen(false);
  };

  // 3. Update Node Position
  const handleUpdateNodePosition = (nodeId: string, x: number, y: number) => {
    setProjects((prev) =>
      prev.map((proj) => {
        const hasNode = proj.nodes.some((n) => n.id === nodeId);
        if (!hasNode) return proj;
        return {
          ...proj,
          nodes: proj.nodes.map((n) => (n.id === nodeId ? { ...n, x, y } : n)),
        };
      })
    );
  };

  // 4. Batch Update Node Positions (Auto-Arrange)
  const handleBatchUpdateNodePositions = (
    updates: Array<{ nodeId: string; x: number; y: number }>
  ) => {
    const updateMap = new Map(updates.map((u) => [u.nodeId, u]));

    setProjects((prev) =>
      prev.map((proj) => ({
        ...proj,
        nodes: proj.nodes.map((n) => {
          const match = updateMap.get(n.id);
          return match ? { ...n, x: match.x, y: match.y } : n;
        }),
      }))
    );
  };

  // 5. Add Edge
  const handleAddEdge = (edge: GraphEdge) => {
    setProjects((prev) =>
      prev.map((proj) => {
        const targetProjId = edge.sourceProjectId || activeProjectId;
        if (proj.id === targetProjId) {
          return {
            ...proj,
            edges: [...proj.edges, edge],
          };
        }
        return proj;
      })
    );
  };

  // 6. Update Artifact Resolution (Slider)
  const handleUpdateArtifactResolution = (
    artifactId: string,
    resolution: AbstractionLevel
  ) => {
    setProjects((prev) =>
      prev.map((proj) => ({
        ...proj,
        artifacts: proj.artifacts.map((a) =>
          a.id === artifactId ? { ...a, resolution } : a
        ),
      }))
    );
  };

  // 7. Update All Artifacts Resolution
  const handleUpdateAllArtifactsResolution = (resolution: AbstractionLevel) => {
    setProjects((prev) =>
      prev.map((proj) => {
        if (proj.id !== activeProjectId) return proj;
        return {
          ...proj,
          artifacts: proj.artifacts.map((a) => ({ ...a, resolution })),
        };
      })
    );
  };

  // 8. Update Artifact Content (Auto-appends version history)
  const handleUpdateArtifactContent = (artifactId: string, newContent: string) => {
    setProjects((prev) =>
      prev.map((proj) => {
        if (proj.id !== activeProjectId) return proj;
        return {
          ...proj,
          artifacts: proj.artifacts.map((a) => {
            if (a.id !== artifactId) return a;
            const currentHistory = a.history || [];
            const newVersionNumber = currentHistory.length + 1;
            const updatedHistory: ArtifactVersion[] = [
              ...currentHistory,
              {
                version: newVersionNumber,
                timestamp: new Date().toISOString(),
                changeSummary: 'Direct manual specification edit',
                previousContent: a.content,
                content: newContent,
              },
            ];

            const updatedArt: Artifact = {
              ...a,
              content: newContent,
              history: updatedHistory,
              updatedAt: new Date().toISOString(),
            };

            return {
              ...updatedArt,
              yamlDocument: serializeArtifactToYamlDoc(updatedArt),
            };
          }),
        };
      })
    );
  };

  // 9. Non-Destructive Version Rollback (Undo)
  const handleRestoreArtifactVersion = (
    artifactId: string,
    targetVersion: ArtifactVersion
  ) => {
    setProjects((prev) =>
      prev.map((proj) => {
        if (proj.id !== activeProjectId) return proj;
        return {
          ...proj,
          artifacts: proj.artifacts.map((a) => {
            if (a.id !== artifactId) return a;
            const currentHistory = a.history || [];
            const rollbackHistory: ArtifactVersion[] = [
              ...currentHistory,
              {
                version: currentHistory.length + 1,
                timestamp: new Date().toISOString(),
                changeSummary: `Restored to baseline of version ${targetVersion.version}`,
                previousContent: a.content,
                content: targetVersion.content,
              },
            ];

            const updatedArt: Artifact = {
              ...a,
              content: targetVersion.content,
              history: rollbackHistory,
              updatedAt: new Date().toISOString(),
            };

            return {
              ...updatedArt,
              yamlDocument: serializeArtifactToYamlDoc(updatedArt),
            };
          }),
        };
      })
    );
  };

  // 10. Add New Artifact (Ensures single-file YAML+MD string & Node)
  const handleAddArtifact = (newArt: Artifact) => {
    const artWithYaml: Artifact = {
      ...newArt,
      yamlDocument: serializeArtifactToYamlDoc(newArt),
    };

    const lastNode = activeProject.nodes[activeProject.nodes.length - 1];
    const newX = lastNode ? lastNode.x + 180 : 300;
    const newY = lastNode ? lastNode.y + 40 : 200;

    const newNode: GraphNode = {
      id: `node-${Date.now()}`,
      artifactId: artWithYaml.id,
      projectId: activeProject.id,
      title: artWithYaml.title,
      type: artWithYaml.type,
      isHighConcept: artWithYaml.isHighConcept,
      x: newX,
      y: newY,
      status: 'active',
      tags: artWithYaml.tags,
    };

    // Auto-link parent edge if specified
    const parentCodeToMatch = artWithYaml.graph?.parent;
    const parentArtifact = parentCodeToMatch
      ? activeProject.artifacts.find(
          (a) => a.code === parentCodeToMatch || a.id === parentCodeToMatch
        )
      : null;
    const parentNode = parentArtifact
      ? activeProject.nodes.find((n) => n.artifactId === parentArtifact.id)
      : null;

    const generatedEdges: GraphEdge[] = [];
    if (parentNode) {
      generatedEdges.push({
        id: `edge-${Date.now()}-parent`,
        sourceProjectId: activeProject.id,
        targetProjectId: activeProject.id,
        sourceNodeId: parentNode.id,
        targetNodeId: newNode.id,
        label: 'parent-spec',
        type: 'dependency',
        strength: 0.8,
      });
    }

    setProjects((prev) =>
      prev.map((proj) => {
        if (proj.id === activeProject.id) {
          return {
            ...proj,
            artifacts: [artWithYaml, ...proj.artifacts],
            nodes: [...proj.nodes, newNode],
            edges: [...proj.edges, ...generatedEdges],
          };
        }
        return proj;
      })
    );

    setSelectedArtifactId(artWithYaml.id);
  };

  // 11. Declare New Chapter or Subchapter (Timeline Split)
  const handleDeclareChapter = (
    messageId: string,
    title: string,
    level: 1 | 2 | 3
  ) => {
    setProjects((prev) =>
      prev.map((proj) => {
        if (proj.id !== activeProjectId) return proj;

        // Find which chapter contains this message
        let foundChapterIndex = -1;
        let messageIndexInChapter = -1;

        proj.chapters.forEach((chap, cIdx) => {
          const mIdx = chap.messages.findIndex((m) => m.id === messageId);
          if (mIdx !== -1) {
            foundChapterIndex = cIdx;
            messageIndexInChapter = mIdx;
          }
        });

        if (foundChapterIndex === -1) return proj;

        const targetChap = proj.chapters[foundChapterIndex];
        const keptMessages = targetChap.messages.slice(0, messageIndexInChapter);
        const movedMessages = targetChap.messages.slice(messageIndexInChapter);

        const newChapterId = `chap-${Date.now()}`;
        const newChapter: Chapter = {
          id: newChapterId,
          projectId: proj.id,
          parentId: level > 1 ? targetChap.id : undefined,
          level,
          title,
          summary: '',
          keyPoints: [],
          isSummarized: false,
          messages: movedMessages.map((m) => ({ ...m, chapterId: newChapterId })),
          status: 'active',
          compressionMode: 'full',
          topicShiftReason: `Declared ${level === 1 ? 'Chapter' : level === 2 ? 'Subchapter' : 'Section'} milestone`,
          createdAt: new Date().toISOString(),
        };

        const updatedChapters = [
          ...proj.chapters.slice(0, foundChapterIndex),
          { ...targetChap, messages: keptMessages },
          newChapter,
          ...proj.chapters.slice(foundChapterIndex + 1),
        ];

        return {
          ...proj,
          chapters: updatedChapters,
          currentChapterId: newChapterId,
        };
      })
    );
  };

  // 12. Summarize Chapter
  const handleSummarizeChapter = async (chapterId: string) => {
    const targetChapter = activeProject.chapters.find((c) => c.id === chapterId);
    if (!targetChapter) return;

    try {
      const res = await fetch('/api/summarize-chapter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: targetChapter.title,
          messages: targetChapter.messages,
        }),
      });
      const data = await res.json();

      setProjects((prev) =>
        prev.map((proj) => {
          if (proj.id !== activeProjectId) return proj;
          return {
            ...proj,
            chapters: proj.chapters.map((c) =>
              c.id === chapterId
                ? {
                    ...c,
                    summary: data.summary,
                    keyPoints: data.keyPoints || [],
                    isSummarized: true,
                    status: 'completed',
                  }
                : c
            ),
          };
        })
      );
    } catch (err) {
      console.error('Failed to summarize chapter:', err);
    }
  };

  // 13. Toggle Chapter Compression Mode
  const handleToggleChapterCompressionMode = (
    chapterId: string,
    mode: 'summary' | 'full' | 'dropped'
  ) => {
    setProjects((prev) =>
      prev.map((proj) => {
        if (proj.id !== activeProjectId) return proj;
        return {
          ...proj,
          chapters: proj.chapters.map((c) =>
            c.id === chapterId ? { ...c, compressionMode: mode } : c
          ),
        };
      })
    );
  };

  // 14. Send Chat Message (With Instant Acceptance of Synthesized Artifacts + Version History)
  const handleSendMessage = async (text: string) => {
    const currentActiveChapter =
      activeProject.chapters[activeProject.chapters.length - 1] ||
      activeProject.chapters[0];

    const userMessage: ChatMessage = {
      id: `m-${Date.now()}`,
      chapterId: currentActiveChapter.id,
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
    };

    // Append user message immediately
    setProjects((prev) =>
      prev.map((proj) => {
        if (proj.id !== activeProjectId) return proj;
        return {
          ...proj,
          chapters: proj.chapters.map((c) =>
            c.id === currentActiveChapter.id
              ? { ...c, messages: [...c.messages, userMessage] }
              : c
          ),
        };
      })
    );

    setIsChatLoading(true);

    try {
      // Compile context payload from active artifacts respecting abstraction levels
      const activeArtifactsText = activeProject.artifacts
        .filter((a) => a.resolution !== 'excluded')
        .map((a) => `# ${a.title} (${a.type})\n${a.summary || a.description}`)
        .join('\n\n');

      // Older chapter summaries respecting compressionMode
      const olderSummaries = activeProject.chapters
        .filter((c) => c.id !== currentActiveChapter.id && c.compressionMode !== 'dropped')
        .map((c) => ({
          title: c.title,
          summary: c.summary,
          keyPoints: c.keyPoints,
        }));

      const compiledHistory = currentActiveChapter.messages.concat(userMessage);

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: selectedModel.id,
          projectTitle: activeProject.name,
          currentTopic: currentActiveChapter.title,
          messages: compiledHistory,
          contextPayload: activeArtifactsText,
          chapterSummaries: olderSummaries,
        }),
      });

      const data = await res.json();

      const assistantMessage: ChatMessage = {
        id: `m-bot-${Date.now()}`,
        chapterId: currentActiveChapter.id,
        role: 'assistant',
        content: data.reply || 'Synthesized architecture verified.',
        timestamp: new Date().toISOString(),
        extractedArtifacts: data.artifacts || [],
      };

      setProjects((prev) =>
        prev.map((proj) => {
          if (proj.id !== activeProjectId) return proj;

          let updatedChapters = proj.chapters.map((c) =>
            c.id === currentActiveChapter.id
              ? { ...c, messages: [...c.messages, assistantMessage] }
              : c
          );

          let updatedArtifacts = [...proj.artifacts];
          let updatedNodes = [...proj.nodes];

          // No review gate / Approval-Free: Automatically ingest or update synthesized artifacts with history!
          if (data.artifacts && data.artifacts.length > 0) {
            data.artifacts.forEach((rawArt: any, idx: number) => {
              const code =
                rawArt.code ||
                rawArt.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30);
              const existingIndex = updatedArtifacts.findIndex(
                (a) => a.code === code || a.title.toLowerCase() === rawArt.title.toLowerCase()
              );

              if (existingIndex !== -1) {
                // Update existing artifact and record new version in history
                const old = updatedArtifacts[existingIndex];
                const newVersion = (old.history?.length || 1) + 1;
                const updatedHistory: ArtifactVersion[] = [
                  ...(old.history || []),
                  {
                    version: newVersion,
                    timestamp: new Date().toISOString(),
                    changeSummary: `Synthesized update from chat: ${rawArt.abstract || 'refined specification'}`,
                    previousContent: old.content,
                    content: rawArt.content,
                  },
                ];

                const modifiedArt: Artifact = {
                  ...old,
                  content: rawArt.content,
                  summary: rawArt.abstract || old.summary,
                  description: rawArt.abstract || old.description,
                  history: updatedHistory,
                  updatedAt: new Date().toISOString(),
                };
                modifiedArt.yamlDocument = serializeArtifactToYamlDoc(modifiedArt);
                updatedArtifacts[existingIndex] = modifiedArt;
              } else {
                // Synthesize new artifact
                const newArtifact: Artifact = {
                  id: `art-${Date.now()}-${idx}`,
                  projectId: proj.id,
                  code,
                  title: rawArt.title,
                  type: rawArt.type || 'architecture',
                  category: rawArt.category || 'system-spec',
                  description: rawArt.abstract || 'Synthesized architectural specification.',
                  summary: rawArt.abstract || 'Automated executive summary.',
                  content: rawArt.content,
                  graph: {
                    parent: rawArt.parent || undefined,
                    children: [],
                    relationships: [],
                    is_high_concept: Boolean(rawArt.highConcept),
                  },
                  isHighConcept: Boolean(rawArt.highConcept),
                  resolution: 'full',
                  history: [
                    {
                      version: 1,
                      timestamp: new Date().toISOString(),
                      changeSummary: 'Initial synthesis from architectural chat session',
                      content: rawArt.content,
                    },
                  ],
                  tags: ['chat-synthesized', rawArt.type || 'architecture'],
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                };
                newArtifact.yamlDocument = serializeArtifactToYamlDoc(newArtifact);
                updatedArtifacts.push(newArtifact);

                // Add spatial node
                const lastNode = updatedNodes[updatedNodes.length - 1];
                updatedNodes.push({
                  id: `node-${Date.now()}-${idx}`,
                  artifactId: newArtifact.id,
                  projectId: proj.id,
                  title: newArtifact.title,
                  type: newArtifact.type,
                  isHighConcept: newArtifact.isHighConcept,
                  x: lastNode ? lastNode.x + 180 : 300,
                  y: lastNode ? lastNode.y + 40 : 200,
                  status: 'active',
                });
              }
            });
          }

          // If Topic Shift was detected automatically:
          if (data.topicShift && data.topicShift.shiftDetected) {
            const newChapter: Chapter = {
              id: `chap-${Date.now()}`,
              projectId: proj.id,
              level: 1,
              title: data.topicShift.newChapterTitle || `Chapter ${proj.chapters.length + 1}`,
              summary: '',
              keyPoints: [],
              isSummarized: false,
              messages: [],
              status: 'active',
              compressionMode: 'full',
              topicShiftReason: data.topicShift.reason || 'Architectural topic pivot detected',
              createdAt: new Date().toISOString(),
            };

            handleSummarizeChapter(currentActiveChapter.id);
            updatedChapters = [...updatedChapters, newChapter];
          }

          return {
            ...proj,
            chapters: updatedChapters,
            artifacts: updatedArtifacts,
            nodes: updatedNodes,
            lastActivity: new Date().toISOString(),
          };
        })
      );
    } catch (err) {
      console.error('Error sending message:', err);
    } finally {
      setIsChatLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-[#0d121c] text-[#e3edf7] font-sans">
      {/* Top Header with Single-Task Switcher */}
      <Header
        projects={projects}
        activeProject={activeProject}
        onSelectProject={(p) => setActiveProjectId(p.id)}
        selectedModel={selectedModel}
        availableModels={AVAILABLE_MODELS}
        onSelectModel={setSelectedModel}
        totalTokens={tokenBreakdown.totalTokens}
        activeView={activeView}
        onChangeView={setActiveView}
        onOpenExport={() => setIsExportOpen(true)}
        onOpenImport={() => setIsImportOpen(true)}
        onOpenProjectLauncher={() => setIsProjectLauncherOpen(true)}
      />

      {/* Main Single-Focused Viewport */}
      <main className="flex-1 flex overflow-hidden relative pb-0">
        {activeView === 'chat' && (
          <div className="w-full h-full">
            <ChatView
              project={activeProject}
              onSendMessage={handleSendMessage}
              isLoading={isChatLoading}
              onAddArtifactToProject={handleAddArtifact}
              onSummarizeChapter={handleSummarizeChapter}
              onToggleChapterCompressionMode={handleToggleChapterCompressionMode}
              onDeclareChapter={handleDeclareChapter}
              onNavigateToGraph={() => setActiveView('graph')}
            />
          </div>
        )}

        {activeView === 'graph' && (
          <div className="w-full h-full relative">
            <SpatialGraph
              project={activeProject}
              onSelectArtifact={(art) => {
                setSelectedArtifactId(art.id);
                setActiveView('artifacts');
              }}
              onAddEdge={handleAddEdge}
              onUpdateNodePosition={handleUpdateNodePosition}
              onBatchUpdateNodePositions={handleBatchUpdateNodePositions}
            />
          </div>
        )}

        {activeView === 'artifacts' && (
          <div className="w-full h-full">
            <ArtifactsDesk
              project={activeProject}
              selectedArtifact={selectedArtifact}
              onSelectArtifact={(art) => setSelectedArtifactId(art.id)}
              onUpdateArtifactResolution={handleUpdateArtifactResolution}
              onUpdateArtifactContent={handleUpdateArtifactContent}
              onRestoreArtifactVersion={handleRestoreArtifactVersion}
            />
          </div>
        )}

        {activeView === 'tokens' && (
          <div className="w-full h-full">
            <ContextInspector
              project={activeProject}
              onUpdateAllArtifactsResolution={handleUpdateAllArtifactsResolution}
              onUpdateArtifactResolution={handleUpdateArtifactResolution}
              onToggleChapterCompression={() => {}}
            />
          </div>
        )}
      </main>

      {/* Mobile Bottom Navigation */}
      <MobileNav
        activeView={activeView}
        onChangeView={setActiveView}
        totalTokens={tokenBreakdown.totalTokens}
        onOpenProjectLauncher={() => setIsProjectLauncherOpen(true)}
      />

      {/* Project Launcher Screen / Modal */}
      {isProjectLauncherOpen && (
        <ProjectLauncher
          projects={projects}
          activeProjectId={activeProjectId}
          onSelectProjectAndLaunchChat={handleSelectProjectAndLaunchChat}
          onCreateProject={handleCreateProject}
          onClose={() => setIsProjectLauncherOpen(false)}
          isDismissable={true}
        />
      )}

      {/* Import Modal */}
      {isImportOpen && (
        <ImportModal
          project={activeProject}
          onClose={() => setIsImportOpen(false)}
          onImportArtifact={handleAddArtifact}
        />
      )}

      {/* Export Modal */}
      {isExportOpen && (
        <ExportModal
          projects={projects}
          activeProject={activeProject}
          onClose={() => setIsExportOpen(false)}
        />
      )}
    </div>
  );
}
