/**
 * AssessmentComprehensionSection — Section 6 + legacy sections of AssessmentReport (#1845).
 *
 * Renders 課文理解力評估 (環節六) via ComprehensionScoreCard,
 * and the 補充資訊 panel (dictation + comprehension legacy results).
 */

import React from 'react';
import ComprehensionScoreCard from './ComprehensionScoreCard';
import type { ComprehensionScoreResult } from '../../services/learningApi';
import type { ComprehensionResult, DictationResult } from '../../types';
import { encourageQuiz } from '../../utils/encouragement';

export interface AssessmentComprehensionSectionProps {
  comprehensionScores?: ComprehensionScoreResult | null;
  comprehensionScoresLoading?: boolean;
  /**
   * MCQ-based 閱讀理解 result (Issue #2835). The live flow's comprehension
   * step (ComprehensionMcqPage) produces THIS, not dialogue turns — so
   * comprehensionScores (which requires a Socratic-dialogue history) stays
   * null forever for MCQ-only sessions. When comprehensionScores is absent
   * but this exists, render a simplified MCQ score card instead of the
   * "尚未完成課文理解對話" placeholder that was misleading every MCQ session.
   */
  comprehensionResult?: ComprehensionResult | null;
  hideScores: boolean;
}

export interface AssessmentLegacyResultsProps {
  dictationResult: DictationResult | null;
  hideScores: boolean;
}

/**
 * Section 6: 課文理解力評估 — AI-evaluated comprehension scores.
 */
export const AssessmentComprehensionSection: React.FC<AssessmentComprehensionSectionProps> = ({
  comprehensionScores,
  comprehensionScoresLoading,
  comprehensionResult,
  hideScores,
}) => {
  if (!comprehensionScores && !comprehensionScoresLoading) {
    if (comprehensionResult) {
      const pct = Math.round(
        (comprehensionResult.understoodCount / Math.max(comprehensionResult.requiredCount, 1)) * 100,
      );
      return (
        <div className="rounded-2xl border border-slate-200 bg-white p-6">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-sm font-bold text-gray-900">閱讀理解測驗</span>
            {!hideScores && (
              <span className="ml-auto text-sm font-black text-accent">
                {comprehensionResult.understoodCount}/{comprehensionResult.requiredCount}
              </span>
            )}
          </div>
          <div className="bg-gray-200 rounded-full h-2 mb-3">
            <div
              className="bg-emerald-500 h-2 rounded-full transition-all"
              style={{ width: `${Math.min(100, pct)}%` }}
            />
          </div>
          {hideScores ? (
            <p className="text-sm text-emerald-600 font-medium">
              {encourageQuiz(comprehensionResult.understoodCount, comprehensionResult.requiredCount)}
            </p>
          ) : (
            <p className="text-xs text-gray-500">
              答對 {comprehensionResult.understoodCount}/{comprehensionResult.requiredCount} 題（{pct}%）
            </p>
          )}
        </div>
      );
    }
    return (
      <div className="p-6 bg-gray-50 rounded-2xl text-center">
        <p className="text-sm text-gray-400 font-bold">尚未完成課文理解對話</p>
        <p className="text-xs text-gray-300 mt-1">完成蘇格拉底式對話後，系統將評估你的三層次理解力</p>
      </div>
    );
  }

  return (
    <ComprehensionScoreCard
      comprehensionScore={comprehensionScores?.comprehension_score ?? 0}
      literalScore={comprehensionScores?.literal_score ?? 0}
      inferentialScore={comprehensionScores?.inferential_score ?? 0}
      evaluativeScore={comprehensionScores?.evaluative_score ?? 0}
      feedback={comprehensionScores?.feedback ?? null}
      loading={comprehensionScoresLoading}
      hideScores={hideScores}
    />
  );
};

/**
 * 補充資訊: dictation legacy results panel.
 * Only renders if dictationResult exists.
 *
 * Issue #2835: this used to ALSO render a "課文理解 (legacy dialogue result)"
 * card driven by comprehensionResult — but that data now IS the live MCQ
 * 閱讀理解 step's result, and is already shown properly (with the right
 * label, not "課文理解") by AssessmentComprehensionSection's MCQ fallback
 * card above. Keeping both would show the same score twice under two
 * different, confusing labels.
 */
export const AssessmentLegacyResults: React.FC<AssessmentLegacyResultsProps> = ({
  dictationResult,
  hideScores,
}) => {
  if (!dictationResult) return null;

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider">其他學習成果</h3>

      <div className="grid md:grid-cols-2 gap-4">
        {/* 聽寫練習 */}
        {dictationResult && (
          <div className="rounded-2xl border p-5 bg-white border-slate-200 shadow-sm">
            <div className="flex items-center gap-2 mb-3">
              <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold bg-accent text-white">5</span>
              <h4 className="text-sm font-bold text-gray-900">聽寫練習</h4>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="flex-1 bg-gray-200 rounded-full h-2">
                  <div
                    className="bg-emerald-500 h-2 rounded-full transition-all"
                    style={{ width: dictationResult.totalWords > 0 ? `${Math.round((dictationResult.correctCount / dictationResult.totalWords) * 100)}%` : '0%' }}
                  />
                </div>
                {!hideScores && (
                  <span className="text-xs font-bold text-gray-600">{dictationResult.correctCount}/{dictationResult.totalWords}</span>
                )}
              </div>
              {hideScores ? (
                <p className="text-xs text-emerald-600 font-medium">
                  {encourageQuiz(dictationResult.correctCount, dictationResult.totalWords)}
                </p>
              ) : (
                <div className="flex gap-3 text-xs text-gray-500">
                  <span className="text-emerald-600 font-medium">正確 {dictationResult.correctCount}</span>
                  {dictationResult.incorrectCount > 0 && (
                    <span className="text-red-500 font-medium">錯誤 {dictationResult.incorrectCount}</span>
                  )}
                  {dictationResult.skippedCount > 0 && (
                    <span className="text-gray-400">跳過 {dictationResult.skippedCount}</span>
                  )}
                </div>
              )}
              {dictationResult.results.some(r => !r.isCorrect && !r.skipped) && (
                <div className="mt-2 space-y-1">
                  <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">答錯的詞語</p>
                  {dictationResult.results
                    .filter(r => !r.isCorrect && !r.skipped)
                    .map((r, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        <span className="font-bold text-gray-900">{r.word}</span>
                        <span className="text-gray-400">你答：</span>
                        <span className="text-red-500">{r.studentAnswer || '（空白）'}</span>
                      </div>
                    ))
                  }
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AssessmentComprehensionSection;
