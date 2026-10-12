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
import { ActiveView } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { SpatialGraph } from './components/SpatialGraph';
import { ChatView } from './components/ChatView';
import { ImportModal } from './components/ImportModal';
import { ExportModal } from './components/ExportModal';
import { ProjectLauncher } from './components/ProjectLauncher';
import { useWorkspaceStore } from './store/workspaceStore';
import { compileOpticalContext, projectToWorkspaceState } from './services/contextCompiler';
import { parseStreamTurn } from './services/streamProtocol';

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
  const opticalMode = useWorkspaceStore((s) => s.opticalMode);
  const setOpticalMode = useWorkspaceStore((s) => s.setOpticalMode);

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
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
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

  // Real Optical Context Engine Compilation
  const compiledContext = useMemo(() => {
    const ws = projectToWorkspaceState(
      activeProject,
      opticalMode,
      selectedArtifactId ? [selectedArtifactId] : []
    );
    return compileOpticalContext(ws, 32000);
  }, [activeProject, opticalMode, selectedArtifactId]);

  // Real Token Footprint & Saturation Breakdown directly from Context Compiler
  const tokenBreakdown = useMemo(() => {
    const tb = compiledContext.telemetry.token_breakdown;
    const nd = compiledContext.telemetry.node_distribution;
    return {
      artifactsTokens: tb.substrate_tokens,
      activeChapterTokens: Math.round(tb.history_tokens * 0.7),
      olderChaptersTokens: Math.round(tb.history_tokens * 0.3),
      systemPromptTokens: tb.system_tokens,
      totalTokens: tb.total_tokens,
      artifactsCount: nd.tier_3_count + nd.tier_2_count + nd.tier_1_count + nd.tier_0_count,
      activeChaptersCount: 1,
      olderChaptersCount: Math.max(0, activeProject.chapters.length - 1),
      estimatedCost: `$${((tb.total_tokens / 1_000_000) * 0.15 * (selectedModel.costMultiplier || 1)).toFixed(5)}`,
    };
  }, [compiledContext, activeProject.chapters.length, selectedModel]);

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

  // 5. Add Edge - wires topological graph edge and syncs artifact relations
  const handleAddEdge = (edge: GraphEdge) => {
    setProjects((prev) =>
      prev.map((proj) => {
        const targetProjId = edge.sourceProjectId || activeProjectId;
        if (proj.id === targetProjId) {
          const sNode = proj.nodes.find((n) => n.id === edge.sourceNodeId);
          const tNode = proj.nodes.find((n) => n.id === edge.targetNodeId);
          const sArtId = sNode?.artifactId || edge.sourceNodeId;
          const tArtId = tNode?.artifactId || edge.targetNodeId;

          const updatedArtifacts = proj.artifacts.map((a) => {
            if (a.id === sArtId && tArtId) {
              const rels = a.relations || [];
              if (!rels.some((r) => r.target_artifact_id === tArtId)) {
                return {
                  ...a,
                  relations: [...rels, { target_artifact_id: tArtId, kind: 'relates_to' as const }],
                };
              }
            }
            if (a.id === tArtId && sArtId) {
              const rels = a.relations || [];
              if (!rels.some((r) => r.target_artifact_id === sArtId)) {
                return {
                  ...a,
                  relations: [...rels, { target_artifact_id: sArtId, kind: 'relates_to' as const }],
                };
              }
            }
            return a;
          });

          return {
            ...proj,
            edges: [...proj.edges, edge],
            artifacts: updatedArtifacts,
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
      title: artWithYaml.title || artWithYaml.current?.t0_label || 'Untitled',
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

  // 11. Declare New Chapter (Timeline Split)
  const handleDeclareChapter = (
    messageId: string,
    title: string
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
          title,
          summary: '',
          keyPoints: [],
          isSummarized: false,
          messages: movedMessages.map((m) => ({ ...m, chapterId: newChapterId })),
          status: 'active',
          compressionMode: 'full',
          topicShiftReason: 'Split chapter boundary',
          createdAt: new Date().toISOString(),
        };

        const updatedChapters = [
          ...proj.chapters.slice(0, foundChapterIndex),
          { ...targetChap, messages: keptMessages, status: 'completed' as const },
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
      // Compile REAL Optical Context from graph topology and depth-of-field
      const wsWithUserMessage = projectToWorkspaceState(
        {
          ...activeProject,
          chapters: activeProject.chapters.map((c) =>
            c.id === currentActiveChapter.id
              ? { ...c, messages: [...c.messages, userMessage] }
              : c
          ),
        },
        opticalMode,
        selectedArtifactId ? [selectedArtifactId] : []
      );

      const compiled = compileOpticalContext(wsWithUserMessage, 32000);

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: selectedModel.id,
          projectTitle: activeProject.name,
          compiledPrompt: compiled.compiledPrompt,
          systemInstruction: compiled.systemInstruction,
        }),
      });

      const data = await res.json();
      const rawText = data.rawReply || data.reply || '';
      const parsedTurn = parseStreamTurn(rawText, activeProject.id);

      const cleanReplyText = parsedTurn.cleanContent || data.reply || 'Synthesized architecture verified.';

      const extractedList = [
        ...(data.artifacts || []),
        ...parsedTurn.artifactUpserts.map((u) => ({
          title: u.title,
          type: u.type,
          abstract: u.content.t1_abstract,
          summary: u.content.t2_summary,
          content: u.content.t3_body,
          highConcept: false,
        })),
      ];

      const assistantMessage: ChatMessage = {
        id: `m-bot-${Date.now()}`,
        chapterId: currentActiveChapter.id,
        role: 'assistant',
        content: cleanReplyText,
        timestamp: new Date().toISOString(),
        extractedArtifacts: extractedList,
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
                (a) => a.code === code || (a.title && a.title.toLowerCase() === (rawArt.title || '').toLowerCase())
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
                const now = Date.now();
                const artTitle = rawArt.title || 'Synthesized Artifact';
                const artDesc = rawArt.abstract || 'Synthesized architectural specification.';
                const artSumm = rawArt.abstract || 'Automated executive summary.';
                const artContent = rawArt.content || `# ${artTitle}\n\nSynthesized specification.`;

                const newArtifact: Artifact = {
                  id: `art-${now}-${idx}`,
                  workspace_id: proj.id,
                  projectId: proj.id,
                  code,
                  title: artTitle,
                  type: 'document',
                  category: rawArt.category || 'system-spec',
                  description: artDesc,
                  summary: artSumm,
                  content: artContent,
                  created_at: now,
                  updated_at: now,
                  current: {
                    t0_label: artTitle,
                    t1_abstract: artDesc,
                    t2_summary: artSumm,
                    t3_body: artContent,
                  },
                  revisions: [],
                  relations: [
                    { target_artifact_id: currentActiveChapter.id, kind: 'born_from' },
                  ],
                  provenance: {
                    origin_chapter_id: currentActiveChapter.id,
                    mutation_chapter_ids: [],
                  },
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
                      content: artContent,
                    },
                  ],
                  tags: ['chat-synthesized', rawArt.type || 'architecture'],
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                };
                newArtifact.yamlDocument = serializeArtifactToYamlDoc(newArtifact);
                updatedArtifacts.push(newArtifact);

                // Add spatial node linked to artifact
                const lastNode = updatedNodes[updatedNodes.length - 1];
                const newNodeId = `node-${Date.now()}-${idx}`;
                updatedNodes.push({
                  id: newNodeId,
                  artifactId: newArtifact.id,
                  projectId: proj.id,
                  title: artTitle,
                  type: newArtifact.type,
                  isHighConcept: newArtifact.isHighConcept,
                  x: lastNode ? lastNode.x + 180 : 300,
                  y: lastNode ? lastNode.y + 40 : 200,
                  status: 'active',
                });
              }
            });
          }

          let updatedEdges = [...proj.edges];

          // Process any extracted links from the model stream
          if (parsedTurn.links.length > 0) {
            parsedTurn.links.forEach((link, lIdx) => {
              const sArt = updatedArtifacts.find((a) => a.id === link.source || a.code === link.source);
              const tArt = updatedArtifacts.find((a) => a.id === link.target || a.code === link.target);
              if (sArt && tArt) {
                if (!sArt.relations.some((r) => r.target_artifact_id === tArt.id)) {
                  sArt.relations.push({ target_artifact_id: tArt.id, kind: link.kind });
                }
                const sNode = updatedNodes.find((n) => n.artifactId === sArt.id);
                const tNode = updatedNodes.find((n) => n.artifactId === tArt.id);
                if (sNode && tNode) {
                  updatedEdges.push({
                    id: `edge-link-${Date.now()}-${lIdx}`,
                    sourceNodeId: sNode.id,
                    targetNodeId: tNode.id,
                    label: link.kind,
                  });
                }
              }
            });
          }

          // If Topic Shift was detected automatically (XML tag or JSON block):
          const shift = parsedTurn.topicShift || (data.topicShift?.shiftDetected ? data.topicShift : null);
          if (shift) {
            const shiftTitle = shift.title || shift.newChapterTitle || `Chapter ${proj.chapters.length + 1}`;
            const newChapterId = `chap-${Date.now()}`;
            const newChapter: Chapter = {
              id: newChapterId,
              projectId: proj.id,
              title: shiftTitle,
              summary: shift.summary || shift.abstract || '',
              keyPoints: shift.summary ? [shift.summary] : [],
              isSummarized: false,
              messages: [],
              status: 'active',
              compressionMode: 'full',
              topicShiftReason: shift.reason || shift.abstract || 'Topic progression',
              createdAt: new Date().toISOString(),
            };

            // Mark previous active chapter as completed
            updatedChapters = updatedChapters.map((c) =>
              c.id === currentActiveChapter.id ? { ...c, status: 'completed' as const } : c
            );
            updatedChapters.push(newChapter);

            return {
              ...proj,
              chapters: updatedChapters,
              artifacts: updatedArtifacts,
              nodes: updatedNodes,
              edges: updatedEdges,
              currentChapterId: newChapterId,
              lastActivity: new Date().toISOString(),
            };
          }

          return {
            ...proj,
            chapters: updatedChapters,
            artifacts: updatedArtifacts,
            nodes: updatedNodes,
            edges: updatedEdges,
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
    <div className="flex h-screen w-screen overflow-hidden bg-[#0d121c] text-[#e3edf7] font-sans relative p-0 m-0">
      {/* Extensible Left Sidebar with Floating Toggle */}
      <Sidebar
        isOpen={isSidebarOpen}
        onToggle={() => setIsSidebarOpen((prev) => !prev)}
        projects={projects}
        activeProject={activeProject}
        onSelectProject={(p) => setActiveProjectId(p.id)}
        selectedModel={selectedModel}
        availableModels={AVAILABLE_MODELS}
        onSelectModel={setSelectedModel}
        totalTokens={tokenBreakdown.totalTokens}
        activeView={activeView === 'graph' ? 'graph' : 'chat'}
        onChangeView={(v) => setActiveView(v)}
        opticalMode={opticalMode}
        onToggleOpticalMode={() => {
          const next =
            opticalMode === 'autofocus'
              ? 'manual'
              : opticalMode === 'manual'
              ? 'myopia'
              : 'autofocus';
          setOpticalMode(next);
        }}
        onOpenExport={() => setIsExportOpen(true)}
        onOpenImport={() => setIsImportOpen(true)}
        onOpenProjectLauncher={() => setIsProjectLauncherOpen(true)}
      />

      {/* Main Single-Focused Viewport - starts from pixel 0, zero top bar */}
      <main className="flex-1 h-full flex overflow-hidden relative p-0 m-0">
        {/* Layer B: Base Conversation Canvas */}
        <div className="flex-1 h-full relative overflow-hidden p-0 m-0">
          {activeView === 'graph' ? (
            <div className="w-full h-full relative">
              <SpatialGraph
                project={activeProject}
                onSelectArtifact={(art) => {
                  setSelectedArtifactId(art.id);
                  setActiveView('chat');
                }}
                onAddEdge={handleAddEdge}
                onUpdateNodePosition={handleUpdateNodePosition}
                onBatchUpdateNodePositions={handleBatchUpdateNodePositions}
              />
            </div>
          ) : (
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

          {/* Layer A: The Floating Token Orb (Top-Right ambient indicator) */}
          <div
            className="absolute top-3 right-4 z-30 flex items-center gap-1.5 px-2 py-1 rounded-full bg-[#0d1421]/90 backdrop-blur-md border border-[#080d15] shadow-lg pointer-events-auto cursor-pointer"
            title={`Optical Token Saturation: ${Math.round(
              tokenBreakdown.totalTokens
            ).toLocaleString()} tokens (${opticalMode.toUpperCase()} mode)`}
            onClick={() => {
              const next =
                opticalMode === 'autofocus'
                  ? 'manual'
                  : opticalMode === 'manual'
                  ? 'myopia'
                  : 'autofocus';
              setOpticalMode(next);
            }}
          >
            <div
              className={`w-2.5 h-2.5 rounded-full transition-colors ${
                tokenBreakdown.totalTokens > 100000
                  ? 'bg-[#e05a66] shadow-[0_0_6px_#e05a66]'
                  : tokenBreakdown.totalTokens > 50000
                  ? 'bg-[#e0b96c] shadow-[0_0_6px_#e0b96c]'
                  : 'bg-[#5ad49b] shadow-[0_0_6px_#5ad49b]'
              }`}
            />
            <span className="text-[10px] font-mono text-[#8ab1e0]">
              {Math.round(tokenBreakdown.totalTokens / 1000)}k
            </span>
          </div>
        </div>

        {/* Layer A: 5px Edge Bar on absolute right edge (Zero Footprint Telemetry) */}
        <div
          className="w-[5px] h-full shrink-0 flex flex-col bg-[#0b1018] border-l border-[#080d15] z-30"
          title="Peripheral Ambient Telemetry: Red=Detail/Focus (T3), Yellow=Summary (T2), Blue=Title (T0)"
        >
          {/* Red = Detail / Tier 3 (Focus) */}
          <div
            className="w-full bg-[#e05a66] transition-all duration-300"
            style={{
              height: `${Math.max(
                10,
                Math.min(
                  70,
                  (tokenBreakdown.activeChapterTokens / (tokenBreakdown.totalTokens || 1)) * 100
                )
              )}%`,
            }}
          />
          {/* Yellow = Summary / Tier 2 */}
          <div
            className="w-full bg-[#e0b96c] transition-all duration-300"
            style={{
              height: `${Math.max(
                15,
                Math.min(
                  60,
                  (tokenBreakdown.olderChaptersTokens / (tokenBreakdown.totalTokens || 1)) * 100
                )
              )}%`,
            }}
          />
          {/* Blue = Title / Tier 0 */}
          <div
            className="w-full bg-[#5d87b8] flex-1 transition-all duration-300"
          />
        </div>
      </main>

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
