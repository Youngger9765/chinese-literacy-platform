/**
 * VocabDefinitionMatch — Step Component for 語詞定義配對
 *
 * Click-to-match interaction (tap definition, then tap word).
 *
 * Flow:
 * 1. matching — one attempt per pair; wrong = recorded silently, no reveal
 * 2. summary  — show score + per-question result; offer retry options
 *
 * Props: { story, onFinish, zhuyinActive? }
 */
import React, {
  useCallback,
  useEffect,
  useState,
} from 'react';
import { Story, VocabItem } from '../../types';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

export interface VocabDefinitionMatchResult {
  matchedCount: number;
  totalCount: number;
}

export interface VocabDefinitionMatchProps {
  story: Story;
  onFinish: (result: VocabDefinitionMatchResult) => void;
  zhuyinActive?: boolean;
}

type MatchPhase = 'matching' | 'summary';

/**
 * Records the answer for one definition item.
 * answeredWordIdx === null  → not yet answered
 * answeredWordIdx === defIndex → correct
 * answeredWordIdx !== defIndex → wrong
 */
interface AnswerRecord {
  defIndex: number;         // which vocab item this is (position in vocab[])
  answeredWordIdx: number | null;
  correct: boolean | null;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ------------------------------------------------------------------ */
/*  Shared sub-components                                               */
/* ------------------------------------------------------------------ */

function StepHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="bg-amber-50 border-b border-amber-200 px-6 py-4">
      <div className="max-w-2xl mx-auto">
        <h2 className="text-xl font-bold text-amber-900">{title}</h2>
        {subtitle && (
          <p className="mt-1 text-base text-amber-700">{subtitle}</p>
        )}
      </div>
    </div>
  );
}

