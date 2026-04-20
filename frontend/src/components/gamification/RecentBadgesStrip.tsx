/**
 * RecentBadgesStrip — horizontal scroll strip of the 3 most recently
 * unlocked badges, with a "看全部 →" link to /achievements.
 *
 * If the student has no unlocked badges, renders a friendly motivational hint.
 *
 * Issue #1153
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import type { BadgeInfo } from '../../services/gamificationApi';

// Mirror of the icon/color maps in AchievementCard to keep this component
// self-contained (no prop drilling the full AchievementCard).
const ICON_EMOJI: Record<string, string> = {
  star: '⭐',
  book: '📚',
  'book-open': '📖',
  library: '🏛️',
  fire: '🔥',
  trophy: '🏆',
  mic: '🎤',
  award: '🥇',
  brain: '🧠',
  crown: '👑',
  zap: '⚡',
  'calendar-check': '📅',
  compass: '🧭',
};

const COLOR_BG: Record<string, string> = {
  yellow: 'bg-yellow-50 border-yellow-200',
  blue: 'bg-blue-50 border-blue-200',
  purple: 'bg-purple-50 border-purple-200',
  gold: 'bg-amber-50 border-amber-200',
  orange: 'bg-orange-50 border-orange-200',
  red: 'bg-red-50 border-red-200',
  green: 'bg-green-50 border-green-200',
  indigo: 'bg-indigo-50 border-indigo-200',
  gray: 'bg-gray-50 border-gray-200',
  emerald: 'bg-emerald-50 border-emerald-200',
  teal: 'bg-teal-50 border-teal-200',
};

function badgeBg(color: string): string {
  return COLOR_BG[color] ?? COLOR_BG.gray;
}

interface RecentBadgesStripProps {
  /** Unlocked badges, sorted by unlock date (newest last). */
  badges: BadgeInfo[];
  className?: string;
}

const RecentBadgesStrip: React.FC<RecentBadgesStripProps> = ({ badges, className = '' }) => {
  const navigate = useNavigate();

  // Take last 3 (most recently unlocked), reverse to show newest first
  const recent = [...badges].slice(-3).reverse();

  return (
    <section aria-labelledby="recent-badges-title" className={className}>
      <div className="flex items-center justify-between mb-3">
        <h2
          id="recent-badges-title"
          className="text-base font-bold font-headline text-on-surface"
        >
          近期成就
        </h2>
        <button
          type="button"
          onClick={() => navigate('/achievements')}
          className="text-sm font-semibold text-accent hover:underline underline-offset-2 transition-colors"
          aria-label="查看全部成就"
        >
          看全部 →
        </button>
      </div>

      {recent.length === 0 ? (
        <div className="rounded-2xl bg-surface-container-lowest border border-dashed border-gray-200 p-5 text-center">
          <div className="text-3xl mb-1" aria-hidden="true">🎯</div>
          <p className="text-sm text-on-surface-variant">完成課文學習來解鎖成就！</p>
        </div>
      ) : (
        <div
          className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1"
          style={{ scrollbarWidth: 'none' }}
          role="list"
          aria-label="近期解鎖的成就徽章"
        >
          {recent.map((badge) => {
            const emoji = ICON_EMOJI[badge.icon] ?? '🏅';
            const bgClass = badgeBg(badge.color);
            return (
              <button
                key={badge.key}
                type="button"
                onClick={() => navigate('/achievements')}
                className={`
                  flex-none w-28 rounded-2xl border-2 ${bgClass} p-3
                  flex flex-col items-center gap-1.5 text-center
                  shadow-sm hover:shadow-md transition-all active:scale-95
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent
                `}
                role="listitem"
                aria-label={`成就：${badge.name}`}
              >
                <span className="text-4xl leading-none" aria-hidden="true">{emoji}</span>
                <span className="text-xs font-black text-gray-800 leading-tight line-clamp-2">
                  {badge.name}
                </span>
                {badge.unlocked_at && (
                  <span className="text-xs text-gray-400">
                    {new Date(badge.unlocked_at).toLocaleDateString('zh-TW', {
                      month: 'numeric',
                      day: 'numeric',
                    })}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
};

export default RecentBadgesStrip;
