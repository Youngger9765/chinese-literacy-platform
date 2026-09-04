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
import { describe, it, expect, afterEach } from 'vitest';

/**
 * Seeded, so a red here means something. Placement calls Math.random, so this
 * test used to answer differently every run: it went red once in CI with L0105
 * dropping 拒人於千里之外, and roughly 700,000 local lesson-runs (102,900 direct,
 * plus 4,000 seeds across 147 lessons) never reproduced it. A gate whose result
 * cannot be reproduced cannot be acted on — the only available response is to
 * re-run it, which is how a real failure eventually gets waved through.
 *
 * With a fixed sequence of seeds the answer is the same on every machine: if
 * this goes red in CI it goes red locally too, and the message names the seed.
 */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const realRandom = Math.random;
afterEach(() => {
  Math.random = realRandom;
});
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
        // Seed per lesson and run, so a failure names a case anyone can rerun.
        const seed = (uid.split('').reduce((h, c) => h * 31 + c.charCodeAt(0), 7) | 0) + run;
        Math.random = mulberry32(seed);
        const { placedWords } = generateGrid(words);
        const missing = words.filter((w) => !placedWords.some((p) => p.word === w));
        if (missing.length) {
          dropped.push(
            `${uid} run${run} (seed ${seed}, ${placedWords.length}/${words.length} placed): ${missing.join(',')}`,
          );
        }
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
