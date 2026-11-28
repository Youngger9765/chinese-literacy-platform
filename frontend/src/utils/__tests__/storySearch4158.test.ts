/**
 * #4158 找課文：標題、體裁、年級都能搜；沒結果時給建議關鍵字（不留空白）
 * 生詞搜尋要先有索引，issue 明寫放第二期，這期不做。
 */
import { describe, it, expect } from 'vitest';
import { matchesStory, suggestKeywords } from '../storySearch';

const S = (title: string, grade: string, genre: string) => ({ id: title, title, grade, genre }) as never;
const stories = [
  S('十秒的背後', '4', '說明文'),
  S('勸學', '文言文', '議論文'),
  S('老鷹的飛翔', '5', '記敘文'),
  S('千里馬', '8', '記敘文'),
];

describe('matchesStory', () => {
  it('標題與體裁照舊能搜', () => {
    expect(matchesStory(stories[0], '十秒')).toBe(true);
    expect(matchesStory(stories[0], '說明')).toBe(true);
    expect(matchesStory(stories[0], '議論')).toBe(false);
  });

  it.each(['4', '四年級', '4年級', '第4級', '第 4 級', '四'])('年級說法「%s」找得到 4 年級', (q) => {
    expect(matchesStory(stories[0], q)).toBe(true);
    expect(matchesStory(stories[2], q)).toBe(false);
  });

  it('年級字串（文言文）也能搜', () => {
    expect(matchesStory(stories[1], '文言文')).toBe(true);
  });

  it('空白查詢全部符合；前後空白不影響', () => {
    expect(matchesStory(stories[0], '')).toBe(true);
    expect(matchesStory(stories[0], '  十秒 ')).toBe(true);
  });

  it('沒有 genre 的課（班級課文）不會炸', () => {
    expect(matchesStory({ id: 'x', title: '班級課文', grade: undefined, genre: undefined } as never, '班級')).toBe(true);
  });
});

describe('suggestKeywords', () => {
  it('從現有課文取最常見的體裁與年級當建議，不會是空的', () => {
    const s = suggestKeywords(stories);
    expect(s.length).toBeGreaterThan(0);
    expect(s).toContain('記敘文'); // 出現兩次，排第一
    expect(s[0]).toBe('記敘文');
  });

  it('每個建議都真的會搜到東西（不給死路）', () => {
    for (const k of suggestKeywords(stories)) {
      expect(stories.some((x) => matchesStory(x, k))).toBe(true);
    }
  });

  it('沒有課文時回空陣列不炸', () => {
    expect(suggestKeywords([])).toEqual([]);
  });
});
