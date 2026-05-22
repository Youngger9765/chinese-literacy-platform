import { SS_MAPPING, type ProcessedChar } from './bopomoConstants';

/**
 * Convert ProcessedChar[] to a Unicode string suitable for BpmfIansui font rendering.
 * Characters with non-default style sets get a PUA variant selector appended.
 */
export function buildZhuyinString(processed: ProcessedChar[]): string {
  let result = '';
  for (const { char, styleSet } of processed) {
    result += char;
    if (styleSet !== '0000' && styleSet in SS_MAPPING) {
      result += String.fromCodePoint(parseInt(SS_MAPPING[styleSet], 16));
    }
  }
  return result;
}
