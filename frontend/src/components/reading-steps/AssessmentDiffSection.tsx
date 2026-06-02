/**
 * AssessmentDiffSection — Section 3 of AssessmentReport (#1845).
 *
 * Renders 逐句分析對比 (環節三) — line-by-line expandable diff view.
 * Teacher view (hideScores=false): shows per-line % and token counts.
 * Student view (hideScores=true): suppresses numeric details.
 */

import React, { useState } from 'react';
import DiffDisplay from '../ui/DiffDisplay';
import type { LineBreakdown, FullReadingResult } from '../../types';

export interface AssessmentDiffSectionProps {
  lineBreakdown: LineBreakdown[];
  fullReadingResult: FullReadingResult | null;
  hideScores: boolean;
}

const AssessmentDiffSection: React.FC<AssessmentDiffSectionProps> = ({
  lineBreakdown,
  fullReadingResult,
  hideScores,
}) => {
  const [expandedLine, setExpandedLine] = useState<number | null>(null);

  if (lineBreakdown.length === 0) {
    return <p className="text-sm text-gray-400 text-center py-4">尚無逐句比對資料</p>;
  }

  return (
    <div className="-mx-6 -mb-6">
      <p className="text-xs text-gray-500 px-6 mb-3">
        點擊每一段可展開查看逐字比對結果
      </p>
      <div className="divide-y divide-slate-100">
        {lineBreakdown.map((line, idx) => {
          const pct = Math.round(line.matchRate * 100);
          const isExpanded = expandedLine === idx;
          return (
            <div key={idx}>
              <button
                onClick={() => setExpandedLine(isExpanded ? null : idx)}
                className="w-full px-6 py-4 flex items-center gap-4 hover:bg-slate-50 transition-colors text-left"
              >
                <span className="text-xs font-bold text-gray-400 w-8 shrink-0">#{idx + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-700 truncate">{line.transcript || '（未朗讀）'}</p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {!hideScores && (
                    <>
                      <span className={`text-sm font-bold ${pct >= 80 ? 'text-emerald-600' : pct >= 60 ? 'text-amber-600' : 'text-red-500'}`}>
                        {pct}%
                      </span>
                      <span className="text-xs text-gray-400">{line.cpm} 字/分</span>
                    </>
                  )}
                  <svg className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </button>
              {isExpanded && line.diffTokens && (
                <div className="px-6 pb-4 pt-1">
                  <DiffDisplay tokens={line.diffTokens} showLegend className="text-lg" />
                  {!hideScores && (
                    <div className="flex gap-4 mt-3 text-xs text-gray-400">
                      <span>正確: {line.diffTokens.filter(t => t.type === 'correct').length} 字</span>
                      <span>讀錯: {line.diffTokens.filter(t => t.type === 'wrong').length} 字</span>
                      <span>漏讀: {line.diffTokens.filter(t => t.type === 'missing').length} 字</span>
                      <span>多讀: {line.diffTokens.filter(t => t.type === 'extra').length} 字</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Full reading diff (if available) */}
      {fullReadingResult?.diffTokens && fullReadingResult.diffTokens.length > 0 && (
        <div className="border-t border-slate-200 px-6 py-4">
          <p className="text-xs text-gray-500 font-bold mb-2">全文朗讀比對</p>
          <DiffDisplay tokens={fullReadingResult.diffTokens} showLegend className="text-lg" />
          {fullReadingResult.errorBreakdown && !hideScores && (
            <div className="flex gap-4 mt-3 text-xs text-gray-400">
              <span>正確: {fullReadingResult.errorBreakdown.correct} 字</span>
              <span>讀錯: {fullReadingResult.errorBreakdown.wrong} 字</span>
              <span>漏讀: {fullReadingResult.errorBreakdown.missing} 字</span>
              <span>多讀: {fullReadingResult.errorBreakdown.extra} 字</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default AssessmentDiffSection;
