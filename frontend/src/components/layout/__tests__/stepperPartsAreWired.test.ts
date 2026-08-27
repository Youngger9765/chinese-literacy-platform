/**
 * 純函式對了不代表畫面用得到它。
 *
 * 這一輪反覆踩到的形狀是「算對了，但某一層沒接」——
 * annotateStepParts 100% 正確、測試全綠，而 AppShell 沒有把它傳下去，
 * 學生看到的還是三組一模一樣的圈圈。單元測試永遠抓不到那個。
 *
 * 所以這裡直接讀 AppShell 的原始碼，斷言四條接線都在。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SRC = fs.readFileSync(
  path.resolve(__dirname, '../AppShell.tsx'),
  'utf8',
);

describe('多篇 stepper 的接線（不是只有純函式對）', () => {
  it('AppShell 有 import annotateStepParts', () => {
    expect(SRC).toMatch(/import\s*\{\s*annotateStepParts\s*\}/);
  });

  it('有拿本課的帳本去算，不是傳空的', () => {
    // 傳 undefined 的話多篇課會退化成「沒有篇次」而且完全不報錯
    expect(SRC).toMatch(/annotateStepParts\(\s*activeSteps\s*,\s*selectedStory\?\.manifestSections\s*\)/);
  });

  it('算出來的結果真的傳進 StepDots', () => {
    expect(SRC).toMatch(/annotations=\{stepAnnotations\}/);
  });

  it('⭐ 每一顆的 aria-label 走 a11yLabel —— 這是學生分得出篇次的唯一來源', () => {
    expect(SRC).toMatch(/aria-label=\{ann\?\.a11yLabel/);
  });

  it('index 對齊有守衛 —— 錯位時寧可不標也不要標錯篇', () => {
    // 沒有這道，兩個陣列一旦錯位就會是「第 2 篇的標籤配第 3 篇的圈圈」，
    // 完全不報錯、畫面看起來正常，而學生被指到錯的文章。
    expect(SRC).toMatch(/annAt\?\.step\.id === step\.id \? annAt : undefined/);
  });

  it('正向對照：這個檔案真的讀到了（不是空字串讓上面全部空過）', () => {
    expect(SRC.length).toBeGreaterThan(5000);
    expect(SRC).toContain('學習步驟進度');
  });
});
