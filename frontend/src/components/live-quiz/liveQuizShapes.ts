/**
 * 課堂搶答 shape+color system — PRD §12 UI/UX review (2026-10-15):
 *
 * "四色避開紅色（平台規定紅色只給系統錯誤）：三角形藍、菱形橘、圓形綠、
 * 方形紫，白字對比 5.0–6.6（AA 級）；對錯用 ✓／✗ 加文字，不只靠顏色"
 *
 * `error` (red) is reserved platform-wide for system errors (DESIGN.md) —
 * never used here. Position 0-3 maps to a FIXED shape+color regardless of
 * how many options a round has (2-4) — a 2-option zhuyin question always
 * uses position 0/1 (triangle/diamond), never a "remapped" 3rd color, so a
 * student who has learned "triangle = top-left" never has to relearn it.
 */
export interface ShapeDef {
  glyph: string;
  label: string;
  bg: string; // Tailwind background class
  textOnBg: string; // Tailwind text color class for content ON this bg (white)
}

// Tailwind 700-shade equivalents chosen for ≥5.0:1 contrast with white text.
export const SHAPE_DEFS: ShapeDef[] = [
  { glyph: '▲', label: '三角形', bg: 'bg-[#1D4ED8]', textOnBg: 'text-white' }, // blue-700
  { glyph: '◆', label: '菱形', bg: 'bg-[#C2410C]', textOnBg: 'text-white' }, // orange-700
  { glyph: '●', label: '圓形', bg: 'bg-[#15803D]', textOnBg: 'text-white' }, // green-700
  { glyph: '■', label: '方形', bg: 'bg-[#6D28D9]', textOnBg: 'text-white' }, // violet-700
];

export function shapeForIndex(index: number): ShapeDef {
  return SHAPE_DEFS[index % SHAPE_DEFS.length];
}

/** Options arrive keyed "A".."D" in display order already (per-game shuffled
 * server-side) — index 0 = "A" = triangle, etc. This is the ONLY place that
 * mapping is made, so host and player screens can never disagree on which
 * shape goes with which option. */
export function shapeForOptionIndex(index: number): ShapeDef {
  return shapeForIndex(index);
}
