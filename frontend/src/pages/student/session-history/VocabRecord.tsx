/**
 * VocabRecord — 生字練習 answer record section.
 * Extracted from SessionHistoryReportPage (Issue #1958).
 */

import React from 'react';
import { ReportSectionAccordion } from './ReportSectionAccordion';

interface VocabRecordProps {
  raw: Record<string, unknown>;
}

export const VocabRecord: React.FC<VocabRecordProps> = ({ raw }) => {
  const words = Array.isArray(raw.practiced_words)
    ? (raw.practiced_words as string[])
    : Array.isArray(raw.practiced_chars)
      ? (raw.practiced_chars as string[])
      : [];
  const total =
    typeof raw.total_words === 'number'
      ? raw.total_words
      : typeof raw.total_chars === 'number'
        ? raw.total_chars
        : 0;

  return (
    <ReportSectionAccordion title="生字練習">
      <div className="text-sm">
        <span className="text-xs text-gray-500">練習進度</span>
        <p className="font-semibold text-gray-800">
          {words.length} / {total} 個生字
        </p>
      </div>
      {words.length > 0 && (
        <div>
          <p className="text-xs text-gray-500 mb-1.5">已練習的生字</p>
          <div className="flex flex-wrap gap-2">
            {words.map((w, i) => (
              <span
                key={i}
                className="px-2.5 py-1 rounded-lg bg-amber-100 text-amber-800 text-base font-medium"
              >
                {w}
              </span>
            ))}
          </div>
        </div>
      )}
    </ReportSectionAccordion>
  );
};

export default VocabRecord;
