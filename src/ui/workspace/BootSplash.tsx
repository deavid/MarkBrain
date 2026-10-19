import { Brain } from 'lucide-react';

/**
 * Full-screen boot/hold splash used by App's pre-flight early returns.
 * Markup extracted verbatim from App.tsx (auth probe + cloud-list loading),
 * which rendered the identical card twice with different label text.
 */
export function BootSplash({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center h-screen w-screen bg-[#070b12] text-[#8ab1e0] font-sans">
      <div className="flex flex-col items-center gap-3">
        <div className="w-12 h-12 rounded-2xl bg-[#121c2d] border border-[#1e2e47] flex items-center justify-center text-[#e05a66] shadow-sm animate-pulse">
          <Brain className="w-6 h-6 text-[#e05a66]" />
        </div>
        <span className="text-xs font-mono text-[#526e91]">{label}</span>
      </div>
    </div>
  );
}
