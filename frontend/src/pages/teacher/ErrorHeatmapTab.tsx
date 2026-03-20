/**
 * ErrorHeatmapTab — classroom tab showing which students struggle with
 * which characters.
 *
 * Fetches from GET /api/teacher/classrooms/{id}/error-heatmap and renders
 * an ErrorHeatmapChart plus a summary of the top problematic characters.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import {
  getClassroomErrorHeatmap,
  ClassroomErrorHeatmap,
  TeacherApiError,
} from '../../services/teacherApi';
import ErrorHeatmapChart from '../../components/teacher/ErrorHeatmapChart';

interface ErrorHeatmapTabProps {
  classroomId: number;
}

const ErrorHeatmapTab: React.FC<ErrorHeatmapTabProps> = ({ classroomId }) => {
  const { token } = useAuth();
  const [data, setData] = useState<ClassroomErrorHeatmap | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const loadData = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    setError('');
    try {
      const heatmap = await getClassroomErrorHeatmap(token, classroomId);
      setData(heatmap);
    } catch (err) {
      if (err instanceof TeacherApiError) {
        setError(err.message);
      } else {
        setError('無法載入錯字分析資料');
      }
    } finally {
      setIsLoading(false);
    }
  }, [token, classroomId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (isLoading) {
    return (
      <div className="p-6 space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-6 bg-gray-200 animate-pulse rounded w-full" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={loadData} className="text-red-600 underline text-xs hover:text-red-800 cursor-pointer">
            重試
          </button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  // Compute top characters by total error count for summary
  const charTotals: Record<string, number> = {};
  for (const entry of data.errors) {
    charTotals[entry.character] = (charTotals[entry.character] ?? 0) + entry.error_count;
  }
  const topChars = Object.entries(charTotals)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h3 className="text-sm font-semibold text-gray-900">錯字熱力圖</h3>
        <p className="text-xs text-gray-500 mt-0.5">
          顏色越深表示該學生在該字的錯誤次數越多。欄位依全班錯誤次數由多至少排列。
        </p>
      </div>

      {/* Summary cards — top problematic characters */}
      {topChars.length > 0 && (
        <div>
          <p className="text-xs font-medium text-gray-600 mb-2">全班最常出錯的字</p>
          <div className="flex flex-wrap gap-2">
            {topChars.map(([char, total]) => (
              <div
                key={char}
                className="flex items-center gap-1.5 bg-red-50 border border-red-200 rounded-lg px-3 py-1.5"
              >
                <span className="text-lg font-bold text-red-700 leading-none">{char}</span>
                <span className="text-xs text-red-500">{total} 次</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Heatmap */}
      <div className="rounded-lg border border-gray-200 overflow-hidden">
        <ErrorHeatmapChart data={data} />
      </div>

      {/* Empty state hint when no errors recorded */}
      {data.errors.length === 0 && data.students.length > 0 && (
        <p className="text-sm text-gray-400 text-center py-4">
          此班級尚未記錄任何錯字資料
        </p>
      )}
    </div>
  );
};

export default ErrorHeatmapTab;
