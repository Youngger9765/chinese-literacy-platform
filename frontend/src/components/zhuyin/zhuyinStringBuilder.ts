import { SS_MAPPING, type ProcessedChar } from './bopomoConstants';
import fontMissingVariants from './fontMissingVariants.json';

/**
 * 出貨的注音字型畫不出來的異體字 → 標準體。SOT 是 `fontMissingVariants.json`
 * （**同一份檔案**也被 `backend/scripts/generate_lesson_zhuyin.py` 讀 —— 兩邊各存
 * 一份必然會漂，而漂掉的症狀是「表上的槽位是為算的、畫出來的字是爲」）。
 */
const VARIANTS: Record<string, string> = fontMissingVariants.variants;

/**
 * Convert ProcessedChar[] to a Unicode string suitable for BpmfIansui font rendering.
 * Characters with non-default style sets get a PUA variant selector appended.
 *
 * ⚠️ 異體字在這裡換成標準體（#3277）。這 13 個字一個字符都不在字型的 cmap 裡，
 * 所以原本那 36 個位置是瀏覽器用 fallback 字型畫的 —— 字體不一樣，而且
 * **一點注音都沒有**（注音是這顆字型的樣式集畫的）。
 *
 * 槽位是產表時**換過字之後**算的，所以這裡換字不會拿到錯的讀音
 * （「因爲」→「因為」→ ss01 → ㄨㄟˋ；只在這一層換字會拿到預設槽 ㄨㄟˊ）。
 */
export function buildZhuyinString(processed: ProcessedChar[]): string {
  let result = '';
  for (const { char, styleSet } of processed) {
    result += VARIANTS[char] ?? char;
    if (styleSet !== '0000' && styleSet in SS_MAPPING) {
      result += String.fromCodePoint(parseInt(SS_MAPPING[styleSet], 16));
    }
  }
  return result;
}
