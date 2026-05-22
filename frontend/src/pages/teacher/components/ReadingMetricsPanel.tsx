/**
 * ReadingMetricsPanel — expanded reading metrics for a single submission.
 * Extracted from AssignmentDetailPanel (Issue #1853).
 */
import React from 'react';

interface Props {
  studentName: string;
  readingAccuracy: number | null;
  readingCpm: number | null;
  readingErrorChars: string[];
}

const ReadingMetricsPanel: React.FC<Props> = ({
  studentName,
  readingAccuracy,
  readingCpm,
  readingErrorChars,
}) => (
  <div className="mx-1 p-2.5 bg-blue-50 border border-blue-100 rounded-lg">
    <p className="text-xs font-medium text-blue-800 mb-2">
      朗讀學習數據 — {studentName}
    </p>
    <div className="flex flex-wrap gap-4">
      <div className="text-center">
        <div className="text-lg font-bold text-blue-700">
          {readingAccuracy != null ? `${readingAccuracy.toFixed(1)}%` : '—'}
        </div>
        <div className="text-xs text-gray-500">正確率</div>
      </div>
      <div className="text-center">
        <div className="text-lg font-bold text-blue-700">
          {readingCpm != null ? `${Math.round(readingCpm)}` : '—'}
        </div>
        <div className="text-xs text-gray-500">語速（字/分）</div>
      </div>
      {readingErrorChars.length > 0 && (
        <div>
          <div className="text-xs text-gray-500 mb-1">
            錯誤字詞（{readingErrorChars.length} 個）
          </div>
          <div className="flex flex-wrap gap-1">
            {readingErrorChars.map((ch, i) => (
              <span
                key={i}
                className="inline-block px-1.5 py-0.5 rounded bg-red-100 text-red-700 text-xs font-medium"
              >
                {ch}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  </div>
);

export default ReadingMetricsPanel;
