import React, { useEffect, useMemo } from 'react';
import { Artifact } from '../types';
import { diffLines, diffStats } from '../utils/lineDiff';
import { AlertCircle, X } from 'lucide-react';

// Multi-import plan — Phase 3: post-import triage. The flag (a relationship
// edge) IS the queue: every flagged pair gets a colored line diff + meta chips
// and four resolution tools. Nothing here is import-time — misclicks are
// undoable (overwrite records a pre-overwrite revision first).

interface RevisionTriageModalProps {
  artifacts: Artifact[];
  /** Flagged artifact id to scroll into view (row-click entry point). */
  focusId: string | null;
  onClose: () => void;
  onKeepBoth: (newId: string, oldId: string) => void;
  onOverwrite: (newId: string, oldId: string) => void;
  onDelete: (artifactId: string) => void;
}

const FLAG_TYPES = new Set(['revision-of', 'duplicate-of']);

interface TriagePair {
  newArt: Artifact;
  oldArt: Artifact;
  relType: string;
  reason: string;
}

export const RevisionTriageModal: React.FC<RevisionTriageModalProps> = ({
  artifacts,
  focusId,
  onClose,
  onKeepBoth,
  onOverwrite,
  onDelete,
}) => {
  // Close on Escape — consistent with the other modals.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const pairs: TriagePair[] = useMemo(() => {
    const out: TriagePair[] = [];
    for (const a of artifacts) {
      for (const r of a.graph?.relationships || []) {
        if (!r || !FLAG_TYPES.has(r.type)) continue;
        const target = artifacts.find((x) => x.id === r.target);
        if (!target) continue; // stale edge to a deleted artifact — skip
        const reasonMatch = /\(([^)]+)\)\s*$/.exec(r.note || '');
        out.push({
          newArt: a,
          oldArt: target,
          relType: r.type,
          reason: reasonMatch ? reasonMatch[1] : r.type,
        });
      }
    }
    return out;
  }, [artifacts]);

  // Row-click entry: bring the focused pair card into view.
  useEffect(() => {
    if (!focusId) return;
    const el = document.getElementById(`triage-${focusId}`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [focusId, pairs.length]);

  return (
    <div className="fixed inset-0 z-50 bg-[#0a0e17]/85 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4">
      <div className="bg-[#101724] border border-[#080d15] rounded-2xl max-w-4xl w-full max-h-[92vh] flex flex-col shadow-2xl text-[#e3edf7] overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b border-[#080d15] flex items-center justify-between shrink-0 bg-[#0d131f]">
          <div>
            <h2 className="text-sm font-bold text-[#eef4fc] font-mono flex items-center gap-2">
              <span>Revisions &amp; Duplicates</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#2a1f0d] border border-[#4a3a16] text-[#f0c674] font-normal">
                {pairs.length} flagged
              </span>
            </h2>
            <p className="text-[11px] text-[#7d93b3]">
              Flagged on import — nothing was overwritten. Resolve after the fact.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-[#1a2538] text-[#869ab8] transition-colors cursor-pointer"
            title="Close (Escape)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {pairs.length === 0 ? (
            <div className="p-8 text-center text-[#556985] text-xs font-mono">
              No flagged revisions.
            </div>
          ) : (
            pairs.map((pair) => {
              const { newArt, oldArt, relType, reason } = pair;
              const lines = diffLines(
                oldArt.current?.t3_body || '',
                newArt.current?.t3_body || ''
              );
              const stats = diffStats(lines);

              const metaChips: string[] = [];
              if ((newArt.title || '') !== (oldArt.title || '')) metaChips.push('title changed');
              if ((newArt.code || '') !== (oldArt.code || '')) metaChips.push('code changed');
              if ((newArt.current?.t1_abstract || '') !== (oldArt.current?.t1_abstract || ''))
                metaChips.push('abstract changed');
              const newTags = new Set(newArt.tags || []);
              const oldTags = new Set(oldArt.tags || []);
              const tagsDelta = [...newTags].filter((t) => !oldTags.has(t)).length +
                [...oldTags].filter((t) => !newTags.has(t)).length;
              if (tagsDelta > 0) metaChips.push(`tags ±${tagsDelta}`);

              return (
                <div
                  key={`${newArt.id}->${oldArt.id}`}
                  id={`triage-${newArt.id}`}
                  className="bg-[#0d121c] border border-[#080d15] rounded-xl p-3.5 space-y-3"
                >
                  {/* Pair header */}
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-mono font-semibold text-[#eef4fc] truncate">
                      {newArt.title}
                    </span>
                    <span
                      className="text-[10px] font-mono px-1.5 py-0.5 rounded border bg-[#2a1f0d] border-[#4a3a16] text-[#f0c674]"
                      title={`Flagged as ${relType} during import`}
                    >
                      ⚑ {relType} · {reason}
                    </span>
                    <span className="text-[#556985] text-[10px]">→ earlier version →</span>
                    <span className="text-xs font-mono text-[#9bb0d1] truncate">
                      {oldArt.title}
                    </span>
                    <span className="ml-auto text-[10px] font-mono text-[#5f7491] shrink-0">
                      Δ body: +{stats.added}/−{stats.removed} lines
                    </span>
                  </div>

                  {/* Meta delta chips */}
                  {metaChips.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {metaChips.map((c) => (
                        <span
                          key={c}
                          className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[#1e2a3f] text-[#8ab1e0] border border-[#080d15]"
                        >
                          {c}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Colored line diff: old (del) → new (add) */}
                  <div className="bg-[#090d14] border border-[#080d15] rounded-lg overflow-auto max-h-72 text-[10px] font-mono leading-relaxed">
                    {lines.map((l, i) => (
                      <div
                        key={i}
                        className={
                          l.type === 'add'
                            ? 'triage-add bg-[#0d2a1b] text-[#6ee7b7] whitespace-pre-wrap px-2'
                            : l.type === 'del'
                              ? 'triage-del bg-[#261317] text-[#f7aab3] whitespace-pre-wrap px-2'
                              : 'triage-same text-[#8297b5] whitespace-pre-wrap px-2'
                        }
                      >
                        {l.type === 'add' ? '+ ' : l.type === 'del' ? '− ' : '  '}
                        {l.text}
                      </div>
                    ))}
                  </div>

                  {/* Actions */}
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => onKeepBoth(newArt.id, oldArt.id)}
                      className="px-3 py-1.5 rounded-lg bg-[#1e2a3f] hover:bg-[#2a3b58] text-[#c2d1e0] text-[11px] font-mono transition-colors cursor-pointer"
                      title="Keep both artifacts and dismiss this flag — for collisions that aren't really related, or when you want both"
                    >
                      Keep both (dismiss flag)
                    </button>
                    <button
                      onClick={() => onOverwrite(newArt.id, oldArt.id)}
                      className="px-3 py-1.5 rounded-lg bg-[#2a1f0d] hover:bg-[#3a2a14] border border-[#4a3a16] text-[#f0c674] text-[11px] font-mono transition-colors cursor-pointer"
                      title="Keep the OLD artifact id, adopt the imported copy's content/meta, record a pre-overwrite revision (rollback-able), and remove the imported carrier"
                    >
                      Overwrite old with new
                    </button>
                    <button
                      onClick={() => {
                        if (
                          window.confirm(
                            `Delete the imported copy “${newArt.title}”? The earlier artifact stays.`
                          )
                        ) {
                          onDelete(newArt.id);
                        }
                      }}
                      className="px-3 py-1.5 rounded-lg bg-[#1f1618] hover:bg-[#2a1d20] border border-[#421d22] text-[#f7aab3] text-[11px] font-mono transition-colors cursor-pointer"
                      title="Omit the import — remove the new carrier, keep the earlier artifact"
                    >
                      Delete new
                    </button>
                    <button
                      onClick={() => {
                        if (
                          window.confirm(
                            `Delete the earlier artifact “${oldArt.title}”? The imported copy stays.`
                          )
                        ) {
                          onDelete(oldArt.id);
                        }
                      }}
                      className="px-3 py-1.5 rounded-lg bg-[#1f1618] hover:bg-[#2a1d20] border border-[#421d22] text-[#f7aab3] text-[11px] font-mono transition-colors cursor-pointer"
                      title="Replace the old record with the import — remove the earlier artifact, keep the new one"
                    >
                      Delete old
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="p-3 bg-[#0d121c] border-t border-[#080d15] flex items-start gap-2 shrink-0">
          <AlertCircle className="w-3.5 h-3.5 text-[#8ab1e0] shrink-0 mt-0.5" />
          <p className="text-[10px] font-mono text-[#627794]">
            Overwrite keeps the old artifact's id and coordinates, records a pre-overwrite revision
            (rollback from the artifact's version history), then removes the imported carrier.
          </p>
        </div>
      </div>
    </div>
  );
};