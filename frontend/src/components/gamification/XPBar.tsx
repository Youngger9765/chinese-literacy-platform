/**
 * XPBar — shows student's current level, XP progress bar, and level name.
 * Designed for elementary school students: large text, vivid colors, encouraging.
 */
import React from 'react';
import type { LevelInfo } from '../../services/gamificationApi';

interface XPBarProps {
  levelInfo: LevelInfo;
  /** If true, renders a compact single-line version (e.g. inside a header). */
  compact?: boolean;
}

const LEVEL_COLORS: Record<number, { bg: string; bar: string; badge: string }> = {
  1:  { bg: 'bg-slate-100',   bar: 'bg-slate-400',   badge: 'bg-slate-500 text-white' },
  2:  { bg: 'bg-blue-50',     bar: 'bg-blue-400',    badge: 'bg-blue-500 text-white' },
  3:  { bg: 'bg-teal-50',     bar: 'bg-teal-500',    badge: 'bg-teal-600 text-white' },
  4:  { bg: 'bg-green-50',    bar: 'bg-green-500',   badge: 'bg-green-600 text-white' },
  5:  { bg: 'bg-lime-50',     bar: 'bg-lime-500',    badge: 'bg-lime-600 text-white' },
  6:  { bg: 'bg-yellow-50',   bar: 'bg-yellow-400',  badge: 'bg-yellow-500 text-white' },
  7:  { bg: 'bg-orange-50',   bar: 'bg-orange-500',  badge: 'bg-orange-600 text-white' },
  8:  { bg: 'bg-red-50',      bar: 'bg-red-500',     badge: 'bg-red-600 text-white' },
  9:  { bg: 'bg-purple-50',   bar: 'bg-purple-500',  badge: 'bg-purple-600 text-white' },
  10: { bg: 'bg-amber-50',    bar: 'bg-amber-500',   badge: 'bg-amber-600 text-white' },
};

function getColors(level: number) {
  return LEVEL_COLORS[level] ?? LEVEL_COLORS[1];
}

const XPBar: React.FC<XPBarProps> = ({ levelInfo, compact = false }) => {
  const { level, level_name, total_xp, progress_pct, xp_to_next, next_level_xp } = levelInfo;
  const colors = getColors(level);
  const isMaxLevel = next_level_xp === null;

  if (compact) {
    return (
      <div className="flex items-center gap-3 min-w-0">
        <span className={`shrink-0 text-xs font-black px-2 py-0.5 rounded-full ${colors.badge}`}>
          Lv.{level}
        </span>
        <div className="flex-1 min-w-0">
          <div className={`h-2 rounded-full ${colors.bg} overflow-hidden`}>
            <div
              className={`h-full rounded-full transition-all duration-700 ${colors.bar}`}
              style={{ width: `${progress_pct}%` }}
            />
          </div>
        </div>
        <span className="shrink-0 text-xs text-gray-500 font-medium">{total_xp} XP</span>
      </div>
    );
  }

  return (
    <div className={`rounded-2xl border border-gray-100 ${colors.bg} p-4 shadow-sm`}>
      {/* Level badge + name */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className={`text-sm font-black px-3 py-1 rounded-full ${colors.badge}`}>
            Lv.{level}
          </span>
          <span className="font-bold text-gray-700">{level_name}</span>
        </div>
        <span className="text-sm font-semibold text-gray-500">{total_xp} XP</span>
      </div>

      {/* Progress bar */}
      <div className={`h-4 rounded-full ${colors.bg} border border-gray-200 overflow-hidden shadow-inner`}>
        <div
          className={`h-full rounded-full transition-all duration-700 ${colors.bar}`}
          style={{ width: `${progress_pct}%` }}
        />
      </div>

      {/* XP to next */}
      <div className="mt-2 text-xs text-gray-500 text-right">
        {isMaxLevel ? (
          <span className="font-bold text-amber-600">已達最高等級！</span>
        ) : (
          <span>距離下一級還需 <strong>{xp_to_next}</strong> XP</span>
        )}
      </div>
    </div>
  );
};

export default XPBar;
