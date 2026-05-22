/**
 * Map a matched variant index returned by match() to the BpmfIansui font's
 * stylistic-set code ('0000' = no selector = font default, 'ss01'..'ss05' = variants).
 *
 * @param matchIndex  Index j returned by match(): -1 means "no explicit pattern
 *                    matched", 0..n means v[j] was the matched variant.
 * @param defaultVariantIdx  The v[] index whose pronunciation the font renders
 *                    by default ('0000').  Stored as `d` in poyin_db.json;
 *                    defaults to 0 when the field is absent.
 *
 * Mapping rules:
 *   j == -1              → treated as j=0 (no match falls back to v[0] reading)
 *   j == defaultVariantIdx → '0000'  (explicit match on the default variant)
 *   j <  defaultVariantIdx → 'ss0{j+1}'  (shift up to skip the default slot)
 *   j >  defaultVariantIdx → 'ss0{j}'    (no shift needed)
 *
 * When defaultVariantIdx == 0 (the common case), this simplifies to:
 *   j == -1 or j == 0  → '0000'
 *   j > 0              → 'ss0{j}'
 * which is identical to the original code.
 */
export function variantIndexToStyleSet(matchIndex: number, defaultVariantIdx: number): string {
  // No explicit match: fall back to v[0] as the reading for unrecognized contexts.
  const j = matchIndex === -1 ? 0 : matchIndex;

  if (j === defaultVariantIdx) {
    return '0000';
  }
  if (j < defaultVariantIdx) {
    return `ss0${j + 1}`;
  }
  // j > defaultVariantIdx
  return `ss0${j}`;
}
