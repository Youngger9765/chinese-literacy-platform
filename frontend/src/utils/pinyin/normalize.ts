/**
 * pinyin/normalize.ts — tone marker handling + bopomofo conversion.
 *
 * Exports:
 *   - getPinyin(ch): returns toneless pinyin for a character, or null
 */

import { charToPinyin } from './data';

/** Returns the toneless pinyin for a character, or `null` if unknown. */
export function getPinyin(ch: string): string | null {
  return charToPinyin.get(ch) ?? null;
}
