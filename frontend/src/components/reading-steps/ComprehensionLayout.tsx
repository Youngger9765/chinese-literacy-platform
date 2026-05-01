/**
 * ComprehensionLayout — shared left-right layout for the 3 comprehension steps.
 *
 * Left panel: scrollable lesson text card with zhuyin toggle + progress bar.
 * Right panel: children (StoryStructureTable / StrategyExercise / MultipleChoiceExercise).
 *
 * Layout design notes (avoids #1332 / #1331 height-collapse bug):
 *   - Outer wrapper: flex flex-col flex-1 min-h-0 — NO scrollIntoView, NO min-h-full on children
 *   - Body: flex-1 min-h-0 overflow-hidden — establishes height boundary
 *   - Grid: grid-rows-[1fr] — CRITICAL: locks row height to 1fr so children cannot push it out
 *   - Panels: min-h-0 — allows them to shrink within the 1fr boundary
 *   - Children area: flex-1 min-h-0 overflow-y-auto — scrolls internally, never grows parent
 */
import React, { useMemo } from 'react';
import { Story } from '../../types';
import { useZhuyin } from '../../context/ZhuyinContext';
import FloatingAIHelper from './FloatingAIHelper';

interface ComprehensionLayoutProps {
  story: Story;
  dbSessionId?: number;
  /** The exercise component rendered in the right panel */
  children: React.ReactNode;
  /** Progress 0–100 to show in the bottom bar of the left card. -1 = hide bar. */
  progressPercent?: number;
  /** Label shown next to the progress percent. Defaults to empty. */
  progressLabel?: string;
}

const ComprehensionLayout: React.FC<ComprehensionLayoutProps> = ({
  story,
  dbSessionId,
  children,
  progressPercent = -1,
  progressLabel = '',
}) => {
  const { zhuyinActive, processLines: zhuyinProcessLines } = useZhuyin();

  const zhuyinLines = useMemo(() => {
    if (!zhuyinActive) return null;
    return zhuyinProcessLines(story.content);
  }, [story.content, zhuyinActive, zhuyinProcessLines]);

  const storyText = useMemo(() => story.content.join('\n'), [story.content]);

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden bg-surface relative">
      {/* ── Main content area ─────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 px-4 md:px-6 py-6 md:py-8 overflow-hidden">
        {/*
          CRITICAL: grid-rows-[1fr] pins row height so child content changes
          (checkbox toggle, MCQ answer reveal) cannot re-expand the row.
          This is the fix for the height-collapse bug in #1332.
        */}
        <div className="w-full h-full grid grid-cols-1 md:grid-cols-12 grid-rows-[1fr] gap-6">

          {/* ── Left: Story text card ─────────────────────────────────────────── */}
          <div className="md:col-span-7 min-h-0 flex">
            <div className="bg-surface-container-lowest rounded-3xl shadow-editorial p-6 md:p-8 flex flex-col w-full min-h-0">
              <div className="flex items-center gap-2 mb-4 shrink-0">
                <span className="material-symbols-outlined text-accent text-xl">menu_book</span>
                <span className="font-headline font-bold text-on-surface text-sm uppercase tracking-wider">
                  參考課文
                </span>
              </div>
              {/* Scrollable story content — overflow-y-auto on the inner div only */}
              <div className="flex-1 min-h-0 overflow-y-auto pr-2 custom-scrollbar space-y-6">
                {story.content.map((line, idx) => (
                  <div key={idx} className="flex gap-3 items-start">
                    <span className="text-xs font-headline font-bold text-on-surface-variant/30 pt-1 select-none shrink-0 w-5 text-right">
                      {String(idx + 1).padStart(2, '0')}
                    </span>
                    <p
                      className={`text-lg md:text-xl text-on-surface leading-[2.6rem] md:leading-[3rem] ${
                        zhuyinActive ? 'tracking-[0.3em]' : ''
                      }`}
                    >
                      {zhuyinLines ? zhuyinLines[idx] : line}
                    </p>
                  </div>
                ))}
              </div>

              {/* Progress bar — only shown when progressPercent >= 0 */}
              {progressPercent >= 0 && (
                <div className="mt-4 pt-4 border-t border-surface-container-high shrink-0">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-headline font-bold text-on-surface-variant">
                      {progressLabel || '完成進度'}
                    </span>
                    <span className="text-xs font-headline font-bold text-accent">
                      {progressPercent === 100 ? '完成！' : `${progressPercent}%`}
                    </span>
                  </div>
                  <div className="h-2 bg-surface-container-high rounded-full overflow-hidden">
                    <div
                      className="h-full bg-accent rounded-full transition-all duration-500 ease-out"
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ── Right: Exercise panel ─────────────────────────────────────────── */}
          <div className="md:col-span-5 min-h-0 flex flex-col">
            <div className="bg-surface-container-lowest rounded-3xl shadow-editorial p-6 md:p-8 flex-1 min-h-0 overflow-y-auto custom-scrollbar">
              {children}
            </div>
          </div>
        </div>
      </div>

      {/* Floating AI helper */}
      <FloatingAIHelper
        storyTitle={story.title}
        storyText={storyText}
        dbSessionId={dbSessionId}
      />

      {/* Background decoration */}
      <div className="fixed top-0 right-0 -z-10 w-96 h-96 bg-accent/5 rounded-full blur-[100px] pointer-events-none" />
      <div className="fixed bottom-0 left-0 -z-10 w-96 h-96 bg-emerald-500/5 rounded-full blur-[100px] pointer-events-none" />

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 5px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #b0ada6; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #797770; }
      `}</style>
    </div>
  );
};

export default ComprehensionLayout;
