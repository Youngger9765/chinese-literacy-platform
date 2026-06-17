import { describe, expect, it } from 'vitest';
import {
  encouragementContainsAbsoluteClaim,
  getEncouragement,
} from './readingEncouragement';

describe('readingEncouragement', () => {
  it('does not claim 一字不差 or 完美 when displayed accuracy is 96%', () => {
    expect(encouragementContainsAbsoluteClaim(0.96)).toBe(false);
    expect(encouragementContainsAbsoluteClaim(0.963)).toBe(false);
  });

  it('allows absolute praise only at 100% rounded accuracy', () => {
    expect(encouragementContainsAbsoluteClaim(1)).toBe(true);
    expect(getEncouragement(1).text).toMatch(/一字不差|完美/);
  });

  it('uses encouraging but honest copy for high-but-not-perfect scores', () => {
    const { text } = getEncouragement(0.96);
    expect(text).toMatch(/讀得|厲害|表現/);
    expect(text).not.toMatch(/一字不差/);
  });
});
