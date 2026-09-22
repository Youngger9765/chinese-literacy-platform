/**
 * MultipleChoiceExercise — ⑦ 閱讀理解選擇題 (#615)
 *
 * Displays MCQ questions from the PDF-extracted YAML data.
 * Shows one question at a time; reveals correct answer + explanation after selection.
 *
 * Issue #1387: McqRescueDialog (AI rescue tutor) reachable via button.
 * Issue #1507: Wrong answer no longer auto-opens the dialog — instead a
 *   「問 AI 助教」button appears so the student opts in. Every click is
 *   logged to mcq_attempt for teacher visibility on students who skip
 *   the rescue.
 * Issue #3024: a correct answer now also shows a brief, non-blocking
 *   CorrectAnswerBurst — teacher feedback asked for "即時增強" on a correct
 *   answer. Purely cosmetic (no score/attempt-count semantics change; see
 *   #3028 for why that's a separate, deliberately out-of-scope concern).
 */
import React, { useState } from 'react';
import { MultipleChoiceItem } from '../../types';
import { useZhuyin } from '../../context/ZhuyinContext';
import { fontForZhuyin } from '../../constants/fonts';
import { useAuth } from '../../contexts/AuthContext';
import { recordMcqAttempt } from '../../services/learningApi';
import McqRescueDialog, { McqRescueContext } from '../reading-spotlight/McqRescueDialog';
import CorrectAnswerBurst from '../gamification/CorrectAnswerBurst';
import TableDisplay from './TableDisplay';
import { tableFrom, tableSourceLine } from './articleExtras';

interface Props {
  questions: MultipleChoiceItem[];
  onComplete: (score: number, total: number) => void;
  /** Lesson/story ID — passed through to rescue agent for session keying. */
  lessonId?: string;
  /** Reading strategy type (e.g. 'summary_psr') — selects strategy-specific rescue prompt. */
  readingStrategy?: string | null;
}

const OPTION_LABELS = ['A', 'B', 'C', 'D'];

