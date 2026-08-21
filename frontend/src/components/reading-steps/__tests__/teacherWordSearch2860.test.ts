/**
 * #2860 —— 教師版找字表要真的到學生面前。
 *
 * 抽取器 150 課抽了 grid + answer_paths，但 API 沒送、前端自己隨機生格子，
 * 於是老師設計的那張表一課都沒被看過，而且**沒有任何錯誤訊息** ——
 * 畫面上有格子、找得到詞、完成得了，只是那張表不是老師出的。
 *
 * 這裡的斷言全部用數量，不用「有一課對就算過」：
 * 2026-08-19 一天內五次「只修一半」的根因就是 `>= 1` 型斷言。
 */
import { describe, it, expect } from 'vitest';
import {
  buildTeacherGrid,
  getCellsBetween,
  wordCellKeys,
  overlayRects,
  cellsAlongWord,
} from '../wordSearchGrid';

/** L0011 的真實片段（1-based 座標，跟 yml 同形狀） */
const L0011 = {
  grid: [
    '偉大飛餓丞讚嘆不已日',
    '喝采機不可失球員休息',
  ],
  answer_paths: [
    { word: '讚嘆不已', cells: [[1, 6], [1, 7], [1, 8], [1, 9]] },
    { word: '喝采', cells: [[2, 1], [2, 2]] },
  ],
};

describe('buildTeacherGrid — 用老師出的表，不是自己生的', () => {
  it('格子逐字等於 yml 的 grid', () => {
    const g = buildTeacherGrid(L0011);
    expect(g).not.toBeNull();
    expect(g!.grid[0].join('')).toBe('偉大飛餓丞讚嘆不已日');
    expect(g!.grid[1].join('')).toBe('喝采機不可失球員休息');
    expect(g!.grid.length).toBe(2);
  });

  it('1-based 座標換成 0-based，讀出來就是那個詞', () => {
    const g = buildTeacherGrid(L0011)!;
    for (const pw of g.placedWords) {
      const read = pw.cells!.map(({ row, col }) => g.grid[row][col]).join('');
      expect(read).toBe(pw.word);
    }
    expect(g.placedWords.length).toBe(2);
  });

  it('沒有 grid 就回 null（讓呼叫端退回自己生）', () => {
    expect(buildTeacherGrid(undefined)).toBeNull();
    expect(buildTeacherGrid({ grid: [], answer_paths: [] })).toBeNull();
  });

  it('target_words 缺路徑時用搜尋補回來（實測全庫可救 45 個）', () => {
    const g = buildTeacherGrid({
      grid: L0011.grid,
      answer_paths: [],
      target_words: ['讚嘆不已', '喝采'],
    })!;
    expect(g.placedWords.map((p) => p.word).sort()).toEqual(['喝采', '讚嘆不已']);
  });

  it('格子裡真的沒有的詞就不放進來 —— 放了學生會永遠找不到', () => {
    const g = buildTeacherGrid({
      grid: L0011.grid,
      answer_paths: [],
      target_words: ['讚嘆不已', '這詞不在格子裡'],
    })!;
    expect(g.placedWords.map((p) => p.word)).toEqual(['讚嘆不已']);
  });
});

describe('斜線 —— 全庫 445 條路徑是斜的，佔 30%', () => {
  it('拖曳選得到 45° 斜線', () => {
    const cells = getCellsBetween({ row: 2, col: 7 }, { row: 5, col: 4 });
    expect(cells).toEqual([
      { row: 2, col: 7 }, { row: 3, col: 6 }, { row: 4, col: 5 }, { row: 5, col: 4 },
    ]);
  });

  it('不是 45° 的仍然不成立（不要為了過測試放寬成任意兩點）', () => {
    expect(getCellsBetween({ row: 0, col: 0 }, { row: 1, col: 5 })).toEqual([
      { row: 0, col: 0 },
    ]);
  });

  it('wordCellKeys 認 cells，斜線的高亮才會對', () => {
    const keys = wordCellKeys({
      word: '血脈賁張',
      row: 2, col: 7, direction: 'horizontal',
      cells: [
        { row: 2, col: 7 }, { row: 3, col: 6 }, { row: 4, col: 5 }, { row: 5, col: 4 },
      ],
    });
    expect([...keys].sort()).toEqual(['2,7', '3,6', '4,5', '5,4']);
  });
});

// ---------------------------------------------------------------------------
// 找到之後畫在哪（#2860 覆審 Finding 2）
// ---------------------------------------------------------------------------

describe('斜線找到之後的紅框要跟著路徑走', () => {
  const DIAG = {
    word: '血脈賁張',
    row: 2, col: 7, direction: 'vertical' as const,
    cells: [
      { row: 2, col: 7 }, { row: 3, col: 6 }, { row: 4, col: 5 }, { row: 5, col: 4 },
    ],
  };

  it('斜線畫成四個格子，不是一根直條', () => {
    const rects = overlayRects(DIAG, 40);
    expect(rects.map((r) => [r.x, r.y])).toEqual([
      [7 * 40, 2 * 40], [6 * 40, 3 * 40], [5 * 40, 4 * 40], [4 * 40, 5 * 40],
    ]);
    // 每一塊都是一格大小 —— 不是 wordLen 倍
    expect(rects.every((r) => r.w === 40 && r.h === 40)).toBe(true);
  });

  it('水平詞仍然是一整條（不要為了斜線把正常的也拆掉）', () => {
    const rects = overlayRects(
      { word: '喝采', row: 1, col: 0, direction: 'horizontal' }, 40
    );
    expect(rects).toEqual([{ key: '喝采', x: 0, y: 40, w: 80, h: 40 }]);
  });

  it('cellsAlongWord 沿著真實路徑，不是沿著 direction 推', () => {
    expect([...cellsAlongWord(DIAG, 2)].sort()).toEqual(['2,7', '3,6', '4,5']);
  });
});

// ---------------------------------------------------------------------------
// 這條防的是「下次又長回來」（#2860 覆審 Finding 2）
// ---------------------------------------------------------------------------

describe('VocabWordSearch 不可以再靠 direction 算座標', () => {
  it('元件裡沒有任何 direction 推導的座標算式', async () => {
    const [fs, path] = await Promise.all([import('fs'), import('path')]);
    const file = path.resolve(process.cwd(), 'src/components/reading-steps/VocabWordSearch.tsx');
    // 正向對照：先確認真的讀到了那個檔。少了這行，路徑寫錯會讀到空字串，
    // 而空字串當然沒有任何推導 —— 一條永遠綠的鎖。
    expect(fs.existsSync(file)).toBe(true);
    const src = fs.readFileSync(file, 'utf-8');
    expect(src).toContain('overlayRects');
    // `direction === 'horizontal' ? … col + i` 這一族推導對斜線一律算錯。
    // 三個消費端（紅框 / 逐字點亮 / 示範游標）都曾經這樣寫，
    // 而它不會報錯 —— 只是畫在別的地方。
    const derivations = src
      .split('\n')
      .map((line, i) => [i + 1, line] as const)
      .filter(([, line]) =>
        /direction\s*===\s*'(horizontal|vertical)'\s*\?/.test(line)
      );
    expect(derivations).toEqual([]);
  });
});
