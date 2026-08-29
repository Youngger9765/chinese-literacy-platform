/**
 * 報告頁要把**真實百分比**送給計分端點，不是只送一個「有沒有達標」（#2904）。
 *
 * 後端的三個來源任一有值才會寫 overall_score。原本前端在 ReportPage 算出了
 * comprehensionPct，第 89 行卻壓成 `pct >= 60` 一個布林送上去 ——
 * 於是沒達標的學生在後端 `elif comprehension_passed:` 什麼都不加，
 * `scores` 是空的、整段跳過：**不是拿低分，是完全沒有分數**。
 * prod 561 課完成只有 9 筆有分數。
 *
 * 純函式對了不代表畫面接得到 —— 這裡直接讀原始碼斷言那條線接著。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const PAGE = fs.readFileSync(
  path.resolve(__dirname, '../ReportPage.tsx'), 'utf8');
const API = fs.readFileSync(
  path.resolve(__dirname, '../../../services/gamificationApi.ts'), 'utf8');

describe('報告頁送出的計分資料', () => {
  it('正向對照：兩個檔案真的讀到了', () => {
    expect(PAGE.length).toBeGreaterThan(2000);
    expect(API.length).toBeGreaterThan(2000);
    expect(PAGE).toContain('reportSessionComplete');
  });

  it('⭐ ReportPage 有把真實百分比一起送出去', () => {
    expect(PAGE).toMatch(/comprehensionScore:\s*comprehensionPct/);
  });

  it('api 層有把它放進 body（送了但沒進 body 等於沒送）', () => {
    expect(API).toMatch(/comprehension_score:\s*opts\.comprehensionScore/);
  });

  it('opts 型別上要有這個欄位，否則 tsc 會靜靜吃掉多傳的參數', () => {
    expect(API).toMatch(/comprehensionScore\?:\s*number/);
  });

  it('舊的 comprehensionPassed 仍然要送 —— 後端拿它當退路', () => {
    expect(PAGE).toMatch(/comprehensionPassed/);
    expect(API).toMatch(/comprehension_passed:\s*opts\.comprehensionPassed/);
  });
});
