import React from 'react';

interface OrgPointsUsageProps {
  totalPoints: number;
  usedPoints: number;
  subscriptionStartDate: string | null;
  subscriptionEndDate: string | null;
}

const formatDate = (dateStr: string) =>
  new Date(dateStr).toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric' });

const OrgPointsUsage: React.FC<OrgPointsUsageProps> = ({
  totalPoints,
  usedPoints,
  subscriptionStartDate,
  subscriptionEndDate,
}) => {
  const remainingPoints = totalPoints - usedPoints;
  const usagePercent = totalPoints > 0
    ? Math.min(100, Math.round((usedPoints / totalPoints) * 100))
    : 0;

  return (
    <div className="bg-white rounded-2xl shadow-card p-6">
      <h3 className="font-bold text-gray-900 mb-4">點數使用狀況</h3>
      <div className="grid grid-cols-3 gap-4 mb-4">
        <div className="text-center">
          <p className="text-2xl font-bold text-gray-900">{totalPoints.toLocaleString()}</p>
          <p className="text-xs text-gray-500 mt-1">總點數</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold text-amber-600">{usedPoints.toLocaleString()}</p>
          <p className="text-xs text-gray-500 mt-1">已使用</p>
        </div>
        <div className="text-center">
          <p className={`text-2xl font-bold ${remainingPoints <= 0 ? 'text-red-600' : 'text-emerald-600'}`}>
            {remainingPoints.toLocaleString()}
          </p>
          <p className="text-xs text-gray-500 mt-1">剩餘</p>
        </div>
      </div>
      <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
        <div
          className={`h-2 rounded-full transition-all ${usagePercent >= 90 ? 'bg-red-500' : usagePercent >= 70 ? 'bg-amber-500' : 'bg-emerald-500'}`}
          style={{ width: `${usagePercent}%` }}
        />
      </div>
      <p className="text-xs text-gray-400 mt-1 text-right">{usagePercent}% 已使用</p>
      {(subscriptionStartDate || subscriptionEndDate) && (
        <div className="mt-3 pt-3 border-t border-gray-100 text-sm text-gray-500">
          <span className="font-medium text-gray-700">授權期間：</span>
          {subscriptionStartDate ? formatDate(subscriptionStartDate) : '—'}
          {' ~ '}
          {subscriptionEndDate ? formatDate(subscriptionEndDate) : '—'}
        </div>
      )}
    </div>
  );
};

export default OrgPointsUsage;
