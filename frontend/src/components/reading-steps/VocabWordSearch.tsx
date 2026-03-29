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
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Story } from '../../types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface VocabWordSearchProps {
  story: Story;
  onFinish: (elapsedSeconds: number) => void;
  zhuyinActive?: boolean;
}

type Direction = 'horizontal' | 'vertical';

interface PlacedWord {
  word: string;
  row: number;
  col: number;
  direction: Direction;
}

interface CellPos {
  row: number;
  col: number;
}

// ---------------------------------------------------------------------------
// Common Chinese characters pool (for filling empty cells)
// ---------------------------------------------------------------------------

const FILLER_CHARS: string[] = [
  '\u7684', '\u4e00', '\u662f', '\u5728', '\u4e0d', '\u4e86', '\u6709', '\u548c',
  '\u4eba', '\u9019', '\u4e2d', '\u5927', '\u70ba', '\u4e0a', '\u500b', '\u570b',
  '\u6211', '\u4ee5', '\u8981', '\u4ed6', '\u6642', '\u4f86', '\u7528', '\u5011',
  '\u751f', '\u5230', '\u4f5c', '\u5730', '\u65bc', '\u51fa', '\u5c31', '\u5206',
  '\u5c0d', '\u6210', '\u6703', '\u53ef', '\u4e3b', '\u767c', '\u5e74', '\u52d5',
  '\u540c', '\u5de5', '\u4e5f', '\u80fd', '\u4e0b', '\u904e', '\u5b50', '\u8aaa',
  '\u7522', '\u8986', '\u9762', '\u800c', '\u65b9', '\u5f8c', '\u591a', '\u5b9a',
  '\u884c', '\u5b78', '\u6cd5', '\u6240', '\u6c11', '\u5f97', '\u7d93', '\u5341',
  '\u4e09', '\u4e4b', '\u9032', '\u8457', '\u7b49', '\u90e8', '\u5ea6', '\u5bb6',
  '\u96fb', '\u529b', '\u88e1', '\u5982', '\u6c34', '\u5316', '\u9ad8', '\u81ea',
  '\u4e8c', '\u7406', '\u8d77', '\u5c0f', '\u7269', '\u73fe', '\u5be6', '\u52a0',
  '\u91cf', '\u90fd', '\u5169', '\u9ad4', '\u5236', '\u6a5f', '\u7576', '\u4f7f',
  '\u9ede', '\u5f9e', '\u696d', '\u672c', '\u53bb', '\u628a', '\u6027', '\u597d',
  '\u61c9', '\u958b', '\u5b83', '\u5408', '\u9084', '\u56e0', '\u7531', '\u5176',
  '\u4e9b', '\u7136', '\u524d', '\u5916', '\u5929', '\u653f', '\u56db', '\u65e5',
  '\u90a3', '\u793e', '\u7fa9', '\u4e8b', '\u5e73', '\u5f62', '\u76f8', '\u5168',
  '\u8868', '\u9593', '\u6a23', '\u8207', '\u95dc', '\u5404', '\u91cd', '\u65b0',
  '\u7dda', '\u5167', '\u6578', '\u6b63', '\u5fc3', '\u53cd', '\u4f60', '\u660e',
  '\u770b', '\u539f', '\u53c8', '\u5229', '\u6bd4', '\u6216', '\u4f46', '\u8cea',
  '\u6c23', '\u7b2c', '\u5411', '\u9053', '\u547d', '\u6b64', '\u8b8a', '\u689d',
];

function randomFiller(): string {
  return FILLER_CHARS[Math.floor(Math.random() * FILLER_CHARS.length)];
}

// ---------------------------------------------------------------------------
// Grid generation
// ---------------------------------------------------------------------------

function shuffleArray<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = a[i];
    a[i] = a[j];
    a[j] = tmp;
  }
  return a;
}

