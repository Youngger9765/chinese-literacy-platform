
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Story, ReadingAttempt, VocabResult } from '../../types';
import { hasStrokeData } from '../stroke-order/strokeData';
import WriteCharacter from '../stroke-order/WriteCharacter';
import PronunciationPractice from './PronunciationPractice';
import SentencePractice from './SentencePractice';
import { PolyphonicProcessor, buildZhuyinString } from '../zhuyin/polyphonicProcessor';
import ZhuyinToggle from '../ui/ZhuyinToggle';
import RadicalDecomposition from './RadicalDecomposition';
import { getDecomposition } from '../../data/radicals';
import DictionaryPanel from '../dictionary/DictionaryPanel';

interface VocabPracticeProps {
  story: Story;
  attempt: ReadingAttempt;
  onFinish: (result: VocabResult) => void;
  onBack: () => void;
}

type Phase = 'grid' | 'practice' | 'pronunciation' | 'sentence';

type PracticeMode = 'stroke' | 'pronunciation';

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
          <span className="text-[10px] font-medium text-gray-500">練習進度</span>
          <span className="text-[10px] font-bold text-gray-700">{done} / {total} 字</span>
        </div>
        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
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
      <h3 className="text-2xl font-black text-emerald-800">全部完成！</h3>
      <p className="text-emerald-700 text-sm">
        你練習了 <span className="font-bold text-emerald-900">{count}</span> 個生字，太厲害了！
      </p>
      <button
        onClick={onFinish}
        className="w-full max-w-xs mx-auto mt-2 px-8 py-3.5 rounded-2xl font-bold text-base bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2"
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

      <span className="text-[9px] mt-1 opacity-50 font-medium">
        {isPracticed ? '已完成' : '點我練習'}
      </span>
    </button>
  );
}

/* ================================================================ */
/*  Main component                                                   */
/* ================================================================ */

