/**
 * ReadingRecord — 逐段朗讀 answer record section.
 * Extracted from SessionHistoryReportPage (Issue #1958).
 */

import React from 'react';
import { ReportSectionAccordion } from './ReportSectionAccordion';

interface ReadingRecordProps {
  raw: Record<string, unknown>;
}

export const ReadingRecord: React.FC<ReadingRecordProps> = ({ raw }) => {
  const mispronounced = Array.isArray(raw.mispronounced_words)
    ? (raw.mispronounced_words as string[])
    : [];
  const transcription = typeof raw.transcription === 'string' ? raw.transcription : null;

  return (
    <ReportSectionAccordion title="逐段朗讀">
      {/* Issue #1094: 學生端不顯示準確率 / CPM 數字，只保留錯字詞與辨識文字 */}
      {mispronounced.length > 0 ? (
        <div>
          <p className="text-xs text-gray-500 mb-1.5">念錯的字詞</p>
          <div className="flex flex-wrap gap-1.5">
            {mispronounced.map((w, i) => (
              <span
                key={i}
                className="px-2 py-0.5 rounded bg-red-100 text-red-700 text-sm font-medium"
              >
                {w}
              </span>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-xs text-green-600">沒有念錯的字詞</p>
      )}
      {transcription && (
        <div>
          <p className="text-xs text-gray-500 mb-1">辨識文字</p>
          <p className="text-xs text-gray-600 leading-relaxed bg-gray-50 rounded-lg p-2.5 whitespace-pre-wrap">
            {transcription}
          </p>
        </div>
      )}
    </ReportSectionAccordion>
  );
};

export default ReadingRecord;
