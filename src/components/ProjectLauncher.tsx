import React, { useState } from 'react';
import { Project } from '../types';
import { getTokenColor } from '../utils/tokenCalculator';
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
} from 'lucide-react';

interface ProjectLauncherProps {
  projects: Project[];
  activeProjectId: string;
  onSelectProjectAndLaunchChat: (projectId: string) => void;
  onCreateProject: (name: string, description: string, codeName: string, color: string) => void;
  onClose?: () => void;
  isDismissable?: boolean;
}

export const ProjectLauncher: React.FC<ProjectLauncherProps> = ({
  projects,
  activeProjectId,
  onSelectProjectAndLaunchChat,
  onCreateProject,
  onClose,
  isDismissable = false,
}) => {
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCodeName, setNewCodeName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [selectedColor, setSelectedColor] = useState('#be3a49'); // default Unhaunter ruby

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
      newDescription.trim() || 'Architectural project workspace.',
      newCodeName.trim() || newName.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      selectedColor
    );
    setIsCreating(false);
    setNewName('');
    setNewCodeName('');
    setNewDescription('');
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#0a0e17]/95 backdrop-blur-md flex flex-col p-4 sm:p-6 overflow-y-auto">
      {/* Top Bar */}
      <div className="max-w-3xl w-full mx-auto flex items-center justify-between pb-4 border-b border-[#080d15] shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#e05a66] to-[#8c52ff] flex items-center justify-center shadow-lg shadow-[#e05a66]/20">
            <Brain className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="text-base sm:text-lg font-bold text-[#eef4fc] font-mono tracking-tight flex items-center gap-2">
              MarkBrain
              <span className="text-[10px] font-mono font-normal px-2 py-0.5 rounded-full bg-[#182338] text-[#8ab1e0] border border-[#080d15]">
                Workspace Deck
              </span>
            </h1>
            <p className="text-xs text-[#869ab8]">One screen, one job: Select your project or spawn a new idea.</p>
          </div>
        </div>

        {isDismissable && onClose && (
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl bg-[#141b29] hover:bg-[#1f2b40] text-[#8ca3c7] transition-colors"
            title="Return to active project"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Main Content */}
      <div className="max-w-3xl w-full mx-auto py-6 space-y-6 flex-1">
        {/* Callout / Subheader */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[#111826] border border-[#080d15] p-4 rounded-2xl">
          <div>
            <h2 className="text-sm font-semibold text-[#eef4fc]">What project do you want to open?</h2>
            <p className="text-xs text-[#7d93b3] mt-0.5">
              Projects encompass your artifacts, connected spatial graphs, and continuous chapter chat.
            </p>
          </div>
          {!isCreating && (
            <button
              onClick={() => setIsCreating(true)}
              className="inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-xl bg-[#e05a66] hover:bg-[#be3a49] text-white font-medium text-xs shadow-md shadow-[#e05a66]/20 transition-all shrink-0 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Create New Project</span>
            </button>
          )}
        </div>

        {/* Create Project Form Drawer/Card */}
        {isCreating && (
          <form
            onSubmit={handleCreateSubmit}
            className="bg-[#141c2c] border border-[#080d15] p-4 sm:p-5 rounded-2xl space-y-4 shadow-xl animate-in fade-in slide-in-from-top-2 duration-200"
          >
            <div className="flex items-center justify-between border-b border-[#080d15] pb-2">
              <span className="text-xs font-mono font-bold text-[#e05a66] uppercase flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5" />
                Initialize New Project Container
              </span>
              <button
                type="button"
                onClick={() => setIsCreating(false)}
                className="text-xs text-[#7d93b3] hover:text-[#eef4fc]"
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
                  placeholder="e.g. Nebula Space Protocol"
                  value={newName}
                  onChange={(e) => handleNameChange(e.target.value)}
                  className="w-full bg-[#0d121c] border border-[#080d15] rounded-xl px-3 py-2 text-xs text-[#eef4fc] placeholder-[#50637f] focus:outline-none focus:border-[#e05a66]/50"
                />
              </div>

              <div>
                <label className="block text-[11px] font-mono text-[#869ab8] mb-1">
                  Identifier / Handle (Slug)
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. nebula-protocol"
                  value={newCodeName}
                  onChange={(e) => setNewCodeName(e.target.value)}
                  className="w-full bg-[#0d121c] border border-[#080d15] rounded-xl px-3 py-2 text-xs font-mono text-[#8ab1e0] placeholder-[#50637f] focus:outline-none focus:border-[#e05a66]/50"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-mono text-[#869ab8] mb-1">
                High-Level Architecture & Scope Description
              </label>
              <textarea
                rows={2}
                placeholder="Core subsystems, domain boundaries, and conceptual invariants..."
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                className="w-full bg-[#0d121c] border border-[#080d15] rounded-xl p-2.5 text-xs text-[#eef4fc] placeholder-[#50637f] focus:outline-none focus:border-[#e05a66]/50 resize-none"
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
                className="px-4 py-2 rounded-xl bg-[#e05a66] hover:bg-[#be3a49] text-white font-medium text-xs shadow-md transition-all flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <span>Create & Go To Chat</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </form>
        )}

        {/* Existing Projects List */}
        <div className="space-y-3">
          <div className="text-[11px] font-mono text-[#6c82a1] uppercase tracking-wider flex items-center gap-1.5">
            <FolderOpen className="w-3.5 h-3.5" />
            <span>Active Project Repositories ({projects.length})</span>
          </div>

          <div className="grid grid-cols-1 gap-3">
            {projects.map((proj) => {
              const isActive = proj.id === activeProjectId;
              const totalArtifacts = proj.artifacts.length;
              const totalChapters = proj.chapters.length;

              return (
                <div
                  key={proj.id}
                  onClick={() => onSelectProjectAndLaunchChat(proj.id)}
                  className={`p-4 rounded-2xl border transition-all cursor-pointer group flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
                    isActive
                      ? 'bg-[#152033] border-[#080d15] shadow-lg shadow-[#152033]/30'
                      : 'bg-[#111826] border-[#080d15] hover:border-[#1e2a3f] hover:bg-[#141c2c]'
                  }`}
                >
                  <div className="flex items-start gap-3.5 min-w-0">
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 shadow-inner"
                      style={{ backgroundColor: `${proj.color}22`, border: `1px solid ${proj.color}44` }}
                    >
                      {proj.name.toLowerCase().includes('game') ? (
                        <Gamepad2 className="w-5 h-5" style={{ color: proj.color }} />
                      ) : (
                        <Brain className="w-5 h-5" style={{ color: proj.color }} />
                      )}
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <h3 className="font-bold text-sm text-[#eef4fc] group-hover:text-white transition-colors truncate">
                          {proj.name}
                        </h3>
                        <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[#0d131f] text-[#8ab1e0] border border-[#080d15]">
                          {proj.codeName || proj.id}
                        </span>
                        {isActive && (
                          <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-[#2e1519] text-[#f28894] border border-[#3d161d] font-bold">
                            CURRENT
                          </span>
                        )}
                      </div>

                      <p className="text-xs text-[#869ab8] line-clamp-2 leading-relaxed">
                        {proj.description}
                      </p>

                      {/* Metadata Badges */}
                      <div className="flex flex-wrap items-center gap-3 mt-2 text-[10px] font-mono text-[#6c82a1]">
                        <span className="flex items-center gap-1">
                          <FileCode className="w-3 h-3 text-[#e05a66]" />
                          {totalArtifacts} YAML Specs
                        </span>
                        <span className="flex items-center gap-1">
                          <Layers className="w-3 h-3 text-[#8ab1e0]" />
                          {totalChapters} Tree Chapters
                        </span>
                        {proj.lastActivity && (
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3 text-[#64748b]" />
                            {new Date(proj.lastActivity).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Launch Action */}
                  <div className="sm:self-center shrink-0 flex items-center justify-end">
                    <button
                      type="button"
                      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold font-mono transition-all ${
                        isActive
                          ? 'bg-[#e05a66] text-white shadow-md shadow-[#e05a66]/25'
                          : 'bg-[#182338] text-[#8ab1e0] group-hover:bg-[#e05a66] group-hover:text-white'
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
    </div>
  );
};
