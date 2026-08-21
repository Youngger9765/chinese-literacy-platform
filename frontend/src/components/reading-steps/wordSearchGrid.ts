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
  /**
   * 教師版找字表的實際路徑（#2860）。自動生成的表只走水平/垂直，用 row+col+direction
   * 就推得出格子；老師出的表有 30% 是斜線（實測全庫 445 條），推不出來，所以直接帶座標。
   * 有 cells 時它是權威，row/col/direction 只留給既有消費端當起點用。
   */
  cells?: CellPos[];
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

  // Direction balance counters: bias each word toward the under-represented
  // direction so that |horizontal_count - vertical_count| stays ≤ 1.
  let hCount = 0;
  let vCount = 0;

  for (const word of shuffleArray(words)) {
    const wordLen = [...word].length;
    let placed = false;

    // Preferred direction: whichever has fewer placements so far.
    // If equal, pick randomly (standard 50/50).
    const preferred: Direction =
      hCount < vCount ? 'horizontal'
      : vCount < hCount ? 'vertical'
      : dirs[Math.floor(Math.random() * 2)];
    const fallback: Direction = preferred === 'horizontal' ? 'vertical' : 'horizontal';

    // First half of the attempt budget uses the preferred direction;
    // second half falls back to the other direction so we never fail to place.
    for (let attempt = 0; attempt < 200 && !placed; attempt++) {
      const dir: Direction = attempt < 100 ? preferred : fallback;
      const maxRow = dir === 'vertical' ? size - wordLen : size - 1;
      const maxCol = dir === 'horizontal' ? size - wordLen : size - 1;
      if (maxRow < 0 || maxCol < 0) continue;
      const row = Math.floor(Math.random() * (maxRow + 1));
      const col = Math.floor(Math.random() * (maxCol + 1));

      if (tryPlaceWord(grid, word, size, dir, row, col)) {
        placedWords.push({ word, row, col, direction: dir });
        if (dir === 'horizontal') hCount++; else vCount++;
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
  if (placed.cells?.length) {
    // 教師版路徑（#2860）—— 斜線只有這條路推得出來
    for (const c of placed.cells) keys.add(c.row + ',' + c.col);
    return keys;
  }
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
  } else if (Math.abs(dr) === Math.abs(dc)) {
    // 45° 斜線（#2860）。教師版的表 30% 是斜的，不支援等於那些詞選不起來。
    // ⛔ 只認 |dr| === |dc| —— 放寬成任意兩點會讓學生亂拖也能中。
    const sr = dr > 0 ? 1 : -1;
    const sc = dc > 0 ? 1 : -1;
    for (let i = 0; i <= Math.abs(dr); i++) {
      cells.push({ row: start.row + i * sr, col: start.col + i * sc });
    }
  } else {
    // 不成直線也不成 45° —— 不是合法選取
    cells.push(start);
  }
  return cells;
}

// ---------------------------------------------------------------------------
// 教師版找字表（#2860）
// ---------------------------------------------------------------------------

/** 後端 `story.vocab_review` 的形狀。yml 的 grid 是一列一個字串、座標 1-based。 */
export interface TeacherWordSearchSource {
  /** 一列是字串或字元陣列，兩種都在服務中（實測 142 / 1） */
  grid?: (string | string[])[] | null;
  answer_paths?: { word?: string; cells?: number[][] }[] | null;
  target_words?: string[] | null;
}

const SEARCH_DIRS: [number, number][] = [
  [0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [1, -1], [-1, 1], [-1, -1],
];

/** 在格子裡找一個詞，回它的路徑；找不到回 null。 */
function searchWord(grid: string[][], word: string): CellPos[] | null {
  const chars = [...word];
  if (chars.length === 0) return null;
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      if (grid[r][c] !== chars[0]) continue;
      for (const [dr, dc] of SEARCH_DIRS) {
        const path: CellPos[] = [];
        let ok = true;
        for (let i = 0; i < chars.length; i++) {
          const rr = r + i * dr;
          const cc = c + i * dc;
          if (grid[rr]?.[cc] !== chars[i]) { ok = false; break; }
          path.push({ row: rr, col: cc });
        }
        if (ok) return path;
      }
    }
  }
  return null;
}

/**
 * 把老師出的那張表轉成畫面用的格子。
 *
 * 回 `null` 代表「這課沒有教師版的表」，呼叫端退回 generateGrid ——
 * ⛔ 但退回時必須讓畫面標記出來（`grid_source`），不要靜默降級。
 * `useTtsPlayback` 就是靜默降級成瀏覽器機器音，QA 聽到有聲音就當 AI 朗讀成功。
 */
export function buildTeacherGrid(
  src: TeacherWordSearchSource | null | undefined
): GeneratedGrid | null {
  const rows = src?.grid;
  if (!Array.isArray(rows) || rows.length === 0) return null;

  // 一列可能是字串 '熬過沮疑…'（142 課）也可能是 ['憑','速',…]（1 課，L0003）。
  // 只處理字串那種的話，list 那課會被 String() 變成 "['憑', '速'…" —— 畫面照樣畫得出來，
  // 只是每一格都是引號跟逗號。這種錯不會有錯誤訊息。
  const grid = rows.map((row) =>
    Array.isArray(row) ? row.map((ch) => String(ch)) : [...String(row ?? '')]
  );
  const size = Math.max(grid.length, ...grid.map((r) => r.length));

  const placedWords: PlacedWord[] = [];
  const seen = new Set<string>();

  const push = (word: string, cells: CellPos[]) => {
    if (!word || seen.has(word) || cells.length === 0) return;
    seen.add(word);
    placedWords.push({
      word,
      row: cells[0].row,
      col: cells[0].col,
      direction: cells.length > 1 && cells[0].row === cells[1].row ? 'horizontal' : 'vertical',
      cells,
    });
  };

  for (const p of src?.answer_paths ?? []) {
    const word = String(p?.word ?? '');
    const cells = (p?.cells ?? [])
      // yml 是 1-based
      .map(([r, c]) => ({ row: Number(r) - 1, col: Number(c) - 1 }))
      .filter(({ row, col }) => grid[row]?.[col] !== undefined);
    // 座標對不上格子內容就不要用 —— 寧可讓它落到下面的搜尋，也不要放一條讀出來不是那個詞的路徑
    if (cells.length === [...word].length &&
        cells.map(({ row, col }) => grid[row][col]).join('') === word) {
      push(word, cells);
    }
  }

  // target_words 有、answer_paths 沒有的，用搜尋補（實測全庫可救 45 個）。
  // 搜不到 = 格子裡真的沒有（實測 10 個，源頭 target_words 打錯字），
  // ⛔ 那些不放進來 —— 放了學生會找到天荒地老。
  for (const raw of src?.target_words ?? []) {
    const word = String(raw ?? '').replace(/[，,\s]/g, '');
    if (!word || seen.has(word)) continue;
    const found = searchWord(grid, word);
    if (found) push(word, found);
  }

  if (placedWords.length === 0) return null;
  return { grid, placedWords, size };
}
