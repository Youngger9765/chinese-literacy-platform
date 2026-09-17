/**
 * 回饋句要說出它量的是什麼（#3156 的最後一項，做得到的那一半）
 *
 * ## 原本的問題（六方架構複審）
 *
 * 朗讀畫面上有三個不同的東西在說話：
 *
 *   顯示的指標   每分鐘字數（速度）        ← 家長截圖裡的「127 字/分鐘」
 *   判成敗的     逐字正確率 >= 0.80       ← `passed = accuracyPassed`
 *   回饋句       「讀得很流暢」             ← 依據是正確率，但講的是流暢度
 *
 * 三個詞互不相同，而使用者只看得到第一個和第三個 —— 於是「流暢」會被讀成
 * 「速度很好」，而它其實在講準確度。
 *
 * 流暢度在閱讀研究裡是 **速度 × 準確度 × 韻律**（NRP 2000，見
 * `docs/research/reading-fluency-quantification-2026-05-01.md`），平台只量前兩個，
 * 而這條回饋只看其中一個。所以它不該自稱流暢。
 *
 * ## 這一份鎖什麼 —— 以及**沒有**鎖什麼
 *
 * 鎖的是「按正確率分級的回饋句不可以自稱流暢」。
 *
 * ⛔ **沒有**鎖「`passed` 要分年級」。那一項我做不到而且不該我決定：
 *    - 分年級的資料只有**速度**（課文 YAML 的 `reading_benchmark.levels`，
 *      G4 190/220/221 … G9 220/250/251），**正確率沒有任何分年級的來源**
 *    - 把 `passed` 從正確率改成速度會推翻 #2131 記下的決定
 *      （`fluencyAnalyzer.ts` 裡那行註解：passed is accuracy-only）
 *    那是改變學生看到的過與不過，要 owner 決定，不是我補一個數字。
 */
import { describe, it, expect } from 'vitest';
import { analyzeFluency } from '../fluencyAnalyzer';

function feedbackFor(accuracy: number): string {
  // 用一段目標文字，讓 spoken 剛好對到想要的正確率
  const target = '一二三四五六七八九十';
  const keep = Math.round(target.length * accuracy);
  const spoken = target.slice(0, keep) + 'ㄅ'.repeat(target.length - keep);
  const r = analyzeFluency({ spoken, target, durationMs: 5000 });
  return r.feedback;
}

describe('#3156 回饋句要說出它量的是什麼', () => {
  it('⭐ 按正確率分級的回饋句不可以自稱「流暢」', () => {
    const all = [feedbackFor(1), feedbackFor(0.8), feedbackFor(0.6), feedbackFor(0.3)];
    for (const f of all) {
      expect(f, `「${f}」按正確率分級卻自稱流暢 —— 畫面上顯示的是速度，會被讀成在講速度`)
        .not.toContain('流暢');
    }
  });

  it('正向對照：回饋句真的有東西（否則上面那條對空字串也會綠）', () => {
    for (const a of [1, 0.8, 0.6, 0.3]) {
      const f = feedbackFor(a);
      expect(f.length, `正確率 ${a} 沒有回饋句`).toBeGreaterThan(5);
    }
  });

  it('正向對照：最高一級仍然講得出「準」這件事', () => {
    expect(feedbackFor(1)).toContain('準');
  });

  it('分級還在（三級各不相同）—— 改用詞不可以把分級弄平', () => {
    const top = feedbackFor(1);
    const mid = feedbackFor(0.6);
    const low = feedbackFor(0.3);
    expect(new Set([top, mid, low]).size, '三級的回饋句不該相同').toBe(3);
  });
});
