/**
 * paragraphMarkers — detect 紙本 caption rows inside paragraphs.
 *
 * Lessons like G7-L30 embed image/table captions as their own paragraph
 * (e.g. `圖一 白尾八哥（左）...`). To render images/tables inline at the
 * same place they appear in the printed worksheet (rather than dumped at
 * the end of the article), we detect these caption paragraphs and emit
 * the corresponding asset right after them.
 *
 * Caption rule
 *   `^(圖|表)[一二三...十]\s+.+`
 *
 * The trailing whitespace is what distinguishes a caption row from a body
 * sentence that happens to start with the marker, e.g.
 *   - `表一 白尾八哥...`     → caption (whitespace after 表一)
 *   - `表一比較了外形與習性` → body sentence (CJK char immediately after)
 *
 * G7-L30 verified manually:
 *   paragraph[1] `圖一 ...`       → caption
 *   paragraph[2] `表一比較了...`  → body, NOT a caption
 *   paragraph[3] `表一 ...`       → caption
 *   paragraph[4] `表二則說明...`  → body, NOT a caption
 *   paragraph[5] `表二 ...`       → caption
 */

const CN_NUMERALS: Record<string, number> = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5,
  六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
};

const IMAGE_CAPTION_RE = /^圖([一二三四五六七八九十])[\s　]+\S/;
const TABLE_CAPTION_RE = /^表([一二三四五六七八九十])[\s　]+\S/;

// Body-sentence intro for a table, e.g. `表一比較了...`, `表二則說明了...`.
// Distinguished from a caption row by the ABSENCE of whitespace after 表N
// (a CJK char follows immediately). Used as the inline anchor when a lesson
// has no standalone `表N …` caption row (e.g. after #2218 stripped them from
// G7-L30 paragraphs). Anchoring to the intro sentence keeps the table inline at
// its natural reference point — the table renders right after the paragraph that
// first explains it, rather than vanishing to the bottom-of-article fallback.
const TABLE_BODY_INTRO_RE = /^表([一二三四五六七八九十])(?![\s　])\S/;

/**
 * Detect whether a paragraph is an image caption row.
 * Returns the 1-based marker number (e.g. 1 for 圖一) or null.
 */
export function detectImageMarker(text: string): number | null {
  if (!text) return null;
  const m = text.match(IMAGE_CAPTION_RE);
  if (!m) return null;
  return CN_NUMERALS[m[1]] ?? null;
}

/**
 * Detect whether a paragraph is a table caption row.
 * Returns the 1-based marker number (e.g. 1 for 表一) or null.
 */
export function detectTableMarker(text: string): number | null {
  if (!text) return null;
  const m = text.match(TABLE_CAPTION_RE);
  if (!m) return null;
  return CN_NUMERALS[m[1]] ?? null;
}

/**
 * Detect a body paragraph that introduces a table (e.g. `表一比較了...`).
 * Returns the 1-based marker number or null.
 *
 * This is the fallback anchor for tables when the printed `表N …` caption row
 * has been moved out of `paragraphs` (the figure caption now lives in the
 * asset's own `title`/`caption`, see #2218). Without this, a graphic-text lesson
 * whose tables are only named in prose would drop the table to the
 * bottom-of-article fallback block instead of rendering it inline.
 */
export function detectTableBodyMarker(text: string): number | null {
  if (!text) return null;
  const m = text.match(TABLE_BODY_INTRO_RE);
  if (!m) return null;
  return CN_NUMERALS[m[1]] ?? null;
}

/**
 * Pick a table from the yml `tables[]` array for the given marker number.
 *
 * Strategy:
 *   1. Match by title prefix — `表一 ...` caption → table whose title starts with `表一`.
 *      Most robust because yml parser preserves the printed marker in `title`.
 *   2. Fallback — use `markerNumber - 1` as array index. Works when titles don't
 *      embed the marker (e.g. G7-L28's only table is `文章重點表 — ...`).
 *
 * Returns the matching table index, or null if neither strategy resolves.
 */
export function resolveTableIndex<T extends { title?: string }>(
  tables: T[] | undefined,
  markerNumber: number,
): number | null {
  if (!tables || tables.length === 0) return null;
  const cnNumeral = Object.keys(CN_NUMERALS).find((k) => CN_NUMERALS[k] === markerNumber);
  if (cnNumeral) {
    const prefix = `表${cnNumeral}`;
    const titleIdx = tables.findIndex((t) => (t.title ?? '').trim().startsWith(prefix));
    if (titleIdx >= 0) return titleIdx;
  }
  // Fallback: positional
  const fallback = markerNumber - 1;
  if (fallback >= 0 && fallback < tables.length) return fallback;
  return null;
}

/**
 * Pick an image index for a `圖N` caption. Image yml `caption` rarely embeds the
 * printed marker, so we use positional mapping. Verified for G7-L30 (1 image,
 * marker 圖一 → index 0) and G7-L29 (4 images, 圖一-圖四 → index 0-3).
 */
export function resolveImageIndex<T>(
  images: T[] | undefined,
  markerNumber: number,
): number | null {
  if (!images || images.length === 0) return null;
  const idx = markerNumber - 1;
  if (idx >= 0 && idx < images.length) return idx;
  return null;
}
