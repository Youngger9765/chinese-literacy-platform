/**
 * GamificationHero — compact hero banner for StudentHome.
 *
 * Surfaces Octalysis Core Drive 2 (Development & Accomplishment) signals
 * on the student's home page without requiring a page switch.
 *
 * Layout (two rows, ~160px tall):
 *   Row 1: 🔥 streak + Lv.N + XP progress bar
 *   Row 2: "距離「{next_badge}」還差 N" + "看全部 →"
 *
 * Mobile: collapses to single row (streak + level + XP bar only).
 *
 * Issue #1153
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import type { GamificationSummary } from '../../services/gamificationApi';

interface GamificationHeroProps {
  summary: GamificationSummary;
  className?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function levelGradient(level: number): string {
  const gradients: Record<number, string> = {
    1: 'from-slate-500 to-slate-600',
    2: 'from-blue-500 to-blue-600',
    3: 'from-cyan-500 to-cyan-600',
    4: 'from-teal-500 to-teal-600',
    5: 'from-green-500 to-green-600',
    6: 'from-yellow-500 to-yellow-600',
    7: 'from-orange-500 to-orange-600',
    8: 'from-red-500 to-red-600',
    9: 'from-purple-500 to-purple-600',
    10: 'from-amber-400 to-yellow-500',
  };
  return gradients[level] ?? gradients[1];
}

/**
 * Find the next locked badge the student is closest to unlocking.
 * Returns null if all badges are unlocked or all_badges is empty.
 */
function findNextBadge(
  summary: GamificationSummary,
): { name: string; remaining: number } | null {
  const unlockedKeys = new Set(summary.badges.map((b) => b.key));
  const locked = summary.all_badges.filter((b) => !unlockedKeys.has(b.key));
  if (locked.length === 0) return null;
  // Show the first locked badge in catalogue order as the "next target"
  const next = locked[0];

  // Heuristic: compute remaining based on badge type keywords
  // Since the backend doesn't expose per-badge thresholds in the summary,
  // we return a simplified "N 個課文" message based on stories_completed.
  // For streak/XP badges we fall back to a generic "繼續努力！" hint.
  const name = next.name ?? next.key;
  // We can't calculate an exact remaining without the badge thresholds,
  // so we keep the hint concise.
  return { name, remaining: 0 };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface XPProgressBarProps {
  progressPct: number;
  currentXp: number;
  nextLevelXp: number | null;
  xpToNext: number;
  gradient: string;
}

const XPProgressBar: React.FC<XPProgressBarProps> = ({
  progressPct,
  currentXp,
  nextLevelXp,
  xpToNext,
  gradient,
}) => (
  <div className="flex-1 min-w-0">
    <div className="flex items-center justify-between text-xs mb-1">
      <span className="text-white font-medium">{currentXp} XP</span>
      {nextLevelXp !== null ? (
        <span className="text-white font-medium">還差 {xpToNext} XP</span>
      ) : (
        <span className="text-white font-bold">已達最高等級</span>
      )}
    </div>
    <div className="h-2 rounded-full bg-white/20 overflow-hidden">
      <div
        className={`h-full rounded-full bg-gradient-to-r ${gradient} transition-all duration-700`}
        style={{ width: `${Math.min(100, progressPct)}%`, filter: 'brightness(1.5)' }}
      />
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const GamificationHero: React.FC<GamificationHeroProps> = ({ summary, className = '' }) => {
  const navigate = useNavigate();
  const { level_info: li, streak } = summary;
  const gradient = levelGradient(li.level);
  const nextBadge = findNextBadge(summary);

  return (
    <div
      className={`rounded-3xl bg-gradient-to-br from-accent to-accent/80 shadow-editorial overflow-hidden ${className}`}
      style={{ background: 'linear-gradient(135deg, var(--color-accent, #5b7fff) 0%, #7c5cbf 100%)' }}
    >
      <div className="px-5 py-4 space-y-3">
        {/* ── Row 1: streak + level pill + XP bar ── */}
        <div className="flex items-center gap-3">
          {/* Streak badge */}
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-xl leading-none" aria-hidden="true">
              {streak.current > 0 ? '🔥' : '💤'}
            </span>
            <span className="text-white font-black text-lg leading-none tabular-nums">
              {streak.current}
            </span>
            <span className="text-white text-xs">天</span>
          </div>

          {/* Level pill */}
          <div
            className={`shrink-0 px-2.5 py-1 rounded-full bg-gradient-to-r ${gradient} text-white text-xs font-black shadow-sm`}
          >
            Lv.{li.level}
          </div>

          {/* XP progress bar */}
          <XPProgressBar
            progressPct={li.progress_pct}
            currentXp={li.current_level_xp}
            nextLevelXp={li.next_level_xp}
            xpToNext={li.xp_to_next}
            gradient={gradient}
          />
        </div>

        {/* ── Row 2: next badge hint + link (hidden on mobile xs, shown sm+) ── */}
        <div className="hidden sm:flex items-center justify-between">
          <p className="text-white text-xs leading-snug">
            {nextBadge ? (
              <>
                距離
                <span className="text-white font-bold mx-1">「{nextBadge.name}」</span>
                徽章，繼續努力！
              </>
            ) : (
              <span className="text-white font-bold">所有成就已解鎖！</span>
            )}
          </p>
          <button
            type="button"
            onClick={() => navigate('/achievements')}
            className="text-white text-xs font-bold shrink-0 ml-3 transition-colors underline-offset-2 hover:underline"
            aria-label="前往成就頁"
          >
            看全部 →
          </button>
        </div>

        {/* Mobile-only: compact "看全部" link */}
        <div className="flex sm:hidden items-center justify-between">
          <p className="text-white text-xs">
            {li.level_name}
          </p>
          <button
            type="button"
            onClick={() => navigate('/achievements')}
            className="text-white text-xs font-bold underline-offset-2 hover:underline"
            aria-label="前往成就頁"
          >
            看全部 →
          </button>
        </div>
      </div>
    </div>
  );
};

export default GamificationHero;
