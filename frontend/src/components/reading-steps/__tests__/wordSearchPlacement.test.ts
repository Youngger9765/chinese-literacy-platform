/**
 * Every word the puzzle lists must be findable in the grid it generated (#2683).
 *
 * `generateGrid` gives up on a word after 200 attempts and skips it, and the UI lists
 * `placedWords` rather than the vocabulary — so a skipped word never becomes an
 * unsolvable target. What it does become is a word the student never practises, and
 * nothing reports that.
 *
 * Run against every lesson's real vocabulary rather than a fixture of invented words:
 * the failure depends on word length and count, which is exactly what a hand-written
 * fixture gets wrong.
 */
import { describe, it, expect } from 'vitest';
import { generateGrid } from '../wordSearchGrid';
import vocab from './vocab_fixture.json';

const LESSONS = Object.entries(vocab as Record<string, string[]>);

describe('word search grid placement', () => {
  it('has lessons to test', () => {
    expect(LESSONS.length).toBeGreaterThan(100);
  });

  it('places every word of every lesson', () => {
    const dropped: string[] = [];
    for (const [uid, words] of LESSONS) {
      // Ten runs each: placement is randomised, so a single run can pass by luck.
      for (let run = 0; run < 10; run++) {
        const { placedWords } = generateGrid(words);
        const missing = words.filter((w) => !placedWords.some((p) => p.word === w));
        if (missing.length) dropped.push(`${uid} run${run}: ${missing.join(',')}`);
      }
    }
    expect(dropped).toEqual([]);
  });

  it('every placed word really reads out of the grid', () => {
    const wrong: string[] = [];
    for (const [uid, words] of LESSONS.slice(0, 40)) {
      const { grid, placedWords } = generateGrid(words);
      for (const p of placedWords) {
        const chars = [...p.word];
        const read = chars
          .map((_, i) =>
            p.direction === 'horizontal' ? grid[p.row][p.col + i] : grid[p.row + i][p.col]
          )
          .join('');
        if (read !== p.word) wrong.push(`${uid}: ${p.word} reads as ${read}`);
      }
    }
    expect(wrong).toEqual([]);
  });
});