const MultipleChoiceExercise: React.FC<Props> = ({
  questions,
  onComplete,
  lessonId = '',
  readingStrategy,
}) => {
  const { zhuyinActive, processZhuyin } = useZhuyin();
  const { token } = useAuth();
  const zh = (text: string) => zhuyinActive ? processZhuyin(text) : text;
  const [current, setCurrent] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [score, setScore] = useState(0);
  // #2199: show "再選一次" feedback after a wrong answer without revealing correct
  const [wrongFeedback, setWrongFeedback] = useState(false);
  /**
   * 這一題最近一次選錯的選項，以及選錯幾次（#3158）。
   *
   * ⛔ 這兩個**不可以**跟 `wrongFeedback` 共用。`wrongFeedback` 是 900 毫秒的視覺閃爍，
   * 而補救管道必須活到學生真的想用它為止。原本兩者共用一個 flag，於是「問 AI 助教」
   * 這顆按鈕的存活時間就是那 900 毫秒 —— 五年級孩子來不及讀完按鈕上那九個字。
   *
   * ⚠️ 這顆按鈕已經死過兩次。第一次條件是 `revealed && !isCorrect`，而 #2199 把
   * revealed 改成只在答對時為 true，條件恆為 false。第二次就是上面那個 900 毫秒。
   * 所以它現在看一個**只有換題才會重置**的狀態。
   */
  const [lastWrongChoice, setLastWrongChoice] = useState<string | null>(null);
  const [wrongCount, setWrongCount] = useState(0);
  // #3024: bump on every correct answer to re-trigger CorrectAnswerBurst
  const [correctBurstKey, setCorrectBurstKey] = useState(0);

  // MCQ Rescue dialog state (Issue #1387 / #1507)
  const [rescueOpen, setRescueOpen] = useState(false);
  const [rescueContext, setRescueContext] = useState<McqRescueContext | null>(null);

  const q = questions[current];
  // 題目附的表（#3277）—— 形狀跟課文層的 inline_table 相同，走同一個轉接器。
  const materialTable = React.useMemo(
    () => tableFrom(q?.material_table, `mcq-${current}-table`, '表'),
    [q?.material_table, current],
  );
  const materialSource = tableSourceLine(q?.material_table);
  const isCorrect = selected === q.answer;
  const isLast = current === questions.length - 1;
  const questionId = `${lessonId}-q${current}`;

  function handleSelect(label: string) {
    if (revealed) return;
    const correct = label === q.answer;

    // Telemetry — every click, including wrong answers where the student
    // never opens the rescue dialog (Issue #1507 / Young 5/8 meeting).
    if (token) {
      recordMcqAttempt(token, {
        lesson_id: lessonId,
        question_id: questionId,
        choice: label,
        is_correct: correct,
      });
    }

    if (correct) {
      // #2199: only reveal on correct answer
      setSelected(label);
      setRevealed(true);
      setWrongFeedback(false);
      setScore((s) => s + 1);
      // #3024: brief positive reinforcement, never delays advancing
      setCorrectBurstKey((k) => k + 1);
    } else {
      // #2199: wrong — show "再選一次" without locking or revealing the answer
      setSelected(label);
      setWrongFeedback(true);
      // #3158: these two survive the flash. The rescue path needs them.
      setLastWrongChoice(label);
      setWrongCount((n) => n + 1);
      // Clear selection after brief flash so student can pick again
      setTimeout(() => {
        setSelected(null);
        setWrongFeedback(false);
      }, 900);
    }
  }

  function openRescue() {
    // #3158: was `if (!selected) return` — but the 900ms flash timer clears
    // `selected`, so clicking the button after the flash was a silent no-op.
    const wrong = lastWrongChoice ?? selected;
    if (!wrong) return;
    const wrongIdx = OPTION_LABELS.indexOf(wrong);
    const correctIdx = q.answer ? OPTION_LABELS.indexOf(q.answer) : -1;
    setRescueContext({
      questionId,
      lessonId,
      wrongChoice: wrong,
      wrongChoiceText: wrongIdx >= 0 ? q.options[wrongIdx] : undefined,
      questionText: q.question,
      correctAnswer: q.answer ?? '',
      correctAnswerText: correctIdx >= 0 ? q.options[correctIdx] : undefined,
      options: q.options,
      optionLabels: OPTION_LABELS.slice(0, q.options.length),
      strategyType: readingStrategy ?? null,
    });
    setRescueOpen(true);
  }

  function handleNext() {
    if (isLast) {
      onComplete(score, questions.length);
      return;
    }
    setCurrent((c) => c + 1);
    setSelected(null);
    setRevealed(false);
    setWrongFeedback(false);
    // #3158: per-question, so they reset here and only here
    setLastWrongChoice(null);
    setWrongCount(0);
  }

  return (
    <>
    {/* #3024: instant positive feedback on a correct answer */}
    <CorrectAnswerBurst triggerKey={correctBurstKey} />
    {/* MCQ Rescue dialog — parallel feature, doesn't disrupt existing socratic chat (#1373) */}
    <McqRescueDialog
      isOpen={rescueOpen}
      context={rescueContext}
      onClose={() => setRescueOpen(false)}
      onComplete={() => setRescueOpen(false)}
    />
    <div className="flex flex-col gap-4 p-4 max-w-2xl mx-auto"
      style={{ fontFamily: fontForZhuyin(zhuyinActive) }}>
      {/* Progress — Issue #1094: 學生端不顯示「答對 N 題」數字 */}
      <div className="flex items-center justify-between text-sm text-gray-500">
        <span>第 {current + 1} 題／共 {questions.length} 題</span>
        <span>繼續加油！</span>
      </div>
      <div className="w-full bg-gray-200 rounded-full h-1.5">
        <div
          className="bg-blue-500 h-1.5 rounded-full transition-all"
          style={{ width: `${((current + (revealed ? 1 : 0)) / questions.length) * 100}%` }}
        />
      </div>

      {/* Question */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
        <p className="text-base font-medium text-gray-800 leading-relaxed mb-4">
          {current + 1}. {zh(q.question)}
        </p>

        {/* 這一題要讀的那張表（#3277）。少了它，L0150 第 4 題是在問一張看不到的表。 */}
        {materialTable && (
          <div className="mb-4" data-testid="mcq-material-table">
            <TableDisplay tables={[materialTable]} layout="stacked" />
            {materialSource && (
              <p className="mt-1 text-sm text-on-surface-variant">{materialSource}</p>
            )}
          </div>
        )}

        {/* Options */}
        <div className="flex flex-col gap-2">
          {q.options.map((opt, idx) => {
            const label = OPTION_LABELS[idx];
            const isChosen = selected === label;
            const isAnswerLabel = q.answer === label;
            // #2199: wrong-flash state — briefly highlight the wrong pick before clearing
            const isWrongFlash = wrongFeedback && isChosen;

            let btnClass =
              'flex items-start gap-3 rounded-lg border p-3 text-sm text-left transition-all ';
            if (!revealed) {
              if (isWrongFlash) {
                btnClass += 'border-amber-400 bg-amber-50 text-amber-800';
              } else {
                btnClass += 'border-gray-200 hover:border-blue-400 hover:bg-blue-50 cursor-pointer';
              }
            } else if (isAnswerLabel) {
              btnClass += 'border-green-500 bg-green-50 font-semibold text-green-800';
            } else if (isChosen && !isAnswerLabel) {
              btnClass += 'border-tertiary-container bg-tertiary-container/20 text-tertiary line-through';
            } else {
              btnClass += 'border-gray-200 text-gray-400';
            }

            return (
              <button
                key={label}
                onClick={() => handleSelect(label)}
                disabled={revealed}
                className={btnClass}
              >
                <span className="shrink-0 w-6 h-6 rounded-full border border-current flex items-center justify-center text-xs font-bold">
                  {label}
                </span>
                <span>{zh(opt)}</span>
                {revealed && isAnswerLabel && (
                  <span className="ml-auto text-green-600 text-lg">✓</span>
                )}
                {revealed && isChosen && !isAnswerLabel && (
                  <span className="ml-auto text-tertiary text-lg">✗</span>
                )}
              </button>
            );
          })}
        </div>

        {/* #2199: Wrong-answer feedback — "再選一次" without revealing correct answer */}
        {wrongFeedback && (
          <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 px-4 py-2.5 text-sm text-amber-800 flex items-center gap-2 animate-pulse">
            <span aria-hidden="true">🔄</span>
            <span className="font-medium">再選一次！</span>
          </div>
        )}

        {/* Explanation — on a correct answer, or after two wrong tries (#3158).
            原本只看 `revealed`，而 revealed 只在答對時為 true，所以答錯的孩子看不到
            正解也看不到解說，卻能無限重選而分數照加 —— 分數對老師因此失去鑑別力。
            Sweller 的 worked example effect：對還沒有 schema 的初學者，
            「讓他自己想」比給完整範例差。第一次仍不揭露，那是 #2199 刻意的設計。 */}
        {(revealed || wrongCount >= 2) && q.explanation && (
          <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 px-4 py-2 text-sm text-amber-800">
            💡 {zh(q.explanation)}
          </div>
        )}

        {/* 問 AI 助教 — only on wrong answers after reveal, opt-in (Issue #1507) */}
        {/* 答錯時要能問 AI 助教（#1507）。
            ⚠️ 原本的條件是 `revealed && !isCorrect` —— #2199 把「答錯」改成
            不揭露答案、讓學生再選一次之後，`revealed` 只在**答對**時才為 true，
            於是這個條件恆為 false，這顆按鈕從此再也沒出現過（死碼）。
            改看 `wrongFeedback`：那才是「這次選錯了」的訊號。 */}
        {(lastWrongChoice != null || (revealed && !isCorrect)) && !rescueOpen && (
          <button
            onClick={openRescue}
            className="mt-3 w-full flex items-center justify-center gap-2 rounded-lg border-2 border-amber-300 bg-amber-50 px-4 py-2.5 text-sm font-medium text-amber-800 hover:bg-amber-100 hover:border-amber-400 transition-colors"
          >
            <span aria-hidden="true">🦉</span>
            問 AI 助教，一起想想看
          </button>
        )}
      </div>

      {/* Next / Submit */}
      {revealed && (
        <button
          onClick={handleNext}
          className="self-end rounded-lg bg-blue-500 px-6 py-2 text-white text-sm font-medium hover:bg-blue-600 transition-colors"
        >
          {isLast ? '完成測驗' : '下一題 →'}
        </button>
      )}
    </div>
    </>
  );
};

export default MultipleChoiceExercise;
