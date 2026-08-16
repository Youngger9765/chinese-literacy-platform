/**
 * parseReadingBenchmark — every notation the worksheets actually use (#2719).
 *
 * The parser was written against ＜ and ＞. Now that the lessons carry their own targets
 * instead of falling through to a grade default, one lesson turned out to write its outer
 * tiers with ≦ and ≧ — and those fell through every branch and were dropped silently,
 * leaving a three-tier rubric with one tier and taking both its messages with them.
 *
 * ≦220 is not ＜220. It is ＜221. Normalising the marker's symbol away at extraction time
 * would have moved the boundary by one, so the parser learns the symbol instead.
 *
 * Counted across the 154 lessons that carry a target:
 *      154  a range        221~250字
 *      143  ＜ and ＞      ＜220字 / ＞251字
 *       10  以下 / 以上     90秒以下 / 105秒以上   (文言文, seconds)
 *        1  ≦ and ≧        ≦220字 / ≧251字        (L0082)
 */
import { describe, expect, it } from 'vitest';

import { parseReadingBenchmark } from '../fluencyAnalyzer';

const tiers = (thresholds: string[]) =>
  thresholds.map((threshold, i) => ({ threshold, feedback: `第${i + 1}級` }));

describe('parseReadingBenchmark', () => {
  it('keeps all three tiers for the common ＜ / range / ＞ form', () => {
    const parsed = parseReadingBenchmark(tiers(['□ ＜190字', '□ 191~220字', '□ ＞221字']));
    expect(parsed).toEqual([
      { minCpm: 0, maxCpm: 189, feedback: '第1級' },
      { minCpm: 191, maxCpm: 220, feedback: '第2級' },
      { minCpm: 221, maxCpm: Infinity, feedback: '第3級' },
    ]);
  });

  it('keeps all three tiers when the marker wrote ≦ and ≧ (L0082)', () => {
    const parsed = parseReadingBenchmark(tiers(['□ ≦220字', '□ 221~250字', '□ ≧251字']));
    expect(parsed).toHaveLength(3);
    // ≦220 includes 220 — one more than ＜220 does.
    expect(parsed[0]).toEqual({ minCpm: 0, maxCpm: 220, feedback: '第1級' });
    expect(parsed[2]).toEqual({ minCpm: 251, maxCpm: Infinity, feedback: '第3級' });
  });

  it('reads the seconds form 文言文 uses, and marks its unit', () => {
    const parsed = parseReadingBenchmark(tiers(['□42秒以下', '□42~55秒', '□55秒以上']));
    expect(parsed).toHaveLength(3);
    expect(parsed.every(l => 'unit' in l && l.unit === 'sec')).toBe(true);
  });

  it('drops nothing silently: a tier it cannot read is not simply absent', () => {
    // The failure this whole test file exists for. Any future notation that falls
    // through every branch must not shrink the rubric behind the reader's back.
    const parsed = parseReadingBenchmark(tiers(['□ ≦220字', '□ 221~250字', '□ ≧251字']));
    expect(parsed.length).toBe(3);
  });
});
