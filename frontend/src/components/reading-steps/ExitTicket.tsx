
import React, { useState, useMemo } from 'react';

interface WrongToken {
  char: string;
  expected: string;
}

interface ExitTicketProps {
  wrongTokens: WrongToken[];
  missingChars: string[];
  storyContent: string[];
}

interface Question {
  prompt: string;
  correctAnswer: string;
  options: string[];
}

/** Shuffle array using Fisher-Yates */
const shuffle = <T,>(arr: T[]): T[] => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/** Generate up to 3 multiple-choice questions from wrong + missing tokens */
const generateQuestions = (wrongTokens: WrongToken[], missingChars: string[], storyContent: string[]): Question[] => {
  if (wrongTokens.length === 0 && missingChars.length === 0) return [];

  // Collect unique characters from the story for distractors
  const storyChars = new Set<string>();
  for (const paragraph of storyContent) {
    for (const ch of paragraph) {
      if (/[\u4e00-\u9fff]/.test(ch)) storyChars.add(ch);
    }
  }

  const questions: Question[] = [];

  // Questions from wrong tokens: "你讀成了 X，正確的字應該是？"
  for (const token of shuffle(wrongTokens)) {
    if (questions.length >= 3) break;
    const distractorPool = new Set<string>();
    for (const t of wrongTokens) {
      if (t.expected !== token.expected) distractorPool.add(t.expected);
    }
    for (const ch of storyChars) {
      if (ch !== token.expected && ch !== token.char) distractorPool.add(ch);
    }
    const distractors = shuffle([...distractorPool]).slice(0, 3);
    while (distractors.length < 3) {
      const fallback = String.fromCharCode(0x4e00 + Math.floor(Math.random() * 200));
      if (fallback !== token.expected && !distractors.includes(fallback)) {
        distractors.push(fallback);
      }
    }
    questions.push({
      prompt: `你讀成了「${token.char}」，正確的字應該是？`,
      correctAnswer: token.expected,
      options: shuffle([token.expected, ...distractors.slice(0, 3)]),
    });
  }

  // Fill remaining slots with missing chars: "這個字怎麼唸？"
  const usedChars = new Set(questions.map(q => q.correctAnswer));
  for (const ch of shuffle(missingChars)) {
    if (questions.length >= 3) break;
    if (usedChars.has(ch)) continue;
    usedChars.add(ch);

    const distractorPool = new Set<string>();
    for (const sc of storyChars) {
      if (sc !== ch) distractorPool.add(sc);
    }
    const distractors = shuffle([...distractorPool]).slice(0, 3);
    while (distractors.length < 3) {
      const fallback = String.fromCharCode(0x4e00 + Math.floor(Math.random() * 200));
      if (fallback !== ch && !distractors.includes(fallback)) {
        distractors.push(fallback);
      }
    }
    questions.push({
      prompt: `你漏讀了一個字，是下面哪一個？`,
      correctAnswer: ch,
      options: shuffle([ch, ...distractors.slice(0, 3)]),
    });
  }

  return questions;
};

const ExitTicket: React.FC<ExitTicketProps> = ({ wrongTokens, missingChars, storyContent }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [answers, setAnswers] = useState<(string | null)[]>([]);
  const [submitted, setSubmitted] = useState(false);

  const questions = useMemo(
    () => generateQuestions(wrongTokens, missingChars, storyContent),
    [wrongTokens, missingChars, storyContent],
  );

  // No wrong tokens = no exit ticket
  if (questions.length === 0) return null;

  // Initialize answers array
  if (answers.length !== questions.length) {
    setAnswers(new Array(questions.length).fill(null));
    return null;
  }

  const correctCount = submitted
    ? answers.filter((a, i) => a === questions[i].correctAnswer).length
    : 0;
  const allAnswered = answers.every((a) => a !== null);

  const handleSelect = (qIdx: number, option: string) => {
    if (submitted) return;
    const next = [...answers];
    next[qIdx] = option;
    setAnswers(next);
  };

  const handleSubmit = () => {
    if (!allAnswered) return;
    setSubmitted(true);
  };

  return (
    <div className="rounded-3xl border border-amber-200 bg-amber-50/50 overflow-hidden">
      {/* Header (toggle) */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-6 py-4 flex items-center justify-between hover:bg-amber-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="w-8 h-8 rounded-full bg-amber-400 text-white flex items-center justify-center text-sm font-black shrink-0">
            ✎
          </span>
          <h3 className="text-lg font-bold text-gray-900">學習出場卷</h3>
          {submitted && (
            <span className={`text-sm font-bold px-2 py-0.5 rounded-full ${
              correctCount === questions.length
                ? 'bg-emerald-100 text-emerald-700'
                : 'bg-amber-100 text-amber-700'
            }`}>
              {correctCount}/{questions.length}
            </span>
          )}
        </div>
        <svg
          className={`w-5 h-5 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Content */}
      {isOpen && (
        <div className="px-6 pb-6 space-y-5 border-t border-amber-200">
          <p className="text-sm text-gray-500 pt-4">
            根據你剛才讀錯的字，來做個小測驗吧！
          </p>

          {questions.map((q, qIdx) => (
            <div key={qIdx} className="space-y-2">
              <p className="text-sm font-bold text-gray-800">
                {qIdx + 1}. {q.prompt}
              </p>
              <div className="grid grid-cols-2 gap-2">
                {q.options.map((opt) => {
                  const isSelected = answers[qIdx] === opt;
                  const isCorrect = opt === q.correctAnswer;
                  let style = 'bg-white border-gray-200 hover:border-accent hover:bg-accent/5';

                  if (submitted) {
                    if (isCorrect) {
                      style = 'bg-emerald-50 border-emerald-400 text-emerald-800';
                    } else if (isSelected && !isCorrect) {
                      style = 'bg-red-50 border-red-400 text-red-700';
                    } else {
                      style = 'bg-gray-50 border-gray-200 text-gray-400';
                    }
                  } else if (isSelected) {
                    style = 'bg-accent/10 border-accent text-accent';
                  }

                  return (
                    <button
                      key={opt}
                      onClick={() => handleSelect(qIdx, opt)}
                      disabled={submitted}
                      className={`border-2 rounded-xl px-4 py-3 text-lg font-bold transition-all ${style}`}
                    >
                      {opt}
                      {submitted && isCorrect && ' ✓'}
                      {submitted && isSelected && !isCorrect && ' ✗'}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Submit / Result */}
          {!submitted ? (
            <button
              onClick={handleSubmit}
              disabled={!allAnswered}
              className={`w-full py-3 rounded-xl font-bold text-sm transition-all ${
                allAnswered
                  ? 'bg-amber-500 text-white hover:bg-amber-600'
                  : 'bg-gray-200 text-gray-400 cursor-not-allowed'
              }`}
            >
              提交答案
            </button>
          ) : (
            <div className={`rounded-2xl p-4 text-center ${
              correctCount === questions.length
                ? 'bg-emerald-50 border border-emerald-200'
                : 'bg-amber-50 border border-amber-200'
            }`}>
              <p className="text-2xl font-black">
                {correctCount === questions.length ? '🎉' : '💪'}
              </p>
              <p className="font-bold text-gray-900 mt-1">
                {correctCount}/{questions.length} 題正確
              </p>
              <p className="text-sm text-gray-500 mt-0.5">
                {correctCount === questions.length
                  ? '太棒了！全部答對！'
                  : '沒關係，多練習幾次就會進步！'}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ExitTicket;
