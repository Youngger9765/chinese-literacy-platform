/**
 * ZhuyinPhoneticGame — 注音聲韻覺識互動遊戲
 *
 * Implements phonological awareness exercises based on PRD §1139-1143.
 * Three game modes:
 *   - 聲母配對: Pick the correct initial (聲母) for a character
 *   - 韻母配對: Pick the correct final (韻母) for a character
 *   - 拼音合成: Tap bopomofo symbols in order to spell a character
 *
 * Uses the MOE dictionary batch API to fetch zhuyin for story characters.
 * Falls back gracefully when zhuyin data is unavailable.
 *
 * Refactored (issue-1859): pure logic extracted to zhuyinGameLogic.ts.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { lookupCharactersBatch } from '../../services/learningApi';
import { INITIALS, PRENUCLEAR, FINALS } from '../zhuyin/bopomoConstants';
import { Story } from '../../types';
import {
  CharZhuyin,
  parseZhuyin,
  shuffle,
  buildChoices,
  getInitialModeAnswer,
  getFinalModeAnswer,
  composeTargetSeq,
} from './zhuyinGameLogic';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface ZhuyinPhoneticGameProps {
  story: Story;
  /** Characters to practice. Defaults to first 12 Chinese chars in story. */
  practiceChars?: string[];
  onFinish: (score: number, total: number) => void;
  onBack: () => void;
}

type GameMode = 'initial' | 'final' | 'compose';
type AnswerState = 'idle' | 'correct' | 'wrong';

// ─────────────────────────────────────────────────────────────────────────────
// Loading / Error states
// ─────────────────────────────────────────────────────────────────────────────

function LoadingState() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center py-12 gap-4" role="status" aria-label="載入注音資料中">
      <div className="w-10 h-10 border-4 border-indigo-200 border-t-indigo-500 rounded-full animate-spin" aria-hidden="true" />
      <p className="text-sm text-gray-500">載入注音資料中…</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Mode intro card
// ─────────────────────────────────────────────────────────────────────────────

interface ModeSelectProps {
  charCount: number;
  onSelect: (mode: GameMode) => void;
  onBack: () => void;
}

