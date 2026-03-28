/**
 * FillInBlankExercise — ④ 語詞應用（選詞填句）(#615)
 *
 * Shows vocab word bank (A~G codes) and sentences with blanks.
 * Student picks the correct code for each blank, submits to check.
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
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [submitted, setSubmitted] = useState(false);

  const answeredCount = Object.keys(answers).length;
  const allAnswered = answeredCount >= sentences.length;

  function handleSelect(sentenceIdx: number, code: string) {
    if (submitted) return;
    setAnswers((prev) => ({ ...prev, [sentenceIdx]: code }));
  }

  function handleSubmit() {
    if (!allAnswered) return;
    setSubmitted(true);
  }

  function handleRetry() {
    setAnswers({});
    setSubmitted(false);
  }

  const score = submitted
    ? sentences.filter((s, i) => answers[i] === s.answer).length
    : 0;

  // Render sentence text with (　　) replaced by a word badge
  function renderSentence(sentence: string, idx: number) {
    const chosen = answers[idx];
    const correct = sentences[idx].answer;

    const parts = sentence.split('(　　)');
    const isCorrect = submitted && chosen === correct;
    const isWrong = submitted && chosen !== correct;

    const badge = (
      <span
        className={`inline-flex items-center gap-1 rounded-lg px-3 py-1 text-base font-semibold border mx-1 transition-all
          ${!submitted
            ? chosen
              ? 'bg-indigo-100 border-indigo-400 text-indigo-900'
              : 'bg-gray-100 border-dashed border-gray-400 text-gray-400'
            : isCorrect
              ? 'bg-emerald-100 border-emerald-500 text-emerald-900'
              : 'bg-red-100 border-red-400 text-red-700 line-through'
          }`}
      >
        {chosen ? `${chosen} ${vocabBank[chosen]}` : '＿＿'}
        {submitted && isWrong && (
          <span className="not-italic text-emerald-700 no-underline ml-1 font-normal text-sm">
            → {correct} {vocabBank[correct]}
          </span>
        )}
      </span>
    );

    return (
      <span>
        {parts[0]}
        {badge}
        {parts[1]}
      </span>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-4 max-w-2xl mx-auto">
      {/* Progress indicator */}
      {!submitted && (
        <div className="bg-white rounded-2xl border border-indigo-100 shadow-sm px-5 py-3 flex items-center justify-between">
          <span className="text-base text-gray-600 font-medium">已作答</span>
          <span className="text-lg font-black text-indigo-700">
            {answeredCount} <span className="text-gray-400 font-normal text-sm">/ {sentences.length}</span>
          </span>
        </div>
      )}

      {/* Word bank */}
      <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-5 shadow-sm">
        <p className="text-sm text-indigo-700 mb-3 font-semibold">詞語題庫：將正確的詞語代號填入空格中</p>
        <div className="flex flex-wrap gap-3">
          {bankEntries.map(([code, word]) => (
            <span
              key={code}
              className="rounded-xl border border-indigo-200 bg-white px-4 py-2 text-base shadow-sm"
            >
              <span className="font-black text-indigo-600 text-lg">{code}</span>
              <span className="mx-1.5 text-gray-300">·</span>
              <span className="text-gray-800 font-medium">{word}</span>
            </span>
          ))}
        </div>
      </div>

      {/* Sentences */}
      <div className="flex flex-col gap-4">
        {sentences.map((s, idx) => {
          const isCorrect = submitted && answers[idx] === s.answer;
          const isWrong = submitted && answers[idx] !== s.answer;
          return (
            <div
              key={idx}
              className={`rounded-2xl border-2 bg-white p-5 shadow-sm transition-all duration-200 ${
                isCorrect
                  ? 'border-emerald-300 bg-emerald-50'
                  : isWrong
                  ? 'border-red-300 bg-red-50'
                  : 'border-gray-200'
              }`}
            >
              {/* Question number + sentence */}
              <p className="text-lg leading-loose text-gray-800 mb-4 flex items-start gap-2">
                <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-indigo-100 text-indigo-700 font-black text-sm flex-shrink-0 mt-0.5">
                  {idx + 1}
                </span>
                <span>
                  {renderSentence(s.sentence, idx)}
                  {submitted && (
                    <span className="ml-2 text-lg">
                      {isCorrect ? '✅' : '❌'}
                    </span>
                  )}
                </span>
              </p>

              {!submitted && (
                <div className="flex flex-wrap gap-2 ml-9">
                  {bankEntries.map(([code, word]) => (
                    <button
                      key={code}
                      onClick={() => handleSelect(idx, code)}
                      className={`rounded-xl px-4 py-2 text-base border-2 transition-all active:scale-95 font-medium min-h-[44px]
                        ${answers[idx] === code
                          ? 'bg-indigo-600 border-indigo-600 text-white font-bold shadow-md'
                          : 'bg-white border-gray-200 text-gray-700 hover:border-indigo-400 hover:bg-indigo-50'
                        }`}
                    >
                      <span className="font-black">{code}</span>
                      <span className="ml-1.5 text-sm">{word}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Action buttons */}
      {!submitted ? (
        <button
          onClick={handleSubmit}
          disabled={!allAnswered}
          className="self-center rounded-xl bg-indigo-600 px-12 py-4 text-white text-lg font-bold
            disabled:opacity-40 disabled:cursor-not-allowed hover:bg-indigo-700 active:scale-95 transition-all shadow-lg min-h-[56px]"
        >
          {allAnswered ? '提交答案' : `還有 ${sentences.length - answeredCount} 題未填`}
        </button>
      ) : (
        <div className="flex flex-col items-center gap-4 animate-fade-in">
          <div className={`rounded-2xl px-8 py-4 text-center ${score === sentences.length ? 'bg-emerald-50 border border-emerald-200' : 'bg-amber-50 border border-amber-200'}`}>
            <p className="text-2xl font-black text-gray-800">
              {score === sentences.length
                ? '全對！太棒了！'
                : `答對 ${score}／${sentences.length} 題`}
            </p>
          </div>
          <div className="flex gap-4">
            <button
              onClick={handleRetry}
              className="rounded-xl border-2 border-gray-300 px-7 py-3 text-base font-semibold text-gray-600 hover:bg-gray-50 active:scale-95 transition-all min-h-[52px]"
            >
              再試一次
            </button>
            <button
              onClick={() => onComplete(score, sentences.length)}
              className="rounded-xl bg-indigo-600 px-7 py-3 text-base font-bold text-white hover:bg-indigo-700 active:scale-95 transition-all shadow-md min-h-[52px]"
            >
              繼續 →
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default FillInBlankExercise;
