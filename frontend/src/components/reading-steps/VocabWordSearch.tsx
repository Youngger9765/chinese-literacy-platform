/**
 * VocabWordSearch -- find vocab words in a character grid (Sanmin Step 8)
 *
 * Generates an NxN Chinese character grid containing lesson vocabulary words.
 * Words are placed horizontally or vertically only (no diagonal).
 * Students drag or tap to select characters and find all vocabulary words.
 *
 * Props:
 *   story       -- The lesson story (uses story.vocabulary)
 *   onFinish    -- Called when all words are found, with time elapsed (seconds)
 *   zhuyinActive -- (optional) reserved for future zhuyin overlay
 *
 * Issue #816 — fix: completion record not persisted
 *   - On completion, save completed:true + elapsedTime to localStorage
 *     (do NOT removeItem on finish — that was the bug)
 *   - On mount, if saved state has completed:true, show completion screen
 *     immediately without starting a new game
 *   - Only clear localStorage when student clicks "重新練習"
 *
 * Issue #1856 — refactor: extracted pure logic to:
 *   - wordSearchGrid.ts  (grid generation, cell keys, drag selection)
 *   - useWordSearchProgress.ts  (timer, localStorage, completion, redo)
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Story } from '../../types';
import { isToolboxMode } from '../../services/learningStorageScope';
import { useZhuyin } from '../../context/ZhuyinContext';
import { fontForZhuyin } from '../../constants/fonts';
import ToolboxCompletionActions from '../tools/ToolboxCompletionActions';
import { useWordSearchProgress } from './useWordSearchProgress';
import type { WordSearchProgress } from './useWordSearchProgress';
import { PlacedWord, overlayRects, cellsAlongWord, cellAt } from './wordSearchGrid';
import NextStepFooter from '../learning/NextStepFooter';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface VocabWordSearchProps {
  story: Story;
  onFinish: (elapsedSeconds: number) => void;
  zhuyinActive?: boolean;
  /** #2848 — DB 裡先前存下的進度（存了讀不回來等於沒存）。 */
  initialProgress?: WordSearchProgress | null;
  /** #2848 — 找到字就回報一次，讓作答中的進度進得了 DB。 */
  onProgressChange?: (progress: WordSearchProgress) => void;
}

// A8: Detect touch (coarse pointer) vs mouse at mount time.
const IS_TOUCH_DEVICE =
  typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

const VOCAB_WORDSEARCH_ONBOARDED_KEY = 'vocab_wordsearch_onboarded';

type WordSearchDemoStep = 'find-word' | 'start-drag' | 'dragging' | 'success';

interface WordSearchDemoRuntime {
  step: WordSearchDemoStep;
  targetWord: string;
  highlightCells: Set<string>;
}

interface DemoCursor {
  x: number;
  y: number;
}

// 語詞書寫練習／難字挑戰 (#2752 Phase 3) — the worksheet's own last practice item
// (usually 大題九, right after 詞語複習/大題八). Same "copy it, cover it, self-test,
// check the box" exercise the worksheet describes — not graded (原稿本來就是學生
// 自填檢查，no answer key to compare against), so this is a checklist, not a quiz.
function WritingPracticeSection({ label, instruction, words }: { label?: string; instruction?: string; words: string[] }) {
  if (!words || words.length === 0) return null;
  return (
    <div className="rounded-2xl border border-surface-container-high bg-surface-container-lowest px-6 py-5 space-y-3">
      <span className="text-xs font-bold text-on-surface-variant uppercase tracking-widest">
        {label || '語詞書寫練習'}
      </span>
      {instruction && <p className="text-sm text-on-surface-variant">{instruction}</p>}
      <ul className="flex flex-wrap gap-3">
        {words.map((w, i) => (
          <li
            key={i}
            className="px-4 py-2 rounded-xl bg-surface border border-surface-container-high text-lg font-bold text-on-surface"
          >
            {w}
          </li>
        ))}
      </ul>
      <p className="text-xs text-on-surface-variant">先看著寫一遍，蓋起來考自己，再檢查是否寫對了。</p>
    </div>
  );
}