function calcGridSize(words: string[]): number {
  const chars = words.map((w) => [...w]);
  const maxLen = Math.max(...chars.map((c) => c.length));
  const totalChars = chars.reduce((s, c) => s + c.length, 0);
  const minSize = Math.max(maxLen + 2, Math.ceil(Math.sqrt(totalChars * 2.5)));
  // Clamp between 8 and 14
  return Math.max(8, Math.min(14, minSize));
}

function tryPlaceWord(
  grid: string[][],
  word: string,
  size: number,
  direction: Direction,
  row: number,
  col: number
): boolean {
  const chars = [...word];
  // Check bounds and conflicts
  for (let i = 0; i < chars.length; i++) {
    const r = direction === 'vertical' ? row + i : row;
    const c = direction === 'horizontal' ? col + i : col;
    if (r < 0 || r >= size || c < 0 || c >= size) return false;
    if (grid[r][c] !== '' && grid[r][c] !== chars[i]) return false;
  }
  // Place
  for (let i = 0; i < chars.length; i++) {
    const r = direction === 'vertical' ? row + i : row;
    const c = direction === 'horizontal' ? col + i : col;
    grid[r][c] = chars[i];
  }
  return true;
}

interface GeneratedGrid {
  grid: string[][];
  placedWords: PlacedWord[];
  size: number;
}

function generateGrid(words: string[]): GeneratedGrid {
  const size = calcGridSize(words);
  const grid: string[][] = Array.from({ length: size }, () =>
    Array(size).fill('')
  );
  const placedWords: PlacedWord[] = [];
  const dirs: Direction[] = ['horizontal', 'vertical'];

  for (const word of shuffleArray(words)) {
    const wordLen = [...word].length;
    let placed = false;

    for (let attempt = 0; attempt < 200 && !placed; attempt++) {
      const dir = dirs[Math.floor(Math.random() * 2)];
      const maxRow = dir === 'vertical' ? size - wordLen : size - 1;
      const maxCol = dir === 'horizontal' ? size - wordLen : size - 1;
      if (maxRow < 0 || maxCol < 0) continue;
      const row = Math.floor(Math.random() * (maxRow + 1));
      const col = Math.floor(Math.random() * (maxCol + 1));

      if (tryPlaceWord(grid, word, size, dir, row, col)) {
        placedWords.push({ word, row, col, direction: dir });
        placed = true;
      }
    }
    // If not placed after 200 attempts, skip word
  }

  // Fill remaining empty cells
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (grid[r][c] === '') {
        grid[r][c] = randomFiller();
      }
    }
  }

  return { grid, placedWords, size };
}

// ---------------------------------------------------------------------------
// Cell key helpers
// ---------------------------------------------------------------------------

function wordCellKeys(placed: PlacedWord): Set<string> {
  const keys = new Set<string>();
  const chars = [...placed.word];
  for (let i = 0; i < chars.length; i++) {
    const r = placed.direction === 'vertical' ? placed.row + i : placed.row;
    const c = placed.direction === 'horizontal' ? placed.col + i : placed.col;
    keys.add(r + ',' + c);
  }
  return keys;
}

function cellKey(pos: CellPos): string {
  return pos.row + ',' + pos.col;
}

// ---------------------------------------------------------------------------
// Timer hook (kept for elapsed tracking; not displayed in UI)
// ---------------------------------------------------------------------------

