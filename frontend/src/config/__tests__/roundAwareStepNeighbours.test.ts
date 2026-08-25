import { describe, it, expect } from 'vitest';
import { stepNeighbours } from '../stepNeighbours';
import { resolveActiveSteps } from '../stepConfig';

/**
 * 維度 4（元件 activate）與 7（URL）的資料層鎖 —— 多文本課（#2930）。
 *
 * 2026-08-25 staging 實測：站在 `?p=7wavn`（第 3 篇）時
 *   active 圓圈  → 永遠是「2. 讀全文-做記號」（第 1 篇那顆）
 *   上一步／下一步 → 永遠是「課程簡介／重點朗讀」（第 1 輪的鄰居）
 *
 * 根因：`stepNeighbours(activeSteps, currentView)` 的 `currentView` 只反映
 * 路徑段（`full-text-annotate`），不含 `?p=`。`matches` 於是永遠命中
 * **第一個**同名步驟。三個輪次共用一顆 active。
 *
 * ⚠️ 這支的 docstring 早就記過一次同類事故（只比 `s.id` 導致全部 miss），
 *    當時的結論是「單元測試傳 step id、真實呼叫端傳 AppView，所以測不到」。
 *    這次是同一個縫的另一邊：呼叫端傳的東西**少了輪次**。
 */
const SEQ = [
  'lesson-intro',
  'full-text-annotate#p3kud', 'key-passage-reading#yprak',
  'full-text-annotate#4uee3', 'key-passage-reading#9a7x4',
  'full-text-annotate#7wavn', 'key-passage-reading#ajy9w',
  'report',
];

describe('stepNeighbours 要吃得到輪次（多文本）', () => {
  const steps = resolveActiveSteps(SEQ);

  it('先確認這個序列真的有三輪 —— 否則下面在測空氣', () => {
    expect(steps.filter((s) => (s.baseId ?? s.id).startsWith('full-text-annotate'))).toHaveLength(3);
  });

  it.each([
    ['full-text-annotate#p3kud', 1],
    ['full-text-annotate#4uee3', 3],
    ['full-text-annotate#7wavn', 5],
  ])('%s 命中第 %i 個位置，不是第一個同名步驟', (key, idx) => {
    expect(stepNeighbours(steps, key).index).toBe(idx);
  });

  it('每一輪的上一步／下一步是**自己那一輪**的鄰居', () => {
    const third = stepNeighbours(steps, 'full-text-annotate#7wavn');
    expect(third.prev?.id).toBe('key-passage-reading#9a7x4');   // 第 2 輪的念順順
    expect(third.next?.id).toBe('key-passage-reading#ajy9w');   // 第 3 輪的念順順
    const first = stepNeighbours(steps, 'full-text-annotate#p3kud');
    expect(first.prev?.id).toBe('lesson-intro');
    expect(first.next?.id).toBe('key-passage-reading#yprak');
  });

  it('三輪各自命中不同位置 —— 這是整件事的重點', () => {
    const idx = ['p3kud', '4uee3', '7wavn']
      .map((s) => stepNeighbours(steps, `full-text-annotate#${s}`).index);
    expect(new Set(idx).size).toBe(3);
  });
});

describe('單文本課不可以被這個改動弄壞', () => {
  const steps = resolveActiveSteps([
    'lesson-intro', 'full-text-annotate', 'key-passage-reading', 'report',
  ]);

  it('沒有輪次時照舊命中', () => {
    expect(stepNeighbours(steps, 'full-text-annotate').index).toBe(1);
    expect(stepNeighbours(steps, 'key-passage-reading').next?.id).toBe('report');
  });

  it('傳 AppView 仍然要能命中（既有呼叫端就是這樣傳的）', () => {
    const byView = stepNeighbours(steps, String(steps[1].view));
    expect(byView.index).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⚠️ 上面那些是打在 **helper** 上的，而 helper 本來就是對的 ——
//    2026-08-25 我先寫了它們，8 條全綠，而畫面上 bug 還在。
//    真正的缺陷在**呼叫端**：它傳的是 `currentView`（只有路徑段，沒有輪次）。
//    這一段鎖的是那件事。
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(__dirname, '..', '..');
function walk(d: string): string[] {
  return readdirSync(d).flatMap((e) => {
    const f = join(d, e);
    if (statSync(f).isDirectory()) return walk(f);
    return /\.tsx?$/.test(e) ? [f] : [];
  });
}

describe('呼叫 stepNeighbours 時必須帶輪次', () => {
  const files = walk(SRC).filter((f) => !/\.test\.|__tests__|stepNeighbours\.ts$/.test(f));

  it('掃得到檔案', () => {
    expect(files.length).toBeGreaterThan(200);
  });

  it('沒有人拿 `currentView` 當 key 呼叫 —— 那裡面沒有輪次', () => {
    const offenders = files
      .map((f) => [f, readFileSync(f, 'utf8')] as const)
      .filter(([, s]) => /stepNeighbours\(\s*\w+\s*,\s*currentView\s*\)/.test(s))
      .map(([f]) => f.replace(SRC, 'src'));
    expect(
      offenders,
      `這些檔用 currentView 呼叫 stepNeighbours（只有路徑段、沒有輪次）：\n  ${offenders.join('\n  ')}\n`
      + '改傳 useCurrentStepId() 的結果（`full-text-annotate#7wavn`）。',
    ).toEqual([]);
  });
});