const VocabPractice: React.FC<VocabPracticeProps> = ({ story, attempt, onFinish, onBack }) => {
  const [phase, setPhase] = useState<Phase>('grid');
  const [practicingChar, setPracticingChar] = useState('');
  const [practicedChars, setPracticedChars] = useState<Set<string>>(new Set());
  const [pronouncedChars, setPronoucedChars] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<PracticeMode>('stroke');
  const [zhuyinEnabled, setZhuyinEnabled] = useState(true);
  const [zhuyinReady, setZhuyinReady] = useState(false);
  /** Character whose radical panel is currently open */
  const [radicalChar, setRadicalChar] = useState<string | null>(null);
  const [selectedChar, setSelectedChar] = useState<string | null>(null);
  const [justCompleted, setJustCompleted] = useState('');

  const zhuyinActive = zhuyinReady && zhuyinEnabled;

  useEffect(() => {
    PolyphonicProcessor.instance.loadPolyphonicData()
      .then(() => setZhuyinReady(true))
      .catch((err) => console.error('Failed to load zhuyin data:', err));
  }, []);

  const processZhuyin = useCallback((text: string): string => {
    if (!zhuyinActive) return text;
    try {
      const processed = PolyphonicProcessor.instance.process(text);
      return buildZhuyinString(processed);
    } catch {
      return text;
    }
  }, [zhuyinActive]);

  const needPracticeSet = useMemo(
    () => new Set(attempt.mispronouncedWords),
    [attempt.mispronouncedWords],
  );

  const displayChars = useMemo(() => {
    const suggested = attempt.mispronouncedWords.filter(hasStrokeData);

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
  }, [story.content, attempt.mispronouncedWords]);

  // Pronunciation tab: all characters are candidates (no stroke-data filter needed)
  const pronunciationChars = useMemo(() => {
    const suggested = attempt.mispronouncedWords.filter(ch => /[\u4e00-\u9fa5]/.test(ch));
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
  }, [story.content, attempt.mispronouncedWords]);

  const handlePractice = (ch: string, mode: PracticeMode = 'stroke') => {
    setPracticingChar(ch);
    setPhase(mode === 'stroke' ? 'practice' : 'pronunciation');
    setJustCompleted('');
  };

  const handlePracticeComplete = () => {
    const ch = practicingChar;
    setPracticedChars(prev => new Set(prev).add(ch));
    setJustCompleted(ch);
    setPhase('grid');
  };

  const handlePronunciationComplete = () => {
    setPronoucedChars(prev => new Set(prev).add(practicingChar));
    setPhase('grid');
  };

  const handlePracticeBack = () => {
    setPhase('grid');
  };

  /** Toggle the radical panel for a character. Long-press / secondary action. */
  const handleRadicalToggle = (ch: string) => {
    setRadicalChar(prev => (prev === ch ? null : ch));
  };

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

  /* ── Sentence phase: compose sentences after stroke practice ── */
  if (phase === 'sentence') {
    return (
      <SentencePractice
        practicedChars={Array.from(practicedChars)}
        storyTitle={story.title}
        onFinish={() => onFinish({ practicedChars: Array.from(practicedChars), totalChars: displayChars.length })}
        onBack={() => setPhase('grid')}
      />
    );
  }

  /* ── Grid phase: character selection ── */
  const strokeDone = displayChars.length > 0 && displayChars.every(ch => practicedChars.has(ch));
  const pronounceDone = displayChars.length > 0 && displayChars.every(ch => pronouncedChars.has(ch));
  const allDone = strokeDone && pronounceDone;

  const currentChars = activeTab === 'stroke' ? displayChars : pronunciationChars;
  const currentPracticedSet = activeTab === 'stroke' ? practicedChars : pronouncedChars;
  const currentDone = activeTab === 'stroke' ? strokeDone : pronounceDone;

  // Characters for which we have radical decomposition data
  const charsWithRadical = displayChars.filter(ch => getDecomposition(ch) !== null);

  return (
    <div
      className="flex-1 flex flex-col bg-amber-50 overflow-hidden"
      style={{
        fontFamily: zhuyinActive
          ? "'BpmfIansui', 'Iansui', 'Noto Sans TC', sans-serif"
          : "'Iansui', 'Noto Sans TC', sans-serif",
      }}
    >
      {/* Tab bar */}
      <div className="h-9 bg-white border-b border-gray-200 flex items-center px-2 gap-2 shrink-0">
        <div className="h-full px-4 flex items-center bg-amber-50 border-t-2 border-accent border-x border-gray-200 text-xs text-gray-800 gap-2">
          {story.filename} — 生字練習
        </div>
        <div className="flex-1" />
        <span className="text-[10px] text-gray-500">
          {activeTab === 'stroke'
            ? `筆順 ${practicedChars.size} / ${displayChars.length}`
            : `發音 ${pronouncedChars.size} / ${pronunciationChars.length}`}
        </span>
        <ZhuyinToggle enabled={zhuyinEnabled} ready={zhuyinReady} onToggle={() => setZhuyinEnabled(!zhuyinEnabled)} />
      </div>

      {/* Progress bar */}
      <ProgressBar done={practicedChars.size} total={displayChars.length} />

      {/* Main content */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-2xl mx-auto space-y-6">

          {/* Header */}
          <div>
            <h2 className="text-xl font-black text-gray-900 mb-1">生字練習</h2>
            <p className="text-sm text-gray-500">
              {attempt.timestamp === 0
                ? '還沒有朗讀紀錄，以下是這篇課文的生字，選一個模式開始練習吧！'
                : needPracticeSet.size > 0
                  ? `以下 ${Math.min(needPracticeSet.size, 12)} 個字可以再練習看看，選一個模式開始練習吧！`
                  : '讀得很棒！沒有漏字。想再練習這篇的字嗎？'}
            </p>
          </div>

          {/* Mode toggle tabs */}
          <div className="flex bg-gray-100 rounded-xl p-1 gap-1">
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
              onClick={() => setActiveTab('pronunciation')}
              className={[
                'flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-semibold transition-all',
                activeTab === 'pronunciation'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700',
              ].join(' ')}
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.49 6-3.31 6-6.72h-1.7z" />
              </svg>
              發音練習
              {pronounceDone && <span className="w-2 h-2 bg-emerald-500 rounded-full" />}
            </button>
          </div>

          {/* Just-completed flash */}
          {justCompleted && (
            <div className="flex items-center gap-2 px-4 py-2.5 bg-emerald-50 border border-emerald-200 rounded-xl text-sm text-emerald-700 animate-slide-up-fast">
              <svg className="w-4 h-4 text-emerald-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
              <span>「<strong>{justCompleted}</strong>」練習完成！繼續加油！</span>
            </div>
          )}

          {/* Character grid */}
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
                const hasRadical = activeTab === 'stroke' && getDecomposition(ch) !== null;
                const isRadicalOpen = radicalChar === ch;
                const isSelected = selectedChar === ch;
                return (
                  <div key={ch} className="relative">
                    <button
                      onClick={() => {
                        setSelectedChar(prev => prev === ch ? null : ch);
                      }}
                      onDoubleClick={() => handlePractice(ch, activeTab)}
                      className={[
                        `relative flex flex-col items-center justify-center w-full ${zhuyinActive ? 'aspect-[3/6]' : 'aspect-square'} rounded-2xl border transition-all active:scale-95 animate-card-in`,
                        isSelected
                          ? 'ring-2 ring-indigo-500 ring-offset-1'
                          : '',
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

                      <span className="text-[9px] mt-1 opacity-60">
                        {isPracticed
                          ? '已練習'
                          : isSelected
                            ? '再點練習'
                            : '點我查字'}
                      </span>
                    </button>

                    {/* Radical decomposition toggle button */}
                    {hasRadical && (
                      <button
                        onClick={() => handleRadicalToggle(ch)}
                        title="查看部件拆解"
                        className={[
                          'absolute -bottom-1 -left-1 w-5 h-5 rounded-full flex items-center justify-center border text-[9px] font-bold transition-all',
                          isRadicalOpen
                            ? 'bg-indigo-500 border-indigo-600 text-white'
                            : 'bg-indigo-100 border-indigo-200 text-indigo-600 hover:bg-indigo-200',
                        ].join(' ')}
                        aria-label={`查看「${ch}」的部件拆解`}
                        aria-expanded={isRadicalOpen}
                      >
                        部
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Dictionary panel — shown when a character is selected */}
          {selectedChar && (
            <div className="bg-white border border-indigo-100 rounded-2xl p-4 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold text-indigo-600 uppercase tracking-wide">
                  教育部國語辭典
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => handlePractice(selectedChar)}
                    className="text-xs px-3 py-1.5 rounded-lg bg-accent text-white hover:bg-accent-hover font-semibold transition-colors"
                  >
                    練習筆順
                  </button>
                  <button
                    onClick={() => setSelectedChar(null)}
                    className="text-xs px-2 py-1.5 rounded-lg text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition-colors"
                    aria-label="關閉字典"
                  >
                    ✕
                  </button>
                </div>
              </div>
              <DictionaryPanel character={selectedChar} />
            </div>
          )}

          {/* Legend */}
          <div className="flex items-center gap-4 text-[10px] text-gray-400 flex-wrap">
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
            {charsWithRadical.length > 0 && (
              <div className="flex items-center gap-1.5">
                <span className="w-5 h-5 bg-indigo-100 border border-indigo-200 text-indigo-600 rounded-full flex items-center justify-center text-[9px] font-bold">部</span>
                點我查看部件拆解
              </div>
            )}
          </div>

          {/* Radical decomposition panel */}
          {radicalChar && (
            <div className="animate-[fadeIn_0.2s_ease-in]">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold text-gray-700">
                  「{radicalChar}」的部件學習
                </span>
                <button
                  onClick={() => setRadicalChar(null)}
                  className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1 rounded"
                >
                  收起
                </button>
              </div>
              <RadicalDecomposition char={radicalChar} />
            </div>
          )}

          {/* Usage hint */}
          {currentChars.length > 0 && !selectedChar && (
            <p className="text-[10px] text-gray-400 text-center">
              點一下字卡查字典，連點兩下練習{activeTab === 'stroke' ? '筆順' : '發音'}
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
                onClick={() => setPhase('sentence')}
                className="px-6 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm transition-all active:scale-95"
              >
                開始造句練習
              </button>
            </div>
          )}

          {allDone && (
            <CompletionBanner
              count={practicedChars.size}
              onFinish={() => onFinish({ practicedChars: Array.from(practicedChars), totalChars: displayChars.length })}
            />
          )}
        </div>
      </div>

      {/* Bottom actions */}
      <div className="flex-shrink-0 bg-white border-t border-gray-200 px-6 py-4 flex items-center justify-between">
        <button
          onClick={onBack}
          className="px-4 py-3 rounded-xl text-base text-gray-500 hover:text-gray-800 transition-colors"
        >
          回到朗讀
        </button>
        <div className="flex items-center gap-3">
          {practicedChars.size > 0 && !allDone && (
            <button
              onClick={() => setPhase('sentence')}
              className="px-5 py-3 rounded-xl font-bold text-base border border-accent text-accent hover:bg-accent/10 transition-all active:scale-95"
            >
              造句練習
            </button>
          )}
          <button
            onClick={() => onFinish({ practicedChars: Array.from(practicedChars), totalChars: displayChars.length })}
            className="px-8 py-3 rounded-xl font-bold text-base bg-accent hover:bg-accent-hover text-white shadow-lg transition-all active:scale-95 flex items-center gap-2"
          >
            {practicedChars.size > 0 || pronouncedChars.size > 0 ? '完成，查看報告' : '跳過，查看報告'}
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
};

export default VocabPractice;
