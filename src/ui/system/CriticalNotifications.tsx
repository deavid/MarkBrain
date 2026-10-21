import React, { useSyncExternalStore } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import {
  CriticalNotice,
  dismissCritical,
  getCriticalNotices,
  subscribeCriticalNotices,
} from '../../utils/criticalNotifications';

/**
 * The red banner for failures severe enough that the session is lying to you —
 * "couldn't save to the cloud", "couldn't load your chats". One sentence, no
 * error specifics (the console has the stack), gone on its own after the TTL.
 *
 * It sits at the top centre, above every overlay, and only the banner itself
 * takes pointer events, so it can never block the app it is warning about.
 */

function useCriticalNotices(): CriticalNotice[] {
  return useSyncExternalStore(subscribeCriticalNotices, getCriticalNotices, getCriticalNotices);
}

export const CriticalNotifications: React.FC = () => {
  const notices = useCriticalNotices();
  if (notices.length === 0) return null;

  return (
    <div
      data-testid="critical-notifications"
      className="fixed top-3 left-1/2 -translate-x-1/2 z-[80] flex flex-col items-center gap-2 pointer-events-none"
    >
      {notices.map((notice) => (
        <div
          key={notice.id}
          role="alert"
          data-testid="critical-notification"
          className="pointer-events-auto flex items-start gap-2 w-[min(92vw,520px)] rounded-xl px-3 py-2 bg-[#5b1414]/95 ring-1 ring-[#f45a56]/60 shadow-lift backdrop-blur-sm"
        >
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-[#fca5a5]" aria-hidden="true" />
          <span className="flex-1 text-[12px] leading-snug text-[#fee2e2]">{notice.message}</span>
          <button
            type="button"
            onClick={() => dismissCritical(notice.id)}
            aria-label="Dismiss this warning"
            title="Dismiss"
            className="min-w-[30px] min-h-[30px] -mr-1 flex items-center justify-center rounded-lg text-[#fca5a5] hover:text-[#fee2e2] hover:bg-[#f45a56]/25 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  );
};
