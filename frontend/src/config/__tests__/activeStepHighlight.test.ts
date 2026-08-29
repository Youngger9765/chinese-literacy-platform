/**
 * 同名步驟出現好幾次時，高亮要停在**這一輪**那一顆（#2930 維度 4）。
 *
 * 一份學習單印三篇時，「讀全文／念順順／詞語…」各出現三次。
 * 判斷「現在是第幾步」如果只比對路徑段，三顆同名的永遠對到第一顆 ——
 * 圓圈停在第 1 篇、上一步／下一步也跳到第 1 篇那一輪。
 */
import { describe, it, expect } from 'vitest';
import { resolveActiveSteps } from '../stepConfig';
import { stepNeighbours } from '../stepNeighbours';

// staging `GET /api/stories/20063` 的真值（三篇 × 五個模組 + 共用步驟）
const SEQ = [
  'lesson-intro',
  'full-text-annotate#p3kud', 'key-passage-reading#yprak', 'vocab-definition#mc9mf',
  'vocab-application#4fq9w', 'keypoints-table#dydnq',
  'full-text-annotate#4uee3', 'key-passage-reading#9a7x4', 'vocab-definition#3944x',
  'vocab-application#3q3cd', 'keypoints-table#6xvh6',
  'full-text-annotate#7wavn', 'key-passage-reading#ajy9w', 'vocab-definition#arpnw',
];

describe('多篇課的步驟高亮', () => {
  const steps = resolveActiveSteps(SEQ);

  it('輪次沒有在解析時被丟掉（丟掉的話後面每一條都對不到）', () => {
    const withRound = steps.filter((s) => s.id.includes('#'));
    expect(withRound.length, `解析後帶輪次的步驟：${steps.map((s) => s.id).join(',')}`)
      .toBe(SEQ.filter((s) => s.includes('#')).length);
  });

  it('每一顆同名步驟各自對到自己那一輪，不會擠在第一顆', () => {
    const idxs = ['p3kud', '4uee3', '7wavn'].map(
      (r) => stepNeighbours(steps, `full-text-annotate#${r}`).index,
    );
    expect(new Set(idxs).size, `三輪的「讀全文」對到同一個位置：${idxs}`).toBe(3);
    expect(idxs.every((i) => i >= 0), `有對不到的：${idxs}`).toBe(true);
  });

  it('上一步／下一步不會跨回第 1 篇', () => {
    const nav = stepNeighbours(steps, 'full-text-annotate#7wavn');
    expect(nav.next?.id, '第 3 篇的下一步應該是第 3 篇的念順順')
      .toBe('key-passage-reading#ajy9w');
  });

  it('單篇課不受影響（沒有輪次時照原本走）', () => {
    const plain = resolveActiveSteps(['lesson-intro', 'full-text-annotate', 'key-passage-reading']);
    expect(stepNeighbours(plain, 'full-text-annotate').index).toBe(1);
  });
});
