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

  function handleSelect(sentenceIdx: number, code: string) {
    if (submitted) return;
    setAnswers((prev) => ({ ...prev, [sentenceIdx]: code }));
  }

  function handleSubmit() {
    if (Object.keys(answers).length < sentences.length) return;
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
        className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-sm font-semibold border mx-0.5
          ${!submitted
            ? chosen
              ? 'bg-blue-100 border-blue-400 text-blue-800'
              : 'bg-gray-100 border-dashed border-gray-400 text-gray-400'
            : isCorrect
              ? 'bg-green-100 border-green-500 text-green-800'
              : 'bg-red-100 border-red-400 text-red-700 line-through'
          }`}
      >
        {chosen ? `${chosen} ${vocabBank[chosen]}` : '＿＿'}
        {submitted && isWrong && (
          <span className="not-italic text-green-700 no-underline ml-1">
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
    <div className="flex flex-col gap-5 p-4 max-w-2xl mx-auto">
      {/* Word bank */}
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
        <p className="text-xs text-gray-500 mb-2 font-medium">詞語題庫：將正確的詞語代號填入空格中</p>
        <div className="flex flex-wrap gap-2">
          {bankEntries.map(([code, word]) => (
            <span
              key={code}
              className="rounded-md border border-gray-300 bg-white px-3 py-1 text-sm"
            >
              <span className="font-bold text-blue-600">{code}</span>
              <span className="mx-1 text-gray-400">·</span>
              {word}
            </span>
          ))}
        </div>
      </div>

      {/* Sentences */}
      <div className="flex flex-col gap-3">
        {sentences.map((s, idx) => (
          <div key={idx} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-sm leading-relaxed text-gray-800 mb-3">
              ({idx + 1}) {renderSentence(s.sentence, idx)}
            </p>

            {!submitted && (
              <div className="flex flex-wrap gap-1.5">
                {bankEntries.map(([code, word]) => (
                  <button
                    key={code}
                    onClick={() => handleSelect(idx, code)}
                    className={`rounded px-2.5 py-1 text-xs border transition-all
                      ${answers[idx] === code
                        ? 'bg-blue-500 border-blue-500 text-white font-semibold'
                        : 'bg-white border-gray-200 text-gray-700 hover:border-blue-400'
                      }`}
                  >
                    {code} {word}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Action buttons */}
      {!submitted ? (
        <button
          onClick={handleSubmit}
          disabled={Object.keys(answers).length < sentences.length}
          className="self-center rounded-lg bg-blue-500 px-8 py-2.5 text-white text-sm font-medium
            disabled:opacity-40 disabled:cursor-not-allowed hover:bg-blue-600 transition-colors"
        >
          提交答案
        </button>
      ) : (
        <div className="flex flex-col items-center gap-3">
          <p className="text-lg font-semibold text-gray-800">
            {score === sentences.length
              ? '全對！太棒了！'
              : `答對 ${score}／${sentences.length} 題`}
          </p>
          <div className="flex gap-3">
            <button
              onClick={handleRetry}
              className="rounded-lg border border-gray-300 px-5 py-2 text-sm text-gray-600 hover:bg-gray-50"
            >
              再試一次
            </button>
            <button
              onClick={() => onComplete(score, sentences.length)}
              className="rounded-lg bg-blue-500 px-5 py-2 text-sm text-white hover:bg-blue-600"
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
