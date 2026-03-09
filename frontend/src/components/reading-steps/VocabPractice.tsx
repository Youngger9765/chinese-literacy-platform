
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Story, ReadingAttempt, VocabResult } from '../../types';
import { hasStrokeData } from '../stroke-order/strokeData';
import WriteCharacter from '../stroke-order/WriteCharacter';
import PronunciationPractice from './PronunciationPractice';
import { PolyphonicProcessor, buildZhuyinString } from '../zhuyin/polyphonicProcessor';
import ZhuyinToggle from '../ui/ZhuyinToggle';
import RadicalDecomposition from './RadicalDecomposition';
import { getDecomposition } from '../../data/radicals';

interface VocabPracticeProps {
  story: Story;
  attempt: ReadingAttempt;
  onFinish: (result: VocabResult) => void;
  onBack: () => void;
}

type Phase = 'grid' | 'practice' | 'pronunciation';

type PracticeMode = 'stroke' | 'pronunciation';

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

  /** Characters from low-match-rate paragraphs (suggested practice) */
  const needPracticeSet = useMemo(
    () => new Set(attempt.mispronouncedWords),
    [attempt.mispronouncedWords],
  );

  /**
   * Build display character list:
   * - If there are missed characters (mispronouncedWords): show ONLY those.
   *   Don't mix in unrelated story characters — every card shown is a real miss.
   * - If none missed (perfect reading): show optional story characters so the
   *   student can still choose to practice.
   * All characters are filtered to those with available stroke data.
   */
  const displayChars = useMemo(() => {
    const suggested = attempt.mispronouncedWords.filter(hasStrokeData);

    if (suggested.length > 0) {
      // Show only the chars the student actually missed
      return suggested.slice(0, 12);
    }

    // No misses — optional story characters for extra practice
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

  const handlePractice = (ch: string, mode: PracticeMode = 'stroke') => {
    setPracticingChar(ch);
    setPhase(mode === 'stroke' ? 'practice' : 'pronunciation');
  };

  const handlePracticeComplete = () => {
    setPracticedChars(prev => new Set(prev).add(practicingChar));
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

  /* ── Grid phase: character selection ── */
  const strokeDone = displayChars.length > 0 && displayChars.every(ch => practicedChars.has(ch));
  const pronounceDone = displayChars.length > 0 && displayChars.every(ch => pronouncedChars.has(ch));
  const allDone = strokeDone && pronounceDone;

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
      {/* Tab bar — VS Code style */}
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

      {/* Main content */}
      <div className="flex-1 overflow-y-auto px-6 py-8">
        <div className="max-w-2xl mx-auto space-y-6">

          {/* Header */}
          <div>
            <h2 className="text-xl font-black text-gray-900 mb-1">生字練習</h2>
            <p className="text-sm text-gray-600">
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

          {/* Character grid */}
          {currentChars.length === 0 ? (
            <div className="text-gray-400 text-sm py-8 text-center">
              {activeTab === 'stroke'
                ? '這篇課文的漢字沒有筆順資料'
                : '沒有生字資料'}
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
              {currentChars.map(ch => {
                const isSuggested = needPracticeSet.has(ch);
                const isPracticed = currentPracticedSet.has(ch);
                const hasRadical = activeTab === 'stroke' && getDecomposition(ch) !== null;
                const isRadicalOpen = radicalChar === ch;
                return (
                  <div key={ch} className="relative">
                    <button
                      onClick={() => handlePractice(ch, activeTab)}
                      className={[
                        `relative flex flex-col items-center justify-center w-full ${zhuyinActive ? 'aspect-[3/6]' : 'aspect-square'} rounded-2xl border transition-all active:scale-95`,
                        isPracticed
                          ? 'bg-emerald-50 border-emerald-700/50 text-emerald-800'
                          : isSuggested
                            ? 'bg-amber-900/30 border-amber-600/60 text-amber-700 ring-1 ring-amber-500/30 hover:bg-amber-900/50'
                            : 'bg-white border-gray-200 text-gray-800 hover:bg-gray-100 hover:border-accent/40',
                      ].join(' ')}
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
                        <span className="absolute -top-1 -right-1 w-4 h-4 bg-emerald-500 rounded-full flex items-center justify-center border-2 border-[#0d1117]">
                          <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
                          </svg>
                        </span>
                      )}

                      <span className="text-[9px] mt-1 opacity-60">
                        {isPracticed
                          ? '已練習'
                          : activeTab === 'stroke'
                            ? '點我練字'
                            : '點我練音'}
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

          {allDone && (
            <div className="bg-blue-50 border border-blue-300 rounded-2xl p-4 text-center">
              <p className="text-blue-800 font-bold">筆順和發音都練習完了，真厲害！</p>
            </div>
          )}
        </div>
      </div>

      {/* Bottom actions */}
      <div className="flex-shrink-0 bg-white border-t border-gray-200 px-6 py-4 flex items-center justify-between">
        <button
          onClick={onBack}
          className="px-4 py-3 rounded-xl text-base text-gray-600 hover:text-gray-800 transition-colors"
        >
          回到朗讀
        </button>
        <button
          onClick={() => onFinish({ practicedChars: Array.from(practicedChars), totalChars: displayChars.length })}
          className="px-8 py-3 rounded-xl font-bold text-base bg-accent hover:bg-accent-hover text-white shadow-lg transition-all active:scale-95 flex items-center gap-2"
        >
          {practicedChars.size > 0 || pronouncedChars.size > 0 ? '完成，查看報告' : '跳過，查看報告'}
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  );
};

export default VocabPractice;
