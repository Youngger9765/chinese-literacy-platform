/**
 * RereadPanel — "再讀一次" encouragement panel shown after LiveTutor or FullReading.
 *
 * Shows the progress chart + a prominent "再讀一次" button.
 * Also saves the just-completed reading to history.
 *
 * Issue #909: 重複朗讀 + 進步曲線
 */
import React, { useEffect, useRef, useState } from 'react';
import ReadingProgressChart from './ReadingProgressChart';
import { useAuth } from '../../contexts/AuthContext';
import { saveReadingHistory, type ReadingProgressSummary } from '../../services/readingHistoryApi';

interface RereadPanelProps {
  lessonId: string;
  studentId: number;
  /** Reading metrics from the just-completed reading */
  cpm: number;
  accuracy: number;
  durationSeconds: number;
  readingType: 'full' | 'paragraph';
  paragraphIndex?: number;
  /** Called when user clicks "再讀一次" */
  onReread: () => void;
  /** Called when user clicks "繼續" to move to next step */
  onContinue: () => void;
}

const RereadPanel: React.FC<RereadPanelProps> = ({
  lessonId,
  studentId,
  cpm,
  accuracy,
  durationSeconds,
  readingType,
  paragraphIndex,
  onReread,
  onContinue,
}) => {
  const { token } = useAuth();
  const savedRef = useRef(false);
  const [encouragement, setEncouragement] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  // Save the reading attempt on mount (once)
  useEffect(() => {
    if (savedRef.current || !token) return;
    savedRef.current = true;

    saveReadingHistory(
      {
        lesson_id: lessonId,
        paragraph_index: paragraphIndex ?? null,
        reading_type: readingType,
        cpm,
        accuracy,
        duration_seconds: durationSeconds,
      },
      token,
    )
      .then(() => {
        // Trigger chart refresh after save
        setRefreshKey(k => k + 1);
      })
      .catch((err) => {
        console.error('Failed to save reading history:', err);
      });
  }, [token, lessonId, paragraphIndex, readingType, cpm, accuracy, durationSeconds]);

  const handleSummaryLoad = (summary: ReadingProgressSummary) => {
    setEncouragement(summary.encouragement);
  };

  return (
    <div className="space-y-4 animate-in fade-in duration-500">
      {/* Current reading results */}
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl border border-blue-200 p-4">
        <h3 className="text-sm font-semibold text-blue-800 mb-3">本次朗讀成績</h3>
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <div className="text-2xl font-bold text-blue-700">{Math.round(cpm)}</div>
            <div className="text-xs text-blue-600 mt-0.5">字/分鐘</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-green-700">{Math.round(accuracy)}%</div>
            <div className="text-xs text-green-600 mt-0.5">準確率</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-purple-700">{Math.round(durationSeconds)}</div>
            <div className="text-xs text-purple-600 mt-0.5">秒</div>
          </div>
        </div>
      </div>

      {/* Progress chart */}
      <ReadingProgressChart
        key={refreshKey}
        studentId={studentId}
        lessonId={lessonId}
        readingType={readingType}
        paragraphIndex={paragraphIndex}
        compact
        onSummaryLoad={handleSummaryLoad}
      />

      {/* Action buttons */}
      <div className="flex gap-3">
        <button
          onClick={onReread}
          className="flex-1 py-3 px-6 bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600 text-white font-semibold rounded-xl shadow-md hover:shadow-lg transition-all duration-200 text-base"
        >
          🔄 再讀一次
        </button>
        <button
          onClick={onContinue}
          className="flex-none py-3 px-6 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded-xl border border-gray-300 transition-all duration-200 text-sm"
        >
          繼續 →
        </button>
      </div>
    </div>
  );
};

export default RereadPanel;
