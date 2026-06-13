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
 *   - #2194 (table 對照) PairedReading now pairs tables alongside figures — a paragraph
 *     that references 表N shows TableDisplay inline (right side), same as 圖N shows FigureCard.
 *     Tables that no paragraph references fall back to the 其他圖表 section.
 *     The standalone collapsible 紙本表格 panel is removed for graphic-text lessons since
 *     tables are now always visible in-line with the paragraph that references them.
 */
import React, { useMemo } from 'react';
import { Story } from '../../types';
import { useZhuyin } from '../../context/ZhuyinContext';
import FloatingAIHelper from './FloatingAIHelper';
import { FigureCard, buildImageSrc, deriveLessonCodeFromFilename } from './GraphicTextImageStrip';
import TableDisplay from './TableDisplay';
import CollapsibleRefPanel from './CollapsibleRefPanel';

/** Image entry shape used by the graphic-text pairing layout (#2085). */
type GraphicTextImage = NonNullable<Story['images']>[number];

/**
 * Map Chinese numeral characters → integer (圖一 → 1 … 圖十 → 10), #2085.
 * Handles single-digit Arabic numerals too (圖3 → 3).
 */
const CN_NUM_MAP: Record<string, number> = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
};
function figureTokenToNumber(token: string): number | null {
  if (CN_NUM_MAP[token] != null) return CN_NUM_MAP[token];
  const n = parseInt(token, 10);
  return Number.isNaN(n) ? null : n;
}

/**
 * Parse all inline 圖N references from a paragraph, return the set of figure
 * numbers it references (deduped, in first-appearance order). #2085.
 * Regex matches both 中文 numerals (圖一) and Arabic (圖3), tolerating a space.
 *
 * Bug fix #2194: negative lookbehind for common compound-word prefixes that
 * attach to 圖 (e.g. 製圖、地圖、示圖). Prevents 製圖一覽 → 圖一 false positive.
 */
