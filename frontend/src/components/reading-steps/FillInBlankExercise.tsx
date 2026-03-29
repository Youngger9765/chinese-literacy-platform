/**
 * FillInBlankExercise — ④ 語詞應用（選詞填句）(#615)
 *
 * Issue #698: one-at-a-time + disappearing word bank
 *
 * UX:
 *   - Top: fixed word bank showing only remaining (unused) words
 *   - Below: one fill-in-the-blank sentence at a time
 *   - Correct → word disappears from bank + advance to next question
 *   - Wrong  → show hint, word stays in bank
 *   - No per-sentence option buttons; all selection happens via the top bank
 */
import React, { useState } from 'react';
import { FillInBlankItem } from '../../types';

interface Props {
  sentences: FillInBlankItem[];
  vocabBank: Record<string, string>;  // { A: "疑難雜症", B: "龍爭虎鬥", ... }
  onComplete: (score: number, total: number) => void;
}

const FillInBlankExercise: React.FC<Props> = ({ sentences, vocabBank, onComplete }) => {
  const bankEntries = Object.entries(vocabBank).sort(([a], [b]) => a.localeCompare(b));

  // Index of the current sentence being answered
  const [currentIdx, setCurrentIdx] = useState(0);
  // Codes that have been correctly used and should disappear from bank
  const [usedCodes, setUsedCodes] = useState<Set<string>>(new Set());
  // The code selected for the current question (pending confirmation)
  const [selected, setSelected] = useState<string | null>(null);
  // Feedback state for current question
  const [feedback, setFeedback] = useState<'idle' | 'correct' | 'wrong'>('idle');
  // Track score
  const [score, setScore] = useState(0);

  const total = sentences.length;
  const done = currentIdx >= total;

  // Available words = all words minus correctly used ones
  const availableEntries = bankEntries.filter(([code]) => !usedCodes.has(code));

  const currentSentence = !done ? sentences[currentIdx] : null;

  function handleSelect(code: string) {
    if (feedback === 'correct') return; // waiting for auto-advance
    setSelected(code);
    setFeedback('idle');
  }

  function handleConfirm() {
    if (!selected || !currentSentence) return;

    if (selected === currentSentence.answer) {
      // Correct
      const newUsed = new Set(usedCodes);
      newUsed.add(selected);
      setUsedCodes(newUsed);
      setScore((s) => s + 1);
      setFeedback('correct');
      // Brief pause so student sees green flash, then advance
      setTimeout(() => {
        setCurrentIdx((i) => i + 1);
        setSelected(null);
        setFeedback('idle');
      }, 900);
    } else {
      // Wrong
      setFeedback('wrong');
    }
  }

  function handleRetryCurrentQuestion() {
    setSelected(null);
    setFeedback('idle');
  }

  // Render the sentence with the blank slot
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

  if (done) {
    return (
      <div className="flex flex-col items-center gap-4 p-6 max-w-2xl mx-auto animate-fade-in">
        <div className={`rounded-2xl px-8 py-4 text-center w-full ${score === total ? 'bg-emerald-50 border border-emerald-200' : 'bg-amber-50 border border-amber-200'}`}>
          <p className="text-2xl font-black text-gray-800">
            {score === total ? '全對！太棒了！' : `答對 ${score}／${total} 題`}
          </p>
        </div>
        <button
          onClick={() => onComplete(score, total)}
          className="rounded-xl bg-[#5B4FC4] px-10 py-3 text-base font-bold text-white hover:bg-[#4a3fa8] active:scale-95 transition-all shadow-md min-h-[52px]"
        >
          繼續 →
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 p-4 max-w-2xl mx-auto">
      {/* Progress */}
      <div className="bg-white rounded-2xl border border-[#5B4FC4]/20 shadow-sm px-5 py-3 flex items-center justify-between">
        <span className="text-base text-gray-600 font-medium">第 {currentIdx + 1} 題</span>
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

          {/* Feedback message */}
          {feedback === 'correct' && (
            <p className="ml-9 text-sm text-emerald-700 font-semibold animate-fade-in">
              答對了！進入下一題…
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
                className="rounded-xl bg-[#5B4FC4] px-8 py-2.5 text-white text-base font-bold
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
