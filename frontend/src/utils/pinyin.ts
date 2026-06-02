/**
 * Pinyin lookup for common Chinese characters (~2500 most frequent).
 * Used to detect homophones: two characters with the same pinyin (tone-insensitive)
 * are considered homophones for STT correction purposes.
 *
 * Format: base pinyin without tone marks (e.g. "he" covers 河/禾/和/何/合…).
 * Multi-reading characters use their most common reading.
 *
 * This file is a thin facade — implementation is split into:
 *   pinyin/data.ts      — static lookup tables
 *   pinyin/normalize.ts — getPinyin (character → toneless pinyin)
 *   pinyin/match.ts     — comparison + scoring algorithms
 */

export { getPinyin } from './pinyin/normalize';
export {
  isHomophone,
  isNearSound,
  isSttEquivalent,
  correctHomophones,
} from './pinyin/match';
