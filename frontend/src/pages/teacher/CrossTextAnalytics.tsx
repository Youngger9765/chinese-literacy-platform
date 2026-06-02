/**
 * CrossTextAnalytics — Orchestrator
 *
 * Refactored from 537 LOC monolith (Issue #1951) into:
 *   - useCrossTextData  (hooks/useCrossTextData.ts)     — data fetching + state
 *   - CrossTextFilterBar (components/CrossTextFilterBar.tsx) — view mode toggle
 *   - CrossTextChartGrid (components/CrossTextChartGrid.tsx) — all chart panels
 *   - CrossTextAnalytics (this file)                    — orchestrator only
 */
import React, { useState } from 'react';
import { useCrossTextData } from './hooks/useCrossTextData';
import { CrossTextFilterBar, ViewMode } from './components/CrossTextFilterBar';
import {
  ClassOverviewPanel,
  StudentDetailPanel,
  StudentSelector,
} from './components/CrossTextChartGrid';

interface CrossTextAnalyticsProps {
  classroomId: number;
}

const CrossTextAnalytics: React.FC<CrossTextAnalyticsProps> = ({ classroomId }) => {
  const { data, isLoading, error, reload } = useCrossTextData(classroomId);
  const [viewMode, setViewMode] = useState<ViewMode>('class');
  const [selectedStudentId, setSelectedStudentId] = useState<number | null>(null);

  // Auto-select first student when data loads
  React.useEffect(() => {
    if (data && data.student_patterns.length > 0 && selectedStudentId === null) {
      setSelectedStudentId(data.student_patterns[0].student_id);
    }
  }, [data, selectedStudentId]);

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-32 bg-gray-100 animate-pulse rounded-xl" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 text-center text-red-500">
        <p>{error}</p>
        <button onClick={reload} className="mt-3 text-sm text-indigo-600 hover:underline">
          重試
        </button>
      </div>
    );
  }

  if (!data) return null;

  if (data.total_sessions === 0) {
    return (
      <div className="p-8 text-center text-gray-500">
        <p className="text-4xl mb-3">📚</p>
        <p className="font-medium">尚無學習記錄</p>
        <p className="text-sm mt-1">學生完成課文練習後，跨課文模式分析將自動生成。</p>
      </div>
    );
  }

  const selectedPattern = data.student_patterns.find(
    (p) => p.student_id === selectedStudentId,
  );

  return (
    <div className="p-5 space-y-5">
      <CrossTextFilterBar viewMode={viewMode} onViewModeChange={setViewMode} />

      {viewMode === 'class' ? (
        <ClassOverviewPanel data={data} />
      ) : (
        <div className="flex flex-col md:flex-row gap-5">
          <StudentSelector
            students={data.student_patterns}
            selected={selectedStudentId}
            onSelect={setSelectedStudentId}
          />
          <div className="flex-1 min-w-0">
            {selectedPattern ? (
              <>
                <h3 className="text-base font-semibold text-gray-700 mb-4">
                  {selectedPattern.student_name} 的跨課文學習模式
                </h3>
                <StudentDetailPanel pattern={selectedPattern} />
              </>
            ) : (
              <div className="text-center text-gray-400 py-12">請從左側選擇學生</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default CrossTextAnalytics;
