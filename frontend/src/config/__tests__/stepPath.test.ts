import { describe, it, expect } from 'vitest';
import { stepPath } from '../stepPath';

/**
 * 步驟導向的網址形狀（#2916）。
 *
 * 2026-08-25 staging 實測：點步驟列走到的是
 * `/learn/20063/full-text-annotate#p3kud` —— **井字號**。
 * 那是 `navigate(\`/learn/${id}/${step.id}\`)` 把帶 `#` 的 step id
 * 直接塞進路徑造成的，瀏覽器把 `#` 之後當成 fragment。
 *
 * 而輪次切換讀的是 `?p=`（`/q/` 轉址產的也是這個），於是三篇的讀全文
 * **網址不一樣、slug 也對，內容卻一模一樣**（各 3093 字、同樣開頭）。
 * owner：「怎麼都長一樣？？」
 *
 * ⛔ 全站只能有一種形狀。這支就是那個唯一的組法。
 */
describe('stepPath — 步驟網址只有一種形狀', () => {
  it('多篇課用 ?p= 帶輪次，不是 #', () => {
    expect(stepPath(20063, 'full-text-annotate#p3kud'))
      .toBe('/learn/20063/full-text-annotate?p=p3kud');
    expect(stepPath(20063, 'key-passage-reading#9a7x4'))
      .toBe('/learn/20063/key-passage-reading?p=9a7x4');
  });

  it('產出的網址不含 # —— 井字號後面前端讀不到', () => {
    for (const k of ['full-text-annotate#p3kud', 'keypoints-table#dydnq', 'comprehension#9a3ve']) {
      expect(stepPath(1, k)).not.toContain('#');
    }
  });

  it('單篇課維持原樣，不多帶參數', () => {
    expect(stepPath(20001, 'full-text-annotate')).toBe('/learn/20001/full-text-annotate');
    expect(stepPath(20001, 'report')).toBe('/learn/20001/report');
  });

  it('三篇的三個網址互不相同 —— 這是整件事的重點', () => {
    const urls = ['p3kud', '4uee3', '7wavn'].map((s) => stepPath(20063, `full-text-annotate#${s}`));
    expect(new Set(urls).size).toBe(3);
    urls.forEach((u) => expect(u).toMatch(/\?p=[0-9a-z]+$/));
  });

  it('空的輪次不製造尾巴為空的參數', () => {
    expect(stepPath(1, 'full-text-annotate#')).toBe('/learn/1/full-text-annotate');
  });
});
