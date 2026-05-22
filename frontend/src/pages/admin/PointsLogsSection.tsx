import React from 'react';
import { PointsLogResponse } from '../../services/organizationApi';

interface PointsLogsSectionProps {
  logs: PointsLogResponse[];
  logsTotal: number;
  logsLoading: boolean;
  onLoadMore: () => void;
}

const formatDateTime = (dateStr: string) =>
  new Date(dateStr).toLocaleString('zh-TW', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

const PointsLogsSection: React.FC<PointsLogsSectionProps> = ({
  logs,
  logsTotal,
  logsLoading,
  onLoadMore,
}) => {
  return (
    <div className="bg-white rounded-2xl shadow-card">
      <div className="p-5 border-b border-gray-100">
        <h3 className="font-bold text-gray-900">點數使用紀錄</h3>
        <p className="text-xs text-gray-500 mt-0.5">共 {logsTotal} 筆</p>
      </div>
      {logs.length === 0 && !logsLoading ? (
        <div className="p-8 text-center text-sm text-gray-400">尚無使用紀錄</div>
      ) : (
        <>
          <div className="md:hidden p-4 space-y-3">
            {logs.map((log) => (
              <div key={log.id} className="bg-white rounded-lg border border-gray-200 p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-gray-900 text-sm">
                    {log.user_name ?? <span className="text-gray-400">—</span>}
                  </span>
                  <span className="text-amber-700 font-medium text-sm">-{log.points_used}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="inline-block px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 text-xs">
                    {log.feature_type}
                  </span>
                  <span className="text-xs text-gray-400">{formatDateTime(log.created_at)}</span>
                </div>
                {log.description && (
                  <p className="text-xs text-gray-500 line-clamp-2">{log.description}</p>
                )}
              </div>
            ))}
          </div>

          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-500">使用者</th>
                  <th className="text-right px-5 py-3 text-xs font-medium text-gray-500">點數</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-500">功能類型</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-500">說明</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-500">時間</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {logs.map((log) => (
                  <tr key={log.id} className="hover:bg-gray-50/50">
                    <td className="px-5 py-3 text-gray-700">
                      {log.user_name ?? <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-5 py-3 text-right text-amber-700 font-medium">
                      -{log.points_used}
                    </td>
                    <td className="px-5 py-3">
                      <span className="inline-block px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 text-xs">
                        {log.feature_type}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-gray-500 max-w-xs truncate">
                      {log.description ?? <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-5 py-3 text-gray-400 whitespace-nowrap">
                      {formatDateTime(log.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {logs.length < logsTotal && (
            <div className="p-4 text-center border-t border-gray-100">
              <button
                onClick={onLoadMore}
                disabled={logsLoading}
                className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                {logsLoading ? '載入中...' : '載入更多'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default PointsLogsSection;
