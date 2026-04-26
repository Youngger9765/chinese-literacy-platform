
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  generateExitTicket,
  submitExitTicket,
  type ExitTicketQuestion as ApiQuestion,
} from '../../services/learningApi';

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

// ── Local rule-based fallback (kept from original implementation) ─────────────

interface LocalQuestion {
  id: number;
  question: string;
  correctAnswer: string;
  options: string[];
  /** Always undefined for local questions (no server explanation) */
  explanation?: string;
  source: 'local';
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

const COMMON_PARTICLES = new Set(['的', '了', '在', '是', '有', '和', '與', '也', '都', '就', '把', '被', '讓', '給', '從', '到', '著', '過', '嗎', '呢', '吧', '啊', '嗎']);

/**
 * Map of commonly confused Chinese characters (形近字 / 音近字).
 * When generating distractors, use these as priority options before falling back to story chars.
 */
const CONFUSABLE_CHARS: Record<string, string[]> = {
  // 形近字 (visually similar)
  '己': ['已', '巳'],
  '已': ['己', '巳'],
  '巳': ['己', '已'],
  '未': ['末', '木'],
  '末': ['未', '木'],
  '大': ['太', '犬', '天'],
  '太': ['大', '犬', '天'],
  '犬': ['大', '太'],
  '日': ['目', '曰'],
  '目': ['日', '曰'],
  '人': ['入', '八'],
  '入': ['人', '八'],
  '土': ['士', '王'],
  '士': ['土', '王'],
  '干': ['千', '于', '幹'],
  '千': ['干', '于'],
  '天': ['夫', '大', '太'],
  '夫': ['天', '大'],
  '刀': ['力', '刃'],
  '力': ['刀', '刃'],
  '田': ['由', '甲', '申'],
  '由': ['田', '甲', '申'],
  '甲': ['田', '由', '申'],
  '白': ['自', '百', '臼'],
  '自': ['白', '百'],
  '百': ['白', '自'],
  '午': ['牛', '干'],
  '牛': ['午', '干'],
  '折': ['拆', '析'],
  '拆': ['折', '析'],
  '買': ['賣', '貿'],
  '賣': ['買', '貿'],
  '同': ['回', '向'],
  '回': ['同', '向'],
  '代': ['伐', '從'],
  '伐': ['代', '從'],
  // 形近字 - 三點水系列
  '晴': ['睛', '情', '清', '請', '精', '青'],
  '睛': ['晴', '情', '清', '青'],
  '情': ['晴', '睛', '清', '請'],
  '清': ['晴', '睛', '情', '請', '青'],
  '請': ['情', '清', '晴'],
  '精': ['晴', '清', '青'],
  '青': ['晴', '清', '精'],
  // 音近字 (phonetically similar)
  '在': ['再', '載', '栽'],
  '再': ['在', '載', '栽'],
  '的': ['得', '地', '底'],
  '得': ['的', '地', '底'],
  '地': ['的', '得', '底'],
  '做': ['作', '坐', '座'],
  '作': ['做', '坐', '座'],
  '坐': ['做', '作', '座'],
  '座': ['做', '作', '坐'],
  '他': ['她', '它', '祂'],
  '她': ['他', '它'],
  '它': ['他', '她'],
  '像': ['象', '向', '相'],
  '象': ['像', '向', '相'],
  '向': ['像', '象', '鄉'],
  '那': ['哪', '娜', '拿'],
  '哪': ['那', '娜'],
  '只': ['指', '紙', '隻', '支'],
  '指': ['只', '紙', '隻'],
  '紙': ['只', '指', '隻'],
  '隻': ['只', '指', '紙'],
  '園': ['圓', '源', '緣', '員', '遠'],
  '圓': ['園', '員', '遠'],
  '員': ['園', '圓', '遠'],
  '源': ['園', '緣', '遠'],
  '緣': ['源', '園', '員'],
  '生': ['聲', '勝', '省', '升'],
  '聲': ['生', '勝', '省'],
  '勝': ['生', '聲', '省'],
  '省': ['生', '聲', '勝'],
  '式': ['試', '是', '事', '市'],
  '試': ['式', '是', '事'],
  '是': ['式', '試', '事'],
  '事': ['式', '試', '是'],
  '市': ['式', '試', '是'],
  '練': ['煉', '鍊', '連'],
  '煉': ['練', '鍊', '連'],
  '鍊': ['練', '煉', '連'],
  '問': ['聞', '文', '閒'],
  '聞': ['問', '文', '閒'],
  '花': ['化', '華', '樺'],
  '化': ['花', '華'],
  '心': ['新', '辛', '欣'],
  '想': ['相', '向', '象'],
  '相': ['想', '象', '向'],
  '原': ['園', '圓', '員', '源'],
  '看': ['著', '觀', '視'],
  '說': ['話', '語', '悅'],
  '話': ['說', '語', '悅'],
  '走': ['足', '奔', '跑'],
  '跑': ['走', '足', '奔'],
  '來': ['回', '去', '到'],
  '去': ['來', '回', '到'],
  '開': ['關', '閉', '闊'],
  '關': ['開', '閉', '闊'],
  '高': ['告', '稿', '膏'],
  '好': ['壞', '妙', '姐'],
  '年': ['午', '牛', '幸'],
  '月': ['目', '日', '用'],
  '山': ['出', '止', '丘'],
  '水': ['木', '永', '氷'],
  '木': ['水', '本', '末'],
  '本': ['木', '末', '未'],
  '手': ['毛', '才', '扌'],
  '上': ['土', '止', '卡'],
  '下': ['上', '卡', '不'],
  '中': ['申', '由', '串'],
  '口': ['日', '目', '回'],
  '子': ['字', '孑', '孓'],
  '字': ['子', '守', '宇'],
};

/** Generate up to 3 multiple-choice questions from wrong + missing tokens (local fallback) */
const generateLocalQuestions = (
  wrongTokens: WrongToken[],
  missingChars: string[],
  storyContent: string[],
): LocalQuestion[] => {
  if (wrongTokens.length === 0 && missingChars.length === 0) return [];

  const storyChars = new Set<string>();
  for (const paragraph of storyContent) {
    for (const ch of paragraph) {
      if (/[\u4e00-\u9fff]/.test(ch) && !COMMON_PARTICLES.has(ch)) storyChars.add(ch);
    }
  }

  const questions: LocalQuestion[] = [];

  const buildDistractors = (correctAnswer: string, exclude: Set<string>): string[] => {
    const chosen: string[] = [];
    const seen = new Set<string>([correctAnswer, ...exclude]);

    const confusables = CONFUSABLE_CHARS[correctAnswer] ?? [];
    for (const c of shuffle(confusables)) {
      if (!seen.has(c) && chosen.length < 3) { seen.add(c); chosen.push(c); }
    }
    for (const t of wrongTokens) {
      if (!seen.has(t.expected) && chosen.length < 3) { seen.add(t.expected); chosen.push(t.expected); }
    }
    for (const c of shuffle([...storyChars])) {
      if (!seen.has(c) && chosen.length < 3) { seen.add(c); chosen.push(c); }
    }
    while (chosen.length < 3) {
      const fallback = String.fromCharCode(0x4e00 + Math.floor(Math.random() * 200));
      if (!seen.has(fallback)) { seen.add(fallback); chosen.push(fallback); }
    }
    return chosen.slice(0, 3);
  };

  for (const token of shuffle(wrongTokens)) {
    if (questions.length >= 3) break;
    const distractors = buildDistractors(token.expected, new Set([token.char]));
    questions.push({
      id: questions.length + 1,
      question: `你讀成了「${token.char}」，正確的字應該是？`,
      correctAnswer: token.expected,
      options: shuffle([token.expected, ...distractors]),
      source: 'local',
    });
  }

  const usedChars = new Set(questions.map(q => q.correctAnswer));
  for (const ch of shuffle(missingChars)) {
    if (questions.length >= 3) break;
    if (usedChars.has(ch)) continue;
    usedChars.add(ch);
    const distractors = buildDistractors(ch, new Set());
    questions.push({
      id: questions.length + 1,
      question: `你漏讀了一個字，是下面哪一個？`,
      correctAnswer: ch,
      options: shuffle([ch, ...distractors]),
      source: 'local',
    });
  }

  return questions;
};

// ── Unified question type for rendering ──────────────────────────────────────

interface UnifiedQuestion {
  id: number;
  question: string;
  /** Index of the correct answer in options array */
  correctIndex: number;
  options: string[];
  explanation?: string;
  source: 'ai' | 'local';
}

/** Convert API question to unified format */
const fromApiQuestion = (q: ApiQuestion): UnifiedQuestion => ({
  id: q.id,
  question: q.question,
  correctIndex: q.correct_index,
  options: q.options,
  explanation: q.explanation,
  source: 'ai',
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
      if (result.source === 'ai' && result.questions.length > 0) {
        setQuestions(result.questions.map(fromApiQuestion));
      } else {
        // AI unavailable — fall back to local
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
