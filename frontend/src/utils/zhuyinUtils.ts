/**
 * Split a Zhuyin-annotated string into visual character groups.
 * Each group is a base character optionally followed by a PUA variant selector (U+E01E1–E01E5).
 * This ensures TTS highlight splits align with what the user sees.
 */
export function splitZhuyinChars(text: string): string[] {
  const codepoints = [...text];
  const groups: string[] = [];
  for (let i = 0; i < codepoints.length; i++) {
    const cp = codepoints[i].codePointAt(0) ?? 0;
    if (cp >= 0xE01E1 && cp <= 0xE01E5 && groups.length > 0) {
      groups[groups.length - 1] += codepoints[i];
    } else {
      groups.push(codepoints[i]);
    }
  }
  return groups;
}
