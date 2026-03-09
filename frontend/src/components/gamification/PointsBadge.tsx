/**
 * PointsBadge — compact XP display widget.
 *
 * Shows the student's current level name, total XP, and a progress bar
 * toward the next level. Designed to fit in nav bars or dashboard headers.
 */

import React from 'react';

export interface LevelInfo {
  level: number;
  level_name: string;
  total_xp: number;
  current_level_xp: number;
  next_level_xp: number | null;
  xp_to_next: number;
  progress_pct: number;
}

interface PointsBadgeProps {
  levelInfo: LevelInfo;
  /** compact = just icon + XP number; full = level name + progress bar */
  variant?: 'compact' | 'full';
  className?: string;
}

const LEVEL_COLORS: Record<number, string> = {
  1: 'from-slate-400 to-slate-500',
  2: 'from-blue-400 to-blue-500',
  3: 'from-cyan-400 to-cyan-500',
  4: 'from-teal-400 to-teal-500',
  5: 'from-green-400 to-green-500',
  6: 'from-yellow-400 to-yellow-500',
  7: 'from-orange-400 to-orange-500',
  8: 'from-red-400 to-red-500',
  9: 'from-purple-400 to-purple-500',
  10: 'from-yellow-400 to-amber-500',
};

function levelColor(level: number): string {
  return LEVEL_COLORS[level] ?? LEVEL_COLORS[1];
}

const PointsBadge: React.FC<PointsBadgeProps> = ({
  levelInfo,
  variant = 'compact',
  className = '',
}) => {
  const color = levelColor(levelInfo.level);

  if (variant === 'compact') {
    return (
      <div
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gradient-to-r ${color} text-white text-sm font-bold shadow-sm ${className}`}
        title={`等級 ${levelInfo.level} ${levelInfo.level_name} — ${levelInfo.total_xp} XP`}
      >
        <span className="text-xs opacity-80">Lv.{levelInfo.level}</span>
        <span>{levelInfo.total_xp} XP</span>
      </div>
    );
  }

  // Full variant
  return (
    <div className={`rounded-2xl bg-white border border-gray-100 shadow-sm p-4 ${className}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div
            className={`w-10 h-10 rounded-full bg-gradient-to-br ${color} flex items-center justify-center text-white font-black text-lg shadow`}
          >
            {levelInfo.level}
          </div>
          <div>
            <div className="text-xs text-gray-500 font-medium">等級 {levelInfo.level}</div>
            <div className="text-base font-black text-gray-800">{levelInfo.level_name}</div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-black text-gray-800">{levelInfo.total_xp}</div>
          <div className="text-xs text-gray-400">XP 總計</div>
        </div>
      </div>

      {/* Progress bar */}
      {levelInfo.next_level_xp !== null ? (
        <div>
          <div className="flex justify-between text-xs text-gray-400 mb-1">
            <span>{levelInfo.current_level_xp} XP</span>
            <span>還需 {levelInfo.xp_to_next} XP</span>
          </div>
          <div className="h-2.5 rounded-full bg-gray-100 overflow-hidden">
            <div
              className={`h-full rounded-full bg-gradient-to-r ${color} transition-all duration-500`}
              style={{ width: `${levelInfo.progress_pct}%` }}
            />
          </div>
          <div className="text-xs text-gray-400 mt-1 text-right">
            距離等級 {levelInfo.level + 1}
          </div>
        </div>
      ) : (
        <div className="text-center text-sm font-bold text-yellow-600 mt-1">
          已達最高等級！
        </div>
      )}
    </div>
  );
};

export default PointsBadge;
