/**
 * BadgeGrid — shows all badges (unlocked highlighted, locked grayed out).
 * Elementary-student friendly with large icons and short descriptions.
 */
import React from 'react';
import type { BadgeInfo } from '../../services/gamificationApi';

interface BadgeGridProps {
  badges: BadgeInfo[];           // All badges (unlocked have unlocked=true)
  /** If provided, show only this many badges before "show more" */
  previewCount?: number;
}

const ICON_MAP: Record<string, string> = {
  star:      '⭐',
  book:      '📖',
  'book-open': '📚',
  library:   '🏛',
  fire:      '🔥',
  trophy:    '🏆',
  mic:       '🎤',
  award:     '🎖',
  brain:     '🧠',
  crown:     '👑',
  zap:       '⚡',
};

const COLOR_MAP: Record<string, { unlocked: string; locked: string }> = {
  yellow: { unlocked: 'bg-yellow-50 border-yellow-300 shadow-yellow-100', locked: 'bg-gray-50 border-gray-200' },
  blue:   { unlocked: 'bg-blue-50 border-blue-300 shadow-blue-100',       locked: 'bg-gray-50 border-gray-200' },
  purple: { unlocked: 'bg-purple-50 border-purple-300 shadow-purple-100', locked: 'bg-gray-50 border-gray-200' },
  gold:   { unlocked: 'bg-amber-50 border-amber-400 shadow-amber-100',    locked: 'bg-gray-50 border-gray-200' },
  orange: { unlocked: 'bg-orange-50 border-orange-300 shadow-orange-100', locked: 'bg-gray-50 border-gray-200' },
  red:    { unlocked: 'bg-red-50 border-red-300 shadow-red-100',          locked: 'bg-gray-50 border-gray-200' },
  green:  { unlocked: 'bg-green-50 border-green-300 shadow-green-100',    locked: 'bg-gray-50 border-gray-200' },
  indigo: { unlocked: 'bg-indigo-50 border-indigo-300 shadow-indigo-100', locked: 'bg-gray-50 border-gray-200' },
  gray:   { unlocked: 'bg-gray-100 border-gray-400',                      locked: 'bg-gray-50 border-gray-200' },
};

function getColorClass(color: string, unlocked: boolean): string {
  const palette = COLOR_MAP[color] ?? COLOR_MAP.gray;
  return unlocked ? palette.unlocked : palette.locked;
}

function getIcon(icon: string): string {
  return ICON_MAP[icon] ?? '🏅';
}

interface BadgeCardProps {
  badge: BadgeInfo;
}

const BadgeCard: React.FC<BadgeCardProps> = ({ badge }) => {
  const colorClass = getColorClass(badge.color, badge.unlocked);
  const icon = getIcon(badge.icon);

  return (
    <div
      className={`relative flex flex-col items-center gap-1 p-3 rounded-2xl border-2 shadow-sm transition-all ${colorClass} ${
        badge.unlocked ? 'opacity-100' : 'opacity-40 grayscale'
      }`}
      title={badge.description}
    >
      {/* Lock overlay for unearned badges */}
      {!badge.unlocked && (
        <div className="absolute inset-0 flex items-center justify-center rounded-2xl">
          <span className="text-gray-300 text-2xl">🔒</span>
        </div>
      )}

      <span className="text-3xl leading-none">{icon}</span>
      <span className="text-xs font-bold text-center text-gray-700 leading-tight">
        {badge.name}
      </span>
      <span className="text-[10px] text-center text-gray-500 leading-tight">
        {badge.description}
      </span>

      {badge.unlocked && badge.unlocked_at && (
        <span className="text-[9px] text-gray-400 mt-0.5">
          {new Date(badge.unlocked_at).toLocaleDateString('zh-TW', { month: 'short', day: 'numeric' })}
        </span>
      )}
    </div>
  );
};

const BadgeGrid: React.FC<BadgeGridProps> = ({ badges, previewCount }) => {
  const [showAll, setShowAll] = React.useState(false);
  const displayed = previewCount && !showAll ? badges.slice(0, previewCount) : badges;
  const remaining = previewCount ? badges.length - previewCount : 0;

  if (badges.length === 0) {
    return (
      <div className="text-center py-8 text-gray-400 text-sm">
        完成第一篇課文就能獲得徽章！
      </div>
    );
  }

  return (
    <div>
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
        {displayed.map((badge) => (
          <BadgeCard key={badge.key} badge={badge} />
        ))}
      </div>

      {previewCount && !showAll && remaining > 0 && (
        <button
          onClick={() => setShowAll(true)}
          className="mt-3 w-full text-sm text-blue-600 hover:text-blue-700 font-medium py-1"
        >
          顯示全部 {badges.length} 個徽章
        </button>
      )}
    </div>
  );
};

export default BadgeGrid;
