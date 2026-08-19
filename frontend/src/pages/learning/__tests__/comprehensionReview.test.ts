/**
 * 閱讀理解的分數不可以是編的。
 *
 * `ComprehensionMcqPage` 原本 `handleMcqComplete(total, total)` —— 寫死滿分，
 * 不管學生第一次答錯幾題，存進學習紀錄與老師報表的都是 100%。
 * 跟 #2784 修掉的「詞語理解結算永遠全對」是同一種病：紀錄看起來有意義，
 * 但它記的不是真的。
 *
 * 這裡鎖的是「第一次作答的對錯」——重試答對不可以把它洗掉，
 * 否則「重做錯題」會變成空集合（學生一定會重試到對）。
 */
import { describe, it, expect } from 'vitest';
import { absorbVerdicts, reviewItemsOf } from '../comprehensionReview';
import { firstTryScore, wrongFirstTryIds } from '../../../utils/questionReview';

const BLOCKS = [
  { id: 'q1', stem: '請問「勢均力敵」可以用哪個詞語替換？', options: ['天差地遠', '揚眉吐氣', '不分上下', '寡不敵眾'], answerIndex: 2 },
  { id: 'q2', stem: '本文主旨最接近下列何者？', options: ['勝負', '堅持', '運氣', '天分'], answerIndex: 1 },
];

describe('閱讀理解 first-try 計分', () => {
  it('第一次答錯、重試答對 → first-try 仍記為錯', () => {
    // 第一次：q1 錯
    let recs = absorbVerdicts([], { q1: false }, { q1: 0 }, BLOCKS);
    expect(recs).toHaveLength(1);
    expect(recs[0].firstTryCorrect).toBe(false);

    // 重試答對：verdict 變 true，但 first-try 不可以被覆蓋
    recs = absorbVerdicts(recs, { q1: true }, { q1: 2 }, BLOCKS);
    expect(recs).toHaveLength(1);
    expect(recs[0].firstTryCorrect).toBe(false);
  });

  it('分數是 first-try 的分數，不是滿分', () => {
    let recs = absorbVerdicts([], { q1: false }, { q1: 0 }, BLOCKS);
    recs = absorbVerdicts(recs, { q1: true, q2: true }, { q1: 2, q2: 1 }, BLOCKS);
    expect(firstTryScore(recs)).toEqual({ correct: 1, total: 2 });
    expect(wrongFirstTryIds(recs)).toEqual(['q1']);
  });

  it('verdict 還是 null（沒作答）的題目不記錄', () => {
    const recs = absorbVerdicts([], { q1: null, q2: true }, { q2: 1 }, BLOCKS);
    expect(recs.map((r) => r.id)).toEqual(['q2']);
  });

  it('錯題卡片帶得出「你選了 X → 正確：Y」的兩邊', () => {
    const recs = absorbVerdicts([], { q1: false }, { q1: 0 }, BLOCKS);
    const items = reviewItemsOf(recs, BLOCKS);
    expect(items).toHaveLength(1);
    expect(items[0].studentAnswer).toBe('天差地遠');
    expect(items[0].correctAnswer).toBe('不分上下');
    expect(items[0].studentAnswer).not.toBe(items[0].correctAnswer);
  });

  it('答對的題目不進錯題卡片', () => {
    const recs = absorbVerdicts([], { q1: true, q2: true }, { q1: 2, q2: 1 }, BLOCKS);
    expect(reviewItemsOf(recs, BLOCKS)).toEqual([]);
  });
});
