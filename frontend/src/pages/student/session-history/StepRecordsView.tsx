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
import { KeyPassageReadingRecord } from './KeyPassageReadingRecord';
import { ComprehensionRecord } from './ComprehensionRecord';
import { VocabRecord } from './VocabRecord';

interface StepRecordsViewProps {
  detail: SessionDetailResponse;
  comprehensionScores: ComprehensionScoreResult | null;
  token: string;
  sessionId: number;
  /**
   * 對話紀錄的來源。預設打學生自己的 `/learning/sessions/{id}/dialogue`。
   *
   * ⛔ 教師端必須注入自己那支（`/teacher/students/{id}/sessions/{sid}/dialogue`）——
   * 學生端那支走 `get_owned_session`，`session.student_id != current_user.id`
   * 直接 403，老師打不到。這個 prop 存在的唯一理由就是這件事。
   */
  loadDialogue?: () => Promise<DialogueTurnItem[]>;
}

export const StepRecordsView: React.FC<StepRecordsViewProps> = ({
  detail,
  comprehensionScores,
  token,
  sessionId,
  loadDialogue,
}) => {
  const [turns, setTurns] = useState<DialogueTurnItem[]>([]);
  const [loadingTurns, setLoadingTurns] = useState(true);
  const [dialogueChecked, setDialogueChecked] = useState(false);

  // Issue #3682: this used to be gated on `detail.comprehension_result`, but no
  // current step component ever writes that scalar column — the real
  // conversation lives in the DialogueTurn table from the moment the student
  // answers the first question, independent of whether the session (or even
  // just the comprehension step) has finished. Gating the fetch on a column
  // that's always null meant this dialogue call never actually ran in
  // production, so a student's already-given answers were invisible even
  // while they were mid-conversation. Always check; whether anything renders
  // is decided below by what actually comes back, not by that dead column.
  useEffect(() => {
    setLoadingTurns(true);
    setDialogueChecked(false);
    const load = loadDialogue ?? (() => fetchDialogueHistory(token, sessionId).then((r) => r.turns));
    load()
      .then(setTurns)
      .catch(() => {
        /* non-critical */
      })
      .finally(() => {
        setLoadingTurns(false);
        setDialogueChecked(true);
      });
  }, [token, sessionId, loadDialogue]);

  const hasReading = !!detail.reading_result;
  const hasKeyPassageReading = !!detail.full_reading_result;
  // Keep the legacy field as a fallback (older sessions may still carry it),
  // but real turns are the signal that actually reflects current step code.
  const hasComprehension = !!detail.comprehension_result || turns.length > 0;
  const hasVocab = !!detail.vocab_result;
  const hasAny = hasReading || hasKeyPassageReading || hasComprehension || hasVocab;

  // The dialogue check is the only async gate here — if it's still in flight
  // and nothing else has data yet, wait for it instead of flashing "尚無作答
  // 紀錄" and then yanking it away once turns arrive.
  if (!hasAny && !dialogueChecked) {
    return (
      <div className="space-y-2" aria-label="作答紀錄載入中">
        <div className="h-4 bg-gray-200 animate-pulse rounded w-1/3" />
        <div className="h-20 bg-gray-100 animate-pulse rounded-xl" />
      </div>
    );
  }

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
      {hasKeyPassageReading && <KeyPassageReadingRecord raw={detail.full_reading_result!} />}
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
