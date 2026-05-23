/**
 * ComprehensionRecord — 課文理解 dialogue answer record section.
 * Extracted from SessionHistoryReportPage (Issue #1958).
 */

import React from 'react';
import type { ComprehensionScoreResult, DialogueTurnItem } from '../../../services/learningApi';
import { ReportSectionAccordion } from './ReportSectionAccordion';

interface ComprehensionRecordProps {
  raw: Record<string, unknown> | null;
  turns: DialogueTurnItem[];
  scores: ComprehensionScoreResult | null;
}

export const ComprehensionRecord: React.FC<ComprehensionRecordProps> = ({
  raw: _raw,
  turns,
  scores,
}) => {
  // Only show ai + student turns (skip feedback role for readability)
  const conversationTurns = turns.filter((t) => t.role === 'ai' || t.role === 'student');

  return (
    <ReportSectionAccordion title="課文理解">
      {/* Issue #1094: 學生端不顯示答對題數 / 理解率 / 三層次分數，改以對話紀錄為主 */}

      {conversationTurns.length > 0 ? (
        <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
          {conversationTurns.map((turn) => (
            <div
              key={turn.id}
              className={`flex ${turn.role === 'student' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                  turn.role === 'ai'
                    ? 'bg-gray-100 text-gray-800 rounded-tl-sm'
                    : turn.is_correct === false
                      ? 'bg-red-100 text-red-800 rounded-tr-sm'
                      : 'bg-accent-bg text-accent rounded-tr-sm'
                }`}
              >
                {turn.text}
                {turn.role === 'student' && turn.is_correct === false && (
                  <span className="block text-xs text-red-500 mt-0.5">✗ 答錯</span>
                )}
                {turn.role === 'student' && turn.is_correct === true && (
                  <span className="block text-xs text-green-600 mt-0.5">✓ 答對</span>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-gray-400">沒有對話紀錄</p>
      )}

      {scores?.feedback.overall && (
        <div className="bg-emerald-50 border border-emerald-100 rounded-lg p-3">
          <p className="text-xs font-medium text-emerald-700 mb-0.5">AI 整體回饋</p>
          <p className="text-sm text-gray-700 leading-relaxed">{scores.feedback.overall}</p>
        </div>
      )}
    </ReportSectionAccordion>
  );
};

export default ComprehensionRecord;
