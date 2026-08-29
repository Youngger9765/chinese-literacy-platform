/**
 * useWordSearchProgress — timer, localStorage, completion, redo (Issue #1856)
 *
 * Extracted from VocabWordSearch.tsx.
 * Manages: timer, found words, highlighted cells, completion state, redo.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { scopedStepStorageKey } from '../../services/learningStorageScope';
import {
  PlacedWord, wordCellKeys, generateGrid,
  buildTeacherGrid, TeacherWordSearchSource,
} from './wordSearchGrid';

// ---------------------------------------------------------------------------
// Timer hook (elapsed tracking only; not displayed in UI)
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

// ---------------------------------------------------------------------------
// useWordSearchProgress
// ---------------------------------------------------------------------------

export interface WordSearchProgressReturn {
  // State
  foundWords: Set<string>;
  highlightedCells: Set<string>;
  dragCells: Set<string>;
  dragStart: { row: number; col: number } | null;
  flashCells: Set<string>;
  finished: boolean;
  justFound: string | null;
  finishedElapsed: number;
  elapsed: number;
  redoKey: number;
  // Grid (derived from redoKey)
  grid: string[][];
  placedWords: PlacedWord[];
  size: number;
  wordKeysMap: Map<string, Set<string>>;
  /**
   * 這張表哪來的（#2860）。`teacher` = 老師出的那張；`generated` = 這課沒有，自己生的。
   * ⛔ 一定要露出來 —— 靜默降級會讓 QA 看到格子就當成功，
   * 那正是 useTtsPlayback 降級成瀏覽器機器音沒被發現的形狀。
   */
  gridSource: 'teacher' | 'generated';
  // Actions
  handleDragStart: (pos: { row: number; col: number }) => void;
  handleDragMove: (pos: { row: number; col: number }) => void;
  handleDragEnd: () => void;
  handleRedo: () => void;
}

/**
 * 一次遊戲的進度快照。localStorage 與 DB 存的是同一份東西（#2848）。
 */
export interface WordSearchProgress {
  foundWords: string[];
  elapsedTime: number;
  completed?: boolean;
}

export interface WordSearchProgressOptions {
  /**
   * #2848 — 先前存下的進度（DB 優先於 localStorage）。
   * 沒給就退回 localStorage，跟這個 hook 原本的行為一樣。
   */
  initialProgress?: WordSearchProgress | null;
  /**
   * #2860 — 老師出的那張找字表（`story.vocabReview`）。給了就用它，
   * 不給才自己生格子。⚠️ 這裡收的是**內容**不是參考：
   * 下面 memo 依 JSON 字串，因為任何上層 `{...story}` 都會換掉參考，
   * 而重建格子會讓 `foundWords`（按詞存）跟 `highlightedCells`（按座標存）對不上。
   */
  teacherSource?: TeacherWordSearchSource | null;
  /**
   * #2848 — 進度變動時回報一次，讓它進得了 DB。
   *
   * 這個 callback 之前不存在，是這一關的根因：整個 hook 沒有任何 API import，
   * 找到的字只寫 localStorage，`VocabReviewPage` 連 `saveStepProgressPatch` 都
   * 沒拿。學生換裝置或清快取，找到的字全部消失。
   */
  onProgressChange?: (progress: WordSearchProgress) => void;
}

