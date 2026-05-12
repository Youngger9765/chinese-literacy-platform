/**
 * StrategyExercise — 閱讀策略練習 (#943) / 閱讀聚光燈
 *
 * Renders one of three exercise types based on `exercise.type`:
 *   - ordering      : drag-and-drop (HTML5 native) to sort items in correct order
 *   - trait_inference: show clues, pick correct character trait from options
 *   - guided_steps  : multi-step exercise with free_text and select steps
 *
 * Issue #1507: trait_inference + guided_steps' select-type steps wire to
 *   McqRescueDialog (AI tutor) on wrong answer — same pattern as the
 *   閱讀理解 MCQ. ordering has no MCQ shape and is skipped.
 *
 * Designed to feel like part of the existing worksheet (matches MCQ / StoryStructure UI).
 */
import React, { useCallback, useRef, useState } from 'react';
import { StrategyExercise as StrategyExerciseType, StrategyExerciseOrderingItem } from '../../types';
import { useZhuyin } from '../../context/ZhuyinContext';
import { fontForZhuyin } from '../../constants/fonts';
import { useAuth } from '../../contexts/AuthContext';
import { recordMcqAttempt } from '../../services/learningApi';
import McqRescueDialog, { McqRescueContext } from '../reading-spotlight/McqRescueDialog';

const OPTION_LABELS = ['A', 'B', 'C', 'D', 'E', 'F'];

interface Props {
  exercise: StrategyExerciseType;
  onComplete?: () => void;
  /** Lesson/story ID — passed through to rescue agent for session keying. */
  lessonId?: string;
  /** Reading strategy type — selects strategy-specific rescue prompt. */
  readingStrategy?: string | null;
}

// ── Shared helpers ──────────────────────────────────────────────────────────

function StrategyHeader({ name, instruction }: { name: string; instruction: string }) {
  return (
    <div className="mb-5">
      <div className="inline-block px-3 py-1 rounded-full bg-violet-100 text-violet-700 text-xs font-semibold mb-3">
        閱讀策略：{name}
      </div>
      <p className="text-sm text-gray-600 leading-relaxed bg-violet-50 rounded-xl px-4 py-3 border border-violet-100">
        {instruction}
      </p>
    </div>
  );
}

// ── Ordering Exercise ───────────────────────────────────────────────────────

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

interface OrderingItem extends StrategyExerciseOrderingItem {
  id: string;
}

