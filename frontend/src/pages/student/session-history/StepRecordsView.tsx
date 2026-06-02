/**
 * StepRecordsView — 作答紀錄 tab: renders all step answer records.
 * Extracted from SessionHistoryReportPage (Issue #1958).
 */

import React, { useEffect, useState } from 'react';
import {
  fetchDialogueHistory,
  type SessionDetailResponse,
  type ComprehensionScoreResult,
  type DialogueTurnItem,
} from '../../../services/learningApi';
import { ReadingRecord } from './ReadingRecord';
import { FullReadingRecord } from './FullReadingRecord';
import { ComprehensionRecord } from './ComprehensionRecord';
import { VocabRecord } from './VocabRecord';

interface StepRecordsViewProps {
  detail: SessionDetailResponse;
  comprehensionScores: ComprehensionScoreResult | null;
  token: string;
  sessionId: number;
}

export const StepRecordsView: React.FC<StepRecordsViewProps> = ({
  detail,
  comprehensionScores,
  token,
  sessionId,
}) => {
  const [turns, setTurns] = useState<DialogueTurnItem[]>([]);
  const [loadingTurns, setLoadingTurns] = useState(false);

  useEffect(() => {
    if (!detail.comprehension_result) return;
    setLoadingTurns(true);
    fetchDialogueHistory(token, sessionId)
      .then((r) => setTurns(r.turns))
      .catch(() => {
        /* non-critical */
      })
      .finally(() => setLoadingTurns(false));
  }, [token, sessionId, detail.comprehension_result]);

  const hasReading = !!detail.reading_result;
  const hasFullReading = !!detail.full_reading_result;
  const hasComprehension = !!detail.comprehension_result;
  const hasVocab = !!detail.vocab_result;
  const hasAny = hasReading || hasFullReading || hasComprehension || hasVocab;

  if (!hasAny) {
    return (
      <div className="text-center py-12 space-y-2">
        <p className="text-sm font-medium text-gray-600">尚無作答紀錄</p>
        <p className="text-sm text-gray-400">
          這次學習的作答詳情未儲存，可能是較舊的紀錄或尚未完成所有步驟
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {hasReading && <ReadingRecord raw={detail.reading_result!} />}
      {hasFullReading && <FullReadingRecord raw={detail.full_reading_result!} />}
      {hasComprehension &&
        (loadingTurns ? (
          <div className="bg-white rounded-2xl shadow-card p-4">
            <div className="h-4 bg-gray-200 animate-pulse rounded w-1/3 mb-3" />
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-8 bg-gray-100 animate-pulse rounded-xl" />
              ))}
            </div>
          </div>
        ) : (
          <ComprehensionRecord
            raw={detail.comprehension_result}
            turns={turns}
            scores={comprehensionScores}
          />
        ))}
      {hasVocab && <VocabRecord raw={detail.vocab_result!} />}
    </div>
  );
};

export default StepRecordsView;
