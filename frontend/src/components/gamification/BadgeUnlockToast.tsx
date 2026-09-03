/**
 * BadgeUnlockToast — mid-session badge unlock notification (Issue #3024).
 *
 * Teacher feedback: 「徽章系統怎麼運作？是達成目標的當下就跑出來嗎？」— for
 * badges whose condition can genuinely be evaluated from data available
 * mid-lesson (XP totals, level, distinct-event-type count — see
 * learning_step_progress.py's `_award_step_complete_xp`), the answer is now
 * literally yes: this toast appears the moment the backend reports a newly
 * unlocked badge key from a step-complete save.
 *
 * Badges that can only be judged once the whole session's data is in
 * (accuracy / streak / story-count) are NOT duplicated here — they still
 * settle at the report page, where XPAwardToast now also explains that
 * explicitly (see its "部分成就...需完成整堂課才會結算" caption).
 */
import React, { useEffect } from 'react';
import { badgeIcon, badgeName } from './badgeMeta';

export interface BadgeUnlockToastProps {
  /** Badge keys newly unlocked mid-session. Empty array renders nothing. */
  badgeKeys: string[];
  onDismiss: () => void;
}

const AUTO_DISMISS_MS = 5000;

const BadgeUnlockToast: React.FC<BadgeUnlockToastProps> = ({ badgeKeys, onDismiss }) => {
  useEffect(() => {
    if (badgeKeys.length === 0) return;
    const timer = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
    // Re-arm the timer whenever the SET of badges changes (a new unlock while
    // one is already showing should extend the visible window), not on every
    // onDismiss identity change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [badgeKeys.join(',')]);

  if (badgeKeys.length === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="badge-unlock-toast"
      className="fixed top-6 right-6 z-50"
    >
      <div className="max-w-xs rounded-2xl border-2 border-yellow-200 bg-white px-5 py-4 shadow-2xl">
        <div className="mb-2 text-xs font-medium text-gray-500">解鎖新成就！</div>
        <div className="flex flex-col gap-2">
          {badgeKeys.map((key) => (
            <div key={key} className="flex items-center gap-2">
              <span className="text-xl" aria-hidden="true">{badgeIcon(key)}</span>
              <span className="text-sm font-bold text-gray-800">{badgeName(key)}</span>
            </div>
          ))}
        </div>
        <button
          onClick={onDismiss}
          className="mt-3 w-full text-xs font-medium text-blue-600 hover:text-blue-700"
        >
          好的！
        </button>
      </div>
    </div>
  );
};

export default BadgeUnlockToast;
