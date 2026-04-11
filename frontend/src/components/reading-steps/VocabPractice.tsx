import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Story, ReadingAttempt, VocabResult } from '../../types';
import { hasStrokeData } from '../stroke-order/strokeData';
import WriteCharacter from '../stroke-order/WriteCharacter';
import PronunciationPractice from './PronunciationPractice';
import SentencePractice from './SentencePractice';
import ZhuyinPhoneticGame from './ZhuyinPhoneticGame';
import { useZhuyin } from '../../context/ZhuyinContext';
import RadicalDecomposition from './RadicalDecomposition';
import { getDecomposition, initGeneratedDecompositions, initRadicalMeanings } from '../../data/radicals';
import DictionaryPanel from '../dictionary/DictionaryPanel';
import FillInBlankExercise from './FillInBlankExercise';
import { scopedStepStorageKey } from '../../services/learningStorageScope';

interface VocabPracticeProps {
  story: Story;
  attempt: ReadingAttempt | null;
  onFinish: (result: VocabResult) => void;
  onBack: () => void;
}

type Phase = 'grid' | 'practice' | 'pronunciation' | 'zhuyin-game';

type PracticeMode = 'radical' | 'stroke' | 'pronunciation' | 'zhuyin' | 'fillinblank' | 'sentence';

/* ================================================================ */
/*  Progress bar                                                     */
/* ================================================================ */

interface ProgressBarProps {
  done: number;
  total: number;
}

function ProgressBar({ done, total }: ProgressBarProps) {
  if (total === 0) return null;
  const pct = Math.round((done / total) * 100);
  return (
    <div className="w-full px-6 py-2 bg-white border-b border-gray-100">
      <div className="max-w-2xl mx-auto">
        <div className="flex justify-between items-center mb-1">
          <span className="text-xs font-medium text-gray-500" aria-hidden="true">練習進度</span>
          <span className="text-xs font-bold text-gray-700" aria-hidden="true">{done} / {total} 字</span>
        </div>
        <div
          role="progressbar"
          aria-valuenow={done}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-label={`生字練習進度：已完成 ${done} 個，共 ${total} 個`}
          className="h-2 bg-gray-100 rounded-full overflow-hidden"
        >
          <div
            className="h-full bg-emerald-500 rounded-full transition-all duration-500 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </div>
  );
}

/* ================================================================ */
/*  Completion celebration                                           */
/* ================================================================ */

interface CompletionBannerProps {
  count: number;
  onFinish: () => void;
}

function CompletionBanner({ count, onFinish }: CompletionBannerProps) {
  return (
    <div className="animate-slide-up bg-gradient-to-br from-emerald-50 to-teal-50 border-2 border-emerald-300 rounded-2xl p-6 text-center space-y-3 shadow-lg">
      <div className="flex justify-center gap-2 text-3xl select-none animate-pop">
        <span>🌟</span><span>🎉</span><span>🌟</span>
      </div>
      <h3 className="text-2xl font-bold text-emerald-800">全部完成！</h3>
      <p className="text-emerald-700 text-sm">
        你練習了 <span className="font-bold text-emerald-900">{count}</span> 個生字，太厲害了！
      </p>
      <button
        onClick={onFinish}
        className="w-full max-w-xs mx-auto mt-2 px-6 py-2.5 rounded-full font-bold text-sm bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2"
      >
        查看學習報告
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>
    </div>
  );
}

/* ================================================================ */
/*  Character card                                                   */
/* ================================================================ */

interface CharCardProps {
  label: string;
  isSuggested: boolean;
  isPracticed: boolean;
  animDelay: number;
  onClick: () => void;
}

function CharCard({ label, isSuggested, isPracticed, animDelay, onClick }: CharCardProps) {
  return (
    <button
      onClick={onClick}
      className={[
        'relative flex flex-col items-center justify-center aspect-square rounded-2xl border transition-all duration-200 active:scale-90 animate-card-in',
        isPracticed
          ? 'bg-emerald-50 border-emerald-400/70 text-emerald-800 shadow-sm'
          : isSuggested
            ? 'bg-amber-50 border-amber-500/60 text-amber-800 ring-1 ring-amber-400/30 hover:bg-amber-100 hover:border-amber-500 shadow-md hover:shadow-lg hover:-translate-y-0.5'
            : 'bg-white border-gray-200 text-gray-800 hover:bg-gray-50 hover:border-accent/40 hover:shadow-md hover:-translate-y-0.5',
      ].join(' ')}
      style={{ animationDelay: `${animDelay}ms`, opacity: 0 }}
    >
      <span className="text-3xl font-bold leading-none py-2">{label}</span>

      {isSuggested && !isPracticed && (
        <span className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 bg-amber-500 rounded-full border-2 border-white shadow-sm" />
      )}

      {isPracticed && (
        <span className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-emerald-500 rounded-full flex items-center justify-center border-2 border-white shadow-sm animate-pop">
          <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
          </svg>
        </span>
      )}

      <span className="text-xs mt-1 opacity-50 font-medium">
        {isPracticed ? '已完成' : '點我練習'}
      </span>
    </button>
  );
}

