/**
 * 回到島上時，哪一站要記成「做過」。
 * 課程簡介（港口燈塔）在平台設計上永遠不會進 steps_completed，
 * 只靠伺服器進度判定的話第一區永遠集不滿、後面的霧永遠不散。
 */
import { describe, it, expect } from 'vitest';
import { shouldMarkVisitedOnReturn } from '../storyMode';

describe('shouldMarkVisitedOnReturn', () => {
  it('marks the stop when the lesson page reported it finished, even with reliable server progress', () => {
    expect(shouldMarkVisitedOnReturn({ finished: true, reliable: true })).toBe(true);
  });

  it('does not mark when the student only pressed 回到島上 and server progress is reliable', () => {
    expect(shouldMarkVisitedOnReturn({ finished: false, reliable: true })).toBe(false);
  });

  it('keeps the old fallback: no server progress at all → mark what was visited', () => {
    expect(shouldMarkVisitedOnReturn({ finished: false, reliable: false })).toBe(true);
  });
});
