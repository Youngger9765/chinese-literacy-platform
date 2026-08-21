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
import { absorbVerdicts, allReviewItemsOf } from '../comprehensionReview';
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

});

/**
 * 完成卡的逐題清單（#2834）要跟 vocab-application 一樣「全部列出」——包含答對的題目，
 * 不是只列錯題。原本有一顆只列錯題的 `reviewItemsOf`（給舊的 WrongAnswerReviewList
 * 呼叫點），code review 發現 ComprehensionMcqPage 改用這顆之後它變成死 code，
 * 已經連同它的兩條專屬測試一起移除（「你選了 X → 正確：Y」跟「答對不進卡片」
 * 兩個行為，下面 allReviewItemsOf 的測試都涵蓋到了）。
 */
describe('閱讀理解完成卡的逐題清單（#2834，全部列出不只錯題）', () => {
  it('全對時兩題都要出現，且都標記 correct:true', () => {
    const recs = absorbVerdicts([], { q1: true, q2: true }, { q1: 2, q2: 1 }, BLOCKS);
    const items = allReviewItemsOf(recs, BLOCKS);
    expect(items).toHaveLength(2);
    expect(items.every((it) => it.correct)).toBe(true);
  });

  it('一對一錯時兩題都要出現，錯題帶得出學生選的答案，對題的 studentAnswer 是 null', () => {
    const recs = absorbVerdicts([], { q1: false, q2: true }, { q1: 0, q2: 1 }, BLOCKS);
    const items = allReviewItemsOf(recs, BLOCKS);
    expect(items).toHaveLength(2);

    const q1Item = items.find((it) => it.id === 'q1')!;
    expect(q1Item.correct).toBe(false);
    expect(q1Item.studentAnswer).toBe('天差地遠');
    expect(q1Item.correctAnswer).toBe('不分上下');

    const q2Item = items.find((it) => it.id === 'q2')!;
    expect(q2Item.correct).toBe(true);
    expect(q2Item.studentAnswer).toBeNull();
  });

  it('保留 blocks 的原始順序（題目在畫面上的順序），不是 records 被記錄的順序', () => {
    // q2 先被記錄（後測完先送出），q1 後記錄 —— 輸出仍要照 BLOCKS 的 q1, q2 順序。
    const recs = absorbVerdicts([], { q2: true }, { q2: 1 }, BLOCKS);
    const recs2 = absorbVerdicts(recs, { q1: false }, { q1: 0 }, BLOCKS);
    const items = allReviewItemsOf(recs2, BLOCKS);
    expect(items.map((it) => it.id)).toEqual(['q1', 'q2']);
  });

  it('還沒作答的題目不出現（防呆——完成卡理論上不該碰到這種情形）', () => {
    const recs = absorbVerdicts([], { q1: true }, { q1: 2 }, BLOCKS);
    const items = allReviewItemsOf(recs, BLOCKS);
    expect(items.map((it) => it.id)).toEqual(['q1']);
  });
});
