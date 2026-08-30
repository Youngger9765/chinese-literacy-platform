import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { getCellsBetween } from '../wordSearchGrid';

/**
 * 畫面上的操作說明不能比程式能做的還窄（#2863）。
 *
 * #2860 之後學生看到的是**老師出的那張表**，而那張表的答案路徑
 * 30% 是斜線（全庫 1490 條裡 445 條，143 課裡 139 課至少各有一條）。
 * 拖曳早就支援 45° 斜線，但說明寫「水平或垂直」——
 * 學生照著做會找不到那 445 個詞，然後以為是自己看錯或程式壞了。
 *
 * ⛔ 這條守的是「說明 ↔ 能力」一致，不是某一句固定文案。
 */
const SRC = fs.readFileSync(
  path.resolve(__dirname, '../VocabWordSearch.tsx'), 'utf-8');

/** 畫面上給學生看的操作說明（引號裡、含「圈出語詞」或「滑過」「拖曳」的中文句） */
function instructionStrings(): string[] {
  return [...SRC.matchAll(/['"`]([^'"`\n]*(?:圈出語詞|拖曳圈出|滑過圈出)[^'"`\n]*)['"`]/g)]
    .map((m) => m[1]);
}

describe('#2863 操作說明要跟拖曳能力一致', () => {
  it('程式真的支援 45° 斜線（先證明前提成立）', () => {
    // 正向對照：這條垮了，下面那條就沒有意義
    expect(getCellsBetween({ row: 0, col: 0 }, { row: 2, col: 2 })).toEqual([
      { row: 0, col: 0 }, { row: 1, col: 1 }, { row: 2, col: 2 },
    ]);
    // 反向：非 45° 不該連成線（放寬會讓學生亂拖也中）
    expect(getCellsBetween({ row: 0, col: 0 }, { row: 1, col: 5 }).length).toBeLessThan(3);
  });

  it('抓得到操作說明（量具自檢）', () => {
    expect(instructionStrings().length).toBeGreaterThan(2);
  });

  it('沒有一句說明把方向講成只有橫和直', () => {
    const tooNarrow = instructionStrings().filter(
      (s) => /水平或垂直|橫或直/.test(s) && !/斜/.test(s));
    expect(tooNarrow, `這些說明比程式能做的窄，學生照做會找不到斜線的詞：\n  ${tooNarrow.join('\n  ')}`)
      .toEqual([]);
  });

  it('說明有講到斜線', () => {
    expect(instructionStrings().some((s) => s.includes('斜')),
      '一句提到斜線的說明都沒有 —— 30% 的答案是斜的').toBe(true);
  });
});
