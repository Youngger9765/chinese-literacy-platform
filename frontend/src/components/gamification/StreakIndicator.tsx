/* eslint-disable no-use-before-define -- pre-existing pattern, not TDZ risk (#2289) */
/**
 * StreakIndicator — shows the student's daily learning streak.
 *
 * Displays a flame emoji + current streak count.
 * Variants: compact (inline badge) and full (card with longest streak).
 */

import React from 'react';

export interface StreakData {
  current: number;
  longest: number;
  last_activity_date: string | null;
}

interface StreakIndicatorProps {
  streak: StreakData;
  variant?: 'compact' | 'full';
  className?: string;
}

function flameColor(streak: number): string {
  if (streak === 0) return 'text-gray-400';
  if (streak < 3) return 'text-orange-400';
  if (streak < 7) return 'text-orange-500';
  if (streak < 14) return 'text-red-500';
  return 'text-red-600';
}

function streakLabel(streak: number): string {
  if (streak === 0) return '尚未開始';
  if (streak === 1) return '開始學習！';
  if (streak < 3) return '持續下去！';
  if (streak < 7) return '很有進步！';
  if (streak < 14) return '太厲害了！';
  if (streak < 30) return '學習達人！';
  return '傳說等級！';
}

const StreakIndicator: React.FC<StreakIndicatorProps> = ({
  streak,
  variant = 'compact',
  className = '',
}) => {
  const flame = streak.current > 0 ? '🔥' : '💤';
  const color = flameColor(streak.current);

  if (variant === 'compact') {
    return (
      <div
        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-orange-50 border border-orange-200 ${className}`}
        title={`連續學習 ${streak.current} 天（最長 ${streak.longest} 天）`}
      >
        <span className="text-base leading-none">{flame}</span>
        <span className={`font-black text-sm ${color}`}>
          {streak.current}
        </span>
        <span className="text-xs text-gray-400">天</span>
      </div>
    );
  }

  // Full card variant
  return (
    <div className={`rounded-2xl bg-white border border-orange-100 shadow-sm p-4 ${className}`}>
      <div className="flex items-center gap-3 mb-3">
        <span className="text-5xl leading-none">{flame}</span>
        <div>
          <div className="text-xs text-gray-500 font-medium">連續學習</div>
          <div className={`text-4xl font-black ${color}`}>
            {streak.current} <span className="text-xl">天</span>
          </div>
        </div>
      </div>

      <div className="text-sm font-bold text-orange-600 mb-2">
        {streakLabel(streak.current)}
      </div>

      {/* Mini calendar: last 7 days */}
      <StreakCalendar lastActivityDate={streak.last_activity_date} current={streak.current} />

      <div className="mt-3 flex items-center justify-between text-xs text-gray-400">
        <span>最長連續學習</span>
        <span className="font-bold text-gray-600">{streak.longest} 天</span>
      </div>
    </div>
  );
};

/**
 * Renders a 7-day dot calendar showing which days had activity.
 * We infer activity from last_activity_date + current streak length.
 */
const StreakCalendar: React.FC<{ lastActivityDate: string | null; current: number }> = ({
  lastActivityDate,
  current,
}) => {
  const today = new Date();
  const days: { label: string; active: boolean }[] = [];

  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dayLabel = d.toLocaleDateString('zh-TW', { weekday: 'short' }).slice(0, 1);

    let active = false;
    if (lastActivityDate && current > 0) {
      const last = new Date(lastActivityDate);
      last.setHours(0, 0, 0, 0);
      d.setHours(0, 0, 0, 0);
      const diffDays = Math.floor((last.getTime() - d.getTime()) / 86400000);
      // active if within the current streak window
      active = diffDays >= 0 && diffDays < current;
    }

    days.push({ label: dayLabel, active });
  }

  return (
    <div className="flex justify-between gap-1">
      {days.map((day, idx) => (
        <div key={idx} className="flex flex-col items-center gap-1">
          <div
            className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all
              ${day.active
                ? 'bg-orange-400 text-white shadow-sm'
                : 'bg-gray-100 text-gray-400'
              }`}
          >
            {day.active ? '🔥' : ''}
          </div>
          <div className="text-xs text-gray-400">{day.label}</div>
        </div>
      ))}
    </div>
  );
};

export default StreakIndicator;
