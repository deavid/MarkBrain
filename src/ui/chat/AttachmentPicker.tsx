import React, { useEffect, useMemo, useState } from 'react';
import { X, Search, Check, Paperclip } from 'lucide-react';
import type { Artifact } from '../../types';
import { GRANULARITY_LABEL } from '../../domains/granularity';
import type { ChatAttachment } from '../../domains/06-chat-threads';

interface AttachmentPickerProps {
  open: boolean;
  onClose: () => void;
  artifacts: Artifact[];
  /** The ACTIVE chat's attachments — used to mark what is already in. */
  attachments: ChatAttachment[];
  onAttach: (artifactId: string) => void;
}

/**
 * `[+]` picker — membership only (09 §3).
 *
 * Full-screen sheet on phones, centered modal above ~ss. Attaching always
 * lands at Full: you attach a thing because you want the model to read it;
 * you lower the granularity afterwards, in the mirror. There is no detach.
 */
export const AttachmentPicker: React.FC<AttachmentPickerProps> = ({
  open,
  onClose,
  artifacts,
  attachments,
  onAttach,
}) => {
  const [query, setQuery] = useState('');

  const attachedById = useMemo(
    () => new Map(attachments.map((a) => [a.artifactId, a])),
    [attachments]
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...artifacts]
      .sort((a, b) => (a.title || '').localeCompare(b.title || ''))
      .filter((a) => !q || (a.title || '').toLowerCase().includes(q) || (a.current?.description || '').toLowerCase().includes(q));
  }, [artifacts, query]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-[#0a0e17]/85 backdrop-blur-sm flex items-stretch sm:items-center justify-center p-0 sm:p-3"
      onClick={onClose}
    >
      <div
        className="bg-[#101724] border border-[#080d15] sm:rounded-2xl w-full sm:max-w-md h-full sm:h-auto sm:max-h-[85vh] flex flex-col shadow-2xl text-[#e3edf7]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-[#080d15] flex items-center justify-between shrink-0 bg-[#0d131f] sm:rounded-t-2xl">
          <div>
            <h2 className="text-sm font-bold font-mono flex items-center gap-1.5">
              <Paperclip className="w-3.5 h-3.5" /> Attach artifacts
            </h2>
            <p className="text-[10px] text-[#6b82a3] font-mono mt-0.5">
              Added at Full — lower it afterwards in the mirror
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[#162132] cursor-pointer" title="Close picker">
            <X className="w-4 h-4 text-[#8ab1e0]" />
          </button>
        </div>

        <div className="p-3 border-b border-[#0e1522] shrink-0">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#556985]" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search the library…"
              className="w-full min-h-[36px] pl-8 pr-2 rounded-xl bg-[#0c1322] border border-[#141f33] text-xs font-mono text-[#d6e3f5] placeholder-[#4f5f78] focus:outline-none focus:border-[#223552]"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {rows.length === 0 && (
            <p className="text-[10px] font-mono text-[#4f5f78] p-3">Nothing in the library matches.</p>
          )}
          {rows.map((art) => {
            const attached = attachedById.get(art.id);
            return (
              <div
                key={art.id}
                className="flex items-center justify-between gap-2 px-2 py-2 rounded-xl hover:bg-[#0f182a]"
              >
                <div className="min-w-0">
                  <div className="text-xs font-mono text-[#e3edf7] truncate">{art.title}</div>
                  <div className="text-[10px] font-mono text-[#556985] truncate">
                    {art.current?.description || art.current?.summary || art.category || 'note'}
                  </div>
                </div>
                {attached ? (
                  <span className="flex items-center gap-1 text-[10px] font-mono text-[#5ad49b] shrink-0 px-2">
                    <Check className="w-3 h-3" /> {GRANULARITY_LABEL[attached.granularity]}
                  </span>
                ) : (
                  <button
                    onClick={() => onAttach(art.id)}
                    aria-label={`Attach ${art.title}`}
                    className="min-h-[28px] px-2.5 rounded-lg bg-[#18263e] text-[#8ab1e0] border border-[#233758] text-[10px] font-mono hover:bg-[#203252] transition-colors cursor-pointer shrink-0"
                  >
                    Attach
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