function DemoBubble({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="relative flex justify-center mb-3 animate-in fade-in slide-in-from-bottom-2 duration-300"
      role="status"
      aria-live="polite"
    >
      <div className="rounded-xl bg-accent text-white px-4 py-2 text-sm font-bold shadow-lg text-center max-w-xs">
        {children}
        <span
          className="absolute left-1/2 -bottom-1.5 h-3 w-3 -translate-x-1/2 rotate-45 bg-accent"
          aria-hidden
        />
      </div>
    </div>
  );
}

interface OnboardingCoachProps {
  onDismiss: () => void;
  onDemo: () => void;
}

function OnboardingCoach({ onDismiss, onDemo }: OnboardingCoachProps) {
  const instruction = IS_TOUCH_DEVICE
    ? '用手指在方格上滑過，水平或垂直圈出語詞'
    : '用滑鼠在方格上拖曳，水平或垂直圈出語詞';
  return (
    <div className="mb-5 rounded-2xl border-2 border-amber-400/60 bg-amber-50 px-5 py-4 flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <span className="material-symbols-outlined text-amber-500 text-2xl flex-shrink-0 mt-0.5">
          lightbulb
        </span>
        <div className="flex-1">
          <p className="font-bold text-on-surface text-base mb-1">語詞複習怎麼玩？</p>
          <p className="text-sm text-on-surface-variant leading-relaxed">
            {instruction}。右邊列出要找的語詞，全部找到就完成
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 self-end">
        <button
          type="button"
          onClick={onDemo}
          className="px-4 py-2 rounded-full text-sm font-bold border-2 border-accent text-accent hover:bg-accent/10 active:scale-[0.98] transition-all"
        >
          示範
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="px-5 py-2 rounded-full text-sm font-bold text-white bg-accent hover:brightness-110 active:scale-[0.98] transition-all"
        >
          我知道了
        </button>
      </div>
    </div>
  );
}

