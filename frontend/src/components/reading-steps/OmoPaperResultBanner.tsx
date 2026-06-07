/**
 * OmoPaperResultBanner — shows this step's paper (OMO) grading inside the
 * matching online 關卡 (#2027 / #2089 item 3).
 *
 * When a student uploads a paper worksheet and it finishes grading, the backend
 * merges the result into LearningSession.step_progress.step_data[step].omo (the
 * same store online answers use). This banner surfaces that record at the top of
 * the corresponding step page so the paper作答 + 對錯 appears in-flow — the goal
 * being「把紙本作答平移到線上，邏輯跟線上作答完全一樣」.
 *
 * Renders nothing when this step has no paper record, so it is safe to drop into
 * any step page unconditionally.
 */
import React from 'react';
import { useLearningContext } from '../../layouts/LearningLayout';

interface OmoStepAnswer {
  question_id: string;
  student_answer: string;
  correct_answer: string;
  score: number;
  ai_confidence: number;
  context: string;
}

interface OmoStepRecord {
  graded_at: string;
  source: string;
  answers: OmoStepAnswer[];
}

function extractOmoRecord(
  stepData: Record<string, unknown> | undefined,
  stepId: string,
): OmoStepRecord | null {
  const step = stepData?.[stepId];
  if (!step || typeof step !== 'object') return null;
  const omo = (step as Record<string, unknown>).omo;
  if (!omo || typeof omo !== 'object') return null;
  const answers = (omo as Record<string, unknown>).answers;
  if (!Array.isArray(answers)) return null;
  return omo as unknown as OmoStepRecord;
}

function formatGradedAt(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  return new Date(iso).toLocaleString('zh-TW', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const AnswerRow: React.FC<{ ans: OmoStepAnswer }> = ({ ans }) => {
  const answered = (ans.student_answer || '').trim().length > 0;
  const correct = ans.score >= 1;
  const partial = ans.score > 0 && ans.score < 1;
  const mark = !answered ? '—' : correct ? '✓' : partial ? '◐' : '✗';
  const markCls = !answered
    ? 'text-gray-400'
    : correct
    ? 'text-emerald-600'
    : partial
    ? 'text-amber-500'
    : 'text-red-500';

  return (
    <li className="flex items-start gap-2 py-1.5 border-b border-amber-100 last:border-0">
      <span className={`shrink-0 w-5 text-center font-bold ${markCls}`} aria-hidden="true">
        {mark}
      </span>
      <div className="flex-1 min-w-0">
        {ans.context && (
          <p className="text-xs text-gray-500 truncate" title={ans.context}>
            {ans.context}
          </p>
        )}
        <p className="text-sm text-gray-800">
          你的作答：
          <span className={answered ? 'font-semibold' : 'text-gray-400'}>
            {answered ? ans.student_answer : '未作答'}
          </span>
          {answered && !correct && ans.correct_answer && (
            <span className="ml-2 text-emerald-700">正解：{ans.correct_answer}</span>
          )}
        </p>
      </div>
    </li>
  );
};

const OmoPaperResultBanner: React.FC<{ stepId: string }> = ({ stepId }) => {
  const { stepProgressData } = useLearningContext();
  const record = extractOmoRecord(stepProgressData?.step_data, stepId);
  if (!record || record.answers.length === 0) return null;

  const correctCount = record.answers.filter((a) => a.score >= 1).length;
  const gradedAt = formatGradedAt(record.graded_at);

  return (
    <section
      aria-label="紙本批改結果"
      className="mb-4 rounded-2xl border border-amber-200 bg-amber-50/70 p-4 shadow-sm"
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="text-lg" aria-hidden="true">📄</span>
        <h3 className="text-sm font-bold text-amber-900">紙本批改結果</h3>
        <span className="ml-auto text-xs font-medium text-amber-700">
          答對 {correctCount}/{record.answers.length}
        </span>
      </div>
      <ul className="rounded-xl bg-white/70 px-3">
        {record.answers.map((ans) => (
          <AnswerRow key={ans.question_id} ans={ans} />
        ))}
      </ul>
      {gradedAt && (
        <p className="mt-2 text-[11px] text-amber-600">紙本批改於 {gradedAt}</p>
      )}
    </section>
  );
};

export default OmoPaperResultBanner;
