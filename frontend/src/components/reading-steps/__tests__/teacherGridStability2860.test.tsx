/**
 * #2860 —— 教師版格子不可以每次 render 重建。
 *
 * `teacherSource` 進了 useMemo 的依賴陣列。它是 `story.vocabReview` ——
 * 只要有任何一個上層每次 render 造一個新的 story 物件（`{...story}`），
 * 依賴就每次都變，格子每次重生。
 *
 * 對自動生成的格子那還只是「字母洗牌」；對教師版格子，重建會連帶重算
 * `placedWords`，而 `foundWords` 是按**詞**存的、`highlightedCells` 是按**座標**存的
 * —— 學生做到一半畫面上的高亮就對不上了。
 *
 * ⚠️ 這條測的是「內容一樣就不要重建」，不是「物件一樣就不要重建」。
 * 後者靠呼叫端自律，而自律在 render path 上守不住。
 */
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useWordSearchProgress } from '../useWordSearchProgress';

const SOURCE = () => ({
  grid: ['偉大飛餓丞讚嘆不已日', '喝采機不可失球員休息'],
  answer_paths: [
    { word: '讚嘆不已', cells: [[1, 6], [1, 7], [1, 8], [1, 9]] },
    { word: '喝采', cells: [[2, 1], [2, 2]] },
  ],
});

describe('教師版格子的穩定性', () => {
  it('內容相同的新物件不會讓格子重建', () => {
    const words = ['讚嘆不已', '喝采'];
    const { result, rerender } = renderHook(
      ({ src }) => useWordSearchProgress(words, 'L0011-stability', src),
      { initialProps: { src: SOURCE() } }
    );
    const first = result.current.grid;
    // 上層重新 render，給一個**內容一樣但參考不同**的物件
    rerender({ src: SOURCE() });
    expect(result.current.grid).toBe(first);
    expect(result.current.gridSource).toBe('teacher');
  });

  it('內容真的變了才重建', () => {
    const words = ['讚嘆不已'];
    const { result, rerender } = renderHook(
      ({ src }) => useWordSearchProgress(words, 'L0011-change', src),
      { initialProps: { src: SOURCE() } }
    );
    const first = result.current.grid;
    const changed = SOURCE();
    changed.grid[0] = '別的字別的字別的字別';
    rerender({ src: changed });
    expect(result.current.grid).not.toBe(first);
  });
});
