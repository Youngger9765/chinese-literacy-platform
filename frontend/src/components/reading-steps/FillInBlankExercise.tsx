/**
 * FillInBlankExercise — ④ 語詞應用（選詞填句）(#615)
 *
 * Issue #698: one-at-a-time + disappearing word bank
 * Issue #732: first-try correctness tracking + summary screen with retry
 *
 * UX:
 *   - Top: fixed word bank showing only remaining (unused) words
 *   - Below: one fill-in-the-blank sentence at a time
 *   - Correct → word disappears from bank + advance to next question
 *   - Wrong  → show hint, word stays in bank; question is marked ❌ for summary
 *   - After all questions: summary screen with real score + per-question results
 *   - "重做錯題" retries only first-try-wrong questions
 *   - "全部重做" restarts all questions
 */
import React, { useEffect, useState } from 'react';
import { FillInBlankItem } from '../../types';

interface Props {
  sentences: FillInBlankItem[];
  vocabBank: Record<string, string>;  // { A: "疑難雜症", B: "龍爭虎鬥", ... }
  onComplete: (score: number, total: number, firstTryResults?: QuestionResult[]) => void;
  /** Story ID used to namespace the localStorage key (Issue #709). */
  storyId?: string | number;
}

// ---------------------------------------------------------------------------
// Per-question result (for summary)
// ---------------------------------------------------------------------------

export interface QuestionResult {
  sentenceIdx: number;        // index in the original sentences array
  firstTryCorrect: boolean;
  studentFirstAnswer: string | null;  // code of wrong first answer (null if first-try correct)
  correctAnswer: string;      // correct code
}

// ---------------------------------------------------------------------------
// localStorage helpers
// ---------------------------------------------------------------------------

function storageKey(storyId: string | number | undefined): string | null {
  return storyId != null ? `vocab_app_progress_${storyId}` : null;
}

interface SavedProgress {
  currentIdx: number;
  usedCodes: string[];
  score: number;
  firstTryResults: QuestionResult[];
  pendingRetryIndices?: number[];
  retryMode?: boolean;
}