function OrderingExercise({
  exercise,
  onComplete,
}: {
  exercise: StrategyExerciseType;
  onComplete?: () => void;
}) {
  const items = exercise.items ?? [];

  const [orderedItems, setOrderedItems] = useState<OrderingItem[]>(() =>
    shuffle(items.map((it, i) => ({ ...it, id: `item-${i}` }))),
  );
  const [submitted, setSubmitted] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);

  // Drag state
  const dragIndexRef = useRef<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const handleDragStart = (e: React.DragEvent, index: number) => {
    dragIndexRef.current = index;
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverIndex(index);
  };

  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    const dragIndex = dragIndexRef.current;
    if (dragIndex === null || dragIndex === dropIndex) {
      setDragOverIndex(null);
      return;
    }
    const next = [...orderedItems];
    const [removed] = next.splice(dragIndex, 1);
    next.splice(dropIndex, 0, removed);
    setOrderedItems(next);
    dragIndexRef.current = null;
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    dragIndexRef.current = null;
    setDragOverIndex(null);
  };

  const handleSubmit = () => {
    const correct = orderedItems.every((item, idx) => item.correct_order === idx + 1);
    setIsCorrect(correct);
    setSubmitted(true);
    if (correct) onComplete?.();
  };

  const handleReset = () => {
    setOrderedItems(shuffle(items.map((it, i) => ({ ...it, id: `item-${i}` }))));
    setSubmitted(false);
    setIsCorrect(false);
  };

  return (
    <div>
      <StrategyHeader name={exercise.strategy_name} instruction={exercise.instruction} />

      <p className="text-xs text-gray-500 mb-3">拖曳下方事件，依照故事發生的先後順序排列：</p>

      <div className="space-y-2 mb-5">
        {orderedItems.map((item, index) => {
          const itemCorrect = submitted && item.correct_order === index + 1;
          const itemWrong = submitted && item.correct_order !== index + 1;
          return (
            <div
              key={item.id}
              draggable={!submitted}
              onDragStart={(e) => handleDragStart(e, index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDrop={(e) => handleDrop(e, index)}
              onDragEnd={handleDragEnd}
              className={[
                'flex items-center gap-3 px-4 py-3 rounded-xl border-2 transition-all select-none',
                submitted
                  ? itemCorrect
                    ? 'bg-emerald-50 border-emerald-300'
                    : itemWrong
                    ? 'bg-red-50 border-red-300'
                    : 'bg-gray-50 border-gray-200'
                  : dragOverIndex === index
                  ? 'bg-violet-50 border-violet-300 scale-[1.02]'
                  : 'bg-surface-container-low border-gray-200 cursor-grab hover:border-violet-200 hover:bg-violet-50/30',
              ].join(' ')}
            >
              <span className="w-6 h-6 flex-shrink-0 rounded-full bg-gray-100 text-gray-500 text-xs font-bold flex items-center justify-center">
                {index + 1}
              </span>
              <span className="flex-1 text-sm text-on-surface">{item.text}</span>
              {submitted && itemCorrect && (
                <span className="text-emerald-500 text-base flex-shrink-0">&#10003;</span>
              )}
              {submitted && itemWrong && (
                <span className="text-red-400 text-base flex-shrink-0">&#10007;</span>
              )}
              {!submitted && (
                <span className="text-gray-300 text-lg flex-shrink-0 cursor-grab">&#8801;</span>
              )}
            </div>
          );
        })}
      </div>

      {submitted ? (
        <div className={`rounded-xl p-4 mb-4 ${isCorrect ? 'bg-emerald-50 border border-emerald-200' : 'bg-amber-50 border border-amber-200'}`}>
          {isCorrect ? (
            <p className="text-emerald-700 font-semibold text-sm text-center">
              你答對了！順序完全正確
            </p>
          ) : (
            <div className="text-center">
              <p className="text-amber-700 font-semibold text-sm mb-1">順序還不對，再想想看</p>
              <p className="text-amber-600 text-xs">
                正確順序：
                {[...items]
                  .sort((a, b) => a.correct_order - b.correct_order)
                  .map((it) => it.text)
                  .join(' → ')}
              </p>
            </div>
          )}
        </div>
      ) : null}

      <div className="flex gap-2">
        {!submitted && (
          <button
            onClick={handleSubmit}
            className="flex-1 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-semibold text-sm transition-colors"
          >
            送出答案
          </button>
        )}
        {submitted && (
          <button
            onClick={handleReset}
            className="flex-1 py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-600 font-semibold text-sm transition-colors"
          >
            重新練習
          </button>
        )}
      </div>
    </div>
  );
}

// ── Trait Inference Exercise ────────────────────────────────────────────────

function TraitInferenceExercise({
  exercise,
  onComplete,
  lessonId,
  readingStrategy,
}: {
  exercise: StrategyExerciseType;
  onComplete?: () => void;
  lessonId?: string;
  readingStrategy?: string | null;
}) {
  const { token } = useAuth();
  const [selected, setSelected] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [rescueOpen, setRescueOpen] = useState(false);
  const [rescueContext, setRescueContext] = useState<McqRescueContext | null>(null);

  const correct = exercise.correct_trait ?? '';
  const traitOptions = exercise.trait_options ?? [];
  const isWrong = submitted && selected !== null && selected !== correct;
  const questionId = `${lessonId ?? ''}-spotlight-trait`;

  const handleSelect = (trait: string) => {
    if (submitted) return;
    setSelected(trait);
  };

  const handleSubmit = () => {
    if (!selected) return;
    setSubmitted(true);
    const correctAnswer = selected === correct;
    if (correctAnswer) onComplete?.();

    if (token) {
      const labelIdx = traitOptions.indexOf(selected);
      recordMcqAttempt(token, {
        lesson_id: lessonId ?? '',
        question_id: questionId,
        choice: labelIdx >= 0 ? OPTION_LABELS[labelIdx] : selected,
        is_correct: correctAnswer,
        rescue_offered: !correctAnswer,
      });
    }
  };

  const handleReset = () => {
    setSelected(null);
    setSubmitted(false);
  };

  const openRescue = () => {
    if (!selected) return;
    const wrongIdx = traitOptions.indexOf(selected);
    const correctIdx = traitOptions.indexOf(correct);
    const labels = OPTION_LABELS.slice(0, traitOptions.length);
    setRescueContext({
      questionId,
      lessonId: lessonId ?? '',
      wrongChoice: wrongIdx >= 0 ? labels[wrongIdx] : selected,
      wrongChoiceText: selected,
      questionText: `根據線索推論${exercise.character ?? '主角'}的人物特質`,
      correctAnswer: correctIdx >= 0 ? labels[correctIdx] : correct,
      correctAnswerText: correct,
      options: traitOptions,
      optionLabels: labels,
      strategyType: readingStrategy ?? null,
    });
    setRescueOpen(true);
  };

  return (
    <div>
      <StrategyHeader name={exercise.strategy_name} instruction={exercise.instruction} />

      <p className="text-sm font-semibold text-gray-700 mb-3">
        根據下列線索，推論{exercise.character}的人物特質：
      </p>

      <div className="space-y-2 mb-5">
        {(exercise.clues ?? []).map((clue, idx) => (
          <div key={idx} className="flex gap-3 bg-surface-container-low rounded-xl border border-gray-200 px-4 py-3">
            <span className="flex-shrink-0 px-2 py-0.5 rounded-md bg-blue-100 text-blue-700 text-xs font-semibold">
              {clue.source}
            </span>
            <span className="text-sm text-on-surface">{clue.text}</span>
          </div>
        ))}
      </div>

      <p className="text-xs text-gray-500 mb-2">選出最符合的人物特質：</p>
      <div className="grid grid-cols-2 gap-2 mb-5">
        {(exercise.trait_options ?? []).map((trait) => {
          const isSelected = selected === trait;
          const isCorrectOption = submitted && trait === correct;
          const isWrongSelected = submitted && isSelected && trait !== correct;
          return (
            <button
              key={trait}
              onClick={() => handleSelect(trait)}
              className={[
                'py-3 rounded-xl border-2 text-sm font-semibold transition-all',
                isCorrectOption
                  ? 'bg-emerald-50 border-emerald-400 text-emerald-700'
                  : isWrongSelected
                  ? 'bg-red-50 border-red-300 text-red-600'
                  : isSelected
                  ? 'bg-violet-50 border-violet-400 text-violet-700'
                  : 'bg-surface-container-low border-gray-200 text-on-surface-variant hover:border-violet-300 hover:bg-violet-50/30',
              ].join(' ')}
            >
              {trait}
              {isCorrectOption && <span className="ml-1">&#10003;</span>}
              {isWrongSelected && <span className="ml-1">&#10007;</span>}
            </button>
          );
        })}
      </div>

      {submitted && (
        <div className={`rounded-xl p-4 mb-4 ${selected === correct ? 'bg-emerald-50 border border-emerald-200' : 'bg-amber-50 border border-amber-200'}`}>
          {selected === correct ? (
            <p className="text-emerald-700 font-semibold text-sm text-center">
              你答對了！{exercise.character}的特質是「{correct}」
            </p>
          ) : (
            <p className="text-amber-700 font-semibold text-sm text-center">
              還不對喔！正確答案是「{correct}」，可以再看看線索
            </p>
          )}
        </div>
      )}

      {/* 問 AI 助教 — opt-in on wrong answer (Issue #1507) */}
      {isWrong && !rescueOpen && (
        <button
          onClick={openRescue}
          className="w-full mb-3 flex items-center justify-center gap-2 rounded-lg border-2 border-amber-300 bg-amber-50 px-4 py-2.5 text-sm font-medium text-amber-800 hover:bg-amber-100 hover:border-amber-400 transition-colors"
        >
          <span aria-hidden="true">🦉</span>
          問 AI 助教，一起想想看
        </button>
      )}

      <McqRescueDialog
        isOpen={rescueOpen}
        context={rescueContext}
        onClose={() => setRescueOpen(false)}
        onComplete={() => setRescueOpen(false)}
      />

      <div className="flex gap-2">
        {!submitted && (
          <button
            onClick={handleSubmit}
            disabled={!selected}
            className="flex-1 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:bg-gray-200 disabled:text-gray-400 text-white font-semibold text-sm transition-colors"
          >
            送出答案
          </button>
        )}
        {submitted && (
          <button
            onClick={handleReset}
            className="flex-1 py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-600 font-semibold text-sm transition-colors"
          >
            重新練習
          </button>
        )}
      </div>
    </div>
  );
}

// ── Guided Steps Exercise ───────────────────────────────────────────────────

function GuidedStepsExercise({
  exercise,
  onComplete,
  lessonId,
  readingStrategy,
}: {
  exercise: StrategyExerciseType;
  onComplete?: () => void;
  lessonId?: string;
  readingStrategy?: string | null;
}) {
  const { token } = useAuth();
  const steps = exercise.steps ?? [];
  const [answers, setAnswers] = useState<(string | number | null)[]>(
    () => steps.map(() => null),
  );
  const [stepFeedback, setStepFeedback] = useState<(boolean | null)[]>(
    () => steps.map(() => null),
  );
  const [allDone, setAllDone] = useState(false);
  const [rescueOpen, setRescueOpen] = useState(false);
  const [rescueContext, setRescueContext] = useState<McqRescueContext | null>(null);

  const openRescueForStep = (stepIdx: number) => {
    const step = steps[stepIdx];
    if (!step || step.type !== 'select') return;
    const opts = step.options ?? [];
    const labels = OPTION_LABELS.slice(0, opts.length);
    const correctIdx = step.answer ?? 0;
    const wrongIdx = typeof answers[stepIdx] === 'number' ? (answers[stepIdx] as number) : -1;
    setRescueContext({
      questionId: `${lessonId ?? ''}-spotlight-guided-${stepIdx}`,
      lessonId: lessonId ?? '',
      wrongChoice: wrongIdx >= 0 ? labels[wrongIdx] : '',
      wrongChoiceText: wrongIdx >= 0 ? opts[wrongIdx] : undefined,
      questionText: step.prompt ?? '',
      correctAnswer: labels[correctIdx] ?? '',
      correctAnswerText: opts[correctIdx],
      options: opts,
      optionLabels: labels,
      strategyType: readingStrategy ?? null,
    });
    setRescueOpen(true);
  };

  const handleTextChange = (stepIdx: number, value: string) => {
    if (stepFeedback[stepIdx] !== null) return;
    setAnswers((prev) => prev.map((a, i) => (i === stepIdx ? value : a)));
  };

  const handleSelect = (stepIdx: number, optionIdx: number) => {
    if (stepFeedback[stepIdx] !== null) return;
    setAnswers((prev) => prev.map((a, i) => (i === stepIdx ? optionIdx : a)));
  };

  const handleStepSubmit = (stepIdx: number) => {
    const step = steps[stepIdx];
    const answer = answers[stepIdx];
    if (step.type === 'free_text') {
      if (!answer || String(answer).trim() === '') return;
      setStepFeedback((prev) => prev.map((f, i) => (i === stepIdx ? true : f)));
    } else if (step.type === 'select') {
      if (answer === null) return;
      const isCorrect = answer === (step.answer ?? 0);
      setStepFeedback((prev) => prev.map((f, i) => (i === stepIdx ? isCorrect : f)));

      // Telemetry — record select-step attempts (Issue #1507)
      if (token) {
        const labels = OPTION_LABELS.slice(0, (step.options ?? []).length);
        const idx = answer as number;
        recordMcqAttempt(token, {
          lesson_id: lessonId ?? '',
          question_id: `${lessonId ?? ''}-spotlight-guided-${stepIdx}`,
          choice: labels[idx] ?? String(idx),
          is_correct: isCorrect,
          rescue_offered: !isCorrect,
        });
      }
    }

    // Check if all steps done
    const nextFeedback = stepFeedback.map((f, i) => {
      if (i === stepIdx) {
        const step = steps[stepIdx];
        if (step.type === 'free_text') return true;
        return answers[stepIdx] === (step.answer ?? 0);
      }
      return f;
    });
    if (nextFeedback.every((f) => f !== null)) {
      setAllDone(true);
      onComplete?.();
    }
  };

  const handleReset = () => {
    setAnswers(steps.map(() => null));
    setStepFeedback(steps.map(() => null));
    setAllDone(false);
  };

  return (
    <div>
      <StrategyHeader name={exercise.strategy_name} instruction={exercise.instruction} />

      <div className="space-y-6">
        {steps.map((step, stepIdx) => {
          const feedback = stepFeedback[stepIdx];
          const isDone = feedback !== null;
          return (
            <div key={stepIdx} className="rounded-xl border border-gray-200 bg-surface-container-low p-4">
              <div className="flex items-start gap-2 mb-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-violet-100 text-violet-700 text-xs font-bold flex items-center justify-center mt-0.5">
                  {stepIdx + 1}
                </span>
                <p className="text-sm font-medium text-on-surface-variant">{step.prompt}</p>
              </div>

              {step.type === 'free_text' ? (
                <div>
                  <textarea
                    value={String(answers[stepIdx] ?? '')}
                    onChange={(e) => handleTextChange(stepIdx, e.target.value)}
                    disabled={isDone}
                    rows={3}
                    placeholder="請在此寫下你的答案..."
                    className={[
                      'w-full resize-none rounded-lg border px-3 py-2 text-sm outline-none transition-colors',
                      isDone
                        ? 'bg-gray-50 border-gray-200 text-gray-500'
                        : 'bg-white border-gray-300 focus:border-violet-400 focus:ring-2 focus:ring-violet-100',
                    ].join(' ')}
                  />
                  {isDone && (
                    <p className="mt-2 text-xs text-emerald-600 font-semibold">
                      &#10003; 已記錄你的答案
                    </p>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  {(step.options ?? []).map((option, optIdx) => {
                    const isSelected = answers[stepIdx] === optIdx;
                    const isCorrectOpt = isDone && optIdx === (step.answer ?? 0);
                    const isWrongSelected = isDone && isSelected && optIdx !== (step.answer ?? 0);
                    return (
                      <button
                        key={optIdx}
                        onClick={() => handleSelect(stepIdx, optIdx)}
                        className={[
                          'w-full text-left px-4 py-2.5 rounded-lg border-2 text-sm transition-all',
                          isCorrectOpt
                            ? 'bg-emerald-50 border-emerald-400 text-emerald-700 font-semibold'
                            : isWrongSelected
                            ? 'bg-red-50 border-red-300 text-red-600'
                            : isSelected
                            ? 'bg-violet-50 border-violet-400 text-violet-700'
                            : 'bg-surface-container-low border-gray-200 text-on-surface-variant hover:border-violet-200',
                        ].join(' ')}
                      >
                        <span className="font-semibold mr-2">
                          {String.fromCharCode(65 + optIdx)}.
                        </span>
                        {option}
                        {isCorrectOpt && <span className="ml-2 text-emerald-500">&#10003;</span>}
                        {isWrongSelected && <span className="ml-2 text-red-400">&#10007;</span>}
                      </button>
                    );
                  })}
                  {isDone && feedback !== null && (
                    <p className={`mt-1 text-xs font-semibold ${feedback ? 'text-emerald-600' : 'text-amber-600'}`}>
                      {feedback
                        ? <>{'\u2713'} 答對了！</>
                        : `還不對，正確答案是 ${String.fromCharCode(65 + (step.answer ?? 0))}`}
                    </p>
                  )}
                  {isDone && feedback === false && !rescueOpen && (
                    <button
                      onClick={() => openRescueForStep(stepIdx)}
                      className="mt-2 w-full flex items-center justify-center gap-2 rounded-lg border-2 border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100 hover:border-amber-400 transition-colors"
                    >
                      <span aria-hidden="true">🦉</span>
                      問 AI 助教，一起想想看
                    </button>
                  )}
                </div>
              )}

              {!isDone && (
                <div className="mt-3 flex justify-end">
                  <button
                    onClick={() => handleStepSubmit(stepIdx)}
                    disabled={
                      step.type === 'free_text'
                        ? !String(answers[stepIdx] ?? '').trim()
                        : answers[stepIdx] === null
                    }
                    className="px-4 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:bg-gray-200 disabled:text-gray-400 text-white text-xs font-semibold transition-colors"
                  >
                    確認
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {allDone && (
        <div className="mt-4 rounded-xl p-4 bg-emerald-50 border border-emerald-200">
          <p className="text-emerald-700 font-semibold text-sm text-center">
            全部步驟完成！
          </p>
        </div>
      )}

      {allDone && (
        <div className="mt-3 flex gap-2">
          <button
            onClick={handleReset}
            className="flex-1 py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-600 font-semibold text-sm transition-colors"
          >
            重新練習
          </button>
        </div>
      )}

      <McqRescueDialog
        isOpen={rescueOpen}
        context={rescueContext}
        onClose={() => setRescueOpen(false)}
        onComplete={() => setRescueOpen(false)}
      />
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────

const StrategyExercise: React.FC<Props> = ({ exercise, onComplete, lessonId, readingStrategy }) => {
  const { zhuyinActive, processZhuyin } = useZhuyin();
  const zhuyinFont = fontForZhuyin(zhuyinActive);

  const handleComplete = useCallback(() => {
    onComplete?.();
  }, [onComplete]);

  const content = (() => {
    if (exercise.type === 'ordering') return <OrderingExercise exercise={exercise} onComplete={handleComplete} />;
    if (exercise.type === 'trait_inference')
      return (
        <TraitInferenceExercise
          exercise={exercise}
          onComplete={handleComplete}
          lessonId={lessonId}
          readingStrategy={readingStrategy}
        />
      );
    if (exercise.type === 'guided_steps')
      return (
        <GuidedStepsExercise
          exercise={exercise}
          onComplete={handleComplete}
          lessonId={lessonId}
          readingStrategy={readingStrategy}
        />
      );
    return <div className="p-4 text-on-surface-variant text-sm text-center">不支援的練習類型：{exercise.type}</div>;
  })();

  return <div style={{ fontFamily: zhuyinFont }}>{content}</div>;
};

export default StrategyExercise;
