/**
 * ReadingGoalsBadge — shows teacher-set (or default) reading goals.
 * Used in LiveTutor header, FullReading header, and AssessmentReport.
 *
 * Issue #84: 課文目標設定（語速、正確率門檻）
 */
import React from 'react';

export interface ReadingGoals {
  effectiveCpm: number;
  effectiveAccuracy: number;
  difficultyLabel?: string | null;
  isCustom?: boolean; // true = teacher set custom goals
}

interface ReadingGoalsBadgeProps {
  goals: ReadingGoals;
  /** compact = single-line inline pills; default = two-line card */
  variant?: 'compact' | 'card';
}

const ReadingGoalsBadge: React.FC<ReadingGoalsBadgeProps> = ({
  goals,
  variant = 'compact',
}) => {
  const difficultyColor: Record<string, string> = {
    '初級': 'bg-green-100 text-green-700',
    '中級': 'bg-amber-100 text-amber-700',
    '高級': 'bg-red-100 text-red-700',
  };

  if (variant === 'compact') {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {goals.difficultyLabel && (
          <span
            className={`px-2 py-0.5 rounded-full font-medium ${difficultyColor[goals.difficultyLabel] ?? 'bg-gray-100 text-gray-600'}`}
          >
            {goals.difficultyLabel}
          </span>
        )}
        <span className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded-full">
          目標語速 <strong>{goals.effectiveCpm}</strong> 字/分
        </span>
        <span className="px-2 py-0.5 bg-purple-50 text-purple-700 rounded-full">
          目標正確率 <strong>{goals.effectiveAccuracy}%</strong>
        </span>
        {!goals.isCustom && (
          <span className="text-xs text-gray-400">(預設標準)</span>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-blue-100 bg-blue-50 p-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-base font-semibold text-blue-800">本次目標</span>
        {goals.difficultyLabel && (
          <span
            className={`px-2 py-0.5 rounded-full text-xs font-medium ${difficultyColor[goals.difficultyLabel] ?? 'bg-gray-100 text-gray-600'}`}
          >
            {goals.difficultyLabel}
          </span>
        )}
        {!goals.isCustom && (
          <span className="text-xs text-gray-400 ml-auto">(預設標準)</span>
        )}
      </div>
      <div className="flex gap-6 text-sm">
        <div>
          <div className="text-gray-500">語速</div>
          <div className="text-xl font-bold text-blue-700">
            {goals.effectiveCpm}
            <span className="text-sm font-normal ml-1">字/分</span>
          </div>
        </div>
        <div>
          <div className="text-gray-500">正確率</div>
          <div className="text-xl font-bold text-purple-700">
            {goals.effectiveAccuracy}%
          </div>
        </div>
      </div>
    </div>
  );
};

export default ReadingGoalsBadge;
