/**
 * GoalAchievementCard — shows pass/fail status against teacher reading goals.
 *
 * Issue #84: 課文目標設定（語速、正確率門檻）
 */
import React from 'react';

interface GoalResult {
  label: string;
  target: string;
  actual: string;
  passed: boolean;
}

interface GoalAchievementCardProps {
  effectiveCpm: number;
  effectiveAccuracy: number;
  actualCpm: number | null | undefined;
  actualAccuracy: number | null | undefined;
}

function getEncouragingMessage(cpmPassed: boolean, accPassed: boolean): string {
  if (cpmPassed && accPassed) return '太棒了！語速和正確率都達標，繼續保持！';
  if (cpmPassed && !accPassed) return '語速很好！再多練習一下，正確率就達標了！';
  if (!cpmPassed && accPassed) return '讀得很準確！試著加快一點速度！';
  return '不要氣餒，多練習幾次就會越來越好！';
}

const GoalAchievementCard: React.FC<GoalAchievementCardProps> = ({
  effectiveCpm,
  effectiveAccuracy,
  actualCpm,
  actualAccuracy,
}) => {
  const actualCpmVal = actualCpm ?? 0;
  const actualAccVal = actualAccuracy ?? 0;
  const cpmPassed = actualCpmVal >= effectiveCpm;
  const accPassed = actualAccVal >= effectiveAccuracy;
  const allPassed = cpmPassed && accPassed;

  const goals: GoalResult[] = [
    {
      label: '語速',
      target: `${effectiveCpm} 字/分`,
      actual: `${Math.round(actualCpmVal)} 字/分`,
      passed: cpmPassed,
    },
    {
      label: '正確率',
      target: `${effectiveAccuracy}%`,
      actual: `${Math.round(actualAccVal)}%`,
      passed: accPassed,
    },
  ];

  return (
    <div
      className={`rounded-xl border p-4 ${
        allPassed
          ? 'border-green-200 bg-green-50'
          : 'border-amber-200 bg-amber-50'
      }`}
    >
      <div className="flex items-center gap-2 mb-3">
        <span className="text-lg">
          {allPassed ? '🎉' : '💪'}
        </span>
        <span className="font-semibold text-gray-800">目標達成情況</span>
        <span
          className={`ml-auto text-sm font-medium px-2 py-0.5 rounded-full ${
            allPassed
              ? 'bg-green-200 text-green-800'
              : 'bg-amber-200 text-amber-800'
          }`}
        >
          {allPassed ? '全部達標' : '繼續加油'}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-3">
        {goals.map((g) => (
          <div
            key={g.label}
            className={`rounded-lg p-3 ${
              g.passed ? 'bg-green-100' : 'bg-red-50'
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm text-gray-600">{g.label}</span>
              <span className="text-base">{g.passed ? '✅' : '❌'}</span>
            </div>
            <div className="text-sm text-gray-500">目標：{g.target}</div>
            <div
              className={`text-base font-bold ${
                g.passed ? 'text-green-700' : 'text-red-600'
              }`}
            >
              實際：{g.actual}
            </div>
          </div>
        ))}
      </div>

      <p className="text-sm text-gray-700 italic">
        {getEncouragingMessage(cpmPassed, accPassed)}
      </p>
    </div>
  );
};

export default GoalAchievementCard;