function loadProgress(storyId: string | number | undefined): SavedProgress | null {
  const key = storageKey(storyId);
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedProgress;
    if (typeof parsed.currentIdx === 'number' && Array.isArray(parsed.usedCodes)) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function saveProgress(storyId: string | number | undefined, data: SavedProgress): void {
  const key = storageKey(storyId);
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch {
    // Quota exceeded or private mode — silently ignore
  }
}

function clearAnswers(storyId: string | number | undefined): void {
  const key = storageKey(storyId);
  if (!key) return;
  try {
    localStorage.removeItem(key);
  } catch {}
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type Phase = 'exercise' | 'summary';

const FillInBlankExercise: React.FC<Props> = ({ sentences, vocabBank, onComplete, storyId }) => {
  const bankEntries = Object.entries(vocabBank).sort(([a], [b]) => a.localeCompare(b));

  // Restore progress from localStorage if available
  const savedProgress = loadProgress(storyId);

  // ---- exercise state ----
  const [phase, setPhase] = useState<Phase>('exercise');
  // Whether we are replaying only wrong questions
  const [retryMode, setRetryMode] = useState(savedProgress?.retryMode ?? false);
  // Indices (into original sentences[]) queued for retry
  const [retryIndices, setRetryIndices] = useState<number[]>(
    savedProgress?.pendingRetryIndices ?? [],
  );
  // Index into activeSentences
  const [currentIdx, setCurrentIdx] = useState(savedProgress?.currentIdx ?? 0);
  // Codes that have been correctly used and should disappear from bank
  const [usedCodes, setUsedCodes] = useState<Set<string>>(
    () => new Set(savedProgress?.usedCodes ?? []),
  );
  // The code selected for the current question (pending confirmation)
  const [selected, setSelected] = useState<string | null>(null);
  // Feedback state for current question
  const [feedback, setFeedback] = useState<'idle' | 'correct' | 'wrong'>('idle');
  // Whether this question has already had a wrong attempt (first-try used up)
  const [firstTryUsed, setFirstTryUsed] = useState(false);

  // ---- scoring & results ----
  // Score counts first-try-correct questions only
  const [score, setScore] = useState(savedProgress?.score ?? 0);
  // Per-question first-try results (accumulated during the original run)
  const [firstTryResults, setFirstTryResults] = useState<QuestionResult[]>(
    savedProgress?.firstTryResults ?? [],
  );

  // Active sentences = full list in normal mode, retry subset in retry mode
  const activeSentences: FillInBlankItem[] = retryMode
    ? retryIndices.map((i) => sentences[i])
    : sentences;

  const total = activeSentences.length;
  const done = currentIdx >= total;

  // Persist progress after every state change
  useEffect(() => {
    if (storyId == null) return;
    saveProgress(storyId, {
      currentIdx,
      usedCodes: Array.from(usedCodes),
      score,
      firstTryResults,
      pendingRetryIndices: retryIndices,
      retryMode,
    });
  }, [currentIdx, usedCodes, score, firstTryResults, retryIndices, retryMode, storyId]);

  // Switch to summary when all active questions are done
  useEffect(() => {
    if (done && phase === 'exercise') {
      setPhase('summary');
    }
  }, [done, phase]);

  // Available words = all words minus correctly used ones
  const availableEntries = bankEntries.filter(([code]) => !usedCodes.has(code));

  const currentSentence = !done ? activeSentences[currentIdx] : null;
  // Original index of the current sentence (for result recording)
  const currentOriginalIdx = retryMode ? retryIndices[currentIdx] : currentIdx;

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  function handleSelect(code: string) {
    if (feedback === 'correct') return;
    setSelected(code);
    setFeedback('idle');
  }

  function handleConfirm() {
    if (!selected || !currentSentence) return;

    if (selected === currentSentence.answer) {
      // Correct answer — remove from bank, advance
      const newUsed = new Set(usedCodes);
      newUsed.add(selected);
      setUsedCodes(newUsed);

      // Record first-try result only if not already recorded for this original question
      const alreadyRecorded = firstTryResults.some((r) => r.sentenceIdx === currentOriginalIdx);
      if (!alreadyRecorded) {
        const isFirstTryCorrect = !firstTryUsed;
        if (isFirstTryCorrect) setScore((s) => s + 1);
        setFirstTryResults((prev) => [
          ...prev,
          {
            sentenceIdx: currentOriginalIdx,
            firstTryCorrect: isFirstTryCorrect,
            studentFirstAnswer: null,  // wrong answer was already recorded on the wrong attempt
            correctAnswer: currentSentence.answer,
          },
        ]);
      }

      setFeedback('correct');
      setTimeout(() => {
        setCurrentIdx((i) => i + 1);
        setSelected(null);
        setFeedback('idle');
        setFirstTryUsed(false);
      }, 900);
    } else {
      // Wrong answer — record on first mistake only
      if (!firstTryUsed) {
        setFirstTryResults((prev) => {
          const alreadyRecorded = prev.some((r) => r.sentenceIdx === currentOriginalIdx);
          if (alreadyRecorded) return prev;
          return [
            ...prev,
            {
              sentenceIdx: currentOriginalIdx,
              firstTryCorrect: false,
              studentFirstAnswer: selected,
              correctAnswer: currentSentence!.answer,
            },
          ];
        });
        setFirstTryUsed(true);
      }
      setFeedback('wrong');
    }
  }

  function handleRetryCurrentQuestion() {
    setSelected(null);
    setFeedback('idle');
  }

  // ---- Summary actions ----

  function handleRetryWrong() {
    const wrongIndices = firstTryResults
      .filter((r) => !r.firstTryCorrect)
      .map((r) => r.sentenceIdx);
    setRetryIndices(wrongIndices);
    setRetryMode(true);
    setCurrentIdx(0);
    setUsedCodes(new Set());
    setSelected(null);
    setFeedback('idle');
    setFirstTryUsed(false);
    setPhase('exercise');
  }

  function handleRetryAll() {
    setRetryMode(false);
    setRetryIndices([]);
    setCurrentIdx(0);
    setUsedCodes(new Set());
    setScore(0);
    setFirstTryResults([]);
    setSelected(null);
    setFeedback('idle');
    setFirstTryUsed(false);
    setPhase('exercise');
    clearAnswers(storyId);
  }

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  function renderSentence(sentence: string) {
    const parts = sentence.split('(　　)');

    const blankContent = selected
      ? (
        <span
          className={`inline-flex items-center gap-1 rounded-lg px-3 py-1 text-base font-semibold border mx-1
            ${feedback === 'correct'
              ? 'bg-emerald-100 border-emerald-500 text-emerald-900'
              : feedback === 'wrong'
              ? 'bg-red-100 border-red-400 text-red-700'
              : 'bg-[#5B4FC4]/10 border-[#5B4FC4]/40 text-[#5B4FC4]'
            }`}
        >
          <span className="font-black">{selected}</span>
          <span className="ml-1">{vocabBank[selected]}</span>
        </span>
      )
      : (
        <span className="inline-block rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 text-gray-400 px-6 py-1 mx-1 text-base min-w-[80px] text-center">
          ＿＿
        </span>
      );

    return (
      <span>
        {parts[0]}
        {blankContent}
        {parts[1] ?? ''}
      </span>
    );
  }

  // ---------------------------------------------------------------------------
  // Summary screen
  // ---------------------------------------------------------------------------

  if (phase === 'summary') {
    const firstTryScore = firstTryResults.filter((r) => r.firstTryCorrect).length;
    const firstTryTotal = sentences.length;
    const allCorrect = firstTryScore === firstTryTotal;
    const wrongCount = firstTryResults.filter((r) => !r.firstTryCorrect).length;

    return (
      <div className="flex flex-col gap-5 p-4 max-w-2xl mx-auto animate-fade-in">
        {/* Score header */}
        <div
          className={`rounded-2xl px-6 py-5 text-center border ${
            allCorrect
              ? 'bg-emerald-50 border-emerald-200'
              : 'bg-amber-50 border-amber-200'
          }`}
        >
          <p className="text-3xl font-black text-gray-800 mb-1">
            {allCorrect ? '全對！太棒了！' : `一次答對 ${firstTryScore}／${firstTryTotal} 題`}
          </p>
          <p className="text-sm text-gray-500">
            {allCorrect
              ? '每一題都一次答對，表現優異！'
              : '以下是各題的一次作答結果'}
          </p>
        </div>

        {/* Per-question breakdown */}
        <div className="flex flex-col gap-3">
          {sentences.map((s, idx) => {
            const result = firstTryResults.find((r) => r.sentenceIdx === idx);
            const correct = result?.firstTryCorrect ?? false;
            const correctCode = result?.correctAnswer ?? '';
            const wrongCode = result?.studentFirstAnswer ?? null;

            return (
              <div
                key={idx}
                className={`rounded-xl border p-4 ${
                  correct
                    ? 'bg-emerald-50 border-emerald-200'
                    : 'bg-red-50 border-red-200'
                }`}
              >
                <div className="flex items-start gap-3">
                  <span className="text-xl flex-shrink-0 mt-0.5">
                    {correct ? '✅' : '❌'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-base text-gray-700 leading-relaxed mb-1">
                      {s.sentence.replace(
                        '(　　)',
                        `【${vocabBank[correctCode] ?? correctCode}】`,
                      )}
                    </p>
                    {!correct && wrongCode && (
                      <p className="text-sm text-red-600">
                        你選了：
                        <span className="font-semibold mx-1">
                          {wrongCode}·{vocabBank[wrongCode] ?? wrongCode}
                        </span>
                        <span className="text-gray-500 mx-1">→ 正確答案：</span>
                        <span className="font-semibold text-emerald-700">
                          {correctCode}·{vocabBank[correctCode] ?? correctCode}
                        </span>
                      </p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Action buttons */}
        <div className="flex flex-col gap-3">
          {wrongCount > 0 && (
            <button
              onClick={handleRetryWrong}
              className="rounded-full border border-gray-300 bg-transparent px-6 py-2.5 text-sm font-bold text-[#5B4FC4] hover:bg-gray-50 active:scale-95 transition-all min-h-[44px]"
            >
              重做錯題（{wrongCount} 題）
            </button>
          )}
          <button
            onClick={handleRetryAll}
            className="rounded-full border border-gray-300 bg-transparent px-6 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50 active:scale-95 transition-all min-h-[44px]"
          >
            全部重做
          </button>
          <button
            onClick={() => { onComplete(firstTryScore, firstTryTotal, firstTryResults); }}
            className="rounded-full bg-[#5B4FC4] px-6 py-2.5 text-sm font-bold text-white hover:bg-[#4a3fa8] active:scale-95 transition-all shadow-md min-h-[44px]"
          >
            繼續 →
          </button>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Exercise screen
  // ---------------------------------------------------------------------------

  return (
    <div className="flex flex-col gap-5 p-4 max-w-2xl mx-auto">
      {/* Progress */}
      <div className="bg-white rounded-2xl border border-[#5B4FC4]/20 shadow-sm px-5 py-3 flex items-center justify-between">
        <span className="text-base text-gray-600 font-medium">
          {retryMode ? `重做錯題 第 ${currentIdx + 1} 題` : `第 ${currentIdx + 1} 題`}
        </span>
        <span className="text-lg font-black text-[#5B4FC4]">
          {currentIdx + 1} <span className="text-gray-400 font-normal text-sm">/ {total}</span>
        </span>
      </div>

      {/* Word bank — top, fixed, shows only remaining words */}
      <div className="rounded-2xl border border-[#5B4FC4]/30 bg-[#5B4FC4]/5 p-5 shadow-sm">
        <p className="text-sm text-[#5B4FC4] mb-3 font-semibold">詞語題庫（點選詞語填入空格）</p>
        {availableEntries.length === 0 ? (
          <p className="text-sm text-gray-400 italic">所有詞語都已使用完畢</p>
        ) : (
          <div className="flex flex-wrap gap-3">
            {availableEntries.map(([code, word]) => (
              <button
                key={code}
                onClick={() => handleSelect(code)}
                disabled={feedback === 'correct'}
                className={`rounded-xl border-2 px-4 py-2 text-base transition-all active:scale-95 font-medium min-h-[44px]
                  ${selected === code
                    ? 'bg-[#5B4FC4] border-[#5B4FC4] text-white shadow-md font-bold'
                    : 'bg-white border-[#5B4FC4]/30 text-gray-700 hover:border-[#5B4FC4] hover:bg-[#5B4FC4]/5'
                  }
                  disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                <span className="font-black text-lg">{code}</span>
                <span className="mx-1.5 text-gray-300">·</span>
                <span>{word}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Current sentence */}
      {currentSentence && (
        <div
          className={`rounded-2xl border-2 bg-white p-5 shadow-sm transition-all duration-200
            ${feedback === 'correct'
              ? 'border-emerald-300 bg-emerald-50'
              : feedback === 'wrong'
              ? 'border-red-300 bg-red-50'
              : 'border-gray-200'
            }`}
        >
          <p className="text-lg leading-loose text-gray-800 mb-4 flex items-start gap-2">
            <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-[#5B4FC4]/15 text-[#5B4FC4] font-black text-sm flex-shrink-0 mt-0.5">
              {currentIdx + 1}
            </span>
            <span>{renderSentence(currentSentence.sentence)}</span>
            {feedback === 'correct' && <span className="ml-1 text-lg">✅</span>}
            {feedback === 'wrong' && <span className="ml-1 text-lg">❌</span>}
          </p>

          {/* First-try status hint */}
          {feedback === 'idle' && !firstTryUsed && (
            <p className="ml-9 text-xs text-[#5B4FC4]/60 font-medium mb-2">
              一次答對才算答對
            </p>
          )}
          {feedback === 'idle' && firstTryUsed && (
            <p className="ml-9 text-xs text-amber-600 font-medium mb-2">
              已有錯誤紀錄，找出正確答案繼續
            </p>
          )}

          {/* Feedback message */}
          {feedback === 'correct' && (
            <p className="ml-9 text-sm text-emerald-700 font-semibold animate-fade-in">
              {firstTryUsed ? '答對了，繼續下一題…' : '一次答對！進入下一題…'}
            </p>
          )}
          {feedback === 'wrong' && (
            <div className="ml-9 flex flex-col gap-2 animate-fade-in">
              <p className="text-sm text-red-600 font-semibold">
                不對喔！再想想看，正確答案是哪個詞語？
              </p>
              <button
                onClick={handleRetryCurrentQuestion}
                className="self-start rounded-lg border border-red-200 bg-white px-4 py-1.5 text-sm text-red-600 hover:bg-red-50 transition-colors"
              >
                重新選擇
              </button>
            </div>
          )}

          {/* Confirm button */}
          {feedback === 'idle' && (
            <div className="ml-9 mt-2">
              <button
                onClick={handleConfirm}
                disabled={!selected}
                className="rounded-full bg-[#5B4FC4] px-6 py-2.5 text-white text-sm font-bold
                  disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#4a3fa8] active:scale-95 transition-all shadow min-h-[44px]"
              >
                {selected ? '確認填入' : '請先選擇詞語'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default FillInBlankExercise;
