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

import React, { useCallback, useMemo } from 'react';
import { Story } from '../../types';
import { isToolboxMode } from '../../services/learningStorageScope';
import { useZhuyin } from '../../context/ZhuyinContext';
import { fontForZhuyin } from '../../constants/fonts';
import ToolboxCompletionActions from '../tools/ToolboxCompletionActions';
import { useWordSearchProgress } from './useWordSearchProgress';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface VocabWordSearchProps {
  story: Story;
  onFinish: (elapsedSeconds: number) => void;
  zhuyinActive?: boolean;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function VocabWordSearch({ story, onFinish }: VocabWordSearchProps) {
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
  } = useWordSearchProgress(vocabWords, story.id);

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
      e.preventDefault();
      const pos = resolveCell(e);
      if (pos) handleDragStart(pos);
    },
    [resolveCell, handleDragStart]
  );

  const onMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!dragStart) return;
      const pos = resolveCell(e);
      if (pos) handleDragMove(pos);
    },
    [dragStart, resolveCell, handleDragMove]
  );

  const onMouseUp = useCallback(
    (e: React.MouseEvent) => {
      const pos = resolveCell(e);
      if (pos) handleDragMove(pos);
      handleDragEnd();
    },
    [resolveCell, handleDragMove, handleDragEnd]
  );

  // Touch handlers
  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      e.preventDefault();
      const pos = resolveCell(e);
      if (pos) handleDragStart(pos);
    },
    [resolveCell, handleDragStart]
  );

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      e.preventDefault();
      const pos = resolveCell(e);
      if (pos) handleDragMove(pos);
    },
    [resolveCell, handleDragMove]
  );

  const onTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      e.preventDefault();
      handleDragEnd();
    },
    [handleDragEnd]
  );

  function getCellClass(row: number, col: number): string {
    const key = row + ',' + col;
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
        <button
          onClick={() => onFinish(0)}
          className="mt-2 px-6 py-2.5 bg-indigo-600 text-white rounded-full text-sm font-bold hover:bg-indigo-700 active:scale-95 transition-all shadow-sm min-h-[44px]"
        >
          繼續下一步
        </button>
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
  const foundWordOverlays = placedWords
    .filter((pw) => foundWords.has(pw.word))
    .map((pw) => {
      const wordLen = [...pw.word].length;
      const x = pw.col * cellSizePx;
      const y = pw.row * cellSizePx;
      const w = pw.direction === 'horizontal' ? wordLen * cellSizePx : cellSizePx;
      const h = pw.direction === 'vertical' ? wordLen * cellSizePx : cellSizePx;
      return { word: pw.word, x, y, w, h };
    });

  return (
    <div className="flex-1 overflow-y-auto flex flex-col gap-4 px-4 md:px-8 py-6 select-none" style={{ fontFamily: zhuyinFont }}>
      {/* Header */}
      <div className="text-center">
        <h2 className="text-lg font-bold text-on-surface">語詞複習</h2>
        <p className="text-sm text-on-surface-variant mt-0.5">
          水平或垂直拖曳圈出語詞
        </p>
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

      <div className="flex flex-col xl:flex-row gap-6 items-center xl:items-start justify-center">
        {/* Grid with red border overlays for found words */}
        <div
          className="flex-shrink-0 touch-none cursor-crosshair border-2 border-gray-200 shadow-sm"
          style={{ position: 'relative' }}
          role="grid"
          aria-label="語詞方格，拖選字元以找出語詞"
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={handleDragEnd}
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
              return (
                <span
                  key={pw.word}
                  className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-sm font-bold transition-all duration-300 ${
                    found
                      ? 'bg-accent/10 text-accent line-through'
                      : 'bg-surface-container-lowest border border-surface-container-high text-on-surface shadow-sm'
                  }`}
                >
                  {found && (
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
                <button
                  onClick={() => onFinish(finishedElapsed)}
                  className="w-full h-14 rounded-full font-headline font-bold text-xl text-white shadow-[0_12px_48px_rgba(86,74,191,0.3)] hover:brightness-110 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                  style={{ background: 'linear-gradient(135deg, #564ABF, #9D93FF)' }}
                >
                  繼續下一步
                  <span className="material-symbols-outlined text-xl">arrow_forward</span>
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