function ModeSelect({ charCount, onSelect, onBack }: ModeSelectProps) {
  const modes: { id: GameMode; label: string; desc: string; icon: string }[] = [
    { id: 'initial', label: '選聲母', desc: '看字選出正確的聲母 ㄅㄆㄇ…', icon: '🔤' },
    { id: 'final',   label: '選韻母', desc: '看字選出正確的韻母 ㄚㄛㄜ…', icon: '🎵' },
    { id: 'compose', label: '拼音合成', desc: '把注音符號拼出正確的字音', icon: '🧩' },
  ];

  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-indigo-50 px-6 py-10">
      <div className="max-w-sm w-full bg-white rounded-3xl shadow-lg border border-indigo-100 p-8 flex flex-col items-center gap-6">
        <div className="w-16 h-16 rounded-full bg-indigo-100 flex items-center justify-center text-3xl select-none">
          🎮
        </div>
        <div className="text-center">
          <h2 className="text-xl font-bold text-gray-900 mb-1">注音拼讀練習</h2>
          <p className="text-sm text-gray-500">本課有 {charCount} 個字可以練習，請選擇模式</p>
        </div>
        <div className="w-full flex flex-col gap-3">
          {modes.map(m => (
            <button
              key={m.id}
              onClick={() => onSelect(m.id)}
              className="w-full flex items-center gap-4 px-5 py-4 rounded-2xl border border-indigo-100 hover:border-indigo-400 hover:bg-indigo-50 transition-all active:scale-95 text-left"
            >
              <span className="text-2xl select-none">{m.icon}</span>
              <div>
                <div className="font-bold text-gray-900 text-sm">{m.label}</div>
                <div className="text-xs text-gray-500">{m.desc}</div>
              </div>
            </button>
          ))}
        </div>
        <button
          onClick={onBack}
          className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
        >
          返回生字練習
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Score banner
// ─────────────────────────────────────────────────────────────────────────────

interface ScoreBannerProps {
  score: number;
  total: number;
  onFinish: () => void;
  onRetry: () => void;
}

function ScoreBanner({ score, total, onFinish, onRetry }: ScoreBannerProps) {
  const pct = total > 0 ? Math.round((score / total) * 100) : 0;
  const isGreat = pct >= 80;

  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-indigo-50 px-6 py-10">
      <div className="max-w-sm w-full bg-white rounded-3xl shadow-lg border border-indigo-100 p-8 flex flex-col items-center gap-5 text-center">
        <div className="text-5xl select-none">{isGreat ? '🌟' : '💪'}</div>
        <div>
          <h3 className="text-2xl font-bold text-gray-900">
            {isGreat ? '太厲害了！' : '繼續加油！'}
          </h3>
          <p className="text-gray-500 text-sm mt-1">
            {isGreat ? '幾乎全對，超級棒！' : '有答對一些，再試一次會更好'}
          </p>
        </div>
        <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-700 ${isGreat ? 'bg-emerald-500' : 'bg-indigo-400'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="w-full flex flex-col gap-3 mt-2">
          <button
            onClick={onRetry}
            className="w-full py-2.5 rounded-full font-bold text-sm bg-indigo-600 hover:bg-indigo-500 text-white shadow transition-all active:scale-95"
          >
            再玩一次
          </button>
          <button
            onClick={onFinish}
            className="w-full py-2.5 rounded-full font-semibold text-sm text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition-all active:scale-95"
          >
            返回生字練習
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// InitialGame — 聲母配對 or 韻母配對
// ─────────────────────────────────────────────────────────────────────────────

interface PickGameProps {
  mode: 'initial' | 'final';
  questions: CharZhuyin[];
  onFinish: (score: number, total: number) => void;
  onBack: () => void;
}

function PickGame({ mode, questions, onFinish, onBack }: PickGameProps) {
  const [qIdx, setQIdx] = useState(0);
  const [score, setScore] = useState(0);
  const [answerState, setAnswerState] = useState<AnswerState>('idle');
  const [selectedChoice, setSelectedChoice] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const q = questions[qIdx];

  // Build correct answer and choice pool for the current mode
  const correctAnswer = useMemo(() => {
    if (mode === 'initial') return getInitialModeAnswer(q);
    return getFinalModeAnswer(q);
  }, [q, mode]);

  const choicePool = useMemo(() => {
    if (mode === 'initial') {
      // Pool: all initials + prenuclear symbols
      return [...INITIALS, ...PRENUCLEAR];
    }
    // Final pool: all finals + medials + tones combined
    // Generate some common finals with tone variations
    const baseFinals = [
      ...FINALS.map(f => f),                // no tone = tone 1
      ...FINALS.map(f => f + 'ˊ'),
      ...FINALS.map(f => f + 'ˇ'),
      ...FINALS.map(f => f + 'ˋ'),
      ...PRENUCLEAR.map(p => p),
      ...PRENUCLEAR.map(p => p + 'ˊ'),
      ...PRENUCLEAR.map(p => p + 'ˇ'),
      ...PRENUCLEAR.map(p => p + 'ˋ'),
    ];
    return baseFinals;
  }, [mode]);

  const choices = useMemo(
    () => buildChoices(correctAnswer, choicePool),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [qIdx, mode],
  );

  const handleChoice = useCallback((choice: string) => {
    if (answerState !== 'idle') return;
    setSelectedChoice(choice);
    const isCorrect = choice === correctAnswer;
    setAnswerState(isCorrect ? 'correct' : 'wrong');
    if (isCorrect) setScore(s => s + 1);

    timerRef.current = setTimeout(() => {
      if (qIdx + 1 >= questions.length) {
        onFinish(isCorrect ? score + 1 : score, questions.length);
      } else {
        setQIdx(i => i + 1);
        setAnswerState('idle');
        setSelectedChoice(null);
      }
    }, 900);
  }, [answerState, correctAnswer, qIdx, questions.length, score, onFinish]);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const modeLabel = mode === 'initial' ? '聲母' : '韻母';
  const progress = `${qIdx + 1} / ${questions.length}`;

  return (
    <div className="flex-1 flex flex-col bg-indigo-50">
      {/* Header */}
      <div className="h-9 bg-white border-b border-gray-200 flex items-center px-4 gap-2 shrink-0">
        <button
          onClick={onBack}
          aria-label="返回生字練習"
          className="text-gray-400 hover:text-gray-700 transition-colors p-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <span className="text-xs text-gray-700 font-semibold flex-1">選{modeLabel}練習</span>
        <span className="text-xs text-gray-400" aria-label={`第 ${qIdx + 1} 題，共 ${questions.length} 題`}>{progress}</span>
      </div>

      {/* Progress bar */}
      <div
        role="progressbar"
        aria-valuenow={qIdx + 1}
        aria-valuemin={1}
        aria-valuemax={questions.length}
        aria-label={`練習進度：第 ${qIdx + 1} 題，共 ${questions.length} 題`}
        className="w-full h-1.5 bg-gray-200"
      >
        <div
          className="h-full bg-indigo-500 transition-all duration-500"
          style={{ width: `${((qIdx) / questions.length) * 100}%` }}
        />
      </div>

      {/* Main area */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 gap-8">

        {/* Question prompt */}
        <div className="text-center space-y-2">
          <p className="text-sm text-gray-500 font-medium">
            這個字的<span className="text-indigo-600 font-bold">{modeLabel}</span>是哪個？
          </p>
          {/* Character display */}
          <div className="w-32 h-32 mx-auto bg-white rounded-3xl shadow-md border border-indigo-100 flex flex-col items-center justify-center gap-1">
            <span className="text-6xl font-bold text-gray-900 leading-none">{q.char}</span>
            <span className="text-xs text-gray-400 mt-1">{q.zhuyin}</span>
          </div>
        </div>

        {/* Feedback flash */}
        {answerState !== 'idle' && (
          <div className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold animate-slide-up-fast ${
            answerState === 'correct'
              ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
              : 'bg-red-100 text-red-700 border border-red-200'
          }`}>
            {answerState === 'correct' ? '答對了！真棒！' : `正確答案是「${correctAnswer}」`}
          </div>
        )}

        {/* Choice buttons */}
        <div className="grid grid-cols-2 gap-4 w-full max-w-xs">
          {choices.map(choice => {
            const isSelected = selectedChoice === choice;
            const isCorrectChoice = choice === correctAnswer;
            let btnClass = 'flex items-center justify-center h-16 rounded-2xl text-2xl font-bold border-2 transition-all active:scale-95 ';
            if (answerState === 'idle') {
              btnClass += 'bg-white border-indigo-200 text-gray-800 hover:bg-indigo-50 hover:border-indigo-400';
            } else if (isCorrectChoice) {
              btnClass += 'bg-emerald-100 border-emerald-500 text-emerald-800';
            } else if (isSelected) {
              btnClass += 'bg-red-100 border-red-400 text-red-700';
            } else {
              btnClass += 'bg-white border-gray-200 text-gray-400';
            }
            return (
              <button
                key={choice}
                onClick={() => handleChoice(choice)}
                disabled={answerState !== 'idle'}
                aria-label={`選擇 ${choice}${answerState !== 'idle' && isCorrectChoice ? '（正確答案）' : answerState !== 'idle' && isSelected && !isCorrectChoice ? '（答錯）' : ''}`}
                aria-pressed={isSelected ? true : undefined}
                className={btnClass}
              >
                {choice}
              </button>
            );
          })}
        </div>

        {/* Encouragement — Issue #1094: 學生端不顯示得分數字 */}
        <p className="text-xs text-gray-400">繼續加油！</p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ComposeGame — 拼音合成: tap bopomofo symbols in order
// ─────────────────────────────────────────────────────────────────────────────

interface ComposeGameProps {
  questions: CharZhuyin[];
  onFinish: (score: number, total: number) => void;
  onBack: () => void;
}

function ComposeGame({ questions, onFinish, onBack }: ComposeGameProps) {
  const [qIdx, setQIdx] = useState(0);
  const [score, setScore] = useState(0);
  const [tapped, setTapped] = useState<string[]>([]);
  const [answerState, setAnswerState] = useState<AnswerState>('idle');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const q = questions[qIdx];

  // Target sequence: [initial, medial, finalPart, tone] — non-empty parts
  const targetSeq = useMemo(() => composeTargetSeq(q), [q]);

  // Build a palette of symbols to tap from
  const palette = useMemo(() => {
    const correct = new Set(targetSeq);
    // Add distractors: pick random symbols from pools not in correct set
    const distractorPool = shuffle([
      ...INITIALS.filter(x => !correct.has(x)),
      ...PRENUCLEAR.filter(x => !correct.has(x)),
      ...FINALS.filter(x => !correct.has(x)),
      ...['ˊ', 'ˇ', 'ˋ'].filter(x => !correct.has(x)),
    ]);
    const distractors = distractorPool.slice(0, Math.max(0, 8 - targetSeq.length));
    return shuffle([...targetSeq, ...distractors]);
  }, [targetSeq]);

  const handleTap = useCallback((sym: string) => {
    if (answerState !== 'idle') return;
    const next = [...tapped, sym];
    setTapped(next);

    // Check if length matches target
    if (next.length === targetSeq.length) {
      const isCorrect = next.join('') === targetSeq.join('');
      setAnswerState(isCorrect ? 'correct' : 'wrong');
      if (isCorrect) setScore(s => s + 1);

      timerRef.current = setTimeout(() => {
        const newScore = isCorrect ? score + 1 : score;
        if (qIdx + 1 >= questions.length) {
          onFinish(newScore, questions.length);
        } else {
          setQIdx(i => i + 1);
          setTapped([]);
          setAnswerState('idle');
        }
      }, 1000);
    }
  }, [answerState, tapped, targetSeq, score, qIdx, questions.length, onFinish]);

  const handleClear = useCallback(() => {
    if (answerState !== 'idle') return;
    setTapped([]);
  }, [answerState]);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const progress = `${qIdx + 1} / ${questions.length}`;

  return (
    <div className="flex-1 flex flex-col bg-indigo-50">
      {/* Header */}
      <div className="h-9 bg-white border-b border-gray-200 flex items-center px-4 gap-2 shrink-0">
        <button
          onClick={onBack}
          aria-label="返回生字練習"
          className="text-gray-400 hover:text-gray-700 transition-colors p-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <span className="text-xs text-gray-700 font-semibold flex-1">拼音合成練習</span>
        <span className="text-xs text-gray-400" aria-label={`第 ${qIdx + 1} 題，共 ${questions.length} 題`}>{progress}</span>
      </div>

      {/* Progress bar */}
      <div
        role="progressbar"
        aria-valuenow={qIdx + 1}
        aria-valuemin={1}
        aria-valuemax={questions.length}
        aria-label={`練習進度：第 ${qIdx + 1} 題，共 ${questions.length} 題`}
        className="w-full h-1.5 bg-gray-200"
      >
        <div
          className="h-full bg-indigo-500 transition-all duration-500"
          style={{ width: `${(qIdx / questions.length) * 100}%` }}
        />
      </div>

      {/* Main area */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 gap-6">

        {/* Prompt */}
        <div className="text-center space-y-3">
          <p className="text-sm text-gray-500">
            按順序拼出這個字的注音
          </p>
          <div className="w-28 h-28 mx-auto bg-white rounded-3xl shadow-md border border-indigo-100 flex items-center justify-center">
            <span className="text-5xl font-bold text-gray-900">{q.char}</span>
          </div>
        </div>

        {/* Answer slots */}
        <div className="flex items-center gap-2">
          {targetSeq.map((part, i) => {
            const filled = tapped[i];
            const stateClass = answerState === 'idle'
              ? filled
                ? 'bg-indigo-100 border-indigo-400 text-indigo-700'
                : 'bg-white border-dashed border-indigo-300 text-transparent'
              : answerState === 'correct'
                ? 'bg-emerald-100 border-emerald-400 text-emerald-700'
                : 'bg-red-100 border-red-400 text-red-700';
            return (
              <div
                key={i}
                className={`w-12 h-12 flex items-center justify-center rounded-xl border-2 text-xl font-bold transition-all duration-200 ${stateClass}`}
              >
                {filled || '?'}
              </div>
            );
          })}
        </div>

        {/* Feedback */}
        {answerState !== 'idle' && (
          <div className={`flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold animate-slide-up-fast ${
            answerState === 'correct'
              ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
              : 'bg-red-100 text-red-700 border border-red-200'
          }`}>
            {answerState === 'correct'
              ? '拼對了！'
              : `正確是「${targetSeq.join('')}」`}
          </div>
        )}

        {/* Symbol palette */}
        <div className="flex flex-wrap justify-center gap-2 max-w-xs">
          {palette.map((sym, i) => (
            <button
              key={`${sym}-${i}`}
              onClick={() => handleTap(sym)}
              disabled={answerState !== 'idle' || tapped.includes(sym)}
              className={`w-11 h-11 rounded-xl border-2 text-lg font-bold transition-all active:scale-90 ${
                tapped.includes(sym)
                  ? 'bg-indigo-200 border-indigo-300 text-indigo-400 opacity-50'
                  : 'bg-white border-indigo-200 text-gray-800 hover:bg-indigo-50 hover:border-indigo-400'
              }`}
            >
              {sym}
            </button>
          ))}
        </div>

        {/* Clear + score row */}
        <div className="flex items-center gap-4">
          <button
            onClick={handleClear}
            disabled={answerState !== 'idle' || tapped.length === 0}
            className="px-4 py-1.5 rounded-lg text-xs font-semibold text-gray-500 hover:text-gray-800 hover:bg-gray-100 disabled:opacity-40 transition-all"
          >
            清除重拼
          </button>
          <span className="text-xs text-gray-400">加油！</span>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

const ZhuyinPhoneticGame: React.FC<ZhuyinPhoneticGameProps> = ({
  story,
  practiceChars,
  onFinish,
  onBack,
}) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [charData, setCharData] = useState<CharZhuyin[]>([]);
  const [phase, setPhase] = useState<'mode-select' | GameMode | 'score'>('mode-select');
  const [activeMode, setActiveMode] = useState<GameMode>('initial');
  const [finalScore, setFinalScore] = useState({ score: 0, total: 0 });

  // Derive practice characters from story content if not provided
  const targetChars = useMemo(() => {
    if (practiceChars && practiceChars.length > 0) return practiceChars.slice(0, 12);
    const seen = new Set<string>();
    const chars: string[] = [];
    for (const line of story.content) {
      for (const ch of line) {
        if (/[\u4e00-\u9fa5]/.test(ch) && !seen.has(ch)) {
          chars.push(ch);
          seen.add(ch);
        }
      }
    }
    return chars.slice(0, 12);
  }, [story.content, practiceChars]);

  // Fetch zhuyin via batch API
  useEffect(() => {
    if (targetChars.length === 0) {
      setLoading(false);
      setError('找不到可練習的字');
      return;
    }

    setLoading(true);
    setError(null);

    lookupCharactersBatch(targetChars)
      .then(res => {
        const data: CharZhuyin[] = [];
        for (const entry of res.results) {
          if (!entry.not_found && entry.zhuyin) {
            const parsed = parseZhuyin(entry.zhuyin);
            data.push({
              char: entry.character,
              zhuyin: entry.zhuyin,
              ...parsed,
            });
          }
        }
        if (data.length === 0) {
          setError('注音資料暫時無法取得，請稍後再試');
        } else {
          setCharData(data);
        }
      })
      .catch(() => setError('注音資料載入失敗，請確認網路連線'))
      .finally(() => setLoading(false));
  }, [targetChars]);

  // Build questions for the active mode (filter chars that have the needed part)
  const questions = useMemo(() => {
    let filtered = charData;
    if (activeMode === 'initial') {
      // Need at least initial or medial
      filtered = charData.filter(c => c.initial || c.medial);
    } else if (activeMode === 'final') {
      // Need finalPart or medial
      filtered = charData.filter(c => c.finalPart || c.medial);
    }
    // Shuffle for variety
    return shuffle(filtered);
  }, [charData, activeMode]);

  const handleModeSelect = (mode: GameMode) => {
    setActiveMode(mode);
    setPhase(mode);
  };

  const handleGameFinish = (score: number, total: number) => {
    setFinalScore({ score, total });
    setPhase('score');
  };

  const handleFinish = () => {
    onFinish(finalScore.score, finalScore.total);
  };

  const handleRetry = () => {
    setPhase(activeMode);
  };

  if (loading) return <LoadingState />;

  if (error) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6 gap-4">
        <div className="text-4xl select-none">😅</div>
        <p className="text-sm text-gray-500 text-center">{error}</p>
        <button
          onClick={onBack}
          className="px-6 py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-sm font-semibold text-gray-700 transition-all"
        >
          返回
        </button>
      </div>
    );
  }

  if (phase === 'mode-select') {
    return (
      <ModeSelect
        charCount={charData.length}
        onSelect={handleModeSelect}
        onBack={onBack}
      />
    );
  }

  if (phase === 'score') {
    return (
      <ScoreBanner
        score={finalScore.score}
        total={finalScore.total}
        onFinish={handleFinish}
        onRetry={handleRetry}
      />
    );
  }

  if (questions.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6 gap-4">
        <p className="text-sm text-gray-500 text-center">
          這一課的生字沒有足夠的{activeMode === 'initial' ? '聲母' : activeMode === 'final' ? '韻母' : '注音'}資料
        </p>
        <button
          onClick={() => setPhase('mode-select')}
          className="px-6 py-2.5 rounded-xl bg-indigo-100 hover:bg-indigo-200 text-sm font-semibold text-indigo-700 transition-all"
        >
          換個模式
        </button>
      </div>
    );
  }

  if (phase === 'initial' || phase === 'final') {
    return (
      <PickGame
        mode={phase}
        questions={questions}
        onFinish={handleGameFinish}
        onBack={() => setPhase('mode-select')}
      />
    );
  }

  if (phase === 'compose') {
    return (
      <ComposeGame
        questions={questions}
        onFinish={handleGameFinish}
        onBack={() => setPhase('mode-select')}
      />
    );
  }

  return null;
};

export default ZhuyinPhoneticGame;
