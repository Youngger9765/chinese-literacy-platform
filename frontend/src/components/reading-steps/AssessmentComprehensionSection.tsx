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
  hideScores: boolean;
}

export interface AssessmentLegacyResultsProps {
  dictationResult: DictationResult | null;
  comprehensionResult: ComprehensionResult | null;
  hideScores: boolean;
}

/**
 * Section 6: 課文理解力評估 — AI-evaluated comprehension scores.
 */
export const AssessmentComprehensionSection: React.FC<AssessmentComprehensionSectionProps> = ({
  comprehensionScores,
  comprehensionScoresLoading,
  hideScores,
}) => {
  if (!comprehensionScores && !comprehensionScoresLoading) {
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
 * 補充資訊: dictation + legacy comprehension dialogue results panel.
 * Only renders if dictationResult or comprehensionResult exists.
 */
export const AssessmentLegacyResults: React.FC<AssessmentLegacyResultsProps> = ({
  dictationResult,
  comprehensionResult,
  hideScores,
}) => {
  if (!dictationResult && !comprehensionResult) return null;

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

        {/* 課文理解 (legacy dialogue result) */}
        <div className={`rounded-2xl border p-5 ${comprehensionResult ? 'bg-white border-slate-200 shadow-sm' : 'bg-gray-50 border-dashed border-gray-300'}`}>
          <div className="flex items-center gap-2 mb-3">
            <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${comprehensionResult ? 'bg-accent text-white' : 'bg-gray-200 text-gray-400'}`}>3</span>
            <h4 className={`text-sm font-bold ${comprehensionResult ? 'text-gray-900' : 'text-gray-400'}`}>課文理解</h4>
            {comprehensionResult?.isComplete && (
              <span className="ml-auto bg-emerald-100 text-emerald-700 text-[10px] font-bold px-2 py-0.5 rounded-full">已完成</span>
            )}
          </div>
          {comprehensionResult ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="flex-1 bg-gray-200 rounded-full h-2">
                  <div className="bg-emerald-500 h-2 rounded-full transition-all" style={{ width: `${Math.min(100, Math.round((comprehensionResult.understoodCount / Math.max(comprehensionResult.requiredCount, 1)) * 100))}%` }} />
                </div>
                {!hideScores && (
                  <span className="text-xs font-bold text-gray-600">{comprehensionResult.understoodCount}/{comprehensionResult.requiredCount}</span>
                )}
              </div>
              {!hideScores && (
                <div className="flex gap-3 text-xs text-gray-500">
                  <span>對話 {comprehensionResult.conversationLength} 回</span>
                  <span>理解率 {Math.round((comprehensionResult.understoodCount / Math.max(comprehensionResult.requiredCount, 1)) * 100)}%</span>
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-gray-400 text-center py-2">未完成</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default AssessmentComprehensionSection;
