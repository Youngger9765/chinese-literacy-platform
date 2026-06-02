/**
 * IntelligentAnalysisSection — Section 2 of AssessmentReport (#1945).
 * 環節二：錄音內容與智能分析
 *
 * Extracted from the inline Section 2 block in AssessmentReport.tsx.
 * Shows transcription text and segment breakdown stat cards (teacher-only).
 */

import React from 'react';
import type { SegmentStats } from './assessmentReportMetrics';

interface LineBreakdownItem {
  lineIndex: number;
  matchRate: number;
  cpm: number;
  transcript: string;
  diffTokens: Array<{ char: string; type: string; expected?: string }>;
}

interface IntelligentAnalysisSectionProps {
  /** Transcription text from readingAttempt or fullReadingResult */
  transcription: string;
  /** Line-by-line breakdown from readingAttempt (may be empty array) */
  lineBreakdown: LineBreakdownItem[];
  /** Aggregated correct/wrong/missing/total counts */
  segmentStats: SegmentStats;
  /** True for student view — hides numeric analysis cards (Issue #1094) */
  hideScores: boolean;
  /** Whether any reading data exists (readingAttempt or fullReadingResult) */
  hasReadingData: boolean;
}

/**
 * Section 2: 錄音內容與智能分析
 *
 * Renders:
 * - Transcription text block (if non-empty)
 * - 4-column stat cards: 正確 / 讀錯 / 遺漏 / 總計 (teacher-only, hidden for students)
 * - Fallback message when no usable data
 * - Empty state when no reading data at all
 */
const IntelligentAnalysisSection: React.FC<IntelligentAnalysisSectionProps> = ({
  transcription,
  lineBreakdown,
  segmentStats,
  hideScores,
  hasReadingData,
}) => {
  if (!hasReadingData) {
    return <p className="text-sm text-gray-400 text-center py-4">尚未完成朗讀練習</p>;
  }

  const hasTranscription = transcription.trim().length > 0;
  const hasBreakdown = lineBreakdown.length > 0;

  return (
    <div className="space-y-4">
      {/* Transcription text */}
      {hasTranscription && (
        <div>
          <p className="text-xs text-gray-500 font-bold mb-2">語音轉文字</p>
          <div className="bg-slate-50 rounded-2xl p-4 text-sm text-gray-700 leading-relaxed">
            {transcription.trim()}
          </div>
        </div>
      )}

      {/* 4 category cards — hidden for students (Issue #1094) */}
      {hasBreakdown && !hideScores && (
        <div>
          <p className="text-xs text-gray-500 font-bold mb-2">朗讀分析</p>
          <div className="grid grid-cols-4 gap-3">
            <div className="bg-emerald-50 rounded-xl p-3 text-center">
              <span className="text-2xl font-black text-emerald-600">{segmentStats.correct}</span>
              <p className="text-xs text-emerald-600 font-bold mt-0.5">正確</p>
            </div>
            <div className="bg-red-50 rounded-xl p-3 text-center">
              <span className="text-2xl font-black text-red-500">{segmentStats.wrong}</span>
              <p className="text-xs text-red-500 font-bold mt-0.5">讀錯</p>
            </div>
            <div className="bg-amber-50 rounded-xl p-3 text-center">
              <span className="text-2xl font-black text-amber-600">{segmentStats.missing}</span>
              <p className="text-xs text-amber-600 font-bold mt-0.5">遺漏</p>
            </div>
            <div className="bg-blue-50 rounded-xl p-3 text-center">
              <span className="text-2xl font-black text-blue-600">{segmentStats.total}</span>
              <p className="text-xs text-blue-600 font-bold mt-0.5">總計</p>
            </div>
          </div>
        </div>
      )}

      {/* Fallback: neither transcription nor breakdown available */}
      {!hasTranscription && !hasBreakdown && (
        <p className="text-sm text-gray-400 text-center py-4">
          語音辨識資料不足，準確度過低時建議重新朗讀
        </p>
      )}
    </div>
  );
};

export default IntelligentAnalysisSection;
