/**
 * HomeStats — compact inline XP/streak/level pill for StudentHome.
 *
 * Extracted from StudentHome.tsx (Issue #1952)
 */

import React from 'react';
import type { GamificationSummary } from '../../../services/gamificationApi';

// ---------------------------------------------------------------------------
// InlineXPPill — compact XP + streak + level pill, not a hero block.
// Replaces the old purple-gradient GamificationHero on this page.
// ---------------------------------------------------------------------------

export interface InlineXPPillProps {
  summary: GamificationSummary;
  onClick: () => void;
}

export const InlineXPPill: React.FC<InlineXPPillProps> = ({ summary, onClick }) => {
  const { level_info: li, streak } = summary;
  return (
    <button
      type="button"
      onClick={onClick}
      className="
        flex items-center gap-2.5 px-3.5 py-1.5 rounded-full
        bg-surface-container-lowest border border-[#E5E0D5]
        hover:border-accent/40 hover:shadow-sm
        transition-all duration-150
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1
      "
      aria-label={`目前 Lv.${li.level}，連續 ${streak.current} 天，點我看成就`}
    >
      <span className="flex items-center gap-1 text-sm font-bold text-tertiary-fixed-dim">
        <span aria-hidden="true">{streak.current > 0 ? '🔥' : '💤'}</span>
        <span className="tabular-nums">{streak.current}</span>
        <span className="text-xs font-medium">天</span>
      </span>
      <span className="px-2 py-0.5 rounded-full bg-accent/10 text-accent text-[11px] font-black tabular-nums">
        Lv.{li.level}
      </span>
      <span className="hidden sm:inline text-xs text-on-surface-variant tabular-nums">
        {li.current_level_xp} / {li.next_level_xp ?? '—'} XP
      </span>
    </button>
  );
};
