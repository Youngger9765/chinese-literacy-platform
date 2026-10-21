/**
 * VocabApplicationRecord — 語詞應用（造句填空）作答紀錄
 *
 * Issue #3682 跟進：session.vocab_result 這個 scalar 欄位從沒被現行的
 * VocabApplication.tsx 寫入過——真正的作答存在
 * step_progress.step_data['vocab-application']，不論學生是中途離開
 * （`{ phase: 'exercise', exercise: { firstTryResults } }`）還是真的交卷
 * （`{ score, total, firstTryResults }`，沒有 `phase`/`exercise` 包一層）。
 * 這支元件把兩種形狀都讀出來，渲染每一題「學生答了什麼 / 正確答案是什麼」。
 *
 * 範圍刻意只接教師端（`TeacherSessionReportPage.tsx`），不是忘了接學生端：
 * 跟它同一套 `step_progress.step_data` 讀法的 `SpotlightStrategyRecord`
 * （#2083）本來就只在教師端出現，`SessionHistoryReportPage.tsx`（學生自己
 * 的「作答紀錄」頁）從未引用過它。這支延續同一個既有分工，不是新開的缺口；
 * 如果之後要讓學生也看得到自己的語詞應用細項，兩支（spotlight + 這支）要
 * 一起補，不是這張票的範圍。
 */
import React from 'react';
import { ReportSectionAccordion } from './ReportSectionAccordion';

interface QuestionResult {
  sentenceIdx: number;
  firstTryCorrect: boolean;
  studentFirstAnswer: string | null;
  correctAnswer: string;
}

interface VocabApplicationRecordProps {
  stepData: Record<string, unknown>;
}

function extractFirstTryResults(stepData: Record<string, unknown>): QuestionResult[] {
  // Completed shape: firstTryResults sits at the top level.
  if (Array.isArray(stepData.firstTryResults)) {
    return stepData.firstTryResults as QuestionResult[];
  }
  // Mid-exercise shape: nested under `exercise` (handleExerciseProgress saves
  // the whole FillInBlankExercise SavedProgress object as-is).
  const exercise = stepData.exercise as Record<string, unknown> | undefined;
  if (exercise && Array.isArray(exercise.firstTryResults)) {
    return exercise.firstTryResults as QuestionResult[];
  }
  return [];
}

export const VocabApplicationRecord: React.FC<VocabApplicationRecordProps> = ({ stepData }) => {
  const results = extractFirstTryResults(stepData);

  if (results.length === 0) {
    // Only a `partialAt` timestamp was saved (beforeunload safety net, no
    // per-question data) — say so rather than rendering nothing silently.
    if (typeof stepData.partialAt === 'string') {
      return (
        <ReportSectionAccordion title="語詞應用">
          <p className="text-sm text-gray-500">學生已開始作答，但尚未存到任何一題的內容</p>
        </ReportSectionAccordion>
      );
    }
    return null;
  }

  return (
    <ReportSectionAccordion title="語詞應用">
      <div className="space-y-2">
        {results.map((r) => (
          <div key={r.sentenceIdx} className="rounded-xl border border-gray-200 p-3 space-y-1">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-medium text-gray-800">第 {r.sentenceIdx + 1} 題</p>
              {r.firstTryCorrect ? (
                <span className="text-xs font-medium text-green-700">✓ 答對</span>
              ) : (
                <span className="text-xs font-medium text-red-600">✗ 答錯</span>
              )}
            </div>
            <p className="text-sm text-gray-700">
              學生填的：{r.studentFirstAnswer || '（未作答）'}
            </p>
            {!r.firstTryCorrect && (
              <p className="text-sm text-gray-500">正確答案：{r.correctAnswer}</p>
            )}
          </div>
        ))}
      </div>
    </ReportSectionAccordion>
  );
};

export default VocabApplicationRecord;
