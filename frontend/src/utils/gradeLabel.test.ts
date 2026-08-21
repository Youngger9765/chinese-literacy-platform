import { describe, it, expect } from 'vitest';
import { gradeLabel } from './gradeLabel';

describe('gradeLabel (#2683)', () => {
  it('renders a year group as 第 N 級', () => {
    expect(gradeLabel('4')).toBe('第 4 級');
    expect(gradeLabel('9')).toBe('第 9 級');
  });

  it('leaves a named collection alone', () => {
    // The bug this locks: `第 {grade} 級` produced 「第 文言文 級」.
    expect(gradeLabel('文言文')).toBe('文言文');
    expect(gradeLabel('品格教育')).toBe('品格教育');
  });

  it('does not wrap a value that merely contains a digit', () => {
    expect(gradeLabel('文言文2')).toBe('文言文2');
  });
});
