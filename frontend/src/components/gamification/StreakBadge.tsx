/**
 * StreakBadge — shows current and longest learning streak.
 * Compact widget suitable for dashboards or profile pages.
 */
import React from 'react';
import type { StreakInfo } from '../../services/gamificationApi';

interface StreakBadgeProps {
  streak: StreakInfo;
  compact?: boolean;
}

const StreakBadge: React.FC<StreakBadgeProps> = ({ streak, compact = false }) => {
  const { current, longest } = streak;

  if (compact) {
    return (
      <div className="flex items-center gap-1.5">
        <span className="text-orange-500 text-lg">🔥</span>
        <span className="text-sm font-bold text-gray-700">{current}</span>
        <span className="text-xs text-gray-500">天</span>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-orange-100 bg-orange-50 p-4 shadow-sm">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-2xl">🔥</span>
        <span className="font-bold text-gray-700">連續學習</span>
      </div>

      <div className="flex items-end gap-4">
        <div className="text-center">
          <div className="text-4xl font-black text-orange-600">{current}</div>
          <div className="text-xs text-gray-500 mt-0.5">目前連續天數</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-black text-gray-400">{longest}</div>
          <div className="text-xs text-gray-400 mt-0.5">最長紀錄</div>
        </div>
      </div>

      {current === 0 && (
        <p className="mt-2 text-xs text-gray-400">今天完成一篇課文就能開始連續！</p>
      )}
      {current > 0 && current < 3 && (
        <p className="mt-2 text-xs text-orange-500 font-medium">繼續加油，連續 3 天可解鎖徽章！</p>
      )}
      {current >= 3 && (
        <p className="mt-2 text-xs text-orange-600 font-bold">太棒了！持續學習！</p>
      )}
    </div>
  );
};

export default StreakBadge;
