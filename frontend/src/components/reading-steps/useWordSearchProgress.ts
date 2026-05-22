/**
 * useWordSearchProgress — timer, localStorage, completion, redo (Issue #1856)
 *
 * Extracted from VocabWordSearch.tsx.
 * Manages: timer, found words, highlighted cells, completion state, redo.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { scopedStepStorageKey } from '../../services/learningStorageScope';
import { PlacedWord, wordCellKeys, generateGrid } from './wordSearchGrid';

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
  // Actions
  handleDragStart: (pos: { row: number; col: number }) => void;
  handleDragMove: (pos: { row: number; col: number }) => void;
  handleDragEnd: () => void;
  handleRedo: () => void;
}

export function useWordSearchProgress(
  vocabWords: string[],
  storyId: string
): WordSearchProgressReturn {
  const storageKey = scopedStepStorageKey('wordSearch_progress_', storyId);

  const loadSaved = () => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return null;
      return JSON.parse(raw) as { foundWords: string[]; elapsedTime: number; completed?: boolean };
    } catch { return null; }
  };
  const savedRef = useRef(loadSaved());

  const [redoKey, setRedoKey] = useState(0);

  const { grid, placedWords, size } = useMemo(() => {
    if (vocabWords.length === 0) return { grid: [], placedWords: [], size: 0 };
    return generateGrid(vocabWords);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vocabWords, redoKey]);

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
      setFinishedElapsed(elapsed);
      // #816: persist completion — do NOT removeItem here
      try {
        localStorage.setItem(storageKey, JSON.stringify({
          foundWords: Array.from(foundWords),
          elapsedTime: elapsed,
          completed: true,
        }));
      } catch {}
    }
  }, [allFound, finished, elapsed, storageKey, foundWords]);

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
    wordKeysMap,
    handleDragStart,
    handleDragMove,
    handleDragEnd,
    handleRedo,
  };
}
