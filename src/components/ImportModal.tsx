import React, { useState, useEffect } from 'react';
import { Project, Artifact, ArtifactType } from '../types';
import { logger } from '../utils/logger';
import {
  googleSignIn,
  googleSignOut,
  initAuth,
  listDriveFiles,
  fetchDriveFileContent,
  fetchGoogleDocById,
  extractGoogleDocIdFromUrl,
  DriveFileItem,
  DriveFilterType,
} from '../services/googleDriveService';
import { User } from 'firebase/auth';
import { parseYamlArtifactDoc, serializeArtifactToYamlDoc } from '../utils/yamlArtifactParser';
import { estimateTokens } from '../utils/tokenCalculator';
import {
  Upload,
  FileText,
  FileCode,
  CheckCircle2,
  AlertCircle,
  X,
  Search,
  RefreshCw,
  FolderOpen,
  Sparkles,
  Loader2,
  ArrowRight,
  Tag,
  Plus,
  BookOpen,
  ExternalLink,
  Code2,
  Sliders,
} from 'lucide-react';

interface ImportModalProps {
  project: Project;
  onClose: () => void;
  onImportArtifact: (artifact: Artifact) => void;
}

export const ImportModal: React.FC<ImportModalProps> = ({
  project,
  onClose,
  onImportArtifact,
}) => {
  const [activeTab, setActiveTab] = useState<'upload' | 'drive'>('drive');
  const [previewMode, setPreviewMode] = useState<'form' | 'raw_yaml'>('form');

  // Artifact Form State
  const [uploadFileName, setUploadFileName] = useState('');
  const [uploadContent, setUploadContent] = useState('');
  const [artifactTitle, setArtifactTitle] = useState('');
  const [artifactCode, setArtifactCode] = useState('');
  const [artifactType, setArtifactType] = useState<ArtifactType>('note');
  const [isHighConcept, setIsHighConcept] = useState(false);
  const [artifactDescription, setArtifactDescription] = useState('');
  const [artifactSummary, setArtifactSummary] = useState('');
  const [artifactTags, setArtifactTags] = useState<string[]>([]);
  const [newTagInput, setNewTagInput] = useState('');
  const [parentCode, setParentCode] = useState('');
  const [isExtractingWithAI, setIsExtractingWithAI] = useState(false);
  const [extractedSuccess, setExtractedSuccess] = useState(false);

  // Google Drive & Docs State
  const [user, setUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [driveFiles, setDriveFiles] = useState<DriveFileItem[]>([]);
  const [driveFilter, setDriveFilter] = useState<DriveFilterType>('docs');
  const [isDriveLoading, setIsDriveLoading] = useState(false);
  const [driveSearch, setDriveSearch] = useState('');
  const [selectedDriveFile, setSelectedDriveFile] = useState<DriveFileItem | null>(null);
  const [conversionStatus, setConversionStatus] = useState<string | null>(null);
  const [driveError, setDriveError] = useState<string | null>(null);
  const [directDocUrl, setDirectDocUrl] = useState('');
  const [isFetchingDirectDoc, setIsFetchingDirectDoc] = useState(false);

  // Initialize auth state
  useEffect(() => {
    const unsubscribe = initAuth(
      (currentUser, token) => {
        setUser(currentUser);
        setAccessToken(token);
      },
      () => {
        setUser(null);
        setAccessToken(null);
      }
    );
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (accessToken && activeTab === 'drive') {
      loadDriveFiles();
    }
  }, [accessToken, activeTab, driveFilter]);

  const loadDriveFiles = async () => {
    if (!accessToken) return;
    setIsDriveLoading(true);
    setDriveError(null);
    try {
      const files = await listDriveFiles(accessToken, driveSearch, driveFilter);
      setDriveFiles(files);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to query Google Drive files';
      setDriveError(msg);
    } finally {
      setIsDriveLoading(false);
    }
  };

  const handleSignIn = async () => {
    setIsAuthLoading(true);
    setDriveError(null);
    try {
      const res = await googleSignIn();
      if (res) {
        setUser(res.user);
        setAccessToken(res.accessToken);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Google authentication failed';
      setDriveError(msg);
    } finally {
      setIsAuthLoading(false);
    }
  };

  const handleSignOut = async () => {
    await googleSignOut();
    setUser(null);
    setAccessToken(null);
    setDriveFiles([]);
    setSelectedDriveFile(null);
    setUploadContent('');
    setConversionStatus(null);
  };

  // Perform LLM extraction to generate YAML frontmatter + tentative tags
  const triggerAIExtraction = async (
    contentToExtract: string,
    filename: string,
    fileType: 'gdoc' | 'doc' = 'doc'
  ) => {
    if (!contentToExtract.trim()) return;
    setIsExtractingWithAI(true);
    try {
      const res = await fetch('/api/extract-artifact-from-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: contentToExtract,
          filename,
          projectTitle: project.name,
          fileType,
        }),
      });

      const data = await res.json();
      if (data.artifact) {
        setArtifactTitle(data.artifact.title || filename);
        setArtifactCode(data.artifact.code || filename.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
        setArtifactDescription(data.artifact.current?.t1_abstract || '');
        setArtifactSummary(data.artifact.current?.t2_summary || '');
        setArtifactType((data.artifact.type as ArtifactType) || 'note');
        setIsHighConcept(Boolean(data.artifact.graph?.is_high_concept));
        setParentCode(data.artifact.graph?.parent || '');

        if (Array.isArray(data.artifact.tags) && data.artifact.tags.length > 0) {
          setArtifactTags(data.artifact.tags);
        } else {
          setArtifactTags(['imported-gdoc', 'note']);
        }

        if (data.artifact.current?.t3_body) {
          setUploadContent(data.artifact.current.t3_body);
        }
        setExtractedSuccess(true);
      }
    } catch (err) {
      logger.error('ImportModal', 'LLM extraction failed', err);
    } finally {
      setIsExtractingWithAI(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadFileName(file.name);
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      setUploadContent(text);

      const parsed = parseYamlArtifactDoc(text, project.id);
      if (parsed.hasFrontmatter) {
        setArtifactTitle(parsed.artifact.title || '');
        setArtifactCode(parsed.artifact.code || '');
        setArtifactDescription(parsed.artifact.current?.t1_abstract || '');
        setArtifactSummary(parsed.artifact.current?.t2_summary || '');
        setArtifactType(parsed.artifact.type);
        setArtifactTags(parsed.artifact.tags || []);
        setIsHighConcept(Boolean(parsed.artifact.isHighConcept));
        setParentCode(parsed.artifact.graph?.parent || '');
        setExtractedSuccess(true);
      } else {
        triggerAIExtraction(text, file.name, 'doc');
      }
    };
    reader.readAsText(file);
  };

  // Select and convert a Google Doc or Drive file
  const handleSelectDriveFile = async (file: DriveFileItem) => {
    setSelectedDriveFile(file);
    if (!accessToken) return;
    setIsDriveLoading(true);
    setConversionStatus(null);
    setDriveError(null);

    try {
      const result = await fetchDriveFileContent(accessToken, file);
      const markdownContent = result.markdown;
      setUploadContent(markdownContent);
      setUploadFileName(file.name);

      if (file.isGoogleDoc) {
        setConversionStatus(
          `Converted Google Doc to Markdown (${markdownContent.split(/\s+/).length} words)`
        );
      } else {
        setConversionStatus(`Loaded ${file.name}`);
      }

      // Check if it already has frontmatter
      const parsed = parseYamlArtifactDoc(markdownContent, project.id);
      if (parsed.hasFrontmatter) {
        setArtifactTitle(parsed.artifact.title || '');
        setArtifactCode(parsed.artifact.code || '');
        setArtifactDescription(parsed.artifact.current?.t1_abstract || '');
        setArtifactSummary(parsed.artifact.current?.t2_summary || '');
        setArtifactType(parsed.artifact.type);
        setArtifactTags(parsed.artifact.tags || []);
        setIsHighConcept(Boolean(parsed.artifact.isHighConcept));
        setExtractedSuccess(true);
      } else {
        // Automatically extract YAML header with AI
        await triggerAIExtraction(
          markdownContent,
          file.name,
          file.isGoogleDoc ? 'gdoc' : 'doc'
        );
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to download and export file';
      setDriveError(msg);
    } finally {
      setIsDriveLoading(false);
    }
  };

  // Direct fetch by Google Doc URL or ID
  const handleFetchDirectDoc = async () => {
    if (!directDocUrl.trim() || !accessToken) return;
    const docId = extractGoogleDocIdFromUrl(directDocUrl);
    if (!docId) {
      setDriveError(
        'Please enter a valid Google Doc link (e.g. https://docs.google.com/document/d/...) or Document ID'
      );
      return;
    }

    setIsFetchingDirectDoc(true);
    setDriveError(null);
    setConversionStatus(null);
    try {
      const { title, markdown } = await fetchGoogleDocById(accessToken, docId);
      setUploadContent(markdown);
      setUploadFileName(title);
      setConversionStatus(`Exported "${title}" as Markdown (${markdown.split(/\s+/).length} words)`);

      // Automatically synthesize YAML artifact with AI
      await triggerAIExtraction(markdown, title, 'gdoc');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch Google Doc';
      setDriveError(msg);
    } finally {
      setIsFetchingDirectDoc(false);
    }
  };

  // Add / Remove Tags
  const handleAddTag = () => {
    const trimmed = newTagInput.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
    if (trimmed && !artifactTags.includes(trimmed)) {
      setArtifactTags([...artifactTags, trimmed]);
      setNewTagInput('');
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setArtifactTags(artifactTags.filter((t) => t !== tagToRemove));
  };

  // Save Artifact
  const handleConfirmImport = () => {
    logger.action('ImportModal', `Confirm import: ${artifactTitle || artifactCode}`);
    if (!uploadContent.trim()) return;

    const baseTitle =
      artifactTitle.trim() ||
      uploadFileName.replace(/\.[^/.]+$/, '') ||
      'Imported Google Doc Artifact';
    const baseCode =
      artifactCode.trim() ||
      baseTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30);

    const now = Date.now();
    const desc = artifactDescription.trim() || `Imported note: ${baseTitle}`;
    const summ =
      artifactSummary.trim() ||
      artifactDescription.trim() ||
      'Imported note.';

    const fullArtifact: Artifact = {
      id: `art-${now}-${Math.floor(Math.random() * 1000)}`,
      workspaceId: project.id,
      code: baseCode,
      title: baseTitle,
      type: 'document',
      category: 'note',
      isHighConcept,
      current: {
        t0_label: baseTitle,
        t1_abstract: desc,
        t2_summary: summ,
        t3_body: uploadContent,
      },
      tags: artifactTags.length > 0 ? artifactTags : ['google-docs', artifactType],
      createdAt: now,
      updatedAt: now,
      graph: {
        parent: parentCode.trim() || undefined,
        children: [],
        relationships: [],
        is_high_concept: isHighConcept,
      },
      resolution: 'full',
    };

    onImportArtifact(fullArtifact);
    onClose();
  };

  // Compute live YAML preview
  const liveYamlDocPreview = React.useMemo(() => {
    if (!uploadContent) return '';
    const now = Date.now();
    const title = artifactTitle || 'Specification Title';
    const desc = artifactDescription || 'Specification description';
    const summ = artifactSummary || 'Specification summary';

    const tempArt: Artifact = {
      id: `art-preview`,
      workspaceId: project.id,
      code: artifactCode || 'sample-spec',
      title,
      type: 'document',
      category: 'note',
      isHighConcept,
      tags: artifactTags,
      current: {
        t0_label: title,
        t1_abstract: desc,
        t2_summary: summ,
        t3_body: uploadContent,
      },
      createdAt: now,
      updatedAt: now,
      graph: {
        parent: parentCode || undefined,
        is_high_concept: isHighConcept,
      },
      resolution: 'full',
    };
    return serializeArtifactToYamlDoc(tempArt);
  }, [
    uploadContent,
    artifactCode,
    artifactTitle,
    artifactType,
    artifactDescription,
    artifactSummary,
    artifactTags,
    parentCode,
    isHighConcept,
  ]);

  return (
    <div className="fixed inset-0 z-50 bg-[#0a0e17]/85 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4">
      <div className="bg-[#101724] border border-[#080d15] rounded-2xl max-w-3xl w-full max-h-[92vh] flex flex-col shadow-2xl text-[#e3edf7] overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b border-[#080d15] flex items-center justify-between shrink-0 bg-[#0d131f]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#e05a66]/20 border border-[#e05a66]/30 flex items-center justify-center text-[#f28894]">
              <Upload className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-[#eef4fc] font-mono flex items-center gap-2">
                <span>Import Google Docs & Markdown</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#1e2a3f] text-[#8ab1e0] border border-[#080d15] font-normal">
                  YAML + Tags Synthesis
                </span>
              </h2>
              <p className="text-[11px] text-[#7d93b3]">
                Select Google Docs or local files to export as Markdown and synthesize YAML headers with cross-linking tags.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-[#1a2538] text-[#869ab8] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="flex border-b border-[#080d15] bg-[#0b0f17] text-xs font-mono shrink-0">
          <button
            onClick={() => setActiveTab('drive')}
            className={`flex-1 py-2.5 px-4 text-center border-b-2 transition-all flex items-center justify-center gap-2 ${
              activeTab === 'drive'
                ? 'border-[#e05a66] text-[#eef4fc] font-semibold bg-[#131b29]'
                : 'border-transparent text-[#627794] hover:text-[#9bb0d1]'
            }`}
          >
            <FolderOpen className="w-4 h-4 text-[#4285F4]" />
            <span>Google Drive & Docs</span>
          </button>

          <button
            onClick={() => setActiveTab('upload')}
            className={`flex-1 py-2.5 px-4 text-center border-b-2 transition-all flex items-center justify-center gap-2 ${
              activeTab === 'upload'
                ? 'border-[#e05a66] text-[#eef4fc] font-semibold bg-[#131b29]'
                : 'border-transparent text-[#627794] hover:text-[#9bb0d1]'
            }`}
          >
            <FileCode className="w-4 h-4 text-[#8ab1e0]" />
            <span>Local File (.md / .txt)</span>
          </button>
        </div>

        {/* Tab Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {activeTab === 'drive' && (
            <div className="space-y-4">
              {!user ? (
                <div className="p-8 text-center space-y-4 bg-[#0d121c] rounded-xl border border-[#080d15]">
                  <div className="w-12 h-12 rounded-2xl bg-[#4285F4]/15 border border-[#4285F4]/30 flex items-center justify-center mx-auto text-[#4285F4]">
                    <BookOpen className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-[#eef4fc] mb-1 font-mono">
                      Connect Google Docs & Drive
                    </h3>
                    <p className="text-xs text-[#8297b5] max-w-md mx-auto">
                      Import Google Docs directly. MarkBrain exports them to Markdown and uses Gemini to turn them into notes with summaries and tags.
                    </p>
                  </div>

                  <button
                    onClick={handleSignIn}
                    disabled={isAuthLoading}
                    className="px-5 py-2.5 rounded-xl bg-[#e05a66] hover:bg-[#be3a49] text-white text-xs font-mono font-medium transition-all shadow-lg inline-flex items-center gap-2 cursor-pointer"
                  >
                    {isAuthLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    <span>Sign in with Google</span>
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Auth Header */}
                  <div className="flex items-center justify-between text-xs text-[#7d93b3] p-2.5 bg-[#0d121c] rounded-xl border border-[#080d15]">
                    <div className="flex items-center gap-2 truncate">
                      <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                      <span className="truncate">
                        Connected as <strong className="text-white font-mono">{user.email}</strong>
                      </span>
                    </div>
                    <button
                      onClick={handleSignOut}
                      className="text-xs text-[#e05a66] hover:underline shrink-0"
                    >
                      Disconnect
                    </button>
                  </div>

                  {/* Filter Pills & Search */}
                  <div className="flex flex-col sm:flex-row gap-2">
                    <div className="flex items-center gap-1 bg-[#0b0f17] p-1 rounded-xl border border-[#080d15] text-[11px] font-mono shrink-0">
                      <button
                        onClick={() => setDriveFilter('docs')}
                        className={`px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 ${
                          driveFilter === 'docs'
                            ? 'bg-[#4285F4] text-white font-semibold'
                            : 'text-[#7d93b3] hover:text-white'
                        }`}
                      >
                        <BookOpen className="w-3.5 h-3.5" />
                        <span>Google Docs</span>
                      </button>

                      <button
                        onClick={() => setDriveFilter('all')}
                        className={`px-3 py-1.5 rounded-lg transition-colors ${
                          driveFilter === 'all'
                            ? 'bg-[#1e2a3f] text-white font-semibold'
                            : 'text-[#7d93b3] hover:text-white'
                        }`}
                      >
                        <span>All Files</span>
                      </button>

                      <button
                        onClick={() => setDriveFilter('markdown')}
                        className={`px-3 py-1.5 rounded-lg transition-colors ${
                          driveFilter === 'markdown'
                            ? 'bg-[#1e2a3f] text-white font-semibold'
                            : 'text-[#7d93b3] hover:text-white'
                        }`}
                      >
                        <span>Markdown</span>
                      </button>
                    </div>

                    <div className="relative flex-1">
                      <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-[#52657e]" />
                      <input
                        type="text"
                        placeholder="Search Google Docs & Drive..."
                        value={driveSearch}
                        onChange={(e) => setDriveSearch(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && loadDriveFiles()}
                        className="w-full bg-[#0d121c] border border-[#080d15] rounded-xl pl-8 pr-3 py-1.5 text-xs text-[#eef4fc] focus:outline-none focus:border-[#e05a66]/50"
                      />
                    </div>
                  </div>

                  {driveError && (
                    <div className="p-3 bg-[#261317] border border-[#3d161d] rounded-xl text-xs text-[#f7aab3] flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>{driveError}</span>
                    </div>
                  )}

                  {/* Drive Files List */}
                  {isDriveLoading ? (
                    <div className="p-6 text-center text-xs font-mono text-[#8ab1e0]">
                      <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2 text-[#e05a66]" />
                      Querying Google Drive documents...
                    </div>
                  ) : (
                    <div className="max-h-52 overflow-y-auto space-y-1.5 pr-1">
                      {driveFiles.length === 0 ? (
                        <div className="p-6 text-center text-xs text-[#677b94] font-mono">
                          No {driveFilter === 'docs' ? 'Google Docs' : 'documents'} found.
                        </div>
                      ) : (
                        driveFiles.map((file) => (
                          <div
                            key={file.id}
                            onClick={() => handleSelectDriveFile(file)}
                            className={`p-2.5 rounded-xl border text-xs cursor-pointer flex items-center justify-between transition-colors ${
                              selectedDriveFile?.id === file.id
                                ? 'bg-[#182338] border-[#e05a66]'
                                : 'bg-[#0d121c] border-[#080d15] hover:border-[#1d293d]'
                            }`}
                          >
                            <div className="flex items-center gap-2.5 truncate">
                              {file.isGoogleDoc ? (
                                <span className="p-1 rounded bg-[#4285F4]/20 text-[#4285F4] shrink-0">
                                  <BookOpen className="w-3.5 h-3.5" />
                                </span>
                              ) : (
                                <span className="p-1 rounded bg-[#1e2a3f] text-[#8ab1e0] shrink-0">
                                  <FileText className="w-3.5 h-3.5" />
                                </span>
                              )}
                              <span className="truncate text-[#eef4fc] font-medium">{file.name}</span>
                              {file.isGoogleDoc && (
                                <span className="text-[9px] px-1.5 py-0.2 rounded bg-[#4285F4]/15 text-[#6ba4fc] border border-[#4285F4]/30 font-mono shrink-0">
                                  Google Doc
                                </span>
                              )}
                            </div>

                            <span className="text-[10px] font-mono text-[#52657e] shrink-0 ml-2">
                              {file.modifiedTime ? new Date(file.modifiedTime).toLocaleDateString() : ''}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  )}

                  {conversionStatus && (
                    <div className="p-2 bg-[#102419] border border-[#0d2a1b] rounded-xl flex items-center justify-between text-xs font-mono text-[#6ee7b7]">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 shrink-0" />
                        <span>{conversionStatus}</span>
                      </div>
                      <span className="text-[10px] text-[#84cca4]">
                        ~{estimateTokens(uploadContent)} tokens
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {activeTab === 'upload' && (
            <div className="space-y-4">
              <label className="border-2 border-dashed border-[#141d2c] hover:border-[#e05a66]/50 rounded-xl p-5 flex flex-col items-center justify-center gap-2 cursor-pointer transition-colors bg-[#0a0e17]/50">
                <FileCode className="w-8 h-8 text-[#8ab1e0]" />
                <span className="text-xs text-[#c2d1e0] font-medium">
                  {uploadFileName ? uploadFileName : 'Tap to select Markdown or Plain Text file'}
                </span>
                <span className="text-[10px] text-[#627794]">
                  Accepts .md, .markdown, .txt (up to 5MB)
                </span>
                <input
                  type="file"
                  accept=".md,.markdown,.txt"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>
            </div>
          )}

          {/* AI Extraction State Indicator */}
          {isExtractingWithAI && (
            <div className="p-3 bg-[#142033] border border-[#080d15] rounded-xl flex items-center gap-2 text-xs font-mono text-[#8ab1e0]">
              <Loader2 className="w-4 h-4 animate-spin text-[#e05a66]" />
              <span>
                Gemini LLM analyzing document, generating YAML metadata, abstract, and cross-linking tags...
              </span>
            </div>
          )}

          {/* Result Editor & Review */}
          {uploadContent && (
            <div className="space-y-3 bg-[#0d121c] p-3.5 rounded-xl border border-[#080d15]">
              {/* Review Bar */}
              <div className="flex items-center justify-between border-b border-[#080d15] pb-2.5">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-[#e05a66] uppercase font-bold flex items-center gap-1">
                    <Sparkles className="w-3 h-3" />
                    YAML Artifact Synthesis
                  </span>
                  <span className="text-[10px] font-mono text-[#5f7491]">
                    ({uploadContent.split(/\s+/).length} words · ~{estimateTokens(uploadContent)} tokens)
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <div className="flex bg-[#141b29] p-0.5 rounded-lg border border-[#080d15] text-[10px] font-mono">
                    <button
                      type="button"
                      onClick={() => setPreviewMode('form')}
                      className={`px-2 py-0.5 rounded transition-colors ${
                        previewMode === 'form' ? 'bg-[#e05a66] text-white' : 'text-[#7d93b3]'
                      }`}
                    >
                      Fields
                    </button>
                    <button
                      type="button"
                      onClick={() => setPreviewMode('raw_yaml')}
                      className={`px-2 py-0.5 rounded transition-colors ${
                        previewMode === 'raw_yaml' ? 'bg-[#e05a66] text-white' : 'text-[#7d93b3]'
                      }`}
                    >
                      Raw YAML+MD
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      triggerAIExtraction(
                        uploadContent,
                        uploadFileName || 'document.md',
                        selectedDriveFile?.isGoogleDoc ? 'gdoc' : 'doc'
                      )
                    }
                    disabled={isExtractingWithAI}
                    className="text-[10px] font-mono text-[#8ab1e0] hover:text-white flex items-center gap-1"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>Re-synthesize</span>
                  </button>
                </div>
              </div>

              {previewMode === 'raw_yaml' ? (
                <div className="space-y-1">
                  <label className="block text-[10px] font-mono text-[#788fa8]">
                    Single-File YAML Frontmatter + Markdown Document
                  </label>
                  <pre className="bg-[#090d14] p-3 rounded-lg border border-[#080d15] text-xs font-mono text-[#cbd5e1] max-h-72 overflow-y-auto whitespace-pre-wrap">
                    {liveYamlDocPreview}
                  </pre>
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Title & Code */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] font-mono text-[#788fa8] mb-1">
                        Title (Few words)
                      </label>
                      <input
                        type="text"
                        value={artifactTitle}
                        onChange={(e) => setArtifactTitle(e.target.value)}
                        className="w-full bg-[#141b29] border border-[#080d15] rounded-lg px-2.5 py-1.5 text-xs text-[#eef4fc] focus:outline-none focus:border-[#e05a66]/50"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-mono text-[#788fa8] mb-1">
                        Code / Handle (Kebab-case slug)
                      </label>
                      <input
                        type="text"
                        value={artifactCode}
                        onChange={(e) => setArtifactCode(e.target.value)}
                        className="w-full bg-[#141b29] border border-[#080d15] rounded-lg px-2.5 py-1.5 text-xs font-mono text-[#8ab1e0] focus:outline-none focus:border-[#e05a66]/50"
                      />
                    </div>
                  </div>

                  {/* Tags Editor */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[10px] font-mono text-[#788fa8] flex items-center gap-1">
                        <Tag className="w-3 h-3 text-[#e05a66]" />
                        <span>Tags (Embedded in YAML for tentative cross-linking)</span>
                      </label>
                      <span className="text-[10px] font-mono text-[#5a6f87]">
                        {artifactTags.length} tags
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 p-2 bg-[#141b29] border border-[#080d15] rounded-lg min-h-[38px]">
                      {artifactTags.map((tag) => (
                        <span
                          key={tag}
                          className="inline-flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded-full bg-[#1e2a3f] text-[#8ab1e0] border border-[#080d15]"
                        >
                          #{tag}
                          <button
                            type="button"
                            onClick={() => handleRemoveTag(tag)}
                            className="hover:text-red-400 ml-0.5"
                          >
                            ×
                          </button>
                        </span>
                      ))}

                      <div className="flex items-center gap-1">
                        <input
                          type="text"
                          placeholder="add tag..."
                          value={newTagInput}
                          onChange={(e) => setNewTagInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleAddTag();
                            }
                          }}
                          className="bg-transparent border-none text-[11px] font-mono text-white placeholder-[#52657e] focus:outline-none w-20"
                        />
                        <button
                          type="button"
                          onClick={handleAddTag}
                          className="p-1 rounded hover:bg-[#202d42] text-[#8ab1e0]"
                          title="Add tag"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Short Description */}
                  <div>
                    <label className="block text-[10px] font-mono text-[#788fa8] mb-1">
                      Short Description (Few phrases)
                    </label>
                    <input
                      type="text"
                      value={artifactDescription}
                      onChange={(e) => setArtifactDescription(e.target.value)}
                      className="w-full bg-[#141b29] border border-[#080d15] rounded-lg px-2.5 py-1.5 text-xs text-[#eef4fc] focus:outline-none focus:border-[#e05a66]/50"
                    />
                  </div>

                  {/* Summary */}
                  <div>
                    <label className="block text-[10px] font-mono text-[#788fa8] mb-1">
                      Summary of Contents (Executive abstract)
                    </label>
                    <textarea
                      rows={2}
                      value={artifactSummary}
                      onChange={(e) => setArtifactSummary(e.target.value)}
                      className="w-full bg-[#141b29] border border-[#080d15] rounded-lg p-2 text-xs text-[#eef4fc] focus:outline-none focus:border-[#e05a66]/50 resize-none"
                    />
                  </div>

                  {/* Parent & High Concept */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] font-mono text-[#788fa8] mb-1">
                        Parent Graph Node (Optional slug)
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. combat-loop"
                        value={parentCode}
                        onChange={(e) => setParentCode(e.target.value)}
                        className="w-full bg-[#141b29] border border-[#080d15] rounded-lg px-2.5 py-1.5 text-xs font-mono text-[#8ab1e0] focus:outline-none focus:border-[#e05a66]/50"
                      />
                    </div>

                    <div className="flex items-center gap-2 pt-4">
                      <input
                        type="checkbox"
                        id="isHighConcept"
                        checked={isHighConcept}
                        onChange={(e) => setIsHighConcept(e.target.checked)}
                        className="accent-[#e05a66] rounded cursor-pointer"
                      />
                      <label htmlFor="isHighConcept" className="text-xs text-[#c2d1e0] cursor-pointer">
                        High-Concept (Can bridge project boundaries)
                      </label>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 bg-[#0d121c] border-t border-[#080d15] flex items-center justify-between shrink-0">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-xl text-xs font-mono text-[#7d93b3] hover:text-white"
          >
            Cancel
          </button>

          <button
            onClick={handleConfirmImport}
            disabled={!uploadContent.trim()}
            className="px-4 py-2 rounded-xl bg-[#e05a66] hover:bg-[#be3a49] disabled:opacity-40 text-white font-medium text-xs font-mono transition-all shadow-md flex items-center gap-1.5 cursor-pointer"
          >
            <span>Import YAML Artifact</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
