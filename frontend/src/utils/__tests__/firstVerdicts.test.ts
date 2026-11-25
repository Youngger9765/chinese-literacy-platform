/** #4081 — 第一次的對錯只寫一次，之後的重答不覆蓋。 */
import { describe, it, expect } from 'vitest';
import { mergeFirstVerdicts } from '../firstVerdicts';

describe('mergeFirstVerdicts', () => {
  it('records the first verdict and keeps it after a later correct retry', () => {
    let first = mergeFirstVerdicts({}, { q1: false, q2: true });
    first = mergeFirstVerdicts(first, { q1: true, q2: true });
    expect(first).toEqual({ q1: false, q2: true });
  });

  it('ignores ungraded (null) answers until they are graded', () => {
    let first = mergeFirstVerdicts({}, { q1: null });
    expect(first).toEqual({});
    first = mergeFirstVerdicts(first, { q1: false });
    expect(first).toEqual({ q1: false });
  });

  it('does not mutate its input and tolerates junk', () => {
    const base = { q1: true };
    expect(mergeFirstVerdicts(base, null)).toEqual({ q1: true });
    mergeFirstVerdicts(base, { q2: false });
    expect(base).toEqual({ q1: true });
  });
});