/* ================================================================ */
/*  Main component                                                   */
/* ================================================================ */

const VocabPractice: React.FC<VocabPracticeProps> = ({ story, attempt, onFinish, onBack }) => {
  // Load generated decomposition data so getDecomposition() covers 2700+ chars
  const [decompReady, setDecompReady] = useState(false);
  useEffect(() => {
    Promise.all([initGeneratedDecompositions(), initRadicalMeanings()]).then(() => setDecompReady(true));
  }, []);
  const storageKey = scopedStepStorageKey('vocabPractice_progress_', story.id);
  const loadSaved = () => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return null;
      return JSON.parse(raw) as { practicedChars: string[]; phase: Phase; practicingChar: string };
    } catch { return null; }
  };
  const savedProgress = useRef(loadSaved());

  const [phase, setPhase] = useState<Phase>('grid');
  const [practicingChar, setPracticingChar] = useState(savedProgress.current?.practicingChar ?? '');
  const [practicedChars, setPracticedChars] = useState<Set<string>>(
    () => new Set(savedProgress.current?.practicedChars ?? [])
  );
  const [pronouncedChars, setPronoucedChars] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<PracticeMode>('radical');
  /** Character whose radical panel is currently open */
  const [radicalChar, setRadicalChar] = useState<string | null>(null);
  const [justCompleted, setJustCompleted] = useState('');

  const { zhuyinActive, processZhuyin } = useZhuyin();

  // ── localStorage persistence ────────────────────────────────────────
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify({
        practicedChars: Array.from(practicedChars),
        phase,
        practicingChar,
      }));
    } catch {}
  }, [practicedChars, phase, practicingChar, storageKey]);

  const needPracticeSet = useMemo(
    () => new Set(attempt?.mispronouncedWords ?? []),
    [attempt?.mispronouncedWords],
  );

  const displayChars = useMemo(() => {
    const suggested = (attempt?.mispronouncedWords ?? []).filter(hasStrokeData);

    if (suggested.length > 0) {
      return suggested.slice(0, 12);
    }

    const seen = new Set<string>();
    const optional: string[] = [];
    for (const line of story.content) {
      for (const ch of line) {
        if (/[\u4e00-\u9fa5]/.test(ch) && hasStrokeData(ch) && !seen.has(ch)) {
          optional.push(ch);
          seen.add(ch);
        }
      }
    }
    return optional.slice(0, 12);
  }, [story.content, attempt?.mispronouncedWords]);

  // Vocabulary words for sentence practice — use whole words as units (Issue #927)
  // These match the cache keys in example_sentence_cache.json
  const vocabWords = useMemo(() => {
    const seen = new Set<string>();
    const words: string[] = [];
    for (const item of story.vocabulary ?? []) {
      const w = item.word.trim();
      if (w && !seen.has(w)) {
        words.push(w);
        seen.add(w);
      }
    }
    return words;
  }, [story.vocabulary]);

  // Pronunciation tab: all characters are candidates (no stroke-data filter needed)
  const pronunciationChars = useMemo(() => {
    const suggested = (attempt?.mispronouncedWords ?? []).filter(ch => /[\u4e00-\u9fa5]/.test(ch));
    if (suggested.length > 0) return suggested.slice(0, 12);
    const seen = new Set<string>();
    const optional: string[] = [];
    for (const line of story.content) {
      for (const ch of line) {
        if (/[\u4e00-\u9fa5]/.test(ch) && !seen.has(ch)) {
          optional.push(ch);
          seen.add(ch);
        }
      }
    }
    return optional.slice(0, 12);
  }, [story.content, attempt?.mispronouncedWords]);

  const handlePractice = (ch: string, mode: PracticeMode = 'stroke') => {
    setPracticingChar(ch);
    // Only 'stroke' launches WriteCharacter; all other modes (including
    // 'radical', 'sentence', etc.) are tab-based inline panels, not a
    // full-screen phase. Guard: any mode that isn't 'stroke' or 'pronunciation'
    // falls through to 'practice' (WriteCharacter) as the safe default.
    // Also pin activeTab so returning from WriteCharacter always lands on the
    // correct tab (fixes #854: clicking stroke-tab card returned to 部件 tab).
    if (mode === 'stroke') {
      setActiveTab('stroke');
      setPhase('practice');
    } else if (mode === 'pronunciation') {
      setActiveTab('pronunciation');
      setPhase('pronunciation');
    } else {
      setActiveTab('stroke');
      setPhase('practice');
    }
    setJustCompleted('');
  };

  const handlePracticeComplete = () => {
    const ch = practicingChar;
    setPracticedChars(prev => new Set(prev).add(ch));
    setJustCompleted(ch);
    // Always return to the stroke tab after completing WriteCharacter (#854)
    setActiveTab('stroke');
    setPhase('grid');
  };

  const handlePronunciationComplete = () => {
    setPronoucedChars(prev => new Set(prev).add(practicingChar));
    setActiveTab('pronunciation');
    setPhase('grid');
  };

  const handlePracticeBack = () => {
    // Return to the stroke tab after backing out of WriteCharacter (#854)
    setActiveTab('stroke');
    setPhase('grid');
  };

  const handleFinish = (result: VocabResult) => {
    // Keep completion record — only clear on explicit redo
    onFinish(result);
  };

  /** Toggle the radical panel for a character. Long-press / secondary action. */
  const handleRadicalToggle = (ch: string) => {
    setRadicalChar(prev => (prev === ch ? null : ch));
  };

  // ── Derived state (must stay BEFORE conditional returns to satisfy Rules of Hooks) ──
  const strokeDone = displayChars.length > 0 && displayChars.every(ch => practicedChars.has(ch));
  const pronounceDone = displayChars.length > 0 && displayChars.every(ch => pronouncedChars.has(ch));
  const allDone = strokeDone && pronounceDone;

  const currentChars = activeTab === 'stroke' ? displayChars : activeTab === 'pronunciation' ? pronunciationChars : [];
  const currentPracticedSet = activeTab === 'stroke' ? practicedChars : activeTab === 'pronunciation' ? pronouncedChars : new Set<string>();
  const currentDone = activeTab === 'stroke' ? strokeDone : activeTab === 'pronunciation' ? pronounceDone : false;

  // Characters for which we have radical decomposition data (re-filter after generated data loads)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const charsWithRadical = useMemo(() => displayChars.filter(ch => getDecomposition(ch) !== null), [displayChars, decompReady]);

  /* ── Pronunciation practice phase ── */
  if (phase === 'pronunciation') {
    const zhuyinStr = zhuyinActive ? processZhuyin(practicingChar) : undefined;
    return (
      <PronunciationPractice
        character={practicingChar}
        zhuyin={zhuyinStr !== practicingChar ? zhuyinStr : undefined}
        onComplete={handlePronunciationComplete}
        onBack={handlePracticeBack}
      />
    );
  }

  /* ── Practice phase: WriteCharacter fills the whole view ── */
  if (phase === 'practice') {
    return (
      <WriteCharacter
        character={practicingChar}
        onComplete={handlePracticeComplete}
        onBack={handlePracticeBack}
      />
    );
  }

  /* ── Zhuyin phonetic game phase ── */
  if (phase === 'zhuyin-game') {
    return (
      <ZhuyinPhoneticGame
        story={story}
        onFinish={() => setPhase('grid')}
        onBack={() => setPhase('grid')}
      />
    );
  }

  /* ── Grid phase: character selection ── */

  return (
    <div
      className="flex-1 flex flex-col bg-amber-50 overflow-hidden"
      style={{
        fontFamily: zhuyinActive
          ? "'BpmfIansui', 'Iansui', 'Noto Sans TC', sans-serif"
          : "'Iansui', 'Noto Sans TC', sans-serif",
      }}
    >
      {/* Progress bar */}
      <ProgressBar done={practicedChars.size} total={displayChars.length} />

      {/* Main content */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-2xl mx-auto space-y-6">

          {/* Header */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-xl font-bold text-gray-900">生字練習</h2>
              <span className="text-xs text-gray-500">
                {activeTab === 'radical'
                  ? `部件 ${charsWithRadical.length} 字`
                  : activeTab === 'stroke'
                    ? `筆順 ${practicedChars.size} / ${displayChars.length}`
                    : activeTab === 'pronunciation'
                      ? `發音 ${pronouncedChars.size} / ${pronunciationChars.length}`
                      : activeTab === 'fillinblank'
                        ? '語詞應用'
                        : activeTab === 'sentence'
                          ? '造句練習'
                          : '注音遊戲'}
              </span>
            </div>

            <p className="text-sm text-gray-600">
              {attempt === null || needPracticeSet.size === 0
                ? '以下是這篇課文的生字，點一點來練習筆順吧！'
                : `以下 ${Math.min(needPracticeSet.size, 12)} 個字可以再練習看看，選一個模式開始練習吧！`}
            </p>
          </div>

          {/* Mode toggle tabs */}
          <div className="flex bg-gray-100 rounded-xl p-1 gap-1">
            <button
              onClick={() => setActiveTab('radical')}
              className={[
                'flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-semibold transition-all',
                activeTab === 'radical'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700',
              ].join(' ')}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
              </svg>
              部件學習
            </button>
            <button
              onClick={() => setActiveTab('stroke')}
              className={[
                'flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-semibold transition-all',
                activeTab === 'stroke'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700',
              ].join(' ')}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
              </svg>
              筆順練習
              {strokeDone && <span className="w-2 h-2 bg-emerald-500 rounded-full" />}
            </button>
            <button
              onClick={() => setActiveTab('sentence')}
              className={[
                'flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-semibold transition-all',
                activeTab === 'sentence'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700',
              ].join(' ')}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-3 3v-3z" />
              </svg>
              造句練習
            </button>
            {/* 發音練習 and 注音遊戲 tabs hidden per product decision 2026-03-27 */}
            {/* 語詞應用 tab removed — now a separate step (#668 VocabApplication) */}
          </div>

          {/* 語詞應用 panel removed — now a separate step */}

          {/* Zhuyin phonetic game entry card */}
          {activeTab === 'zhuyin' && (
            <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-5 flex flex-col items-center gap-4 text-center">
              <div className="text-4xl select-none">🎮</div>
              <div>
                <h3 className="font-semibold text-gray-900 text-base mb-1">注音聲韻覺識遊戲</h3>
                <p className="text-xs text-gray-500 leading-relaxed">
                  練習聲母、韻母配對與拼音合成，<br />鞏固本課生字的注音能力
                </p>
              </div>
              <button
                onClick={() => setPhase('zhuyin-game')}
                className="w-full max-w-xs py-2.5 rounded-full font-bold text-sm bg-indigo-600 hover:bg-indigo-500 text-white shadow transition-all active:scale-95"
              >
                開始注音遊戲
              </button>
            </div>
          )}

          {/* Just-completed flash — only shown on stroke/pronunciation tabs */}
          {justCompleted && activeTab !== 'zhuyin' && (
            <div className="flex items-center gap-2 px-4 py-2.5 bg-emerald-50 border border-emerald-200 rounded-xl text-sm text-emerald-700 animate-slide-up-fast">
              <svg className="w-4 h-4 text-emerald-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
              <span>「<strong>{justCompleted}</strong>」練習完成！繼續加油！</span>
            </div>
          )}

          {/* Radical/component learning tab */}
          {activeTab === 'radical' && (
            <div className="space-y-4">
              {displayChars.map(ch => {
                const hasDecomp = getDecomposition(ch) !== null;
                if (!hasDecomp) {
                  return (
                    <div key={ch} className="flex items-center gap-3 px-4 py-3 bg-gray-50 rounded-xl border border-gray-200">
                      <span className="text-2xl font-bold text-gray-400">{ch}</span>
                      <span className="text-sm text-gray-400">此字目前無部件資料</span>
                    </div>
                  );
                }
                return <RadicalDecomposition key={ch} char={ch} />;
              })}
            </div>
          )}

          {/* Sentence practice — inline tab panel */}
          {activeTab === 'sentence' && (
            <SentencePractice
              practicedWords={vocabWords.length > 0 ? vocabWords : displayChars}
              storyTitle={story.title}
              onFinish={() => handleFinish({ practicedWords: vocabWords, totalWords: vocabWords.length })}
              onBack={() => setActiveTab('stroke')}
              inline
            />
          )}

          {/* Character grid — hidden when zhuyin, fillinblank, or sentence tab is active */}
          {activeTab !== 'zhuyin' && activeTab !== 'fillinblank' && activeTab !== 'sentence' && activeTab !== 'radical' && <>{/* Character grid */}
          {currentChars.length === 0 ? (
            <div className="text-gray-400 text-sm py-8 text-center">
              {activeTab === 'stroke'
                ? '這篇課文的漢字沒有筆順資料'
                : '沒有生字資料'}
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
              {currentChars.map((ch, idx) => {
                const isSuggested = needPracticeSet.has(ch);
                const isPracticed = currentPracticedSet.has(ch);
                const isRadicalOpen = false; // radical button removed — now a separate tab
                return (
                  <div key={ch} className="flex flex-col gap-1">
                    <button
                      onClick={() => handlePractice(ch, activeTab === 'stroke' ? 'stroke' : 'pronunciation')}
                      className={[
                        `relative flex flex-col items-center justify-center w-full ${zhuyinActive ? 'aspect-[3/6]' : 'aspect-square'} rounded-2xl border transition-all active:scale-95 animate-card-in`,
                        isPracticed
                          ? 'bg-emerald-50 border-emerald-700/50 text-emerald-800'
                          : isSuggested
                            ? 'bg-amber-900/30 border-amber-600/60 text-amber-700 ring-1 ring-amber-500/30 hover:bg-amber-900/50'
                            : 'bg-white border-gray-200 text-gray-800 hover:bg-gray-100 hover:border-accent/40',
                      ].join(' ')}
                      style={{ animationDelay: `${idx * 40}ms`, opacity: 0 }}
                    >
                      <span className={`text-3xl font-bold leading-[3.5rem] lg:leading-[3.5rem] ${zhuyinActive ? 'tracking-[0.2em]' : ''}`}>
                        {processZhuyin(ch)}
                      </span>

                      {/* Suggested badge */}
                      {isSuggested && !isPracticed && (
                        <span className="absolute -top-1 -right-1 w-3 h-3 bg-amber-500 rounded-full border-2 border-[#0d1117]" />
                      )}

                      {/* Done checkmark */}
                      {isPracticed && (
                        <span className="absolute -top-1 -right-1 w-4 h-4 bg-emerald-500 rounded-full flex items-center justify-center border-2 border-[#0d1117] animate-pop">
                          <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
                          </svg>
                        </span>
                      )}

                      <span className="text-xs mt-1 opacity-60">
                        {isPracticed ? '已練習' : '點我練習'}
                      </span>
                    </button>

                    {/* Radical button removed — 部件學習 is now a separate tab */}
                  </div>
                );
              })}
            </div>
          )}

          {/* 教育部國語辭典 panel removed per product decision 2026-03-27 */}

          {/* Legend */}
          <div className="flex items-center gap-4 text-xs text-gray-400 flex-wrap">
            {needPracticeSet.size > 0 && (
              <>
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 bg-amber-500 rounded-full" />
                  建議練習
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 bg-emerald-500 rounded-full" />
                  已完成
                </div>
              </>
            )}
            {/* 部件 legend removed — now a separate tab */}
          </div>

          {/* Radical panel removed — now a separate tab */}

          {/* Usage hint */}
          {currentChars.length > 0 && (
            <p className="text-xs text-gray-400 text-center">
              點一下字卡即可練習{activeTab === 'stroke' ? '筆順' : '發音'}
            </p>
          )}

          {/* Completion message per tab */}
          {currentDone && (
            <div className="bg-emerald-50 border border-emerald-300 rounded-2xl p-4 text-center">
              <p className="text-emerald-800 font-bold">
                {activeTab === 'stroke'
                  ? '太棒了！所有筆順都練習完了！'
                  : '太棒了！所有發音都練習完了！'}
              </p>
              {!allDone && (
                <p className="text-emerald-600 text-sm mt-1">
                  試試看{activeTab === 'stroke' ? '發音練習' : '筆順練習'}吧！
                </p>
              )}
            </div>
          )}

          {/* Sentence practice prompt when all done */}
          {allDone && (
            <div className="bg-emerald-50 border border-emerald-300 rounded-2xl p-4 text-center">
              <p className="text-emerald-800 font-bold mb-2">太棒了！所有生字都練習完了！</p>
              <p className="text-emerald-700 text-sm mb-3">接下來，試著用這些生字各造兩個句子吧！</p>
              <button
                onClick={() => setActiveTab('sentence')}
                className="px-6 py-2.5 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm transition-all active:scale-95"
              >
                開始造句練習
              </button>
            </div>
          )}

          {allDone && (
            <CompletionBanner
              count={practicedChars.size}
              onFinish={() => handleFinish({ practicedWords: vocabWords, totalWords: vocabWords.length })}
            />
          )}
          </>}
        </div>
      </div>

      {/* Bottom actions */}
      <div className="flex-shrink-0 bg-white border-t border-gray-200 px-6 py-4 flex items-center justify-end">
        <button
          onClick={() => handleFinish({ practicedWords: vocabWords, totalWords: vocabWords.length })}
          className="px-6 py-2.5 rounded-full font-bold text-sm bg-accent hover:bg-accent-hover text-white shadow-lg transition-all active:scale-95 flex items-center gap-2"
        >
          {practicedChars.size > 0 || pronouncedChars.size > 0 ? '完成，查看報告' : '跳過，查看報告'}
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  );
};

export default VocabPractice;
