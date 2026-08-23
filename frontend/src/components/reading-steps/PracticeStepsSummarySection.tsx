/**
 * PracticeStepsSummarySection — new AssessmentReport section (#2835).
 *
 * Renders completion status (+ score, when the step has one) for the
 * practice steps that had zero representation anywhere in the report before
 * this issue: 讀全文-做記號 / 詞語理解 / 語詞應用 / 文章重點表 / 閱讀聚光燈 /
 * 語詞複習 / 知識補給站.
 */

import React from 'react';
import type { PracticeStepSummaryItem } from './practiceStepsSummary';

interface PracticeStepsSummarySectionProps {
  items: PracticeStepSummaryItem[];
}

const PracticeStepsSummarySection: React.FC<PracticeStepsSummarySectionProps> = ({ items }) => {
  if (items.length === 0) return null;

  return (
    <div className="grid sm:grid-cols-2 gap-3">
      {items.map((item) => (
        <div
          key={item.stepId}
          className={`rounded-2xl border p-4 flex items-center justify-between gap-3 ${
            item.completed ? 'bg-white border-slate-200 shadow-sm' : 'bg-gray-50 border-dashed border-gray-300'
          }`}
        >
          <span className={`text-sm font-bold ${item.completed ? 'text-gray-900' : 'text-gray-400'}`}>
            {item.label}
          </span>
          {item.scoreLabel ? (
            <span className="text-xs font-bold text-accent bg-accent/10 px-2.5 py-1 rounded-full whitespace-nowrap">
              {item.scoreLabel}
            </span>
          ) : item.completed ? (
            <span className="text-xs font-bold text-emerald-700 bg-emerald-100 px-2.5 py-1 rounded-full whitespace-nowrap">
              已完成
            </span>
          ) : (
            <span className="text-xs font-medium text-gray-400 bg-gray-100 px-2.5 py-1 rounded-full whitespace-nowrap">
              尚未完成
            </span>
          )}
        </div>
      ))}
    </div>
  );
};

export default PracticeStepsSummarySection;
