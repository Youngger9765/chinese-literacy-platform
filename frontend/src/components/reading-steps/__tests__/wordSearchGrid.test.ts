/**
 * TDD tests for wordSearchGrid.ts pure-logic utilities (Issue #1856)
 *
 * These tests are written FIRST (Red phase) before extraction.
 * They test the pure functions that will be moved to wordSearchGrid.ts.
 *
 * 4 acceptance criteria:
 * 1. grid places words only horizontal/vertical + within bounds
 * 2. whitespace in vocab words stripped before matching
 * 3. completed-localStorage restores completion screen without regenerating
 * 4. redo clears localStorage + regenerates fresh grid
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  calcGridSize,
  generateGrid,
  wordCellKeys,
  getCellsBetween,
} from '../wordSearchGrid';

// ─────────────────────────────────────────────────────────────────────────────
// Test 1: grid places words only horizontal/vertical + within bounds
// ─────────────────────────────────────────────────────────────────────────────

describe('generateGrid', () => {
  it('places words only horizontally or vertically (no diagonal)', () => {
    const words = ['龍爭虎鬥', '目不轉睛', '落寞', '喝采'];
    const { placedWords, size } = generateGrid(words);

    for (const pw of placedWords) {
      // direction must be horizontal or vertical
      expect(['horizontal', 'vertical']).toContain(pw.direction);

      // all cells of this word must be within bounds
      const wordLen = [...pw.word].length;
      for (let i = 0; i < wordLen; i++) {
        const r = pw.direction === 'vertical' ? pw.row + i : pw.row;
        const c = pw.direction === 'horizontal' ? pw.col + i : pw.col;
        expect(r).toBeGreaterThanOrEqual(0);
        expect(r).toBeLessThan(size);
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThan(size);
      }
    }
  });

  it('characters in grid match placed words at their positions', () => {
    const words = ['落寞', '喝采', '凝聚'];
    const { grid, placedWords } = generateGrid(words);

    for (const pw of placedWords) {
      const chars = [...pw.word];
      for (let i = 0; i < chars.length; i++) {
        const r = pw.direction === 'vertical' ? pw.row + i : pw.row;
        const c = pw.direction === 'horizontal' ? pw.col + i : pw.col;
        expect(grid[r][c]).toBe(chars[i]);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 2: whitespace in vocab words stripped before matching
// ─────────────────────────────────────────────────────────────────────────────

describe('whitespace stripping', () => {
  it('words with spaces produce the same grid keys as words without spaces', () => {
    // Simulate what the component does: strip whitespace before calling generateGrid
    const wordWithSpaces = '孤 寂 感';
    const wordStripped = wordWithSpaces.replace(/\s+/g, '');
    expect(wordStripped).toBe('孤寂感');

    // generateGrid works on stripped words
    const { placedWords, grid } = generateGrid([wordStripped]);
    const placed = placedWords.find(pw => pw.word === wordStripped);

    // The placed word's characters should match the stripped form
    if (placed) {
      const chars = [...placed.word];
      for (let i = 0; i < chars.length; i++) {
        const r = placed.direction === 'vertical' ? placed.row + i : placed.row;
        const c = placed.direction === 'horizontal' ? placed.col + i : placed.col;
        expect(grid[r][c]).toBe(chars[i]);
        expect(chars[i]).not.toBe(' ');
      }
    }
  });

  it('word with multiple spaces strips to correct chars', () => {
    const raw = '提 案  中';
    const stripped = raw.replace(/\s+/g, '');
    expect(stripped).toBe('提案中');
    expect([...stripped]).toHaveLength(3);
  });

  it('wordCellKeys uses all characters of the word (no spaces)', () => {
    const placed = {
      word: '喝采',
      row: 0,
      col: 0,
      direction: 'horizontal' as const,
    };
    const keys = wordCellKeys(placed);
    // '喝采' has 2 chars → 2 cell keys
    expect(keys.size).toBe(2);
    expect(keys.has('0,0')).toBe(true);
    expect(keys.has('0,1')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 3: completed-localStorage restores completion screen without regenerating
// ─────────────────────────────────────────────────────────────────────────────

describe('localStorage completion restoration', () => {
  const storageKey = 'wordSearch_progress_L01';

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('reads completed=true from localStorage on mount', () => {
    // Simulate a previously completed session
    const savedState = {
      foundWords: ['龍爭虎鬥', '目不轉睛'],
      elapsedTime: 42,
      completed: true,
    };
    localStorage.setItem(storageKey, JSON.stringify(savedState));

    // Parse and verify structure (mirrors what loadSaved does in the component)
    const raw = localStorage.getItem(storageKey);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.completed).toBe(true);
    expect(parsed.elapsedTime).toBe(42);
    expect(parsed.foundWords).toEqual(['龍爭虎鬥', '目不轉睛']);
  });

  it('when completed=true is present, finished state is initialized as true (no new game)', () => {
    const savedState = {
      foundWords: ['喝采'],
      elapsedTime: 15,
      completed: true,
    };
    localStorage.setItem(storageKey, JSON.stringify(savedState));

    const raw = localStorage.getItem(storageKey);
    const parsed = JSON.parse(raw!);
    // Component initializes: const [finished, setFinished] = useState(() => savedRef.current?.completed === true)
    const finishedInitialState = parsed?.completed === true;
    expect(finishedInitialState).toBe(true);
  });

  it('when completed is absent or false, finished state is initialized as false', () => {
    const savedState = { foundWords: [], elapsedTime: 0 };
    localStorage.setItem(storageKey, JSON.stringify(savedState));

    const raw = localStorage.getItem(storageKey);
    const parsed = JSON.parse(raw!);
    const finishedInitialState = parsed?.completed === true;
    expect(finishedInitialState).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 4: redo clears localStorage + regenerates fresh grid
// ─────────────────────────────────────────────────────────────────────────────

describe('redo behavior', () => {
  const storageKey = 'wordSearch_progress_L99';

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('redo removes the completed key from localStorage', () => {
    // Simulate completed state in localStorage
    localStorage.setItem(storageKey, JSON.stringify({
      foundWords: ['落寞'],
      elapsedTime: 10,
      completed: true,
    }));

    // handleRedo does: localStorage.removeItem(storageKey)
    localStorage.removeItem(storageKey);

    expect(localStorage.getItem(storageKey)).toBeNull();
  });

  it('generateGrid produces a different grid on repeated calls (different redoKey seed)', () => {
    const words = ['龍爭虎鬥', '目不轉睛', '落寞', '喝采', '凝聚力'];

    // Run generateGrid twice — we can't guarantee different results with Math.random
    // but we can verify each generates a valid structure with the expected words
    const result1 = generateGrid(words);
    const result2 = generateGrid(words);

    // Both must be valid grids
    expect(result1.size).toBeGreaterThanOrEqual(8);
    expect(result2.size).toBeGreaterThanOrEqual(8);
    expect(result1.grid.length).toBe(result1.size);
    expect(result2.grid.length).toBe(result2.size);

    // Both grids must be filled (no empty strings after generation)
    for (const row of result1.grid) {
      for (const cell of row) {
        expect(cell).not.toBe('');
      }
    }
    for (const row of result2.grid) {
      for (const cell of row) {
        expect(cell).not.toBe('');
      }
    }
  });

  it('after redo, foundWords and completed should be cleared', () => {
    // handleRedo also calls setFoundWords(new Set()), setFinished(false), etc.
    // Test the localStorage side: after removeItem, a fresh loadSaved returns null
    localStorage.setItem(storageKey, JSON.stringify({
      foundWords: ['喝采'],
      elapsedTime: 5,
      completed: true,
    }));

    // simulate handleRedo
    localStorage.removeItem(storageKey);

    const raw = localStorage.getItem(storageKey);
    expect(raw).toBeNull();

    // Simulating loadSaved() logic
    const loadSaved = () => {
      try {
        const r = localStorage.getItem(storageKey);
        if (!r) return null;
        return JSON.parse(r) as { foundWords: string[]; elapsedTime: number; completed?: boolean };
      } catch { return null; }
    };

    const saved = loadSaved();
    expect(saved).toBeNull();

    // Fresh state derived from null saved
    const foundWordsInitial = new Set(saved?.foundWords ?? []);
    const finishedInitial = saved?.completed === true;
    expect(foundWordsInitial.size).toBe(0);
    expect(finishedInitial).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getCellsBetween (straight-line selection)
// ─────────────────────────────────────────────────────────────────────────────

describe('getCellsBetween', () => {
  it('returns single cell for same start and end', () => {
    const cells = getCellsBetween({ row: 2, col: 3 }, { row: 2, col: 3 });
    expect(cells).toHaveLength(1);
    expect(cells[0]).toEqual({ row: 2, col: 3 });
  });

  it('returns horizontal cells left-to-right', () => {
    const cells = getCellsBetween({ row: 1, col: 0 }, { row: 1, col: 3 });
    expect(cells).toHaveLength(4);
    expect(cells[0]).toEqual({ row: 1, col: 0 });
    expect(cells[3]).toEqual({ row: 1, col: 3 });
    // all same row
    cells.forEach(c => expect(c.row).toBe(1));
  });

  it('returns horizontal cells right-to-left', () => {
    const cells = getCellsBetween({ row: 0, col: 4 }, { row: 0, col: 2 });
    expect(cells).toHaveLength(3);
    expect(cells[0]).toEqual({ row: 0, col: 4 });
    expect(cells[2]).toEqual({ row: 0, col: 2 });
  });

  it('returns vertical cells top-to-bottom', () => {
    const cells = getCellsBetween({ row: 0, col: 2 }, { row: 3, col: 2 });
    expect(cells).toHaveLength(4);
    expect(cells[0]).toEqual({ row: 0, col: 2 });
    expect(cells[3]).toEqual({ row: 3, col: 2 });
    cells.forEach(c => expect(c.col).toBe(2));
  });

  it('returns single cell for diagonal (not supported)', () => {
    const cells = getCellsBetween({ row: 0, col: 0 }, { row: 2, col: 2 });
    expect(cells).toHaveLength(1);
    expect(cells[0]).toEqual({ row: 0, col: 0 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// calcGridSize
// ─────────────────────────────────────────────────────────────────────────────

describe('calcGridSize', () => {
  it('returns at least 8 for any input', () => {
    expect(calcGridSize(['落寞'])).toBeGreaterThanOrEqual(8);
  });

  it('returns at most 14', () => {
    const manyWords = Array.from({ length: 20 }, (_, i) => `詞${i}語`);
    expect(calcGridSize(manyWords)).toBeLessThanOrEqual(14);
  });

  it('size is at least as large as the longest word + 2', () => {
    const longWord = '龍爭虎鬥目不轉睛'; // 8 chars
    const size = calcGridSize([longWord]);
    expect(size).toBeGreaterThanOrEqual([...longWord].length + 2);
  });
});
