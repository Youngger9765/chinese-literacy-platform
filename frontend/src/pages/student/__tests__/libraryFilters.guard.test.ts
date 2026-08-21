import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The difficulty filter is not coming back (#2683).
 *
 * `getDifficulty` derives difficulty from grade — 4-5 → 入門, 6-7 → 中階, 8-9 → 進階 —
 * so a difficulty filter beside a grade filter is one axis shown twice. Side by side
 * they invite a combination, and 10 of the 15 possible combinations return zero
 * lessons. Measured on staging, not assumed.
 *
 * What made it a real problem rather than a cosmetic one: the selection persists in
 * sessionStorage, so a student who hit an impossible pair kept an empty library
 * across reloads. It reads as 「課文全部不見了」, and the catalogue is fine.
 */
const src = readFileSync(
  join(__dirname, '..', 'StoryLibrary.tsx'),
  'utf-8',
);

describe('library filters (#2683)', () => {
  it('has no difficulty filter', () => {
    expect(src).not.toMatch(/selectedDifficulty/);
    expect(src).not.toMatch(/'easy',\s*'medium',\s*'hard'.*\.map/s);
  });

  it('clears a stored difficulty from before the removal', () => {
    // Otherwise anyone already stuck stays stuck: nothing reads the key any more,
    // so nothing would ever clear it.
    expect(src).toMatch(/removeItem\(['"]library_filter_difficulty['"]\)/);
  });
});