function NoDataFallback({ onFinish }: { onFinish: () => void }) {
  return (
    <div className="flex flex-col items-center gap-6 px-6 py-16 text-center max-w-lg mx-auto">
      <div className="text-5xl select-none">📖</div>
      <div>
        <h3 className="text-lg font-bold text-gray-700 mb-2">本課尚無語詞定義資料</h3>
        <p className="text-sm text-gray-500 leading-relaxed">
          這篇課文目前沒有語詞定義配對資料。<br />
          教師可透過後台上傳詞彙資料，或聯絡管理員更新課文。
        </p>
      </div>
      <button
        onClick={onFinish}
        className="rounded-xl bg-amber-500 px-8 py-3 text-white font-semibold text-lg hover:bg-amber-600 transition-colors"
      >
        繼續下一步
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  SummaryScreen                                                       */
/* ------------------------------------------------------------------ */

interface SummaryScreenProps {
  vocab: VocabItem[];
  answers: AnswerRecord[];
  onRetryWrong: () => void;
  onRetryAll: () => void;
  onFinish: () => void;
}

function SummaryScreen({
  vocab,
  answers,
  onRetryWrong,
  onRetryAll,
  onFinish,
}: SummaryScreenProps) {
  const correctCount = answers.filter((a) => a.correct).length;
  const total = answers.length;
  const allCorrect = correctCount === total;
  const pct = total > 0 ? Math.round((correctCount / total) * 100) : 0;

  const wrongAnswers = answers.filter((a) => !a.correct);

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 animate-fade-in">
      {/* Score card */}
      <div
        className={`rounded-2xl border-2 px-8 py-6 mb-8 text-center shadow-sm ${
          allCorrect
            ? 'bg-emerald-50 border-emerald-300'
            : 'bg-amber-50 border-amber-300'
        }`}
      >
        <div className="text-5xl select-none mb-3">
          {allCorrect ? '🎉' : pct >= 60 ? '👍' : '💪'}
        </div>
        <h3
          className={`text-2xl font-black mb-1 ${
            allCorrect ? 'text-emerald-800' : 'text-amber-800'
          }`}
        >
          {allCorrect ? '全部答對！' : `答對 ${correctCount} / ${total} 題`}
        </h3>
        <p
          className={`text-lg font-semibold ${
            allCorrect ? 'text-emerald-600' : 'text-amber-600'
          }`}
        >
          正確率 {pct}%
        </p>
      </div>

      {/* Per-question results */}
      <div className="flex flex-col gap-3 mb-8">
        <h4 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-1">
          每題結果
        </h4>
        {answers.map((ans, idx) => {
          const item = vocab[ans.defIndex];
          const isCorrect = ans.correct;
          const studentWord =
            ans.answeredWordIdx !== null ? vocab[ans.answeredWordIdx]?.word : '—';

          return (
            <div
              key={idx}
              className={`rounded-xl border-2 px-4 py-3 flex items-start gap-3 ${
                isCorrect
                  ? 'bg-emerald-50 border-emerald-200'
                  : 'bg-red-50 border-red-200'
              }`}
            >
              {/* Status icon */}
              <span
                className={`mt-0.5 flex-shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold text-white ${
                  isCorrect ? 'bg-emerald-500' : 'bg-red-500'
                }`}
              >
                {isCorrect ? '✓' : '✗'}
              </span>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-500 leading-snug mb-1">
                  {item?.definition}
                </p>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <span className="text-gray-500">正確答案：</span>
                  <span className="font-bold text-gray-800">{item?.word}</span>
                  {!isCorrect && (
                    <>
                      <span className="text-gray-400">|</span>
                      <span className="text-gray-500">你的答案：</span>
                      <span className="font-bold text-red-600">{studentWord}</span>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Action buttons */}
      <div className="flex flex-col sm:flex-row gap-3 justify-center">
        {!allCorrect && (
          <button
            onClick={onRetryWrong}
            className="rounded-xl border-2 border-[#5B4FC4] text-[#5B4FC4] px-6 py-3 font-bold hover:bg-[#5B4FC4] hover:text-white transition-all active:scale-95"
          >
            只重做錯題（{wrongAnswers.length} 題）
          </button>
        )}
        <button
          onClick={onRetryAll}
          className="rounded-xl border-2 border-gray-300 text-gray-700 px-6 py-3 font-bold hover:bg-gray-100 transition-all active:scale-95"
        >
          全部重做
        </button>
        <button
          onClick={onFinish}
          className="rounded-xl bg-[#5B4FC4] px-8 py-3 text-white font-bold hover:bg-[#4a3fb0] transition-all active:scale-95 shadow-md"
        >
          繼續下一步 →
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  MatchingExercise — the interactive matching UI                     */
/* ------------------------------------------------------------------ */

interface MatchingExerciseProps {
  vocab: VocabItem[];
  /** Subset of defIndices to practice (all or wrong-only) */
  activeDefIndices: number[];
  shuffledWords: number[];
  answers: AnswerRecord[];
  selectedDef: number | null;
  selectedWord: number | null;
  onDefClick: (defIdx: number) => void;
  onWordClick: (wordIdx: number) => void;
  answeredCount: number;
}

function MatchingExercise({
  vocab,
  activeDefIndices,
  shuffledWords,
  answers,
  selectedDef,
  selectedWord,
  onDefClick,
  onWordClick,
  answeredCount,
}: MatchingExerciseProps) {
  const total = activeDefIndices.length;
  const pct = total > 0 ? (answeredCount / total) * 100 : 0;

  return (
    <div className="max-w-3xl mx-auto px-4">
      {/* Progress bar */}
      <div className="mb-6 bg-white rounded-2xl shadow-sm border border-amber-100 px-5 py-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-base font-semibold text-gray-600">作答進度</span>
          <span className="text-lg font-black text-amber-700">
            {answeredCount} <span className="text-gray-400 font-normal text-sm">/ {total}</span>
          </span>
        </div>
        <div className="h-4 bg-amber-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-amber-400 to-amber-500 rounded-full transition-all duration-500 ease-out"
            style={{ width: `${pct}%` }}
            role="progressbar"
            aria-valuenow={answeredCount}
            aria-valuemin={0}
            aria-valuemax={total}
          />
        </div>
      </div>

      {/* Instruction */}
      <p className="text-center text-base text-amber-800 bg-amber-100 rounded-xl py-2.5 px-4 mb-6 select-none font-medium">
        先點選左邊的「定義」，再點選右邊對應的「語詞」
      </p>

      {/* Two-column layout */}
      <div className="grid grid-cols-2 gap-4">
        {/* Left: definitions */}
        <div className="flex flex-col gap-3">
          <h3 className="text-center text-sm font-bold text-gray-500 uppercase tracking-wider mb-1">
            定義
          </h3>
          {activeDefIndices.map((defIdx) => {
            const item = vocab[defIdx];
            const ans = answers.find((a) => a.defIndex === defIdx);
            const isAnswered = ans?.answeredWordIdx !== null && ans?.answeredWordIdx !== undefined;
            const isSelected = selectedDef === defIdx;

            let cardClass =
              'rounded-2xl border-2 px-4 py-4 text-left cursor-pointer transition-all duration-200 text-base leading-relaxed min-h-[88px] select-none ';

            if (isAnswered) {
              cardClass += 'bg-gray-50 border-gray-200 text-gray-400 cursor-default';
            } else if (isSelected) {
              cardClass += 'bg-amber-100 border-amber-500 text-amber-900 shadow-md scale-[1.02]';
            } else {
              cardClass += 'bg-white border-gray-200 text-gray-700 hover:border-amber-300 hover:bg-amber-50 hover:shadow-sm';
            }

            return (
              <button
                key={defIdx}
                className={cardClass}
                onClick={() => !isAnswered && onDefClick(defIdx)}
                disabled={isAnswered}
                aria-pressed={isSelected}
                aria-label={`定義 ${defIdx + 1}: ${item?.definition}`}
              >
                {isAnswered && (
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-gray-400 text-white text-xs font-bold mr-2 flex-shrink-0">✓</span>
                )}
                {item?.definition}
              </button>
            );
          })}
        </div>

        {/* Right: shuffled vocabulary words — only show words for active defs */}
        <div className="flex flex-col gap-3">
          <h3 className="text-center text-sm font-bold text-gray-500 uppercase tracking-wider mb-1">
            語詞
          </h3>
          {shuffledWords
            .filter((wi) => activeDefIndices.includes(wi))
            .map((vocabIdx) => {
              const ans = answers.find((a) => a.defIndex === vocabIdx);
              const isAnswered = ans?.answeredWordIdx !== null && ans?.answeredWordIdx !== undefined;
              const isSelected = selectedWord === vocabIdx;

              let cardClass =
                'rounded-2xl border-2 px-4 py-4 text-center cursor-pointer transition-all duration-200 font-bold text-xl min-h-[88px] flex items-center justify-center select-none gap-2 ';

              if (isAnswered) {
                cardClass += 'bg-gray-50 border-gray-200 text-gray-400 cursor-default';
              } else if (isSelected) {
                cardClass += 'bg-amber-100 border-amber-500 text-amber-900 shadow-md scale-[1.02]';
              } else {
                cardClass += 'bg-white border-gray-200 text-gray-800 hover:border-amber-300 hover:bg-amber-50 hover:shadow-sm';
              }

              return (
                <button
                  key={vocabIdx}
                  className={cardClass}
                  onClick={() => !isAnswered && onWordClick(vocabIdx)}
                  disabled={isAnswered}
                  aria-pressed={isSelected}
                  aria-label={`語詞：${vocab[vocabIdx]?.word}`}
                >
                  {isAnswered && (
                    <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-gray-400 text-white text-xs font-bold flex-shrink-0">✓</span>
                  )}
                  {vocab[vocabIdx]?.word}
                </button>
              );
            })}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                      */
/* ------------------------------------------------------------------ */

const VocabDefinitionMatch: React.FC<VocabDefinitionMatchProps> = ({
  story,
  onFinish,
}) => {
  const vocab: VocabItem[] = story.vocabulary ?? [];
  const hasData = vocab.length > 0;

  // Which defIndices are active in the current round
  const [activeDefIndices, setActiveDefIndices] = useState<number[]>(() =>
    vocab.map((_, i) => i),
  );

  // Shuffled word order (re-generated on retry-all)
  const [shuffledWords, setShuffledWords] = useState<number[]>(() =>
    shuffle(vocab.map((_, i) => i)),
  );

  const [phase, setPhase] = useState<MatchPhase>('matching');

  // Per-question answer records for the current round
  const [answers, setAnswers] = useState<AnswerRecord[]>(() =>
    vocab.map((_, i) => ({ defIndex: i, answeredWordIdx: null, correct: null })),
  );

  // Selected items
  const [selectedDef, setSelectedDef] = useState<number | null>(null);
  const [selectedWord, setSelectedWord] = useState<number | null>(null);

  const answeredCount = answers.filter(
    (a) => activeDefIndices.includes(a.defIndex) && a.answeredWordIdx !== null,
  ).length;

  // Auto-advance to summary when all active defs answered
  useEffect(() => {
    if (!hasData) return;
    if (phase === 'matching' && activeDefIndices.length > 0 && answeredCount === activeDefIndices.length) {
      setTimeout(() => setPhase('summary'), 400);
    }
  }, [answeredCount, activeDefIndices.length, phase, hasData]);

  // Record an answer: one shot — no retries, no reveals
  const tryMatch = useCallback(
    (defIdx: number, wordIdx: number) => {
      const isCorrect = defIdx === wordIdx;
      setAnswers((prev) =>
        prev.map((a) =>
          a.defIndex === defIdx
            ? { ...a, answeredWordIdx: wordIdx, correct: isCorrect }
            : a,
        ),
      );
      setSelectedDef(null);
      setSelectedWord(null);
    },
    [],
  );

  const handleDefClick = useCallback(
    (defIdx: number) => {
      const ans = answers.find((a) => a.defIndex === defIdx);
      if (ans?.answeredWordIdx !== null && ans?.answeredWordIdx !== undefined) return;

      if (selectedWord !== null) {
        tryMatch(defIdx, selectedWord);
      } else if (selectedDef === defIdx) {
        setSelectedDef(null);
      } else {
        setSelectedDef(defIdx);
      }
    },
    [answers, selectedWord, selectedDef, tryMatch],
  );

  const handleWordClick = useCallback(
    (wordIdx: number) => {
      // Word is "answered" when its corresponding defIndex answer is filled
      const ans = answers.find((a) => a.defIndex === wordIdx);
      if (ans?.answeredWordIdx !== null && ans?.answeredWordIdx !== undefined) return;

      if (selectedDef !== null) {
        tryMatch(selectedDef, wordIdx);
      } else if (selectedWord === wordIdx) {
        setSelectedWord(null);
      } else {
        setSelectedWord(wordIdx);
      }
    },
    [answers, selectedDef, selectedWord, tryMatch],
  );

  const handleRetryWrong = useCallback(() => {
    const wrongIndices = answers
      .filter((a) => activeDefIndices.includes(a.defIndex) && !a.correct)
      .map((a) => a.defIndex);

    // Reset only the wrong answers
    setAnswers((prev) =>
      prev.map((a) =>
        wrongIndices.includes(a.defIndex)
          ? { ...a, answeredWordIdx: null, correct: null }
          : a,
      ),
    );
    setActiveDefIndices(wrongIndices);
    // Reshuffle only wrong words
    setShuffledWords(shuffle(wrongIndices));
    setSelectedDef(null);
    setSelectedWord(null);
    setPhase('matching');
  }, [answers, activeDefIndices]);

  const handleRetryAll = useCallback(() => {
    const allIndices = vocab.map((_, i) => i);
    setAnswers(vocab.map((_, i) => ({ defIndex: i, answeredWordIdx: null, correct: null })));
    setActiveDefIndices(allIndices);
    setShuffledWords(shuffle(allIndices));
    setSelectedDef(null);
    setSelectedWord(null);
    setPhase('matching');
  }, [vocab]);

  const handleFinish = useCallback(() => {
    const correctCount = answers.filter(
      (a) => activeDefIndices.includes(a.defIndex) && a.correct,
    ).length;
    onFinish({ matchedCount: correctCount, totalCount: vocab.length });
  }, [onFinish, answers, activeDefIndices, vocab.length]);

  // Build the summary answers only for the current active round
  const summaryAnswers = answers.filter((a) => activeDefIndices.includes(a.defIndex));

  return (
    <div className="flex flex-col min-h-full bg-amber-50">
      <StepHeader
        title="語詞定義配對"
        subtitle={
          phase === 'matching'
            ? '點選左邊的定義，再點選右邊對應的語詞，完成配對'
            : '作答結果'
        }
      />

      <div className="flex-1 overflow-auto py-6">
        {!hasData ? (
          <NoDataFallback onFinish={handleFinish} />
        ) : phase === 'summary' ? (
          <SummaryScreen
            vocab={vocab}
            answers={summaryAnswers}
            onRetryWrong={handleRetryWrong}
            onRetryAll={handleRetryAll}
            onFinish={handleFinish}
          />
        ) : (
          <MatchingExercise
            vocab={vocab}
            activeDefIndices={activeDefIndices}
            shuffledWords={shuffledWords}
            answers={answers}
            selectedDef={selectedDef}
            selectedWord={selectedWord}
            onDefClick={handleDefClick}
            onWordClick={handleWordClick}
            answeredCount={answeredCount}
          />
        )}
      </div>
    </div>
  );
};

export default VocabDefinitionMatch;
