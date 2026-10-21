import React, { useState, useEffect } from 'react';
import type { ProjectMetadata } from '../../domains/00-workspace/types';
import {
  exportToJSON,
  exportToMarkdown,
  exportToYAML,
  type ProjectExportInput,
} from '../../utils/tokenCalculator';
import { Download, Copy, Check, X, FileText, Code, FileJson } from 'lucide-react';

interface ExportModalProps {
  projects: ProjectMetadata[];
  /** Domain-shaped export payload (App composes it from domain reads + selectors). */
  activeProject: ProjectExportInput;
  onClose: () => void;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  projects,
  activeProject,
  onClose,
}) => {
  const [format, setFormat] = useState<'json' | 'markdown' | 'yaml'>('json');
  const [copied, setCopied] = useState(false);

  // Close on Escape — consistent with ArtifactDetailModal/ImportModal/MirrorPanel
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const getExportData = () => {
    switch (format) {
      case 'json':
        return exportToJSON(projects, activeProject);
      case 'markdown':
        return exportToMarkdown(activeProject);
      case 'yaml':
        return exportToYAML(activeProject);
    }
  };

  const exportString = getExportData();

  const handleCopy = async () => {
    await navigator.clipboard.writeText(exportString);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const ext = format === 'json' ? 'json' : format === 'markdown' ? 'md' : 'yaml';
    const mime = format === 'json' ? 'application/json' : 'text/plain';
    const blob = new Blob([exportString], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeProject.meta.codeName || activeProject.meta.id}-markbrain-spec.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/80 backdrop-blur-md animate-in fade-in">
      <div className="bg-surface-1 rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        <div className="p-4 flex items-center justify-between bg-surface-1">
          <div className="flex items-center gap-2">
            <Download className="w-5 h-5 text-[#b88ec7]" />
            <div>
              <h2 className="font-bold text-sm text-[#f2eaf7]">
                Export project data
              </h2>
              <p className="text-[11px] text-[#9386a3]">
                Export the spatial node graph, token counts, and chat chapters
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg bg-surface-3 hover:bg-surface-4 text-[#cbbdd9]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-3 bg-surface-0 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setFormat('json')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-medium transition-colors ${
                format === 'json'
                  ? 'bg-surface-5 text-[#f2e6fa] font-bold'
                  : 'bg-surface-2 text-[#8a7d99] hover:text-ink'
              }`}
            >
              <FileJson className="w-3.5 h-3.5" />
              <span>JSON</span>
            </button>
            <button
              onClick={() => setFormat('markdown')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-medium transition-colors ${
                format === 'markdown'
                  ? 'bg-surface-5 text-[#f2e6fa] font-bold'
                  : 'bg-surface-2 text-[#8a7d99] hover:text-ink'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Markdown</span>
            </button>
            <button
              onClick={() => setFormat('yaml')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-medium transition-colors ${
                format === 'yaml'
                  ? 'bg-surface-5 text-[#f2e6fa] font-bold'
                  : 'bg-surface-2 text-[#8a7d99] hover:text-ink'
              }`}
            >
              <Code className="w-3.5 h-3.5" />
              <span>YAML</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-surface-3 hover:bg-surface-4 text-xs text-[#cbbdd9] transition-colors"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-[#8fc49f]" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>
            <button
              onClick={handleDownload}
              className="flex items-center gap-1 px-3.5 py-1.5 rounded-lg bg-[#593975] hover:bg-[#6e4691] text-xs font-semibold text-[#f2eaf7] shadow-md transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download .{format === 'markdown' ? 'md' : format}</span>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 bg-surface-0 font-mono text-xs text-[#d1c5db]">
          <pre className="whitespace-pre-wrap leading-relaxed select-all">
            {exportString}
          </pre>
        </div>
      </div>
    </div>
  );
};
