/**
 * 重點朗讀一定要有東西可讀。
 *
 * 2026-08-20：文言文 10 課（文-L3～文-L12）的畫面上寫著
 * 「從頭到尾讀完整篇文章，不要中斷！」＋ AI 朗讀 ＋ 開始朗讀，
 * 但**沒有顯示任何文章** —— 它們的 `keyReading.passage` 與 `content` 都是空的，
 * 內容全在 `classicalText.paragraphs`（282～817 字），而選段邏輯不讀那裡。
 *
 * 這條鎖的是「有內容就一定要挑得出來」，不是「挑得對不對看起來合理」。
 */
import { describe, it, expect } from 'vitest';
import { readingPassagesOf } from './readingPassages';

describe('重點朗讀的文章來源', () => {
  it('有老師指定的重點段 → 只讀那一段', () => {
    const got = readingPassagesOf({
      keyReading: { passage: '重點段落內容' },
      content: ['全文第一段', '全文第二段'],
    });
    expect(got).toEqual(['重點段落內容']);
  });

  it('沒有重點段 → 退回全文', () => {
    const got = readingPassagesOf({ content: ['全文第一段', '全文第二段'] });
    expect(got).toEqual(['全文第一段', '全文第二段']);
  });

  it('🔴 重點段與全文都空、但有文言文原文 → 讀文言文原文', () => {
    const got = readingPassagesOf({
      content: [],
      classicalText: { paragraphs: ['荀巨伯遠看友人疾。', '值胡賊攻郡。'] },
    });
    expect(got).toEqual(['荀巨伯遠看友人疾。', '值胡賊攻郡。']);
  });

  it('三者皆空 → 空陣列（讓上層顯示誠實的空狀態，不要假裝有文章）', () => {
    expect(readingPassagesOf({ content: [] })).toEqual([]);
    expect(readingPassagesOf({})).toEqual([]);
  });

  it('文言文原文只有空白字串時不算內容', () => {
    expect(
      readingPassagesOf({ content: [], classicalText: { paragraphs: ['  ', ''] } }),
    ).toEqual([]);
  });

  it('重點段優先於文言文原文', () => {
    const got = readingPassagesOf({
      keyReading: { passage: '老師指定的' },
      content: [],
      classicalText: { paragraphs: ['原文'] },
    });
    expect(got).toEqual(['老師指定的']);
  });
});
