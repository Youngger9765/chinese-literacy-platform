/**
 * 標題必須跟本文走同一張注音表。
 *
 * 家長 dogfood 截的就是這一行：《長高的祕密》的「長」讀成 ㄔㄤˊ，而同一頁下面
 * 的本文讀 ㄓㄤˇ。#3022 把字型範圍收窄到 <article> 之後，標題被「明確補回來」——
 * 但只補了字型、沒補查表，於是每個字掉到字型的**預設讀音**。標題是最顯眼的一行。
 *
 * ⛔ 為什麼掃原始碼而不是 render 比對：注音是字型畫的，畫面文字看不出讀音對不對
 *    （見 memory project_zhuyin_qa_how_to）。而 mock 掉 context 再比對字串等於
 *    在測我自己複製的那條三元式，不是在測元件 —— 那種鎖改壞了也不會紅。
 *    這裡直接斷言「那個 <h1> 裡不是裸 story.title」。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = readFileSync(
  join(__dirname, '..', 'FullTextAnnotate.tsx'),
  'utf8',
);

describe('#3269 標題走同一張注音表', () => {
  it('標題的 <h1> 不是裸 story.title', () => {
    // 抓 font-headline 那個 h1 到它的結束標籤
    const m = SRC.match(/<h1[^>]*font-headline[\s\S]*?<\/h1>/);
    expect(m, '找不到標題的 <h1> —— 這條斷言等於沒在測，元件結構變了要更新').toBeTruthy();
    const h1 = m![0];
    expect(
      h1.includes('{story.title}'),
      '標題直接吐 story.title，沒有經過注音表 → 每個字會用字型預設讀音',
    ).toBe(false);
  });

  it('標題經過 processZhuyin，且 gate 是 zhuyinActive（難字模式不整片標）', () => {
    expect(SRC).toMatch(/processZhuyin/);
    const memo = SRC.match(/const zhuyinTitle[\s\S]*?\);/);
    expect(memo, '找不到 zhuyinTitle 的計算').toBeTruthy();
    expect(memo![0]).toMatch(/zhuyinActive\s*\?\s*processZhuyin\(story\.title\)/);
  });
});
