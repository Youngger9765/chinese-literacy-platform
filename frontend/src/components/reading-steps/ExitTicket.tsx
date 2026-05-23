import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  generateExitTicket,
  submitExitTicket,
  type ExitTicketQuestion as ApiQuestion,
} from '../../services/learningApi';
import {
  generateLocalQuestions,
  type LocalQuestion,
} from './exitTicketLocalFallback';

interface WrongToken {
  char: string;
  expected: string;
}

interface ExitTicketProps {
  wrongTokens: WrongToken[];
  missingChars: string[];
  storyContent: string[];
  /** DB session ID — required to call backend AI generation and persist results */
  dbSessionId?: number | null;
  /** Auth token — required to call backend endpoints */
  token?: string | null;
}

// ── Unified question type for rendering ──────────────────────────────────────

interface UnifiedQuestion {
  id: number;
  question: string;
  /** Index of the correct answer in options array */
  correctIndex: number;
  options: string[];
  explanation?: string;
  /**
   * 'pregenerated' = pre-authored MCQ from lesson YAML (Issue #1402, default path)
   * 'ai' = AI-generated at request time (legacy fallback)
   * 'local' = rule-based local fallback when API unavailable
   */
  source: 'pregenerated' | 'ai' | 'local';
}

/** Convert API question to unified format. Source comes from response level. */
const fromApiQuestion = (
  q: ApiQuestion,
  source: 'pregenerated' | 'ai' = 'ai',
): UnifiedQuestion => ({
  id: q.id,
  question: q.question,
  correctIndex: q.correct_index,
  options: q.options,
  explanation: q.explanation,
  source,
});

/** Convert local question to unified format */
const fromLocalQuestion = (q: LocalQuestion): UnifiedQuestion => ({
  id: q.id,
  question: q.question,
  correctIndex: q.options.indexOf(q.correctAnswer),
  options: q.options,
  source: 'local',
});

// ── Component ─────────────────────────────────────────────────────────────────

