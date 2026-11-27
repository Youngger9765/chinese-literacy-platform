/**
 * #4154 作答後回饋的附屬件：「看原文依據」視窗與「這題怪怪的」回報。
 *
 * 從 ExerciseBlockView 抽出來，避免那支檔案再長大（元件上限 500 行）。
 * 只負責畫與送，不判斷對錯；什麼時候出現由 ExerciseBlockView 決定。
 */
import React, { useState } from 'react';
import { submitFeedback } from '../../services/feedbackApi';

export interface McqEvidence {
  sentence: string;
  paragraph: string;
}

/** 依據句與它所在的整段缺一不可，而且句子真的要在段裡 —— 否則不顯示（螢光畫不出來）。 */
export function pickEvidence(q: {
  evidence_sentence?: string | null;
  evidence_paragraph?: string | null;
}): McqEvidence | null {
  const { evidence_sentence: s, evidence_paragraph: p } = q;
  return s && p && p.includes(s) ? { sentence: s, paragraph: p } : null;
}

/** `ex-mcq-3` → 3；其他形狀的 id 回 null。 */
export function questionNumberOf(exerciseId: string): number | null {
  const m = /^ex-mcq-(\d+)$/.exec(exerciseId);
  return m ? Number(m[1]) : null;
}

interface Props {
  lessonCode: string;
  exerciseId: string;
  questionText: string;
  evidence: McqEvidence | null;
  /** 學生最後選的字母（報告用） */
  chosenLetter: string | null;
}

const McqFeedbackExtras: React.FC<Props> = ({
  lessonCode,
  exerciseId,
  questionText,
  evidence,
  chosenLetter,
}) => {
  const [open, setOpen] = useState(false);
  const [reported, setReported] = useState(false);

  function report() {
    if (reported) return;
    setReported(true);
    const n = questionNumberOf(exerciseId);
    submitFeedback({
      category: 'bug',
      title: n != null ? `閱讀理解 ${lessonCode} 第 ${n} 題怪怪的` : `閱讀理解 ${lessonCode} 的題目怪怪的（${exerciseId}）`,
      description: `題目：${questionText}\n學生選：${chosenLetter ?? '（未選）'}`,
      page_url: typeof window !== 'undefined' ? window.location.href : undefined,
    }).catch(() => setReported(false));
  }

  const reportButton = (
    <button
      type="button"
      onClick={report}
      disabled={reported}
      className="text-sm text-gray-500 underline hover:text-gray-700 disabled:no-underline disabled:text-gray-400"
    >
      {reported ? '已回報，謝謝' : '這題怪怪的'}
    </button>
  );

  return (
    <>
      <div className="mt-3 flex flex-wrap items-center gap-4">
        {evidence ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-full border border-blue-300 bg-blue-50 px-4 py-1.5 text-base font-medium text-blue-800 hover:bg-blue-100"
          >
            📖 看原文依據
          </button>
        ) : null}
        {reportButton}
      </div>
      {open && evidence ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="原文依據"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        >
          <div className="max-h-[80vh] w-full max-w-xl overflow-y-auto rounded-xl bg-white p-5 shadow-xl">
            <p className="mb-3 text-sm font-medium text-gray-500">課文裡的這一段</p>
            <p className="text-lg leading-loose text-gray-800">
              {(() => {
                const i = evidence.paragraph.indexOf(evidence.sentence);
                return (
                  <>
                    {evidence.paragraph.slice(0, i)}
                    <mark className="rounded bg-yellow-200 px-0.5">{evidence.sentence}</mark>
                    {evidence.paragraph.slice(i + evidence.sentence.length)}
                  </>
                );
              })()}
            </p>
            <div className="mt-4 flex items-center justify-between">
              {reportButton}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg bg-blue-500 px-4 py-2 text-base font-medium text-white hover:bg-blue-600"
              >
                關閉
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
};

export default McqFeedbackExtras;
