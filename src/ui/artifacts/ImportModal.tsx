import React, { useState, useEffect } from 'react';
import { Artifact, ArtifactType } from '../../types';
import type { ProjectMetadata } from '../../domains/00-workspace/types';
import { logger } from '../../utils/logger';
import {
  googleSignIn,
  googleSignOut,
  googleReconnect,
  initAuth,
  verifyDriveScopes,
  openGooglePicker,
  isGooglePickerEnabled,
  fetchDriveFileContent,
  fetchGoogleDocById,
  extractGoogleDocIdFromUrl,
  DriveFileItem,
} from '../../services/googleDriveService';
import { User } from 'firebase/auth';
import { parseYamlArtifactDoc, serializeArtifactToYamlDoc } from '../../utils/yamlArtifactParser';
import { estimateTokens } from '../../utils/tokenCalculator';
import { ImportSessionApi } from './import/useImportSession';
import { extractArtifactFromFile } from '../../gateway/api';
import { ImportSessionList } from './import/ImportSessionList';
import {
  Upload,
  FileCode,
  CheckCircle2,
  AlertCircle,
  X,
  RefreshCw,
  FolderOpen,
  Sparkles,
  Loader2,
  ArrowRight,
  Tag,
  Plus,
  BookOpen,
} from 'lucide-react';

interface ImportModalProps {
  project: ProjectMetadata;
  artifacts: Artifact[];
  onClose: () => void;
  /** Drive-tab single-file confirm (title-idempotent upsert, historic behavior). */
  onImportArtifact: (artifact: Artifact) => void;
  /** Multi-file session, owned by App so it survives this modal closing. */
  session: ImportSessionApi;
  /** Hide this modal and open ArtifactDetailModal for a landed row. */
  onOpenArtifact: (artifactId: string) => void;
}