const ExitTicket: React.FC<ExitTicketProps> = ({
  wrongTokens,
  missingChars,
  storyContent,
  dbSessionId,
  token,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [answers, setAnswers] = useState<(number | null)[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const [questions, setQuestions] = useState<UnifiedQuestion[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Local fallback questions (memoized, same as original logic)
  const localQuestions = useMemo(
    () => generateLocalQuestions(wrongTokens, missingChars, storyContent),
    [wrongTokens, missingChars, storyContent],
  );

  // Attempt AI generation on mount if we have session context
  const fetchAiQuestions = useCallback(async () => {
    if (!dbSessionId || !token || storyContent.length === 0) {
      setQuestions(localQuestions.map(fromLocalQuestion));
      return;
    }
    setIsLoading(true);
    try {
      const wrongChars = wrongTokens.map(t => t.expected);
      const result = await generateExitTicket(token, dbSessionId, storyContent, wrongChars);
      // Accept both 'pregenerated' (YAML, default since #1402) and 'ai' (legacy fallback)
      if (
        (result.source === 'pregenerated' || result.source === 'ai') &&
        result.questions.length > 0
      ) {
        setQuestions(result.questions.map(q => fromApiQuestion(q, result.source as 'pregenerated' | 'ai')));
      } else {
        // API unavailable / fallback — use local rule-based questions
        setQuestions(localQuestions.map(fromLocalQuestion));
      }
    } catch {
      setQuestions(localQuestions.map(fromLocalQuestion));
    } finally {
      setIsLoading(false);
    }
  }, [dbSessionId, token, storyContent, wrongTokens, localQuestions]);

  useEffect(() => {
    fetchAiQuestions();
  }, [fetchAiQuestions]);

  // Initialize answers when questions are loaded
  useEffect(() => {
    if (questions !== null) {
      setAnswers(new Array(questions.length).fill(null));
    }
  }, [questions]);

  // Not ready yet
  if (questions === null || isLoading) {
    if (!isLoading && localQuestions.length === 0) return null;
    return (
      <div className="rounded-3xl border border-amber-200 bg-amber-50/50 overflow-hidden">
        <div className="px-6 py-4 flex items-center gap-3">
          <span className="w-8 h-8 rounded-full bg-amber-400 text-white flex items-center justify-center text-sm font-bold shrink-0">
            ✎
          </span>
          <h3 className="text-lg font-bold text-gray-900">學習出場卷</h3>
          {isLoading && (
            <span className="text-sm text-amber-600 animate-pulse">AI 正在出題中...</span>
          )}
        </div>
      </div>
    );
  }

  if (questions.length === 0) return null;

  if (answers.length !== questions.length) return null;

  const correctCount = submitted
    ? answers.filter((a, i) => a === questions[i].correctIndex).length
    : 0;
  const allAnswered = answers.every((a) => a !== null);

  const handleSelect = (qIdx: number, optIdx: number) => {
    if (submitted) return;
    const next = [...answers];
    next[qIdx] = optIdx;
    setAnswers(next);
  };

  const handleSubmit = async () => {
    if (!allAnswered) return;
    setSubmitted(true);

    // Persist results to backend (non-blocking)
    if (dbSessionId && token) {
      const score = Math.round(
        (answers.filter((a, i) => a === questions[i].correctIndex).length / questions.length) * 100,
      );
      const answerPayload = answers.map((selectedIndex, i) => ({
        question_id: questions[i].id,
        selected_index: selectedIndex ?? 0,
      }));
      submitExitTicket(token, dbSessionId, answerPayload, score, questions.length).catch(() => {
        // Non-critical — don't block student view on persist failure
      });
    }
  };

  const hasAiQuestions = questions.some(q => q.source === 'ai');

  return (
    <div className="rounded-3xl border border-amber-200 bg-amber-50/50 overflow-hidden">
      {/* Header (toggle) */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-6 py-4 flex items-center justify-between hover:bg-amber-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="w-8 h-8 rounded-full bg-amber-400 text-white flex items-center justify-center text-sm font-bold shrink-0">
            ✎
          </span>
          <h3 className="text-lg font-bold text-gray-900">學習出場卷</h3>
          {hasAiQuestions && (
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">
              AI 出題
            </span>
          )}
          {submitted && (
            <span className={`text-sm font-bold px-2 py-0.5 rounded-full ${
              correctCount === questions.length
                ? 'bg-emerald-100 text-emerald-700'
                : 'bg-amber-100 text-amber-700'
            }`}>
              {correctCount === questions.length ? '全部答對！' : '已完成'}
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
            {hasAiQuestions
              ? '根據課文內容，AI 出了幾道題，來測試一下你的理解吧！'
              : '根據你剛才讀錯的字，來做個小測驗吧！'}
          </p>

          {questions.map((q, qIdx) => (
            <div key={q.id} className="space-y-2">
              <p className="text-sm font-bold text-gray-800">
                {qIdx + 1}. {q.question}
              </p>
              <div className="grid grid-cols-2 gap-2">
                {q.options.map((opt, optIdx) => {
                  const isSelected = answers[qIdx] === optIdx;
                  const isCorrect = optIdx === q.correctIndex;
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
                      key={optIdx}
                      onClick={() => handleSelect(qIdx, optIdx)}
                      disabled={submitted}
                      className={`border-2 rounded-xl px-4 py-3 text-base font-bold transition-all text-left ${style}`}
                    >
                      {opt}
                      {submitted && isCorrect && ' ✓'}
                      {submitted && isSelected && !isCorrect && ' ✗'}
                    </button>
                  );
                })}
              </div>
              {/* Show AI explanation after submit */}
              {submitted && q.explanation && (
                <p className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2 mt-1">
                  {q.explanation}
                </p>
              )}
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
                {correctCount === questions.length ? '太棒了，全部答對！' : '你完成了！'}
              </p>
              <p className="text-sm text-gray-500 mt-0.5">
                {correctCount === questions.length
                  ? '繼續保持！'
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
