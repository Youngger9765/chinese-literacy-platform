/**
 * 多篇課的 stepper 要讓學生看得出「這一顆是第幾篇的」。
 *
 * 2026-08-27 prod 實測 L0063（3 篇）的 stepper 是攤平 21 顆，
 * 「讀全文-做記號／重點朗讀／詞語理解／語詞應用／文章重點表」
 * 原樣重複三次、標籤完全相同 —— 功能對，但學生只能靠位置猜。
 *
 * 這裡鎖住 annotateStepParts() 的契約：
 *   - 依 roundSlug 第一次出現的順序給篇次（1-based）
 *   - 沒有 roundSlug 的共用步（課程簡介／聚光燈／報告…）不帶篇次
 *   - 每一篇的第一步標記 isPartStart，給 stepper 畫分隔
 *   - 單篇課完全不帶篇次（行為與以前一模一樣）
 */
import { describe, it, expect } from 'vitest';
import { annotateStepParts } from '../roundScope';
import { resolveActiveSteps } from '../stepConfig';

import L0063fx from './fixtures/L0063_steps.json';
import L0011fx from './fixtures/L0011_steps.json';

// 兩份都是 2026-08-27 從 prod /api/stories/{id} 直接存下來的，不是我編的形狀
const L0063 = L0063fx.step_sequence as string[];
const L0063_MANIFEST = L0063fx.manifest_sections as never;
const L0011 = L0011fx.step_sequence as string[];
const L0011_MANIFEST = L0011fx.manifest_sections as never;

describe('annotateStepParts — 多篇課的 stepper 要看得出篇次', () => {
  it('三篇課：每一步都對到正確的篇次，共用步不帶篇次', () => {
    const ann = annotateStepParts(resolveActiveSteps(L0063), L0063_MANIFEST);

    // 正向對照：真的解析出 3 篇（不是 0 篇讓下面的斷言空過）
    const totals = new Set(ann.map((a) => a.partTotal).filter(Boolean));
    expect(totals, '應該解析出篇數').toEqual(new Set([3]));

    const partOf = (id: string) => ann.find((a) => a.step.id === id)?.partNo;

    expect(partOf('full-text-annotate#p3kud')).toBe(1);
    expect(partOf('keypoints-table#dydnq')).toBe(1);
    expect(partOf('full-text-annotate#4uee3')).toBe(2);
    expect(partOf('keypoints-table#6xvh6')).toBe(2);
    expect(partOf('full-text-annotate#7wavn')).toBe(3);
    expect(partOf('keypoints-table#6pyvc')).toBe(3);

    // 共用步（沒有 roundSlug）不帶篇次
    expect(partOf('lesson-intro')).toBeUndefined();
    expect(partOf('report')).toBeUndefined();
  });

  it('三篇課：每一篇的第一步被標成 isPartStart，且剛好三個', () => {
    const ann = annotateStepParts(resolveActiveSteps(L0063), L0063_MANIFEST);
    const starts = ann.filter((a) => a.isPartStart).map((a) => a.step.id);
    expect(starts).toEqual([
      'full-text-annotate#p3kud',
      'full-text-annotate#4uee3',
      'full-text-annotate#7wavn',
    ]);
  });

  it('⭐ 每一顆的無障礙標籤在多篇課裡必須唯一 —— 這是這張票的核心', () => {
    const ann = annotateStepParts(resolveActiveSteps(L0063), L0063_MANIFEST);
    const labels = ann.map((a) => a.a11yLabel);
    expect(new Set(labels).size, `${labels.length} 顆但只有 ${new Set(labels).size} 種標籤`)
      .toBe(labels.length);
    // 而且真的看得出篇次，不是靠流水號硬湊出唯一
    expect(ann.find((a) => a.step.id === 'key-passage-reading#9a7x4')?.a11yLabel)
      .toContain('第 2 篇');
  });

  it('單篇課：完全不帶篇次，行為跟以前一模一樣', () => {
    const ann = annotateStepParts(resolveActiveSteps(L0011), L0011_MANIFEST);
    expect(ann.every((a) => a.partNo === undefined)).toBe(true);
    expect(ann.every((a) => a.partTotal === undefined)).toBe(true);
    expect(ann.some((a) => a.isPartStart)).toBe(false);
    // 標籤不該出現「第 N 篇」
    expect(ann.some((a) => /第 \d+ 篇/.test(a.a11yLabel))).toBe(false);
    // 正向對照：真的有解析到步驟（不是空陣列讓上面全部空過）
    expect(ann.length).toBeGreaterThan(5);
  });
});