export const ImportModal: React.FC<ImportModalProps> = ({
  project,
  artifacts,
  onClose,
  onImportArtifact,
  session,
  onOpenArtifact,
}) => {
  const [activeTab, setActiveTab] = useState<'upload' | 'drive'>('drive');
  const [previewMode, setPreviewMode] = useState<'form' | 'raw_yaml'>('form');

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

  const [user, setUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  // 'checking' → verifying scopes, 'missing' → Google granted only basic
  // permissions (the insufficient-scopes trap), 'ok' → Drive access confirmed.
  const [scopeStatus, setScopeStatus] = useState<'unknown' | 'checking' | 'ok' | 'missing'>('unknown');
  const [isDriveLoading, setIsDriveLoading] = useState(false);
  const [selectedDriveFile, setSelectedDriveFile] = useState<DriveFileItem | null>(null);
  const [conversionStatus, setConversionStatus] = useState<string | null>(null);
  const [driveError, setDriveError] = useState<string | null>(null);
  const [directDocUrl, setDirectDocUrl] = useState('');
  const [isFetchingDirectDoc, setIsFetchingDirectDoc] = useState(false);

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
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Verify the token actually carries Drive scopes BEFORE any Drive call,
  // so we can offer a Reconnect instead of Google's raw 403 error.
  useEffect(() => {
    if (!accessToken) {
      setScopeStatus('unknown');
      return;
    }
    let cancelled = false;
    setScopeStatus('checking');
    verifyDriveScopes(accessToken).then((result) => {
      if (cancelled) return;
      setScopeStatus(result.granted ? 'ok' : 'missing');
    });
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

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
    setSelectedDriveFile(null);
    setUploadContent('');
    setConversionStatus(null);
  };

  // Disconnect + fresh consent — fixes "Connected but every Drive call 403s
  // with insufficient authentication scopes" (stale, narrower Google grant).
  const handleReconnect = async () => {
    setIsAuthLoading(true);
    setDriveError(null);
    try {
      const res = await googleReconnect();
      if (res) {
        setUser(res.user);
        setAccessToken(res.accessToken);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Google re-authorization failed';
      setDriveError(msg);
    } finally {
      setIsAuthLoading(false);
    }
  };

  // Locked while extraction/fetch is in flight: a second triggerAIExtraction
  // racing the first would clobber fields with whichever response lands last.
  const handleResetSource = () => {
    if (sourceBusy) return;
    setSelectedDriveFile(null);
    setUploadContent('');
    setUploadFileName('');
    setArtifactTitle('');
    setArtifactCode('');
    setArtifactDescription('');
    setArtifactSummary('');
    setArtifactTags([]);
    setArtifactType('architecture');
    setIsHighConcept(false);
    setParentCode('');
    setNewTagInput('');
    setConversionStatus(null);
    setExtractedSuccess(false);
    setDriveError(null);
    setDirectDocUrl('');
  };

  const triggerAIExtraction = async (
    contentToExtract: string,
    filename: string,
    fileType: 'gdoc' | 'doc' = 'doc'
  ) => {
    if (!contentToExtract.trim()) return;
    setIsExtractingWithAI(true);
    try {
      // Extraction can take ~113–135s; cap at 120s so the UI always recovers.
      const res = await extractArtifactFromFile(
        {
          content: contentToExtract,
          filename,
          projectTitle: project.name,
          fileType,
        },
        { signal: AbortSignal.timeout(120_000) }
      );

      const data = await res.json();
      if (data.artifact) {
        setArtifactTitle(data.artifact.title || filename);
        setArtifactCode(data.artifact.code || filename.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
        setArtifactDescription(data.artifact.current?.description || data.artifact.description || '');
        setArtifactSummary(data.artifact.current?.summary || data.artifact.summary || '');
        setArtifactType((data.artifact.type as ArtifactType) || 'note');
        setIsHighConcept(Boolean(data.artifact.graph?.is_high_concept));
        setParentCode(data.artifact.graph?.parent || '');

        if (Array.isArray(data.artifact.tags) && data.artifact.tags.length > 0) {
          setArtifactTags(data.artifact.tags);
        } else {
          setArtifactTags(['imported-gdoc', 'note']);
        }

        const extractedBody = data.artifact.current?.body || data.artifact.content;
        if (extractedBody) {
          setUploadContent(extractedBody);
        }
        setExtractedSuccess(true);
      }
    } catch (err) {
      const timedOut = err instanceof DOMException && err.name === 'TimeoutError';
      logger.error(
        'ImportModal',
        timedOut ? 'LLM extraction timed out after 120s' : 'LLM extraction failed',
        err
      );
    } finally {
      setIsExtractingWithAI(false);
    }
  };

  // Multi-file: every selected file becomes a session row, processed as we go.
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) session.addFiles(files);
    // Reset so re-selecting the same file(s) fires onChange again.
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer?.files?.length) session.addFiles(e.dataTransfer.files);
  };

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
        setArtifactDescription(parsed.artifact.current?.description || '');
        setArtifactSummary(parsed.artifact.current?.summary || '');
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

  // Open Google's hosted file picker, then import the chosen file
  const handleOpenPicker = async () => {
    if (!accessToken) return;
    setDriveError(null);
    setIsDriveLoading(true);
    try {
      const picked = await openGooglePicker(accessToken);
      if (picked) {
        await handleSelectDriveFile({
          id: picked.id,
          name: picked.name,
          mimeType: picked.mimeType,
          isGoogleDoc: picked.mimeType === 'application/vnd.google-apps.document',
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to open Google Picker';
      setDriveError(msg);
    } finally {
      setIsDriveLoading(false);
    }
  };

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
        description: desc,
        summary: summ,
        body: uploadContent,
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
    };

    onImportArtifact(fullArtifact);
    onClose();
  };

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
        description: desc,
        summary: summ,
        body: uploadContent,
      },
      createdAt: now,
      updatedAt: now,
      graph: {
        parent: parentCode || undefined,
        is_high_concept: isHighConcept,
      },
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

  // Source-selection lock: while a file is loaded (or being fetched /
  // extracted) the Browse/Fetch controls are replaced by a source bar —
  // clicking them mid-decomposition would race the extraction response.
  const sourceBusy = isExtractingWithAI || isDriveLoading || isFetchingDirectDoc;
  const sourceLocked = Boolean(uploadContent || selectedDriveFile) || sourceBusy;
  const pickerEnabled = isGooglePickerEnabled();

  return (
    <div className="fixed inset-0 z-50 bg-surface-0/85 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4">
      <div className="bg-surface-2 rounded-2xl max-w-3xl w-full max-h-[92vh] flex flex-col shadow-pop text-ink overflow-hidden">
        <div className="p-4 flex items-center justify-between shrink-0 bg-surface-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-wash-danger flex items-center justify-center text-[#f28894]">
              <Upload className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-ink font-mono flex items-center gap-2">
                <span>Import Google Docs & Markdown</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-4 text-ink-dim font-normal">
                  Markdown → YAML
                </span>
              </h2>
              <p className="text-[11px] text-[#7d93b3]">
                Select Google Docs or local files to export as Markdown and synthesize YAML headers with cross-linking tags.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-surface-3 text-[#869ab8] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex bg-surface-1 text-xs font-mono shrink-0">
          <button
            onClick={() => setActiveTab('drive')}
            className={`flex-1 py-2.5 px-4 text-center border-b-2 transition-all flex items-center justify-center gap-2 ${
              activeTab === 'drive'
                ? 'border-brand text-ink font-semibold bg-surface-3'
                : 'border-transparent text-ink-mute hover:text-ink-dim'
            }`}
          >
            <FolderOpen className="w-4 h-4 text-[#4285F4]" />
            <span>Google Drive & Docs</span>
          </button>

          <button
            onClick={() => setActiveTab('upload')}
            className={`flex-1 py-2.5 px-4 text-center border-b-2 transition-all flex items-center justify-center gap-2 ${
              activeTab === 'upload'
                ? 'border-brand text-ink font-semibold bg-surface-3'
                : 'border-transparent text-ink-mute hover:text-ink-dim'
            }`}
          >
            <FileCode className="w-4 h-4 text-[#8ab1e0]" />
            <span>Local Files (.md / .txt)</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {activeTab === 'drive' && (
            <div className="space-y-4">
              {!user ? (
                <div className="p-8 text-center space-y-4 bg-surface-1 rounded-xl">
                  <div className="w-12 h-12 rounded-2xl bg-[#4285F4]/15 flex items-center justify-center mx-auto text-[#4285F4]">
                    <BookOpen className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-ink mb-1 font-mono">
                      Connect Google Docs & Drive
                    </h3>
                    <p className="text-xs text-[#8297b5] max-w-md mx-auto">
                      Import Google Docs directly. MarkBrain exports them to Markdown and uses Gemini to turn them into notes with summaries and tags.
                    </p>
                  </div>

                  <button
                    onClick={handleSignIn}
                    disabled={isAuthLoading}
                    className="px-5 py-2.5 rounded-xl bg-[#e05a66] hover:bg-[#be3a49] text-ink text-xs font-mono font-medium transition-all shadow-lg inline-flex items-center gap-2 cursor-pointer"
                  >
                    {isAuthLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    <span>Sign in with Google</span>
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs text-ink-mute p-2.5 bg-surface-1 rounded-xl">
                    <div className="flex items-center gap-2 truncate">
                      <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                      <span className="truncate">
                        Connected as <strong className="text-ink font-mono">{user.email}</strong>
                      </span>
                    </div>
                    <button
                      onClick={handleSignOut}
                      className="text-xs text-[#e05a66] hover:underline shrink-0"
                    >
                      Disconnect
                    </button>
                  </div>

                  {scopeStatus === 'checking' && (
                    <div className="p-2.5 bg-surface-1 rounded-xl text-xs font-mono text-ink-dim flex items-center gap-2">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Verifying Google Drive permissions…</span>
                    </div>
                  )}

                  {scopeStatus === 'missing' && (
                    <div className="p-3 bg-wash-warn rounded-xl flex items-center justify-between gap-3 text-xs text-[#f0c674]">
                      <span className="flex items-start gap-2">
                        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                        <span>
                          Signed in <strong>without</strong> Google Drive access — Google reused an older,
                          narrower grant for this app. Reconnect to approve Drive &amp; Docs.
                        </span>
                      </span>
                      <button
                        onClick={handleReconnect}
                        disabled={isAuthLoading}
                        className="px-3 py-1.5 rounded-lg bg-[#e05a66] hover:bg-[#be3a49] text-ink font-mono text-[11px] shrink-0 disabled:opacity-50 inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        {isAuthLoading ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="w-3.5 h-3.5" />
                        )}
                        <span>Reconnect</span>
                      </button>
                    </div>
                  )}

                  {driveError && (
                    <div className="p-3 bg-wash-danger rounded-xl text-xs text-[#f7aab3] flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>{driveError}</span>
                    </div>
                  )}

                  {sourceLocked ? (
                    <div className="p-3 bg-surface-1 rounded-xl flex items-center justify-between gap-3">
                      <div className="min-w-0 space-y-0.5">
                        <div className="text-[10px] font-mono text-[#788fa8] uppercase">Source</div>
                        <div className="text-xs text-ink font-mono truncate">
                          {uploadFileName || selectedDriveFile?.name || 'document'}
                        </div>
                        {isExtractingWithAI && (
                          <div className="text-[10px] text-[#8ab1e0]">
                            Gemini is still extracting — changing source unlocks when it finishes.
                          </div>
                        )}
                      </div>
                      <button
                        onClick={handleResetSource}
                        disabled={sourceBusy}
                        className="px-3 py-1.5 rounded-lg bg-surface-4 hover:bg-veil-1 disabled:opacity-40 text-[#8ab1e0] text-[11px] font-mono shrink-0 inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>Choose different</span>
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="space-y-1.5">
                        <button
                          onClick={handleOpenPicker}
                          disabled={!pickerEnabled || scopeStatus !== 'ok' || sourceBusy || isAuthLoading}
                          title={
                            pickerEnabled
                              ? undefined
                              : 'Unfinished — Google Picker is disabled for now. Paste a Google Doc link below to import instead.'
                          }
                          className="w-full px-4 py-2.5 rounded-xl bg-[#4285F4] hover:bg-[#3367d6] disabled:opacity-40 disabled:cursor-not-allowed text-ink text-xs font-mono font-medium transition-all inline-flex items-center justify-center gap-2 cursor-pointer"
                        >
                          <FolderOpen className="w-4 h-4" />
                          <span>Browse Google Drive…</span>
                        </button>
                        <p className="text-[10px] text-[#627794] text-center">
                          {pickerEnabled
                            ? "Opens Google's file picker to choose a Google Doc or Markdown file."
                            : 'Unfinished feature — disabled for now. Paste a Google Doc link below instead.'}
                        </p>
                      </div>

                      <div className="space-y-1.5 pt-3">
                        <label className="block text-[10px] font-mono text-[#788fa8]">
                          …or paste a Google Docs / Drive link
                        </label>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={directDocUrl}
                            onChange={(e) => setDirectDocUrl(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleFetchDirectDoc()}
                            placeholder="https://docs.google.com/document/d/..."
                            className="flex-1 min-w-0 bg-recess-1 rounded-xl px-3 py-1.5 text-xs text-ink focus:outline-none focus:bg-recess-2 shadow-well"
                          />
                          <button
                            onClick={handleFetchDirectDoc}
                            disabled={!directDocUrl.trim() || sourceBusy || scopeStatus !== 'ok'}
                            className="px-3 py-1.5 rounded-xl bg-surface-4 hover:bg-veil-1 disabled:opacity-40 text-[#8ab1e0] text-xs font-mono transition-colors inline-flex items-center gap-1.5 shrink-0 cursor-pointer"
                          >
                            {isFetchingDirectDoc && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                            <span>Fetch</span>
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                  {isDriveLoading && selectedDriveFile && (
                    <div className="p-6 text-center text-xs font-mono text-[#8ab1e0]">
                      <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2 text-[#e05a66]" />
                      Exporting and converting {selectedDriveFile.name} to Markdown…
                    </div>
                  )}

                  {conversionStatus && (
                    <div className="p-2 bg-wash-success rounded-xl flex items-center justify-between text-xs font-mono text-[#6ee7b7]">
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
              {/* Set BEFORE adding files; applied at each row-land.
                  Precedence: row override > frontmatter parent > batch default. */}
              <div className="bg-surface-1 rounded-xl p-2.5 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono text-[#e05a66] uppercase font-bold">
                    Batch rules (optional)
                  </span>
                  <span className="text-[9px] font-mono text-[#5f7491]">
                    applied to every file as it lands
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    id="batch-parent"
                    list="batch-parent-codes"
                    type="text"
                    placeholder="Parent (slug — pick an existing code or type)"
                    value={session.rules.parent}
                    onChange={(e) => session.setRules((r) => ({ ...r, parent: e.target.value }))}
                    className="w-full bg-recess-1 rounded-lg px-2.5 py-1.5 text-[11px] font-mono text-[#8ab1e0] focus:outline-none focus:bg-recess-2 shadow-well"
                  />
                  <datalist id="batch-parent-codes">
                    {artifacts.map((a) => (
                      <option key={a.id} value={a.code || a.id} />
                    ))}
                  </datalist>
                  <input
                    id="batch-tags"
                    type="text"
                    placeholder="Tags, comma-separated — appended to each"
                    value={session.rules.tags.join(', ')}
                    onChange={(e) =>
                      session.setRules((r) => ({
                        ...r,
                        tags: e.target.value
                          .split(',')
                          .map((t) => t.trim().toLowerCase().replace(/[^a-z0-9_-]/g, ''))
                          .filter(Boolean),
                      }))
                    }
                    className="w-full bg-recess-1 rounded-lg px-2.5 py-1.5 text-[11px] font-mono text-[#8ab1e0] focus:outline-none focus:bg-recess-2 shadow-well"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono">
                  <span className="text-[#788fa8] text-[10px]">Relate all →</span>
                  <select
                    id="batch-rel-type"
                    value={session.rules.relType}
                    onChange={(e) => session.setRules((r) => ({ ...r, relType: e.target.value }))}
                    className="bg-recess-1 rounded-lg px-2 py-1.5 text-[11px] text-[#c2d1e0] focus:outline-none cursor-pointer shadow-well"
                  >
                    <option value="">(no relationship)</option>
                    <option value="cites">cites</option>
                    <option value="belongs-to">belongs-to</option>
                    <option value="responds-to">responds-to</option>
                    <option value="related">related</option>
                  </select>
                  <span className="text-[#556985]">→</span>
                  <select
                    id="batch-rel-target"
                    value={session.rules.relTargetId}
                    onChange={(e) => session.setRules((r) => ({ ...r, relTargetId: e.target.value }))}
                    disabled={!session.rules.relType || artifacts.length === 0}
                    className="bg-recess-1 rounded-lg px-2 py-1.5 text-[11px] text-[#c2d1e0] focus:outline-none cursor-pointer disabled:opacity-40 max-w-[220px] shadow-well"
                  >
                    <option value="">
                      {artifacts.length === 0 ? '(no artifacts yet)' : '(pick target)'}
                    </option>
                    {artifacts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.title}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <label
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
                className="border-2 border-dashed border-line hover:border-brand rounded-xl p-5 flex flex-col items-center justify-center gap-2 transition-colors bg-surface-0/50 cursor-pointer"
              >
                <FileCode className="w-8 h-8 text-[#8ab1e0]" />
                <span className="text-xs text-[#c2d1e0] font-medium">
                  Select or drop multiple Markdown / Plain Text files
                </span>
                <span className="text-[10px] text-[#627794]">
                  Accepts .md, .markdown, .txt (up to 5MB each) — they process as a queue, one by one
                </span>
                <input
                  type="file"
                  accept=".md,.markdown,.txt"
                  multiple
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>

              <ImportSessionList
                rows={session.rows}
                running={session.running}
                onRetry={session.retryRow}
                onDismiss={session.dismissRow}
                onCancelRemaining={session.cancelRemaining}
                onOpenArtifact={onOpenArtifact}
                onParentOverride={session.setParentOverride}
              />
            </div>
          )}

          {activeTab === 'drive' && isExtractingWithAI && (
            <div className="p-3 bg-surface-3 rounded-xl flex items-center gap-2 text-xs font-mono text-ink-dim">
              <Loader2 className="w-4 h-4 animate-spin text-[#e05a66]" />
              <span>
                Gemini LLM analyzing document, generating YAML metadata, abstract, and cross-linking tags...
              </span>
            </div>
          )}

          {activeTab === 'drive' && uploadContent && (
            <div className="space-y-3 bg-surface-1 p-3.5 rounded-xl">
              <div className="flex items-center justify-between pb-2.5">
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
                  <div className="flex bg-surface-3 p-0.5 rounded-lg text-[10px] font-mono">
                    <button
                      type="button"
                      onClick={() => setPreviewMode('form')}
                      className={`px-2 py-0.5 rounded transition-colors ${
                        previewMode === 'form' ? 'bg-[#e05a66] text-ink' : 'text-[#7d93b3]'
                      }`}
                    >
                      Fields
                    </button>
                    <button
                      type="button"
                      onClick={() => setPreviewMode('raw_yaml')}
                      className={`px-2 py-0.5 rounded transition-colors ${
                        previewMode === 'raw_yaml' ? 'bg-[#e05a66] text-ink' : 'text-[#7d93b3]'
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
                    className="text-[10px] font-mono text-[#8ab1e0] hover:text-ink flex items-center gap-1"
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
                  <pre className="bg-surface-0 p-3 rounded-lg text-xs font-mono text-[#cbd5e1] max-h-72 overflow-y-auto whitespace-pre-wrap">
                    {liveYamlDocPreview}
                  </pre>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] font-mono text-[#788fa8] mb-1">
                        Title (Few words)
                      </label>
                      <input
                        type="text"
                        value={artifactTitle}
                        onChange={(e) => setArtifactTitle(e.target.value)}
                        className="w-full bg-recess-1 rounded-lg px-2.5 py-1.5 text-xs text-ink focus:outline-none focus:bg-recess-2 shadow-well"
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
                        className="w-full bg-recess-1 rounded-lg px-2.5 py-1.5 text-xs font-mono text-[#8ab1e0] focus:outline-none focus:bg-recess-2 shadow-well"
                      />
                    </div>
                  </div>

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

                    <div className="flex flex-wrap items-center gap-1.5 p-2 bg-surface-1 rounded-lg min-h-[38px]">
                      {artifactTags.map((tag) => (
                        <span
                          key={tag}
                          className="inline-flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded-full bg-surface-3 text-ink-dim"
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
                          className="bg-transparent border-none text-[11px] font-mono text-ink placeholder-[#52657e] focus:outline-none w-20"
                        />
                        <button
                          type="button"
                          onClick={handleAddTag}
                          className="p-1 rounded hover:bg-surface-4 text-[#8ab1e0]"
                          title="Add tag"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] font-mono text-[#788fa8] mb-1">
                      Short Description (Few phrases)
                    </label>
                    <input
                      type="text"
                      value={artifactDescription}
                      onChange={(e) => setArtifactDescription(e.target.value)}
                      className="w-full bg-recess-1 rounded-lg px-2.5 py-1.5 text-xs text-ink focus:outline-none focus:bg-recess-2 shadow-well"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-mono text-[#788fa8] mb-1">
                      Summary of Contents (Executive abstract)
                    </label>
                    <textarea
                      rows={2}
                      value={artifactSummary}
                      onChange={(e) => setArtifactSummary(e.target.value)}
                      className="w-full bg-recess-1 rounded-lg p-2 text-xs text-ink focus:outline-none focus:bg-recess-2 resize-none shadow-well"
                    />
                  </div>

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
                        className="w-full bg-recess-1 rounded-lg px-2.5 py-1.5 text-xs font-mono text-[#8ab1e0] focus:outline-none focus:bg-recess-2 shadow-well"
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

        <div className="p-3 bg-surface-2 flex items-center justify-between shrink-0">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-xl text-xs font-mono text-[#7d93b3] hover:text-ink"
          >
            {activeTab === 'upload' ? 'Close' : 'Cancel'}
          </button>

          {activeTab === 'drive' ? (
            <button
              onClick={handleConfirmImport}
              disabled={!uploadContent.trim()}
              className="px-4 py-2 rounded-xl bg-[#e05a66] hover:bg-[#be3a49] disabled:opacity-40 text-ink font-medium text-xs font-mono transition-all shadow-md flex items-center gap-1.5 cursor-pointer"
            >
              <span>Import note</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          ) : (
            <span className="text-[10px] font-mono text-[#627794]">
              {session.rows.length > 0
                ? `${session.rows.filter((r) => r.status === 'landed').length}/${session.rows.length} landed`
                : 'Rows land automatically — close anytime, the queue keeps running'}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