function cursorAtCell(row: number, col: number): DemoCursor | null {
  const el = document.querySelector(`[data-row="${row}"][data-col="${col}"]`);
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  return { x: rect.left + rect.width * 0.5, y: rect.top + rect.height * 0.35 };
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function VocabWordSearch({
  story,
  onFinish,
  initialProgress,
  onProgressChange,
}: VocabWordSearchProps) {
  const { zhuyinActive, processZhuyin } = useZhuyin();
  const zh = (text: string) => zhuyinActive ? processZhuyin(text) : text;
  const zhuyinFont = fontForZhuyin(zhuyinActive);

  const vocabWords = useMemo(
    // Strip all whitespace from vocab words before grid generation.
    // Defensive guard: some YAML files historically stored words with spaces
    // between characters (e.g. '孤 寂 感' → '孤寂感', '提 案' → '提案').
    // Without stripping, space characters become blank-looking grid cells and
    // drag-selection never matches because selectedText !== word-with-spaces.
    () => (story.vocabulary ?? []).map((v) => v.word.replace(/\s+/g, '')).filter((w) => [...w].length >= 2),
    [story.vocabulary]
  );

  const {
    foundWords,
    highlightedCells,
    dragCells,
    dragStart,
    flashCells,
    finished,
    justFound,
    finishedElapsed,
    grid,
    placedWords,
    size,
    handleDragStart,
    handleDragMove,
    handleDragEnd,
    handleRedo,
  } = useWordSearchProgress(vocabWords, story.id, {
    initialProgress, onProgressChange, teacherSource: story.vocabReview,
  });

  const [showCoach, setShowCoach] = useState<boolean>(() => {
    try {
      return !localStorage.getItem(VOCAB_WORDSEARCH_ONBOARDED_KEY);
    } catch {
      return true;
    }
  });
  const [demo, setDemo] = useState<WordSearchDemoRuntime | null>(null);
  const [demoCursor, setDemoCursor] = useState<DemoCursor | null>(null);
  const demoTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearDemoTimers = useCallback(() => {
    demoTimersRef.current.forEach((id) => clearTimeout(id));
    demoTimersRef.current = [];
  }, []);

  const scheduleDemoStep = useCallback((fn: () => void, delayMs: number) => {
    const id = setTimeout(fn, delayMs);
    demoTimersRef.current.push(id);
    return id;
  }, []);

  useEffect(() => () => clearDemoTimers(), [clearDemoTimers]);

  const handleDismissCoach = useCallback(() => {
    setShowCoach(false);
    try {
      localStorage.setItem(VOCAB_WORDSEARCH_ONBOARDED_KEY, '1');
    } catch {
      // ignore
    }
  }, []);

  const demoTargetPlaced = useMemo(() => {
    if (placedWords.length === 0) return null;
    // 挑水平的示範最好懂。挑不到就退而求其次挑**直的**（overlayRects 回一塊 = 直線），
    // 最後才隨便挑一個 —— 拿斜線示範會讓學生以為只能斜著拖。
    const isStraight = (pw: PlacedWord) => overlayRects(pw, 1).length === 1;
    const horizontal = placedWords.find(
      (pw) => isStraight(pw)
        && (pw.cells?.length ? pw.cells.every((c) => c.row === pw.cells![0].row)
                             : pw.direction === 'horizontal')
    );
    return horizontal ?? placedWords.find(isStraight) ?? placedWords[0];
  }, [placedWords]);

  const handleDemo = useCallback(() => {
    clearDemoTimers();
    handleDismissCoach();
    const target = demoTargetPlaced;
    if (!target) return;

    const wordLen = [...target.word].length;
    const midIndex = Math.max(0, Math.floor(wordLen / 2));
    const endIndex = wordLen - 1;

    setDemo({ step: 'find-word', targetWord: target.word, highlightCells: new Set() });
    setDemoCursor(null);

    scheduleDemoStep(() => {
      setDemo({
        step: 'start-drag',
        targetWord: target.word,
        highlightCells: cellsAlongWord(target, 0),
      });
      setDemoCursor(cursorAtCell(target.row, target.col));
    }, 900);

    scheduleDemoStep(() => {
      setDemo({
        step: 'dragging',
        targetWord: target.word,
        highlightCells: cellsAlongWord(target, midIndex),
      });
      const at = cellAt(target, midIndex);
      setDemoCursor(cursorAtCell(at.row, at.col));
    }, 1800);

    scheduleDemoStep(() => {
      setDemo({
        step: 'dragging',
        targetWord: target.word,
        highlightCells: cellsAlongWord(target, endIndex),
      });
      const at = cellAt(target, endIndex);
      setDemoCursor(cursorAtCell(at.row, at.col));
    }, 2700);

    scheduleDemoStep(() => {
      setDemo({
        step: 'success',
        targetWord: target.word,
        highlightCells: cellsAlongWord(target, endIndex),
      });
      setDemoCursor(null);
    }, 3600);

    scheduleDemoStep(() => {
      setDemo(null);
      setDemoCursor(null);
    }, 5200);
  }, [clearDemoTimers, demoTargetPlaced, handleDismissCoach, scheduleDemoStep]);

  // Resolve a touch/mouse event to a grid cell position
  const resolveCell = useCallback((e: React.MouseEvent | React.TouchEvent): { row: number; col: number } | null => {
    let clientX: number;
    let clientY: number;
    if ('touches' in e) {
      if (e.touches.length === 0) return null;
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = (e as React.MouseEvent).clientX;
      clientY = (e as React.MouseEvent).clientY;
    }
    const el = document.elementFromPoint(clientX, clientY);
    if (!el) return null;
    const rowAttr = el.getAttribute('data-row');
    const colAttr = el.getAttribute('data-col');
    if (rowAttr === null || colAttr === null) return null;
    return { row: parseInt(rowAttr, 10), col: parseInt(colAttr, 10) };
  }, []);

  // Mouse handlers
  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (demo !== null) return;
      e.preventDefault();
      const pos = resolveCell(e);
      if (pos) handleDragStart(pos);
    },
    [demo, resolveCell, handleDragStart]
  );

  const onMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (demo !== null || !dragStart) return;
      const pos = resolveCell(e);
      if (pos) handleDragMove(pos);
    },
    [demo, dragStart, resolveCell, handleDragMove]
  );

  const onMouseUp = useCallback(
    (e: React.MouseEvent) => {
      if (demo !== null) return;
      const pos = resolveCell(e);
      if (pos) handleDragMove(pos);
      handleDragEnd();
    },
    [demo, resolveCell, handleDragMove, handleDragEnd]
  );

  // Touch handlers
  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (demo !== null) return;
      e.preventDefault();
      const pos = resolveCell(e);
      if (pos) handleDragStart(pos);
    },
    [demo, resolveCell, handleDragStart]
  );

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (demo !== null) return;
      e.preventDefault();
      const pos = resolveCell(e);
      if (pos) handleDragMove(pos);
    },
    [demo, resolveCell, handleDragMove]
  );

  const onTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (demo !== null) return;
      e.preventDefault();
      handleDragEnd();
    },
    [demo, handleDragEnd]
  );

  function getCellClass(row: number, col: number): string {
    const key = row + ',' + col;
    if (demo?.highlightCells.has(key)) {
      if (demo.step === 'success') return 'bg-emerald-100 text-emerald-800 font-black';
      return 'bg-indigo-300 text-white font-bold';
    }
    if (highlightedCells.has(key)) return 'bg-indigo-50 text-indigo-700 font-black';
    if (dragCells.has(key)) return 'bg-indigo-300 text-white font-bold';
    if (flashCells.has(key)) return 'bg-red-300 text-white';
    return 'bg-white text-gray-800 hover:bg-indigo-50';
  }

  // ---- Empty vocabulary state ----
  if (vocabWords.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-6 text-gray-500">
        <div className="text-5xl" aria-hidden="true">📚</div>
        <p className="text-base font-medium">本課無語詞資料，無法產生方格遊戲</p>
        <NextStepFooter onNext={() => onFinish(0)} label="繼續下一步" />
      </div>
    );
  }

  // Ensure minimum 44px touch targets per design guidelines; use larger cells for readability
  const cellSizePx = Math.max(48, Math.min(64, Math.floor((Math.min(520, window.innerWidth - 32)) / size)));
  const fontSizePx = Math.max(20, Math.floor(cellSizePx * 0.62));

  // Sort word list: unfound words first, found words at bottom
  const sortedPlacedWords = [...placedWords].sort((a, b) => {
    const aFound = foundWords.has(a.word) ? 1 : 0;
    const bFound = foundWords.has(b.word) ? 1 : 0;
    return aFound - bFound;
  });

  // Red border overlays for found words — use inset outline to avoid offset issues
  const OVERLAY_BORDER = 4;
  const foundWordOverlays = [
    ...placedWords
      .filter((pw) => foundWords.has(pw.word))
      // 逐格 or 一整條由 overlayRects 判斷 —— 教師版的表 30% 是斜線，
      // 靠 direction 推會畫成一根直條、蓋到不相干的格子（#2860 覆審 Finding 2）
      .flatMap((pw) => overlayRects(pw, cellSizePx).map((r) => ({ word: r.key, ...r }))),
    ...(demo?.step === 'success' && demoTargetPlaced
      ? overlayRects(demoTargetPlaced, cellSizePx).map((r) => ({
          word: `demo-${r.key}`, x: r.x, y: r.y, w: r.w, h: r.h,
        }))
      : []),
  ];

  return (
    <div className="flex-1 overflow-y-auto flex flex-col gap-4 px-4 md:px-8 py-6 select-none" style={{ fontFamily: zhuyinFont }}>
      {demoCursor && (
        <span
          className="fixed z-50 pointer-events-none text-xl"
          style={{
            left: demoCursor.x,
            top: demoCursor.y,
            transform: 'translate(-50%, -50%)',
            transition: 'left 0.7s ease-in-out, top 0.7s ease-in-out',
          }}
          aria-hidden
        >
          {IS_TOUCH_DEVICE ? '👆' : '🖱️'}
        </span>
      )}

      {/* Header */}
      <div className="text-center">
        <h2 className="text-lg font-bold text-on-surface">語詞複習</h2>
        {!showCoach ? (
          <div className="flex items-center justify-center gap-3 mt-0.5">
            <p className="text-sm text-on-surface-variant">
              {IS_TOUCH_DEVICE ? '水平或垂直滑過圈出語詞' : '水平或垂直拖曳圈出語詞'}
            </p>
            <button
              type="button"
              onClick={() => setShowCoach(true)}
              className="text-xs text-on-surface-variant/60 hover:text-on-surface-variant transition-colors flex items-center gap-1 shrink-0"
            >
              <span className="material-symbols-outlined text-sm">help_outline</span>
              怎麼玩？
            </button>
          </div>
        ) : (
          <p className="text-sm text-on-surface-variant mt-0.5">
            水平或垂直拖曳圈出語詞
          </p>
        )}
      </div>

      {/* Found toast */}
      {justFound && (
        <div
          className="fixed top-16 left-1/2 -translate-x-1/2 z-50 bg-emerald-500 text-white px-6 py-3 rounded-2xl font-bold text-base shadow-xl pointer-events-none animate-bounce-in"
          role="status"
          aria-live="polite"
        >
          找到「{justFound}」！
        </div>
      )}

      {/* Progress bar */}
      <div className="w-full max-w-2xl mx-auto">
        <div className="h-2.5 bg-surface-container-high rounded-full overflow-hidden">
          <div
            className="h-full bg-accent rounded-full transition-all duration-500 ease-out"
            role="progressbar"
            aria-valuenow={foundWords.size}
            aria-valuemin={0}
            aria-valuemax={placedWords.length}
            style={{
              width: placedWords.length === 0 ? '0%' : (foundWords.size / placedWords.length) * 100 + '%',
            }}
          />
        </div>
      </div>

      {/* Coach + game — shared width (grid + word list column) */}
      <div className="w-full max-w-3xl mx-auto flex flex-col gap-4">
        {demo?.step === 'find-word' && (
          <DemoBubble>① 先看右邊要找哪些語詞</DemoBubble>
        )}
        {demo?.step === 'start-drag' && (
          <DemoBubble>
            {IS_TOUCH_DEVICE ? '② 按住方格上的第一個字' : '② 按住方格上的第一個字'}
          </DemoBubble>
        )}
        {demo?.step === 'dragging' && (
          <DemoBubble>
            {IS_TOUCH_DEVICE ? '③ 手指滑過，水平或垂直圈出語詞' : '③ 拖曳圈出整個語詞'}
          </DemoBubble>
        )}
        {demo?.step === 'success' && (
          <DemoBubble>✓ 找到了！就是這樣玩</DemoBubble>
        )}

        {showCoach && <OnboardingCoach onDismiss={handleDismissCoach} onDemo={handleDemo} />}

      <div className="flex flex-col xl:flex-row gap-6 items-center xl:items-start justify-center">
        {/* Grid with red border overlays for found words */}
        <div
          className={`flex-shrink-0 touch-none cursor-crosshair border-2 shadow-sm transition-all duration-300 ${
            demo?.step === 'find-word'
              ? 'border-amber-300 ring-4 ring-amber-200/50'
              : 'border-gray-200'
          }`}
          style={{ position: 'relative' }}
          role="grid"
          aria-label="語詞方格，拖選字元以找出語詞"
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={() => { if (demo === null) handleDragEnd(); }}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
          <table className="border-collapse no-zhuyin" style={{ tableLayout: 'fixed' }}>
            <tbody>
              {grid.map((row, r) => (
                <tr key={r}>
                  {row.map((char, c) => (
                    <td
                      key={c}
                      data-row={r}
                      data-col={c}
                      className={
                        'border border-gray-100 text-center font-bold transition-colors duration-100 ' +
                        getCellClass(r, c)
                      }
                      style={{
                        width: cellSizePx + 'px',
                        height: cellSizePx + 'px',
                        fontSize: fontSizePx + 'px',
                        lineHeight: '1',
                        userSelect: 'none',
                        WebkitUserSelect: 'none',
                      }}
                    >
                      {char}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>

          {/* Red rounded borders drawn over found word cells */}
          {foundWordOverlays.map((ov) => (
            <div
              key={ov.word}
              aria-hidden="true"
              style={{
                position: 'absolute',
                left: ov.x,
                top: ov.y,
                width: ov.w,
                height: ov.h,
                outline: `${OVERLAY_BORDER}px solid #ef4444`,
                outlineOffset: `-${OVERLAY_BORDER}px`,
                borderRadius: 8,
                pointerEvents: 'none',
                zIndex: 10,
              }}
            />
          ))}
        </div>

        {/* Word list — compact wrapped pills */}
        <div className="w-full xl:w-56 shrink-0">
          <div className="flex items-center gap-2 mb-3 px-1">
            <span className="material-symbols-outlined text-on-surface-variant text-lg">search</span>
            <span className="text-sm font-headline font-bold text-on-surface-variant uppercase tracking-wider">尋找語詞</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {sortedPlacedWords.map((pw) => {
              const found = foundWords.has(pw.word);
              const isDemoTarget = demo?.targetWord === pw.word;
              const isDemoFound = demo?.step === 'success' && isDemoTarget;
              return (
                <span
                  key={pw.word}
                  className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-sm font-bold transition-all duration-300 ${
                    found || isDemoFound
                      ? 'bg-accent/10 text-accent line-through'
                      : isDemoTarget && demo?.step === 'find-word'
                      ? 'bg-amber-50 border-2 border-amber-400 text-amber-800 ring-4 ring-amber-300/40 shadow-md'
                      : 'bg-surface-container-lowest border border-surface-container-high text-on-surface shadow-sm'
                  }`}
                >
                  {(found || isDemoFound) && (
                    <span className="material-symbols-outlined text-sm">check_circle</span>
                  )}
                  {zh(pw.word)}
                </span>
              );
            })}
          </div>

          {placedWords.length < vocabWords.length && (
            <p className="text-xs text-on-surface-variant px-1 mt-2">
              部分語詞因空間不足未能放入
            </p>
          )}
        </div>
      </div>
      </div>

      {story.writingPractice && (
        <div className="max-w-2xl mx-auto w-full">
          <WritingPracticeSection
            label={story.writingPractice.label}
            instruction={story.writingPractice.instruction}
            words={story.writingPractice.words}
          />
        </div>
      )}

      {/* Completion — fixed bottom CTA */}
      {finished && (
        <div className="fixed bottom-16 left-0 w-full px-6 pb-8 pt-6 pointer-events-none z-20"
             style={{ background: 'linear-gradient(to top, #FBF6EE 60%, transparent)' }}>
          <div className="max-w-md mx-auto pointer-events-auto flex flex-col gap-2">
            {isToolboxMode() ? (
              <ToolboxCompletionActions onRetry={handleRedo} className="w-full" />
            ) : (
              <>
                <button
                  onClick={handleRedo}
                  className="w-full h-12 rounded-full font-headline font-bold text-base text-on-surface bg-surface-container-lowest shadow-editorial hover:bg-surface-container-low active:scale-[0.98] transition-all"
                >
                  重新練習
                </button>
                <NextStepFooter onNext={() => onFinish(finishedElapsed)} label="繼續下一步" />
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