function parseFigureRefs(paragraph: string): number[] {
  // (?<!製|地|示|插|底|簡|描|附|草) — single-char negative lookbehind (fixed-length,
  // JS-supported). Each is a CJK char that forms a compound word ending in 圖.
  const re = /(?<!製|地|示|插|底|簡|描|附|草)圖\s*([一二三四五六七八九十]|\d+)/g;
  const seen = new Set<number>();
  const out: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(paragraph)) !== null) {
    const n = figureTokenToNumber(m[1]);
    if (n != null && !seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}

/**
 * Parse all inline 表N references from a paragraph, return the set of table
 * numbers it references (deduped, in first-appearance order). #2194.
 * Regex matches both 中文 numerals (表一) and Arabic (表1), tolerating a space.
 *
 * Bug fix #2194: negative lookbehind for compound-word prefixes that attach to 表
 * (e.g. 外表、代表). Prevents "外表一眼分辨" → 表一 false positive (G7-L30 para 0).
 */
function parseTableRefs(paragraph: string): number[] {
  // (?<!外|代|列|報|示|綜|述|發|圖) — single-char negative lookbehind (fixed-length,
  // JS-supported). Each is a CJK char that forms a compound word ending in 表.
  const re = /(?<!外|代|列|報|示|綜|述|發|圖)表\s*([一二三四五六七八九十]|\d+)/g;
  const seen = new Set<number>();
  const out: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(paragraph)) !== null) {
    const n = figureTokenToNumber(m[1]);
    if (n != null && !seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}

/**
 * Build a lookup from table number → LessonTable, keyed on the numeric index
 * embedded in the table title (e.g. "表一 …" → 1, "表二 …" → 2). #2194.
 *
 * Bug fix #2194: tables without a 表N prefix in their title are NOT assigned
 * a fallback key. This prevents untitled tables (e.g. G7-L28 "文章重點表")
 * from accidentally matching any 表一 reference in paragraph text.
 */
function buildTableIndex(tables: import('../../types').LessonTable[]): Map<number, import('../../types').LessonTable> {
  const map = new Map<number, import('../../types').LessonTable>();
  tables.forEach((tbl) => {
    const mt = tbl.title.match(/表\s*([一二三四五六七八九十]|\d+)/);
    if (!mt) return; // no 表N prefix → skip (do NOT assign fallback index)
    const num = figureTokenToNumber(mt[1]);
    if (num != null && !map.has(num)) map.set(num, tbl);
  });
  return map;
}

/**
 * Build a lookup from figure number → image, keyed on the REAL `figure_label`
 * baked into the YAML (NOT array order — the array is often reversed). #2085.
 * Falls back to (index + 1) only for images that lack a figure_label, so
 * single-image lessons without an explicit label still resolve.
 */
function buildFigureIndex(images: GraphicTextImage[]): Map<number, GraphicTextImage> {
  const map = new Map<number, GraphicTextImage>();
  images.forEach((img, idx) => {
    const label = img.figure_label;
    let num: number | null = null;
    if (label) {
      const mt = label.match(/圖\s*([一二三四五六七八九十]|\d+)/);
      if (mt) num = figureTokenToNumber(mt[1]);
    }
    if (num == null) num = idx + 1; // fallback when no label present
    if (!map.has(num)) map.set(num, img);
  });
  return map;
}

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

/**
 * PairedReading — per-paragraph 圖文表對照 (#2085, extended by #2194).
 *
 * Renders the lesson as a vertical list of rows. Each row pairs ONE paragraph
 * (left half) with the figure(s) AND/OR table(s) that paragraph references
 * (right half), matched by `figure_label` / table title prefix — NOT array order.
 * The professor's intent: "一段課文就是一張圖（或表）在右邊，左右直接對照."
 *
 * - Desktop (lg): text left, figure/table right (flex-row).
 * - Mobile: text top, figure/table bottom (flex-col).
 * - A paragraph may reference 0, 1, or many figures / tables.
 * - Figures / tables referenced by NO paragraph are appended under "其他圖表".
 */
const PairedReading: React.FC<{
  paragraphs: string[];
  images: GraphicTextImage[];
  tables: import('../../types').LessonTable[];
  lessonCode: string;
  zhuyinLines: React.ReactNode[] | null;
  zhuyinActive: boolean;
}> = ({ paragraphs, images, tables, lessonCode, zhuyinLines, zhuyinActive }) => {
  const figureIndex = useMemo(() => buildFigureIndex(images), [images]);
  const tableIndex = useMemo(() => buildTableIndex(tables), [tables]);

  /**
   * Derive rows + leftover lists inside a single useMemo so there are no
   * render-path mutations (bug fix #2194 — StrictMode double-invoke safety).
   *
   * Each figure / table is shown at most ONCE — next to the FIRST paragraph
   * that references it. Subsequent paragraphs that mention the same 圖N / 表N
   * are intentionally left without a paired card to avoid duplicating the
   * same large table/image 4× down the page (bug fix #2194).
   */
  const { rows, leftoverImages, leftoverTables } = useMemo(() => {
    const usedFilenames = new Set<string>();
    const usedTableIds = new Set<string>();

    const computedRows = paragraphs.map((para, idx) => {
      const figureRefs = parseFigureRefs(para);
      const tableRefs = parseTableRefs(para);

      // Only include a figure/table if it hasn't been shown in an earlier paragraph.
      const matchedFigures: { num: number; img: GraphicTextImage }[] = [];
      figureRefs.forEach((num) => {
        const img = figureIndex.get(num);
        if (img && !usedFilenames.has(img.filename)) {
          matchedFigures.push({ num, img });
          usedFilenames.add(img.filename);
        }
      });

      const matchedTables: { num: number; tbl: import('../../types').LessonTable }[] = [];
      tableRefs.forEach((num) => {
        const tbl = tableIndex.get(num);
        if (tbl && !usedTableIds.has(tbl.id)) {
          matchedTables.push({ num, tbl });
          usedTableIds.add(tbl.id);
        }
      });

      return { idx, para, matchedFigures, matchedTables };
    });

    return {
      rows: computedRows,
      leftoverImages: images.filter((img) => !usedFilenames.has(img.filename)),
      leftoverTables: tables.filter((tbl) => !usedTableIds.has(tbl.id)),
    };
  }, [paragraphs, images, tables, figureIndex, tableIndex]);

  const hasLeftovers = leftoverImages.length > 0 || leftoverTables.length > 0;

  return (
    <div className="space-y-5">
      {rows.map(({ idx, para, matchedFigures, matchedTables }) => {
        const hasRef = matchedFigures.length > 0 || matchedTables.length > 0;
        return (
          <div
            key={idx}
            className="flex flex-col lg:flex-row gap-4 lg:gap-6 items-stretch border-b border-surface-container-high pb-5 last:border-b-0"
          >
            {/* Paragraph — left half (top on mobile) */}
            <div className="w-full lg:w-1/2 flex gap-3 items-start">
              <span className="text-xs font-headline font-bold text-on-surface-variant/30 pt-1 select-none shrink-0 w-6 text-right">
                {String(idx + 1).padStart(2, '0')}
              </span>
              <p
                className={`text-lg md:text-xl text-on-surface leading-[2rem] md:leading-[2.2rem] ${
                  zhuyinActive ? 'tracking-[0.15em]' : ''
                }`}
              >
                {zhuyinLines ? zhuyinLines[idx] : para}
              </p>
            </div>

            {/* Figure(s) + Table(s) — right half (bottom on mobile). Empty when no ref. */}
            <div className="w-full lg:w-1/2 flex flex-col gap-4">
              {hasRef ? (
                <>
                  {matchedFigures.map(({ num, img }) => (
                    <FigureCard
                      key={img.filename}
                      src={buildImageSrc(img.filename, lessonCode)}
                      alt={img.figure_label ?? img.caption ?? `圖 ${num}`}
                      caption={img.caption}
                      index={num - 1}
                      figureLabel={img.figure_label ?? `圖${num}`}
                    />
                  ))}
                  {matchedTables.map(({ tbl }) => (
                    <TableDisplay key={tbl.id} tables={[tbl]} layout="stacked" />
                  ))}
                </>
              ) : (
                <div className="hidden lg:block" aria-hidden="true" />
              )}
            </div>
          </div>
        );
      })}

      {/* Figures / tables referenced by no paragraph → append under 其他圖表. */}
      {hasLeftovers && (
        <div className="pt-2">
          <div className="flex items-center gap-2 mb-3">
            <span className="material-symbols-outlined text-accent text-lg">image</span>
            <span className="font-headline font-bold text-on-surface text-sm tracking-wide">
              其他圖表
            </span>
          </div>
          <div className="space-y-4">
            {leftoverImages.length > 0 && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {leftoverImages.map((img, i) => (
                  <FigureCard
                    key={img.filename}
                    src={buildImageSrc(img.filename, lessonCode)}
                    alt={img.figure_label ?? img.caption ?? `圖 ${i + 1}`}
                    caption={img.caption}
                    index={i}
                    figureLabel={img.figure_label}
                  />
                ))}
              </div>
            )}
            {leftoverTables.length > 0 && (
              <TableDisplay tables={leftoverTables} layout="stacked" />
            )}
          </div>
        </div>
      )}
    </div>
  );
};

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

  // Resolve the lesson directory for GCS image URLs. story.lesson_code maps from
  // grade_code (e.g. 'G7') which is NOT the full lesson code, so derive from the
  // image filename (e.g. 'images/G7-L29/G7-L29-09.png' -> 'G7-L29'), #2085 / #1681.
  const resolvedLessonCode =
    (images[0] ? deriveLessonCodeFromFilename(images[0].filename) : '') ||
    story.lesson_code ||
    '';

  // Paragraphs drive the per-paragraph pairing. story.content === paragraphs
  // (api.ts maps detail.paragraphs -> content), so use content as the source.
  const paragraphs = story.content ?? [];

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden bg-surface relative">
      <div className="flex-1 min-h-0 px-4 md:px-6 py-6 md:py-8 overflow-hidden">

        {hasImages ? (
          /* ══════════════════════════════════════════════════════════════════
           * 圖文對照 per-paragraph pairing (B2, #2085) — graphic-text lessons.
           *
           * The professor's intent (6/4 demo): "一段課文就是一張圖在右邊，左右
           * 直接對照." Each paragraph sits next to the SPECIFIC figure it
           * references (matched by figure_label, NOT array order, since the
           * YAML image array is often reversed vs. figure order).
           *
           * - Single scroll container holds the whole paired list.
           * - Desktop (lg): each row is text-left | figure-right.
           * - Mobile: text-top / figure-bottom.
           * - Exercise renders BELOW the paired reading, full width (not a side
           *   gallery), so practice no longer scrolls back to find the figure.
           * ══════════════════════════════════════════════════════════════════ */
          <div className="w-full h-full overflow-y-auto custom-scrollbar pr-1">
            <div className="bg-surface-container-lowest rounded-3xl shadow-editorial p-6 md:p-8">
              <div className="flex items-center gap-2 mb-5">
                <span className="material-symbols-outlined text-accent text-xl">auto_stories</span>
                <span className="font-headline font-bold text-on-surface text-sm uppercase tracking-wider">
                  圖文表對照閱讀
                </span>
                <span className="text-xs text-on-surface-variant ml-1">
                  {images.length} 張圖{tables.length > 0 ? ` · ${tables.length} 張表` : ''}
                </span>
              </div>

              {/* #2194: pass tables so PairedReading can inline 表N alongside 圖N.
                  The standalone collapsible 紙本表格 panel is removed for graphic-text
                  lessons — tables are now visible directly next to the paragraphs
                  that reference them, matching the professor's 對照 intent. */}
              <PairedReading
                paragraphs={paragraphs}
                images={images}
                tables={tables}
                lessonCode={resolvedLessonCode}
                zhuyinLines={zhuyinLines}
                zhuyinActive={zhuyinActive}
              />

              {progressPercent >= 0 && (
                <div className="mt-6 pt-4 border-t border-surface-container-high">
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

            {/* Note: tables for graphic-text lessons are now inlined per-paragraph
                inside PairedReading (above). No standalone 紙本表格 collapsible here. */}

            {/* Exercise — full width, BELOW the paired reading */}
            <div className="mt-4">
              {/* #2133: 閱讀理解 quiz 預設展開（教授「應一開始就直接呈現、不必點上方小字」）*/}
              <CollapsibleRefPanel
                icon={exerciseIcon}
                label={exerciseLabel}
                defaultOpen={true}
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

              {/* #2133: 閱讀理解 quiz 預設展開（教授「應一開始就直接呈現」）*/}
              <CollapsibleRefPanel
                icon={exerciseIcon}
                label={exerciseLabel}
                defaultOpen={true}
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
