import { describe, it, expect } from 'vitest';
import { articleSlugForStep, scopeDetailToRound } from './roundScope';
import type { ManifestSection } from './stepConfig';

/**
 * L0063 的帳本（三篇課文），只留驗這件事需要的欄位。
 * 形狀跟 `_manifest.yml` 一模一樣 —— 帳本三層同名同形（#2916）。
 */
const LEDGER: ManifestSection[] = [
  { no: '一', name: '讀全文-做記號', module: 'full_text_annotate', slug: 'p3kud' },
  { no: '二', name: '念順順',        module: 'key_reading',        slug: 'yprak', text_ref: 'p3kud' },
  { no: '五', name: '文章重點整理',   module: 'keypoints',          slug: 'dydnq', text_ref: 'p3kud' },
  { no: '一', name: '讀全文-做記號', module: 'full_text_annotate', slug: '4uee3' },
  { no: '二', name: '念順順',        module: 'key_reading',        slug: '9a7x4', text_ref: '4uee3' },
  { no: '五', name: '文章重點整理',   module: 'keypoints',          slug: '6xvh6', text_ref: '4uee3' },
  { no: '六', name: '閱讀聚光燈',     module: 'spotlight',          slug: 'fpctd',
    text_ref: ['p3kud', '4uee3'] },
];

const STORY = {
  title: 'L0063',
  key_reading: { passage: '篇1的重點段' },
  keypoints:   { rows: ['篇1的重點表'] },
  spotlight:   { blocks: ['跨篇聚光燈'] },
  repeat_rounds: {
    p3kud: { key_reading: { passage: '篇1的重點段' }, keypoints: { rows: ['篇1的重點表'] } },
    // 第 2 篇的 spotlight 是 null：那一輪沒有自己的聚光燈。
    // 這一筆是刻意的 —— 少了它，「不要用 null 蓋掉頂層」那條測試根本走不到那行。
    '4uee3': { key_reading: { passage: '篇2的重點段' }, keypoints: { rows: ['篇2的重點表'] },
               spotlight: null },
  },
};

describe('articleSlugForStep — 這一步該用誰的課文', () => {
  it('引用型的節，回傳它 text_ref 指到的課文', () => {
    expect(articleSlugForStep(LEDGER, 'key-passage-reading#9a7x4')).toBe('4uee3');
    expect(articleSlugForStep(LEDGER, 'keypoints-table#dydnq')).toBe('p3kud');
  });

  it('課文本身，用它自己的 slug（它沒有 text_ref，因為它就是被引用的那個）', () => {
    expect(articleSlugForStep(LEDGER, 'full-text-annotate#4uee3')).toBe('4uee3');
  });

  it('跨篇的節（text_ref 是清單）不屬於任何單一篇 → null，維持頂層資料', () => {
    expect(articleSlugForStep(LEDGER, 'spotlight#fpctd')).toBeNull();
  });

  it('沒有 #slug 的步驟（單篇課、lesson-intro）→ null', () => {
    expect(articleSlugForStep(LEDGER, 'key-passage-reading')).toBeNull();
    expect(articleSlugForStep(LEDGER, 'lesson-intro')).toBeNull();
  });

  it('slug 在帳本裡查無此列 → null，不亂猜', () => {
    expect(articleSlugForStep(LEDGER, 'key-passage-reading#zzzzz')).toBeNull();
  });
});

describe('scopeDetailToRound — 換成那一篇的資料', () => {
  it('第 2 篇的念順順拿到第 2 篇的重點段，不是第 1 篇的', () => {
    const s = scopeDetailToRound(STORY, LEDGER, 'key-passage-reading#9a7x4');
    expect(s.key_reading).toEqual({ passage: '篇2的重點段' });
  });

  it('同一輪的其他模組也一起換（重點表跟著走）', () => {
    const s = scopeDetailToRound(STORY, LEDGER, 'keypoints-table#6xvh6');
    expect(s.keypoints).toEqual({ rows: ['篇2的重點表'] });
  });

  it('第 1 篇拿到第 1 篇 —— 不是「有換就算對」，要換對那一篇', () => {
    const s = scopeDetailToRound(STORY, LEDGER, 'key-passage-reading#yprak');
    expect(s.key_reading).toEqual({ passage: '篇1的重點段' });
  });

  it('跨篇的節維持頂層資料，不被任何一輪蓋掉', () => {
    const s = scopeDetailToRound(STORY, LEDGER, 'spotlight#fpctd');
    expect(s.spotlight).toEqual({ blocks: ['跨篇聚光燈'] });
  });

  it('沒有 repeat_rounds 的單篇課，原封不動回傳同一個物件（不製造新 reference）', () => {
    const single = { title: 'L0011', key_reading: { passage: '單篇' } };
    expect(scopeDetailToRound(single, [], 'key-passage-reading')).toBe(single);
  });

  it('那一輪的模組是 null 時不可以蓋掉頂層（消費端多半寫 `?? fallback`，null 會吃掉它）', () => {
    const s = scopeDetailToRound(STORY, LEDGER, 'full-text-annotate#4uee3');
    // 第 2 篇那一輪的 spotlight 是 null，頂層的跨篇聚光燈必須活著
    expect(s.spotlight).toEqual({ blocks: ['跨篇聚光燈'] });
    expect(s.spotlight).not.toBeNull();
  });
});
