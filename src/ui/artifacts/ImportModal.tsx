import React, { useState, useEffect } from 'react';
import { Artifact, ArtifactType } from '../../types';
import type { ProjectMetadata } from '../../domains/00-workspace/types';
import { logger } from '../../utils/logger';
import { parseYamlArtifactDoc, serializeArtifactToYamlDoc } from '../../utils/yamlArtifactParser';
import { estimateTokens } from '../../utils/tokenCalculator';
import { ImportSessionApi } from './import/useImportSession';
import { extractArtifactFromFile } from '../../gateway/api';
import { getModelForSlot } from '../../data/modelConfig';
import { ImportSessionList } from './import/ImportSessionList';
import {
  Upload,
  FileCode,
  X,
  Tag,
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
  const [activeTab, setActiveTab] = useState<'upload'>('upload');
  const [previewMode, setPreviewMode] = useState<'form' | 'raw_yaml'>('form');

  const [uploadFileName, setUploadFileName] = useState('');
  const [uploadContent, setUploadContent] = useState('');
  const [artifactTitle, setArtifactTitle] = useState('');
  const [artifactCode, setArtifactCode] = useState('');
  const [artifactType, setArtifactType] = useState<ArtifactType>('note');
  const [isHighConcept, setIsHighConcept] = useState(false);
  const [artifactDescription, setArtifactDescription] = useState('');
  const [artifactSubtitle, setArtifactSubtitle] = useState('');
  const [artifactSummary, setArtifactSummary] = useState('');
  const [artifactTags, setArtifactTags] = useState<string[]>([]);
  const [newTagInput, setNewTagInput] = useState('');
  const [parentCode, setParentCode] = useState('');
  const [isExtractingWithAI, setIsExtractingWithAI] = useState(false);
  const [extractedSuccess, setExtractedSuccess] = useState(false);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) session.addFiles(files);
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer?.files?.length) session.addFiles(e.dataTransfer.files);
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
    const sub = artifactSubtitle.trim();
    const desc = artifactDescription.trim() || `Imported note: ${baseTitle}`;
    const summ = artifactSummary.trim();

    const fullArtifact: Artifact = {
      id: `art-${now}-${Math.floor(Math.random() * 1000)}`,
      workspaceId: project.id,
      code: baseCode,
      title: baseTitle,
      type: 'document',
      category: 'note',
      isHighConcept,
      current: {
        subtitle: sub,
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
    const sub = artifactSubtitle || 'Specification subtitle';
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
        subtitle: sub,
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
    artifactSubtitle,
    artifactDescription,
    artifactSummary,
    artifactTags,
    parentCode,
    isHighConcept,
  ]);

  // Source-selection lock: while a file is loaded (or being fetched /
  // extracted) the Browse/Fetch controls are replaced by a source bar —
  // clicking them mid-decomposition would race the extraction response.
  const sourceBusy = isExtractingWithAI;
  const sourceLocked = Boolean(uploadContent) || sourceBusy;

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
                <span>Import Markdown & Text Files</span>
                <span className="text-10 px-1.5 py-0.5 rounded bg-surface-4 text-ink-dim font-normal">
                  Markdown → YAML
                </span>
              </h2>
              <p className="text-11 text-[#7d93b3]">
                Drop local .md / .txt files into the multi-file session queue below.
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

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {(
            <div className="space-y-4">
              {/* Set BEFORE adding files; applied at each row-land.
                  Precedence: row override > frontmatter parent > batch default. */}
              <div className="bg-surface-1 rounded-xl p-2.5 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-10 font-mono text-[#e05a66] uppercase font-bold">
                    Batch rules (optional)
                  </span>
                  <span className="text-9 font-mono text-[#5f7491]">
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
                    className="w-full bg-recess-1 rounded-lg px-2.5 py-1.5 text-11 font-mono text-[#8ab1e0] focus:outline-none focus:bg-recess-2 shadow-well"
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
                    className="w-full bg-recess-1 rounded-lg px-2.5 py-1.5 text-11 font-mono text-[#8ab1e0] focus:outline-none focus:bg-recess-2 shadow-well"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2 text-11 font-mono">
                  <span className="text-[#788fa8] text-10">Relate all →</span>
                  <select
                    id="batch-rel-type"
                    value={session.rules.relType}
                    onChange={(e) => session.setRules((r) => ({ ...r, relType: e.target.value }))}
                    className="bg-recess-1 rounded-lg px-2 py-1.5 text-11 text-[#c2d1e0] focus:outline-none cursor-pointer shadow-well"
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
                    className="bg-recess-1 rounded-lg px-2 py-1.5 text-11 text-[#c2d1e0] focus:outline-none cursor-pointer disabled:opacity-40 max-w-[220px] shadow-well"
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
                <span className="text-10 text-[#627794]">
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


        </div>

        <div className="p-3 bg-surface-2 flex items-center justify-between shrink-0">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-xl text-xs font-mono text-[#7d93b3] hover:text-ink"
          >
            Close
          </button>

          {(

            <span className="text-10 font-mono text-[#627794]">
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
