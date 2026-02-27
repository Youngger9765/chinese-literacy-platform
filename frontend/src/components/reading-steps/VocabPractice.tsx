
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Story, ReadingAttempt, VocabResult } from '../../types';
import { hasStrokeData } from '../stroke-order/strokeData';
import WriteCharacter from '../stroke-order/WriteCharacter';
import { PolyphonicProcessor, buildZhuyinString } from '../zhuyin/polyphonicProcessor';
import ZhuyinToggle from '../ui/ZhuyinToggle';

interface VocabPracticeProps {
  story: Story;
  attempt: ReadingAttempt;
  onFinish: (result: VocabResult) => void;
  onBack: () => void;
}

type Phase = 'grid' | 'practice';

const VocabPractice: React.FC<VocabPracticeProps> = ({ story, attempt, onFinish, onBack }) => {
  const [phase, setPhase] = useState<Phase>('grid');
  const [practicingChar, setPracticingChar] = useState('');
  const [practicedChars, setPracticedChars] = useState<Set<string>>(new Set());
  const [zhuyinEnabled, setZhuyinEnabled] = useState(true);
  const [zhuyinReady, setZhuyinReady] = useState(false);

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

  const handlePractice = (ch: string) => {
    setPracticingChar(ch);
    setPhase('practice');
  };

  const handlePracticeComplete = () => {
    setPracticedChars(prev => new Set(prev).add(practicingChar));
    setPhase('grid');
  };

  const handlePracticeBack = () => {
    setPhase('grid');
  };

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
  const allDone = displayChars.length > 0 && displayChars.every(ch => practicedChars.has(ch));

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
          已練習 {practicedChars.size} / {displayChars.length} 字
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
                ? '還沒有朗讀紀錄，以下是這篇課文的生字，點一點來練習筆順吧！'
                : needPracticeSet.size > 0
                  ? `朗讀時漏掉了以下 ${Math.min(needPracticeSet.size, 12)} 個字，點一點來練習筆順吧！`
                  : '讀得很棒！沒有漏字。想再練習這篇的字嗎？'}
            </p>
          </div>

          {/* Character grid */}
          {displayChars.length === 0 ? (
            <div className="text-gray-400 text-sm py-8 text-center">這篇課文的漢字沒有筆順資料</div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
              {displayChars.map(ch => {
                const isSuggested = needPracticeSet.has(ch);
                const isPracticed = practicedChars.has(ch);
                return (
                  <button
                    key={ch}
                    onClick={() => handlePractice(ch)}
                    className={[
                      `relative flex flex-col items-center justify-center ${zhuyinActive ? 'aspect-[3/6]' : 'aspect-square'} rounded-2xl border transition-all active:scale-95`,
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
                      {isPracticed ? '已練習' : '點我練習'}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Legend */}
          {needPracticeSet.size > 0 && (
            <div className="flex items-center gap-4 text-[10px] text-gray-400">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 bg-amber-500 rounded-full" />
                建議練習
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 bg-emerald-500 rounded-full" />
                已完成
              </div>
            </div>
          )}

          {/* Completion message */}
          {allDone && (
            <div className="bg-emerald-50 border border-emerald-300 rounded-2xl p-4 text-center">
              <p className="text-emerald-800 font-bold">太棒了！所有生字都練習完了！</p>
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
          {practicedChars.size > 0 ? '完成，查看報告' : '跳過，查看報告'}
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  );
};

export default VocabPractice;
