/**
 * wordSearchGrid.ts — Pure logic for VocabWordSearch grid (Issue #1856)
 *
 * Extracted from VocabWordSearch.tsx.
 * No React/DOM dependencies — fully unit-testable.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Direction = 'horizontal' | 'vertical';

export interface PlacedWord {
  word: string;
  row: number;
  col: number;
  direction: Direction;
}

export interface CellPos {
  row: number;
  col: number;
}

export interface GeneratedGrid {
  grid: string[][];
  placedWords: PlacedWord[];
  size: number;
}

// ---------------------------------------------------------------------------
// Common Chinese characters pool (for filling empty cells)
// ---------------------------------------------------------------------------

const FILLER_CHARS: string[] = [
  '的', '一', '是', '在', '不', '了', '有', '和',
  '人', '這', '中', '大', '為', '上', '個', '國',
  '我', '以', '要', '他', '時', '來', '用', '們',
  '生', '到', '作', '地', '於', '出', '就', '分',
  '對', '成', '會', '可', '主', '發', '年', '動',
  '同', '工', '也', '能', '下', '過', '子', '說',
  '產', '覆', '面', '而', '方', '後', '多', '定',
  '行', '學', '法', '所', '民', '得', '經', '十',
  '三', '之', '進', '著', '等', '部', '度', '家',
  '電', '力', '裡', '如', '水', '化', '高', '自',
  '二', '理', '起', '小', '物', '現', '實', '加',
  '量', '都', '兩', '體', '制', '機', '當', '使',
  '點', '從', '業', '本', '去', '把', '性', '好',
  '應', '開', '它', '合', '還', '因', '由', '其',
  '些', '然', '前', '外', '天', '政', '四', '日',
  '那', '社', '義', '事', '平', '形', '相', '全',
  '表', '間', '樣', '與', '關', '各', '重', '新',
  '線', '內', '數', '正', '心', '反', '你', '明',
  '看', '原', '又', '利', '比', '或', '但', '質',
  '氣', '第', '向', '道', '命', '此', '變', '條',
];

function randomFiller(): string {
  return FILLER_CHARS[Math.floor(Math.random() * FILLER_CHARS.length)];
}

// ---------------------------------------------------------------------------
// Grid size calculation
// ---------------------------------------------------------------------------

export function calcGridSize(words: string[]): number {
  const chars = words.map((w) => [...w]);
  const maxLen = Math.max(...chars.map((c) => c.length));
  const totalChars = chars.reduce((s, c) => s + c.length, 0);
  const minSize = Math.max(maxLen + 2, Math.ceil(Math.sqrt(totalChars * 2.5)));
  // Clamp between 8 and 14
  return Math.max(8, Math.min(14, minSize));
}

// ---------------------------------------------------------------------------
// Word placement
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

export function generateGrid(words: string[]): GeneratedGrid {
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

export function wordCellKeys(placed: PlacedWord): Set<string> {
  const keys = new Set<string>();
  const chars = [...placed.word];
  for (let i = 0; i < chars.length; i++) {
    const r = placed.direction === 'vertical' ? placed.row + i : placed.row;
    const c = placed.direction === 'horizontal' ? placed.col + i : placed.col;
    keys.add(r + ',' + c);
  }
  return keys;
}

export function cellKey(pos: CellPos): string {
  return pos.row + ',' + pos.col;
}

// ---------------------------------------------------------------------------
// Drag selection: straight lines only
// ---------------------------------------------------------------------------

export function getCellsBetween(start: CellPos, end: CellPos): CellPos[] {
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
