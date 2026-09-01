/**
 * Split a Zhuyin-annotated string into visual character groups.
 * Each group is a base character optionally preceded/followed by a
 * Variation Selectors Supplement codepoint (U+E0100–U+E01EF) -- SS_MAPPING's
 * tone-variant selectors (E01E1–E01E5) live in this block, and so do #3022's
 * DIFFICULT_SPAN_START/END markers (bopomoConstants.ts). Every codepoint in
 * this block is a zero-width combining modifier per Unicode's own semantics
 * for "Variation Selector", so the range check is intentionally the whole
 * block rather than just the five ss01-ss05 values -- narrowing it back to
 * E01E1-E01E5 would push the #3022 markers back out as their own phantom
 * "characters", desyncing the karaoke-highlight char index in
 * KeyPassageReading (see splitDifficultSegments in
 * components/zhuyin/difficultSpanRenderer.tsx for why that string can now
 * contain those markers).
 *
 * A tone selector always follows a real character (buildZhuyinString() only
 * ever emits "char, then optional selector"), so attaching it to the
 * *previous* group is enough for those. DIFFICULT_SPAN_START is different --
 * it opens a run, so it comes BEFORE the character it marks, and if that
 * character is the very first thing in the string there is no previous
 * group to attach to. Buffering it and prepending it onto the *next* group
 * instead (rather than letting it fall through to `groups.push()` as its
 * own one-marker group) is what keeps the array's length equal to the
 * visual/spoken character count in that case too -- otherwise
 * groupIdxForProgress() (ttsHighlight.ts) counts a silent phantom
 * "character" and the karaoke highlight boundary drifts by one real
 * character for any line whose first char happens to be a vocab word.
 *
 * This ensures TTS highlight splits align with what the user sees.
 */
export function splitZhuyinChars(text: string): string[] {
  const codepoints = [...text];
  const groups: string[] = [];
  let pendingPrefix = '';
  for (let i = 0; i < codepoints.length; i++) {
    const cp = codepoints[i].codePointAt(0) ?? 0;
    const isSelector = cp >= 0xE0100 && cp <= 0xE01EF;
    if (isSelector && groups.length > 0) {
      groups[groups.length - 1] += codepoints[i];
    } else if (isSelector) {
      pendingPrefix += codepoints[i];
    } else {
      groups.push(pendingPrefix + codepoints[i]);
      pendingPrefix = '';
    }
  }
  if (pendingPrefix) {
    // Degenerate case: the whole string was selector codepoints. Keep them
    // rather than silently dropping information.
    groups.push(pendingPrefix);
  }
  return groups;
}
