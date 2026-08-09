/**
 * KeyPassageReadingRecord — 全文朗讀 answer record section.
 * Extracted from SessionHistoryReportPage (Issue #1958).
 */

import React from 'react';
import DiffDisplay from '../../../components/ui/DiffDisplay';
import type { DiffToken } from '../../../types';
import { ReportSectionAccordion } from './ReportSectionAccordion';

interface KeyPassageReadingRecordProps {
  raw: Record<string, unknown>;
}

export const KeyPassageReadingRecord: React.FC<KeyPassageReadingRecordProps> = ({ raw }) => {
  const feedback = typeof raw.feedback === 'string' ? raw.feedback : null;
  const diffTokens = Array.isArray(raw.diff_tokens) ? (raw.diff_tokens as DiffToken[]) : [];

  return (
    <ReportSectionAccordion title="全文朗讀">
      {/* Issue #1094: 學生端不顯示符合率 / CPM / 正確漏讀數字 */}
      {diffTokens.length > 0 && (
        <div>
          <p className="text-xs text-gray-500 mb-1.5">朗讀差異對照</p>
          <div className="text-base leading-loose bg-gray-50 rounded-lg p-3">
            <DiffDisplay tokens={diffTokens} showLegend />
          </div>
        </div>
      )}
      {feedback && (
        <div className="bg-blue-50 border border-blue-100 rounded-lg p-3">
          <p className="text-xs font-medium text-blue-700 mb-0.5">AI 回饋</p>
          <p className="text-sm text-gray-700 leading-relaxed">{feedback}</p>
        </div>
      )}
    </ReportSectionAccordion>
  );
};

export default KeyPassageReadingRecord;