function useTimer(running: boolean): number {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef<number>(Date.now());

  useEffect(() => {
    if (!running) return;
    startRef.current = Date.now() - elapsed * 1000;
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 500);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  return elapsed;
}

function formatTime(secs: number): string {
  const m = Math.floor(secs / 60).toString().padStart(2, '0');
  const s = (secs % 60).toString().padStart(2, '0');
  return m + ':' + s;
}

// ---------------------------------------------------------------------------
// Drag selection: straight lines only
// ---------------------------------------------------------------------------

function getCellsBetween(start: CellPos, end: CellPos): CellPos[] {
  const cells: CellPos[] = [];
  const dr = end.row - start.row;
  const dc = end.col - start.col;

  if (dr === 0 && dc === 0) {
    cells.push(start);
  } else if (dr === 0) {
    const step = dc > 0 ? 1 : -1;
    for (let c = start.col; c !== end.col + step; c += step) {
      cells.push({ row: start.row, col: c });
    }
  } else if (dc === 0) {
    const step = dr > 0 ? 1 : -1;
    for (let r = start.row; r !== end.row + step; r += step) {
      cells.push({ row: r, col: start.col });
    }
  } else {
    // Diagonal not supported -- return just start
    cells.push(start);
  }
  return cells;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function VocabWordSearch({ story, onFinish }: VocabWordSearchProps) {
  const storageKey = `wordSearch_progress_${story.id}`;
  const loadSaved = () => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return null;
      return JSON.parse(raw) as { foundWords: string[]; elapsedTime: number };
    } catch { return null; }
  };
  const savedRef = useRef(loadSaved());

  const vocabWords = useMemo(
    () => (story.vocabulary ?? []).map((v) => v.word).filter((w) => [...w].length >= 2),
    [story.vocabulary]
  );

  const { grid, placedWords, size } = useMemo(() => {
    if (vocabWords.length === 0) return { grid: [], placedWords: [], size: 0 };
    return generateGrid(vocabWords);
  }, [vocabWords]);

  const wordKeysMap = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const pw of placedWords) {
      map.set(pw.word, wordCellKeys(pw));
    }
    return map;
  }, [placedWords]);

  const [foundWords, setFoundWords] = useState<Set<string>>(() => new Set(savedRef.current?.foundWords ?? []));
  const [highlightedCells, setHighlightedCells] = useState<Set<string>>(() => {
    const saved = savedRef.current?.foundWords ?? [];
    if (saved.length === 0) return new Set<string>();
    return new Set<string>();
  });
  const [dragCells, setDragCells] = useState<Set<string>>(new Set());
  const [dragStart, setDragStart] = useState<CellPos | null>(null);
  const [flashCells, setFlashCells] = useState<Set<string>>(new Set());
  const [finished, setFinished] = useState(false);
  const [justFound, setJustFound] = useState<string | null>(null);

  // Restore highlighted cells for already-found words on mount
  useEffect(() => {
    if (savedRef.current?.foundWords && savedRef.current.foundWords.length > 0) {
      const restoredCells = new Set<string>();
      for (const word of savedRef.current.foundWords) {
        const keys = wordKeysMap.get(word);
        if (keys) keys.forEach(k => restoredCells.add(k));
      }
      if (restoredCells.size > 0) {
        setHighlightedCells(restoredCells);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const timerRunning = !finished && vocabWords.length > 0;
  const elapsed = useTimer(timerRunning);
  const allFound = foundWords.size === placedWords.length && placedWords.length > 0;

  // ── localStorage persistence ────────────────────────────────────────
  useEffect(() => {
    if (foundWords.size === 0) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify({
        foundWords: Array.from(foundWords),
        elapsedTime: elapsed,
      }));
    } catch {}
  }, [foundWords, elapsed, storageKey]);

  useEffect(() => {
    if (allFound && !finished) {
      setFinished(true);
      try { localStorage.removeItem(storageKey); } catch {}
      setTimeout(() => onFinish(elapsed), 800);
    }
  }, [allFound, finished, onFinish, elapsed, storageKey]);

  // Resolve a touch/mouse event to a grid cell position
  const resolveCell = useCallback((e: React.MouseEvent | React.TouchEvent): CellPos | null => {
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

  const handleDragStart = useCallback((pos: CellPos) => {
    setDragStart(pos);
    setDragCells(new Set([cellKey(pos)]));
  }, []);

  const handleDragMove = useCallback(
    (pos: CellPos) => {
      if (!dragStart) return;
      const cells = getCellsBetween(dragStart, pos);
      setDragCells(new Set(cells.map(cellKey)));
    },
    [dragStart]
  );

  const handleDragEnd = useCallback(() => {
    if (!dragStart || dragCells.size === 0) {
      setDragStart(null);
      setDragCells(new Set());
      return;
    }

    const selectedChars = [...dragCells].map((key) => {
      const parts = key.split(',');
      const r = parseInt(parts[0], 10);
      const c = parseInt(parts[1], 10);
      return grid[r]?.[c] ?? '';
    });
    const selectedText = selectedChars.join('');
    const selectedReverse = selectedChars.slice().reverse().join('');

    let matchedWord: string | null = null;
    for (const pw of placedWords) {
      if (foundWords.has(pw.word)) continue;
      if (selectedText === pw.word || selectedReverse === pw.word) {
        matchedWord = pw.word;
        break;
      }
    }

    if (matchedWord) {
      const wordKeys = wordKeysMap.get(matchedWord) ?? new Set<string>();
      setHighlightedCells((prev) => {
        const next = new Set(prev);
        wordKeys.forEach((k) => next.add(k));
        return next;
      });
      const captured = matchedWord;
      setFoundWords((prev) => {
        const next = new Set(prev);
        next.add(captured);
        return next;
      });
      setJustFound(captured);
      setTimeout(() => setJustFound(null), 1200);
    } else if (dragCells.size > 1) {
      const wrongCells = new Set(dragCells);
      setFlashCells(wrongCells);
      setTimeout(() => setFlashCells(new Set()), 500);
    }

    setDragStart(null);
    setDragCells(new Set());
  }, [dragStart, dragCells, grid, placedWords, foundWords, wordKeysMap]);

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
          className="mt-2 px-8 py-3 bg-indigo-600 text-white rounded-xl text-base font-bold hover:bg-indigo-700 active:scale-95 transition-all shadow-md min-h-[52px]"
        >
          繼續下一步
        </button>
      </div>
    );
  }

  // ---- Completion screen ----
  if (finished) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-8 animate-fade-in">
        <div className="text-8xl animate-bounce-in" role="img" aria-label="慶祝">🎉</div>
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl px-10 py-6 text-center shadow-sm">
          <h2 className="text-3xl font-black text-emerald-700 mb-2">全部找到了！</h2>
          <p className="text-gray-500 text-base">共花了 <span className="font-bold text-gray-700">{formatTime(elapsed)}</span></p>
        </div>
        <div className="flex flex-wrap gap-3 justify-center max-w-sm">
          {placedWords.map((pw) => (
            <span
              key={pw.word}
              className="px-4 py-2 bg-emerald-100 text-emerald-800 rounded-xl text-base font-bold border border-emerald-200"
            >
              ✓ {pw.word}
            </span>
          ))}
        </div>
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

  // Red border overlays for found words — absolutely positioned over the grid
  const BORDER_INSET = 3; // px inset from cell edge for a tighter look
  const foundWordOverlays = placedWords
    .filter((pw) => foundWords.has(pw.word))
    .map((pw) => {
      const wordLen = [...pw.word].length;
      const x = pw.col * cellSizePx + BORDER_INSET;
      const y = pw.row * cellSizePx + BORDER_INSET;
      const w = pw.direction === 'horizontal'
        ? wordLen * cellSizePx - BORDER_INSET * 2
        : cellSizePx - BORDER_INSET * 2;
      const h = pw.direction === 'vertical'
        ? wordLen * cellSizePx - BORDER_INSET * 2
        : cellSizePx - BORDER_INSET * 2;
      return { word: pw.word, x, y, w, h };
    });

  const gridTotalPx = size * cellSizePx;

  return (
    <div className="flex flex-col gap-4 px-2 py-4 select-none">
      {/* Header */}
      <div className="px-2">
        <h2 className="text-lg font-black text-gray-800">語詞複習</h2>
        <p className="text-sm text-gray-500 mt-0.5 font-medium">
          找出
          <span className="font-black text-indigo-700 mx-1">{foundWords.size}</span>
          /
          <span className="mx-1">{placedWords.length}</span>
          個語詞
        </p>
      </div>

      {/* Progress bar */}
      <div className="px-2">
        <div className="h-4 bg-gray-100 rounded-full overflow-hidden shadow-inner">
          <div
            className="h-full bg-gradient-to-r from-emerald-400 to-emerald-500 rounded-full transition-all duration-500 ease-out"
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

      {/* Found toast */}
      {justFound && (
        <div
          className="fixed top-16 left-1/2 -translate-x-1/2 z-50 bg-emerald-500 text-white px-6 py-3 rounded-2xl font-black text-base shadow-xl pointer-events-none animate-bounce-in"
          role="status"
          aria-live="polite"
        >
          找到「{justFound}」！
        </div>
      )}

      <div className="flex flex-col xl:flex-row gap-6 items-center xl:items-start justify-center">
        {/* Grid with red border overlays for found words */}
        <div
          className="flex-shrink-0 touch-none cursor-crosshair rounded-2xl overflow-hidden border-2 border-gray-200 shadow-sm"
          style={{ position: 'relative', width: gridTotalPx, height: gridTotalPx }}
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
          <table className="border-collapse" style={{ tableLayout: 'fixed' }}>
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
                border: '4px solid #ef4444',
                borderRadius: 10,
                pointerEvents: 'none',
                boxSizing: 'border-box',
                zIndex: 10,
              }}
            />
          ))}
        </div>

        {/* Word list — unfound at top, found at bottom */}
        <div className="flex flex-col gap-3 w-full xl:w-52 max-w-sm mx-auto xl:mx-0">
          <h3 className="text-sm font-black text-gray-600 uppercase tracking-wide px-1">
            待找語詞
          </h3>
          <div className="flex flex-wrap xl:flex-col gap-2 justify-center xl:justify-start">
            {sortedPlacedWords.map((pw) => {
              const found = foundWords.has(pw.word);
              const vocabItem = story.vocabulary?.find((v) => v.word === pw.word);
              return (
                <div
                  key={pw.word}
                  className={
                    'flex items-center gap-2 px-4 py-3 rounded-xl border-2 transition-all duration-300 min-h-[52px] ' +
                    (found
                      ? 'bg-[#5B4FC4]/10 border-[#5B4FC4]/40'
                      : 'bg-white border-gray-200')
                  }
                >
                  {found ? (
                    <svg
                      className="w-5 h-5 text-[#5B4FC4] flex-shrink-0"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                      aria-label="已找到"
                    >
                      <path
                        fillRule="evenodd"
                        d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                        clipRule="evenodd"
                      />
                    </svg>
                  ) : (
                    <span className="w-5 h-5 flex-shrink-0 rounded-full border-2 border-dashed border-gray-300" />
                  )}
                  <span
                    className={
                      'text-lg font-black ' +
                      (found ? 'text-[#5B4FC4] line-through' : 'text-gray-800')
                    }
                  >
                    {pw.word}
                  </span>
                  {!found && vocabItem?.definition && (
                    <span
                      className="hidden xl:block text-xs text-gray-400 truncate flex-1"
                      title={vocabItem.definition}
                    >
                      {vocabItem.definition.length > 16
                        ? vocabItem.definition.slice(0, 16) + '...'
                        : vocabItem.definition}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {placedWords.length < vocabWords.length && (
            <p className="text-xs text-amber-600 px-1 mt-1">
              注意：部分語詞因方格空間不足未能放入
            </p>
          )}
        </div>
      </div>

      {/* Instructions */}
      <p className="text-sm text-gray-400 text-center px-4 mt-2 bg-gray-50 rounded-xl py-2.5 mx-2">
        拖曳選取字元，水平或垂直圈出語詞
      </p>
    </div>
  );
}
