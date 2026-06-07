/**
 * ComprehensionLayout — shared left-right layout for the 3 comprehension steps.
 *
 * Left panel: scrollable lesson text card with zhuyin toggle + progress bar.
 * Right panel: vertical stack of 3 accordion-style CollapsibleRefPanels
 *   1. 圖文對照 (graphic-text only) — defaultOpen (reference material first)
 *   2. 紙本表格 (lessons with tables) — defaultOpen (reference material first)
 *   3. Exercise (children — StoryStructureTable / StrategyExercise / MCQ) — defaultOpen
 *
 * All 3 panels are pure flow siblings inside a single overflow-y-auto outer
 * container, so they never overlap and there's only one scrollbar for the
 * right column. Each panel sizes to its own content via shrink-0 (collapsed
 * collapsibles are tiny; expanded ones grow naturally).
 *
 * Layout design notes (avoids #1332 / #1331 height-collapse bug):
 *   - Outer wrapper: flex flex-col flex-1 min-h-0 — NO scrollIntoView, NO min-h-full on children
 *   - Body: flex-1 min-h-0 overflow-hidden — establishes height boundary
 *   - Grid: grid-rows-[1fr] — CRITICAL: locks row height to 1fr so children cannot push it out
 *   - Right col: min-h-0 overflow-y-auto, children shrink-0 -> natural flow stack
 *
 * History:
 *   - #1341 introduced a 3-pane layout (text / image strip / exercise)
 *   - #1504 collapsed to 2 panes (text+image stacked left, exercise right)
 *   - #1692 inlined images/tables right after their 圖 N / 表 N caption paragraph
 *   - #1697 moves all images + tables to the right column inside a
 *     collapsible accordion so the left column stays focused on the text.
 *   - #1699 (Young 5/19 follow-up) wraps the exercise itself in a CollapsibleRefPanel
 *     (defaultOpen=true) so all 3 right-col panels share the same accordion style,
 *     and removes the inner flex-1/min-h-0 nesting that caused the panels to
 *     visually overlap the exercise questions on scroll.
 *   - #1701 reorders right-col panels: 圖文對照 -> 紙本表格 -> 練習 (exercise last),
 *     and sets all 3 panels to defaultOpen=true so students see reference material
 *     immediately without manually expanding.
 *   - #2085 (B1 圖文並陳) graphic-text lessons get a dedicated split layout:
 *     Desktop (>=1024px): left image pane (50%) | right text+exercise pane (50%).
 *     Portrait/tablet (<1024px): top image pane (~40vh) / bottom text+exercise stack.
 *     ZoomableImage modal removed — GraphicTextImageStrip now uses in-pane +/- zoom.
 */
import React, { useMemo } from 'react';
import { Story } from '../../types';
import { useZhuyin } from '../../context/ZhuyinContext';
import FloatingAIHelper from './FloatingAIHelper';
import GraphicTextImageStrip from './GraphicTextImageStrip';
import TableDisplay from './TableDisplay';
import CollapsibleRefPanel from './CollapsibleRefPanel';

interface ComprehensionLayoutProps {
  story: Story;
  dbSessionId?: number;
  /** The exercise component rendered in the right panel */
  children: React.ReactNode;
  /** Progress 0-100 to show in the bottom bar of the left card. -1 = hide bar. */
  progressPercent?: number;
  /** Label shown next to the progress percent. Defaults to empty. */
  progressLabel?: string;
  /** Material Symbols icon for the exercise collapsible header. */
  exerciseIcon?: string;
  /** Header label for the exercise collapsible. */
  exerciseLabel?: string;
}

/** Scrollable lesson text card — shared between standard and graphic-text layouts. */
const StoryTextCard: React.FC<{
  story: Story;
  zhuyinLines: React.ReactNode[] | null;
  zhuyinActive: boolean;
  progressPercent: number;
  progressLabel: string;
  className?: string;
}> = ({ story, zhuyinLines, zhuyinActive, progressPercent, progressLabel, className = '' }) => (
  <div className={`bg-surface-container-lowest rounded-3xl shadow-editorial p-6 md:p-8 flex flex-col w-full flex-1 min-h-0 ${className}`}>
    <div className="flex items-center gap-2 mb-4 shrink-0">
      <span className="material-symbols-outlined text-accent text-xl">menu_book</span>
      <span className="font-headline font-bold text-on-surface text-sm uppercase tracking-wider">
        參考課文
      </span>
    </div>
    <div className="flex-1 min-h-0 overflow-y-auto pr-2 custom-scrollbar space-y-6">
      {story.content.map((line, idx) => (
        <div key={idx} className="flex gap-3 items-start">
          <span className="text-xs font-headline font-bold text-on-surface-variant/30 pt-1 select-none shrink-0 w-5 text-right">
            {String(idx + 1).padStart(2, '0')}
          </span>
          <p
            className={`text-lg md:text-xl text-on-surface leading-[2rem] md:leading-[2.2rem] ${
              zhuyinActive ? 'tracking-[0.15em]' : ''
            }`}
          >
            {zhuyinLines ? zhuyinLines[idx] : line}
          </p>
        </div>
      ))}
    </div>

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
);

