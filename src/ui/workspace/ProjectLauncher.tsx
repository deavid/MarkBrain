import React, { useState } from 'react';
import type { ProjectMetadata } from '../../domains/00-workspace/types';
import { getTokenColor } from '../../utils/tokenCalculator';
import {
  FolderOpen,
  Plus,
  ArrowRight,
  Brain,
  Gamepad2,
  Layers,
  Sparkles,
  FileCode,
  Clock,
  ChevronRight,
  X,
  Trash2,
  AlertTriangle,
} from 'lucide-react';

interface ProjectLauncherProps {
  projects: ProjectMetadata[];
  activeProjectId: string;
  onSelectProjectAndLaunchChat: (projectId: string) => void;
  onCreateProject: (name: string, description: string, codeName: string, color: string) => void;
  /** Permanent delete — routed through the persistence port (any backend). */
  onDeleteProject?: (projectId: string) => Promise<void>;
  onClose?: () => void;
  isDismissable?: boolean;
}

export const ProjectLauncher: React.FC<ProjectLauncherProps> = ({
  projects,
  activeProjectId,
  onSelectProjectAndLaunchChat,
  onCreateProject,
  onDeleteProject,
  onClose,
  isDismissable = false,
}) => {
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCodeName, setNewCodeName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [selectedColor, setSelectedColor] = useState('#be3a49');
  // Delete flow: pendingDelete holds the target until the user confirms.
  const [pendingDelete, setPendingDelete] = useState<ProjectMetadata | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const colorOptions = [
    { label: 'Ruby Crimson', value: '#be3a49' },
    { label: 'Royal Purple', value: '#8c52ff' },
    { label: 'Deep Blue', value: '#3b82f6' },
    { label: 'Emerald Sage', value: '#10b981' },
    { label: 'Amber Gold', value: '#eab308' },
  ];

  const handleNameChange = (val: string) => {
    setNewName(val);
    if (!newCodeName || newCodeName === newName.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 20)) {
      setNewCodeName(val.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 20));
    }
  };

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    onCreateProject(
      newName.trim(),
      newDescription.trim() || 'Thinking space.',
      newCodeName.trim() || newName.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      selectedColor
    );
    setIsCreating(false);
    setNewName('');
    setNewCodeName('');
    setNewDescription('');
  };

  const handleConfirmDelete = async () => {
    if (!pendingDelete || !onDeleteProject) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await onDeleteProject(pendingDelete.id);
      setPendingDelete(null);
    } catch (err: any) {
      setDeleteError(err?.message || 'Delete failed.');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-surface-0/95 backdrop-blur-md flex flex-col p-4 sm:p-6 overflow-y-auto">
      <div className="max-w-3xl w-full mx-auto flex items-center justify-between pb-4 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#e05a66] to-[#8c52ff] flex items-center justify-center shadow-lg shadow-[#e05a66]/20">
            <Brain className="w-4 h-4 text-ink" />
          </div>
          <div>
            <h1 className="text-base sm:text-lg font-bold text-ink font-mono tracking-tight flex items-center gap-2">
              MarkBrain
              <span className="text-[10px] font-mono font-normal px-2 py-0.5 rounded-full bg-surface-3 text-[#8ab1e0] ">
                Workspace Deck
              </span>
            </h1>
            <p className="text-xs text-[#869ab8]">One screen, one job: Select your project or spawn a new idea.</p>
          </div>
        </div>

        {isDismissable && onClose && (
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl bg-surface-2 hover:bg-surface-4 text-[#8ca3c7] transition-colors"
            title="Return to active project"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      <div className="max-w-3xl w-full mx-auto py-6 space-y-6 flex-1">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-surface-1 p-4 rounded-2xl">
          <div>
            <h2 className="text-sm font-semibold text-ink">What project do you want to open?</h2>
            <p className="text-xs text-[#7d93b3] mt-0.5">
              Projects encompass your artifacts, connected spatial graphs, and continuous chapter chat.
            </p>
          </div>
          {!isCreating && (
            <button
              onClick={() => setIsCreating(true)}
              className="inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-xl bg-[#e05a66] hover:bg-[#be3a49] text-ink font-medium text-xs shadow-md shadow-[#e05a66]/20 transition-all shrink-0 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Create New Project</span>
            </button>
          )}
        </div>

        {isCreating && (
          <form
            onSubmit={handleCreateSubmit}
            className="bg-surface-2 p-4 sm:p-5 rounded-2xl space-y-4 shadow-xl animate-in fade-in slide-in-from-top-2 duration-200"
          >
            <div className="flex items-center justify-between pb-2">
              <span className="text-xs font-mono font-bold text-[#e05a66] uppercase flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5" />
                Initialize New Project Container
              </span>
              <button
                type="button"
                onClick={() => setIsCreating(false)}
                className="text-xs text-[#7d93b3] hover:text-ink"
              >
                Cancel
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-mono text-[#869ab8] mb-1">
                  Project Title (e.g. Unhaunter Game, MarkBrain)
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Novel Draft Notes"
                  value={newName}
                  onChange={(e) => handleNameChange(e.target.value)}
                  className="w-full bg-recess-1 rounded-xl px-3 py-2 text-xs text-ink placeholder-[#50637f] focus:outline-none shadow-well"
                />
              </div>

              <div>
                <label className="block text-[11px] font-mono text-[#869ab8] mb-1">
                  Identifier / Handle (Slug)
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. NOVEL"
                  value={newCodeName}
                  onChange={(e) => setNewCodeName(e.target.value)}
                  className="w-full bg-recess-1 rounded-xl px-3 py-2 text-xs font-mono text-[#8ab1e0] placeholder-[#50637f] focus:outline-none shadow-well"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-mono text-[#869ab8] mb-1">
                Description
              </label>
              <textarea
                rows={2}
                placeholder="What is this project about?"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                className="w-full bg-recess-1 rounded-xl p-2.5 text-xs text-ink placeholder-[#50637f] focus:outline-none resize-none shadow-well"
              />
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
              <div>
                <span className="block text-[11px] font-mono text-[#869ab8] mb-1">Color Palette Accent:</span>
                <div className="flex items-center gap-2">
                  {colorOptions.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() => setSelectedColor(c.value)}
                      style={{ backgroundColor: c.value }}
                      className={`w-6 h-6 rounded-full transition-transform ${
                        selectedColor === c.value ? 'ring-2 ring-white scale-110' : 'opacity-70 hover:opacity-100'
                      }`}
                      title={c.label}
                    />
                  ))}
                </div>
              </div>

              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-[#e05a66] hover:bg-[#be3a49] text-ink font-medium text-xs shadow-md transition-all flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <span>Create & Go To Chat</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </form>
        )}

        <div className="space-y-3">
          <div className="text-[11px] font-mono text-[#6c82a1] uppercase tracking-wider flex items-center gap-1.5">
            <FolderOpen className="w-3.5 h-3.5" />
            <span>Active Project Repositories ({projects.length})</span>
          </div>

          <div className="grid grid-cols-1 gap-3">
            {projects.map((proj) => {
              const isActive = proj.id === activeProjectId;

              return (
                <div
                  key={proj.id}
                  onClick={() => onSelectProjectAndLaunchChat(proj.id)}
                  className={`p-4 rounded-2xl  transition-all cursor-pointer group flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
                    isActive
                      ? 'bg-surface-2  shadow-lg shadow-[#152033]/30'
                      : 'bg-surface-1   hover:bg-surface-2'
                  }`}
                >
                  <div className="flex items-start gap-3.5 min-w-0">
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 shadow-inner"
                      style={{ backgroundColor: `${proj.color}22` }}
                    >
                      {proj.name.toLowerCase().includes('game') ? (
                        <Gamepad2 className="w-5 h-5" style={{ color: proj.color }} />
                      ) : (
                        <Brain className="w-5 h-5" style={{ color: proj.color }} />
                      )}
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <h3 className="font-bold text-sm text-ink group-hover:text-ink transition-colors truncate">
                          {proj.name}
                        </h3>
                        <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-surface-1 text-[#8ab1e0] ">
                          {proj.codeName || proj.id}
                        </span>
                        {isActive && (
                          <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-wash-danger text-[#f28894] font-bold">
                            CURRENT
                          </span>
                        )}
                      </div>

                      <p className="text-xs text-[#869ab8] line-clamp-2 leading-relaxed">
                        {proj.description}
                      </p>

                      {/* Metadata Badges (counts live in each project's own
                          snapshot — this list is workspace metadata only) */}
                      <div className="flex flex-wrap items-center gap-3 mt-2 text-[10px] font-mono text-[#6c82a1]">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3 text-[#64748b]" />
                          {new Date(proj.updatedAt).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="sm:self-center shrink-0 flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteError(null);
                        setPendingDelete(proj);
                      }}
                      className="p-2 rounded-xl bg-surface-3 text-[#6c82a1] hover:bg-surface-2 hover:text-[#f28894] transition-colors cursor-pointer"
                      title={`Delete "${proj.name}"`}
                      aria-label={`Delete project ${proj.name}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold font-mono transition-all ${
                        isActive
                          ? 'bg-[#e05a66] text-ink shadow-md shadow-[#e05a66]/25'
                          : 'bg-surface-3 text-[#8ab1e0] group-hover:bg-[#e05a66] group-hover:text-ink'
                      }`}
                    >
                      <span>Open Chat</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {pendingDelete && (
        <div className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-surface-1 rounded-2xl w-full max-w-md p-5 space-y-4 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-surface-2 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-[#f28894]" />
              </div>
              <div className="min-w-0">
                <h2 className="text-sm font-bold text-[#f2eaf7] font-mono">
                  Delete “{pendingDelete.name}”?
                </h2>
                <p className="text-xs text-[#c9a0aa] leading-relaxed mt-1.5">
                  This permanently deletes the project and <strong>ALL of its data</strong> —
                  dialogue turns, chapters, artifacts, and the spatial graph.
                  It cannot be undone.
                </p>
                {pendingDelete.id === activeProjectId && (
                  <p className="text-[11px] text-[#eab308] mt-2">
                    This is your current project — the workspace will move to the next
                    project, or to project creation if it&apos;s the last one.
                  </p>
                )}
                {deleteError && (
                  <p className="text-[11px] text-[#f28894] mt-2 font-mono">{deleteError}</p>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setPendingDelete(null)}
                disabled={isDeleting}
                className="px-3.5 py-2 rounded-xl bg-surface-3 hover:bg-surface-4 text-[#8ab1e0] text-xs font-mono transition-colors cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={isDeleting}
                className="px-3.5 py-2 rounded-xl bg-[#7f1d1d] hover:bg-[#991b1b] text-ink text-xs font-bold font-mono transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{isDeleting ? 'Deleting…' : 'Delete permanently'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
