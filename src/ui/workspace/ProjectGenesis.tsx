import React, { useState } from 'react';
import { Brain, Plus, Sparkles, LogOut, RefreshCw, FolderPlus, RotateCcw } from 'lucide-react';
import { logger } from '../../utils/logger';
import { UserAvatar } from './UserAvatar';

interface ProjectGenesisProps {
  user: {
    displayName?: string | null;
    email?: string | null;
    photoURL?: string | null;
  };
  onCreateProject: (project: {
    id: string;
    name: string;
    codeName: string;
    description: string;
    color: string;
  }) => Promise<void>;
  onSignOut: () => Promise<void>;
  /** Full-database restore trigger — a fresh store must be restorable
   *  from this screen, where the Sidebar I/O tools don't exist yet. */
  onImportDatabase?: () => void;
}

const PALETTE = [
  '#3b82f6',
  '#10b981',
  '#8b5cf6',
  '#f59e0b',
  '#e05a66',
  '#06b6d4',
];

export const ProjectGenesis: React.FC<ProjectGenesisProps> = ({
  user,
  onCreateProject,
  onSignOut,
  onImportDatabase,
}) => {
  const [name, setName] = useState('');
  const [codeName, setCodeName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState(PALETTE[0]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Please provide a project name.');
      return;
    }

    const id = `proj-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const finalCode = (codeName.trim() || name.trim().slice(0, 4)).toUpperCase();

    setIsSubmitting(true);
    setError(null);
    logger.action('ProjectGenesis', `Creating initial project "${name.trim()}" (${id})`);

    try {
      await onCreateProject({
        id,
        name: name.trim(),
        codeName: finalCode,
        description: description.trim() || 'A space for thinking out loud.',
        color,
      });
    } catch (err: any) {
      logger.error('ProjectGenesis', 'Failed to create initial cloud project', err);
      setError(err?.message || 'Failed to create project in Firestore.');
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen w-screen bg-surface-0 text-ink p-4 select-none relative overflow-hidden font-sans">
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#0f172a15_1px,transparent_1px),linear-gradient(to_bottom,#0f172a15_1px,transparent_1px)] bg-[size:48px_48px] pointer-events-none" />

      <div className="relative z-10 w-full max-w-lg p-6 sm:p-8 bg-surface-0 rounded-2xl shadow-2xl space-y-6">
        <div className="flex items-center justify-between pb-4 ">
          <div className="flex items-center gap-3 min-w-0">
            <UserAvatar src={user.photoURL} size="md" />
            <div className="min-w-0">
              <span className="text-xs text-[#526a8a] font-mono block">Signed in as</span>
              <span className="text-sm font-semibold text-ink block truncate">
                {user.displayName || user.email}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={onSignOut}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-wash-danger hover:bg-[#3a1a20] text-[11px] font-mono text-[#f28894] transition-colors cursor-pointer"
            title="Sign out of Google"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign Out</span>
          </button>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <FolderPlus className="w-5 h-5 text-[#38bdf8]" />
            <h2 className="text-base font-bold text-ink font-mono">
              Initialize Your First Workspace
            </h2>
          </div>
          <p className="text-xs text-[#7187a5] leading-relaxed">
            You don't have any projects yet. Create one to start collecting thoughts.
          </p>
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-red-950/40 text-xs text-red-300">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-[11px] font-mono uppercase tracking-wider text-[#7a93b5] block">
              Project Name *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Side Project Ideas"
              required
              className="w-full bg-recess-1 rounded-xl px-3.5 py-2.5 text-xs sm:text-sm text-ink placeholder-[#455770] focus:outline-none transition-colors shadow-well"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-[11px] font-mono uppercase tracking-wider text-[#7a93b5] block">
                Code Identifier
              </label>
              <input
                type="text"
                value={codeName}
                onChange={(e) => setCodeName(e.target.value.toUpperCase())}
                placeholder="e.g. SIDE-IDEAS"
                maxLength={12}
                className="w-full bg-recess-1 rounded-xl px-3.5 py-2.5 text-xs sm:text-sm font-mono text-ink placeholder-[#455770] focus:outline-none transition-colors shadow-well"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-mono uppercase tracking-wider text-[#7a93b5] block">
                Accent Nuance
              </label>
              <div className="flex items-center gap-2 pt-1.5">
                {PALETTE.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    style={{ backgroundColor: c }}
                    className={`w-6 h-6 rounded-full transition-transform cursor-pointer ${
                      color === c ? 'ring-2 ring-white scale-110' : 'opacity-70 hover:opacity-100'
                    }`}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-mono uppercase tracking-wider text-[#7a93b5] block">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this collection of thoughts about?"
              rows={2}
              className="w-full bg-recess-1 rounded-xl px-3.5 py-2 text-xs text-ink placeholder-[#455770] focus:outline-none transition-colors resize-none shadow-well"
            />
          </div>

          <button
            type="submit"
            disabled={isSubmitting || !name.trim()}
            className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-[#2563eb] hover:bg-[#1d4ed8] active:bg-[#1e40af] disabled:opacity-40 text-ink text-xs sm:text-sm font-semibold tracking-wide shadow-md transition-all cursor-pointer font-mono"
          >
            {isSubmitting ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Initializing in Firestore...</span>
              </>
            ) : (
              <>
                <Plus className="w-4 h-4" />
                <span>Create & Launch Workspace</span>
              </>
            )}
          </button>
        </form>

        {onImportDatabase && (
          <button
            type="button"
            onClick={onImportDatabase}
            className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-xl bg-transparent hover:bg-surface-1 text-[#6e88a8] hover:text-[#8ab1e0] text-[11px] font-mono transition-colors cursor-pointer border-transparent "
            title="Restore a MarkBrain database backup file (JSON) into this browser"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Restore from a database backup instead</span>
          </button>
        )}
      </div>
    </div>
  );
};