const ComprehensionLayout: React.FC<ComprehensionLayoutProps> = ({
  story,
  dbSessionId,
  children,
  progressPercent = -1,
  progressLabel = '',
  exerciseIcon = 'edit_note',
  exerciseLabel = '練習',
}) => {
  const { zhuyinActive, processLines: zhuyinProcessLines } = useZhuyin();

  const zhuyinLines = useMemo(() => {
    if (!zhuyinActive) return null;
    return zhuyinProcessLines(story.content);
  }, [story.content, zhuyinActive, zhuyinProcessLines]);

  const storyText = useMemo(() => story.content.join('\n'), [story.content]);

  const isGraphicText = story.layout_mode === 'graphic-text';
  const images = story.images ?? [];
  const tables = story.tables ?? [];
  const hasImages = isGraphicText && images.length > 0;
  const hasTables = tables.length > 0;

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden bg-surface relative">
      <div className="flex-1 min-h-0 px-4 md:px-6 py-6 md:py-8 overflow-hidden">

        {hasImages ? (
          /* ══════════════════════════════════════════════════════════════════
           * 圖文並陳 layout (B1, #2085) — for graphic-text lessons with images
           *
           * Desktop/landscape (>=1024px):
           *   Left pane  (50%): text card (scrollable) + exercise + tables
           *   Right pane (50%): image gallery, full pane width, independently scrollable
           *
           * Portrait/tablet (<1024px):
           *   Top:    text card + exercise stack, scrollable
           *   Bottom: image strip (~40vh, capped so text stays visible)
           *
           * Order controlled via order-1 (text) / order-2 (image) so reading starts at text.
           *
           * Both panes are independently scrollable. Images are never modal-covered.
           * ══════════════════════════════════════════════════════════════════ */
          <div className="w-full h-full flex flex-col lg:flex-row gap-4 lg:gap-6">

            {/* Image pane — #2085: text-left/image-right (desktop) + text-top/image-bottom
                (mobile). order-2 puts this AFTER the text pane in both flex-col & flex-row. */}
            <div
              className="
                order-2
                w-full lg:w-1/2
                h-[40vh] lg:h-full
                min-h-0
                flex-shrink-0 lg:flex-shrink
                bg-surface-container-lowest rounded-3xl shadow-editorial p-4 md:p-5
                flex flex-col
              "
            >
              <div className="flex items-center gap-2 mb-3 shrink-0">
                <span className="material-symbols-outlined text-accent text-xl">photo_library</span>
                <span className="font-headline font-bold text-on-surface text-sm uppercase tracking-wider">
                  課文圖表
                </span>
                <span className="text-xs text-on-surface-variant ml-1">{images.length} 張</span>
              </div>
              {/* GraphicTextImageStrip fills the remaining height of this pane */}
              <div className="flex-1 min-h-0">
                <GraphicTextImageStrip
                  images={images}
                  lessonCode={story.lesson_code}
                />
              </div>
            </div>

            {/* Text + exercise pane — #2085: order-1 puts text FIRST → left on desktop,
                top on mobile (reading flow starts at the text, image is the reference). */}
            <div className="order-1 w-full lg:w-1/2 min-h-0 flex flex-col gap-3 overflow-y-auto custom-scrollbar pr-1">
              {/* Text card */}
              <StoryTextCard
                story={story}
                zhuyinLines={zhuyinLines}
                zhuyinActive={zhuyinActive}
                progressPercent={progressPercent}
                progressLabel={progressLabel}
              />

              {/* Tables (if any) */}
              {hasTables && (
                <CollapsibleRefPanel
                  icon="table_chart"
                  label="紙本表格"
                  count={`${tables.length} 張`}
                  defaultOpen={false}
                >
                  <TableDisplay tables={tables} layout="stacked" />
                </CollapsibleRefPanel>
              )}

              {/* Exercise */}
              <CollapsibleRefPanel
                icon={exerciseIcon}
                label={exerciseLabel}
                defaultOpen={false}
              >
                {children}
              </CollapsibleRefPanel>
            </div>
          </div>
        ) : (
          /* ══════════════════════════════════════════════════════════════════
           * Standard 2-column layout — lessons without graphic-text images.
           * Unchanged from #1701 / #1703.
           * ══════════════════════════════════════════════════════════════════ */
          <div className="w-full h-full grid grid-cols-1 md:grid-cols-12 grid-rows-[1fr] gap-6">

            {/* Left: text card (col-span-7) */}
            <div className="md:col-span-7 min-h-0 flex flex-col">
              <StoryTextCard
                story={story}
                zhuyinLines={zhuyinLines}
                zhuyinActive={zhuyinActive}
                progressPercent={progressPercent}
                progressLabel={progressLabel}
              />
            </div>

            {/* Right: reference panels + exercise (col-span-5) */}
            <div className="md:col-span-5 min-h-0 flex flex-col gap-3 overflow-y-auto custom-scrollbar pr-1">
              {hasTables && (
                <CollapsibleRefPanel
                  icon="table_chart"
                  label="紙本表格"
                  count={`${tables.length} 張`}
                  defaultOpen={false}
                >
                  <TableDisplay tables={tables} layout="stacked" />
                </CollapsibleRefPanel>
              )}

              <CollapsibleRefPanel
                icon={exerciseIcon}
                label={exerciseLabel}
                defaultOpen={false}
              >
                {children}
              </CollapsibleRefPanel>
            </div>
          </div>
        )}
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