export function useWordSearchProgress(
  vocabWords: string[],
  storyId: string,
  options: WordSearchProgressOptions = {}
): WordSearchProgressReturn {
  const { initialProgress, onProgressChange } = options;
  const storageKey = scopedStepStorageKey('wordSearch_progress_', storyId);

  const loadSaved = () => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return null;
      return JSON.parse(raw) as WordSearchProgress;
    } catch { return null; }
  };
  // #2848: DB 快照優先，localStorage 只是離線 / 尚未載入時的 L1 快取。
  const savedRef = useRef<WordSearchProgress | null>(initialProgress ?? loadSaved());

  const [redoKey, setRedoKey] = useState(0);

  // 依**內容**不依**參考**（#2860）。`teacherSource` 是 `story.vocabReview`，
  // 只要任何上層每次 render 造一個新的 story 物件（`{...story}`），
  // 直接把它放進依賴陣列就會每次重建格子 —— 而 `foundWords` 按詞存、
  // `highlightedCells` 按座標存，重建之後學生做到一半的高亮就對不上了。
  // 一課的表約 100 字，序列化的成本遠低於它防的那個 bug。
  const teacherSource = options.teacherSource;
  const teacherKey = teacherSource ? JSON.stringify(teacherSource) : '';

  const { grid, placedWords, size, gridSource } = useMemo(() => {
    // 老師出的表優先（#2860）。150 課抽了卻從沒送到學生面前。
    const teacher = buildTeacherGrid(teacherSource);
    if (teacher) return { ...teacher, gridSource: 'teacher' as const };
    if (vocabWords.length === 0) {
      return { grid: [], placedWords: [], size: 0, gridSource: 'generated' as const };
    }
    return { ...generateGrid(vocabWords), gridSource: 'generated' as const };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vocabWords, redoKey, teacherKey]);

  const wordKeysMap = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const pw of placedWords) {
      map.set(pw.word, wordCellKeys(pw));
    }
    return map;
  }, [placedWords]);

  const [foundWords, setFoundWords] = useState<Set<string>>(
    () => new Set(savedRef.current?.foundWords ?? [])
  );
  const [highlightedCells, setHighlightedCells] = useState<Set<string>>(new Set());
  const [dragCells, setDragCells] = useState<Set<string>>(new Set());
  const [dragStart, setDragStart] = useState<{ row: number; col: number } | null>(null);
  const [flashCells, setFlashCells] = useState<Set<string>>(new Set());
  // #816: start as finished=true if localStorage records a completed session
  const [finished, setFinished] = useState(() => savedRef.current?.completed === true);
  const [justFound, setJustFound] = useState<string | null>(null);
  // #816: time at completion (restored from localStorage for the completion screen)
  const [finishedElapsed, setFinishedElapsed] = useState<number>(
    savedRef.current?.completed ? (savedRef.current.elapsedTime ?? 0) : 0
  );

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

  const allFound = foundWords.size === placedWords.length && placedWords.length > 0;
  const timerRunning = !finished && vocabWords.length > 0;
  const elapsed = useTimer(timerRunning);

  // ── localStorage + DB persistence (#2848) ───────────────────────────
  // 只在「找到的字」變動時送，不跟著 `elapsed` 每 500ms 跳一次 —— 否則計時器
  // 會把進度端點打成每半秒一次。時間仍然一起存，只是由找到字這件事觸發。
  const elapsedRef = useRef(elapsed);
  elapsedRef.current = elapsed;
  useEffect(() => {
    if (foundWords.size === 0) return;
    const progress: WordSearchProgress = {
      foundWords: Array.from(foundWords),
      elapsedTime: elapsedRef.current,
    };
    try { localStorage.setItem(storageKey, JSON.stringify(progress)); } catch {}
    // 同一份快照也往上送。跟 localStorage 綁在同一個 effect 是刻意的：兩邊存的
    // 是同一個東西，一起壞一起好，不會出現「localStorage 有、DB 沒有」那種
    // 換裝置才發現的落差。
    onProgressChange?.(progress);
  }, [foundWords, storageKey, onProgressChange]);

  useEffect(() => {
    if (allFound && !finished) {
      setFinished(true);
      setFinishedElapsed(elapsed);
      // #816: persist completion — do NOT removeItem here
      const progress: WordSearchProgress = {
        foundWords: Array.from(foundWords),
        elapsedTime: elapsed,
        completed: true,
      };
      try { localStorage.setItem(storageKey, JSON.stringify(progress)); } catch {}
      onProgressChange?.(progress);
    }
  }, [allFound, finished, elapsed, storageKey, foundWords, onProgressChange]);

  // ── Drag handlers ────────────────────────────────────────────────────

  const handleDragStart = useCallback((pos: { row: number; col: number }) => {
    setDragStart(pos);
    setDragCells(new Set([pos.row + ',' + pos.col]));
  }, []);

  const handleDragMove = useCallback(
    (pos: { row: number; col: number }) => {
      if (!dragStart) return;
      // getCellsBetween imported inline to avoid circular dependency risk
      const dr = pos.row - dragStart.row;
      const dc = pos.col - dragStart.col;
      const cells: Array<{ row: number; col: number }> = [];
      if (dr === 0 && dc === 0) {
        cells.push(dragStart);
      } else if (dr === 0) {
        const step = dc > 0 ? 1 : -1;
        for (let c = dragStart.col; c !== pos.col + step; c += step) {
          cells.push({ row: dragStart.row, col: c });
        }
      } else if (dc === 0) {
        const step = dr > 0 ? 1 : -1;
        for (let r = dragStart.row; r !== pos.row + step; r += step) {
          cells.push({ row: r, col: dragStart.col });
        }
      } else {
        cells.push(dragStart);
      }
      setDragCells(new Set(cells.map(c => c.row + ',' + c.col)));
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

  // ── Redo ─────────────────────────────────────────────────────────────

  const handleRedo = useCallback(() => {
    // Clear localStorage so completion state is gone
    try { localStorage.removeItem(storageKey); } catch {}
    // Reset all game state; incrementing redoKey regenerates the grid via useMemo
    setFoundWords(new Set());
    setHighlightedCells(new Set());
    setDragCells(new Set());
    setDragStart(null);
    setFlashCells(new Set());
    setFinished(false);
    setFinishedElapsed(0);
    setJustFound(null);
    setRedoKey((k) => k + 1);
  }, [storageKey]);

  return {
    foundWords,
    highlightedCells,
    dragCells,
    dragStart,
    flashCells,
    finished,
    justFound,
    finishedElapsed,
    elapsed,
    redoKey,
    grid,
    placedWords,
    size,
    gridSource,
    wordKeysMap,
    handleDragStart,
    handleDragMove,
    handleDragEnd,
    handleRedo,
  };
}
