// Font stacks for the learning shell (issue #1351).
//
// ZHUYIN_FONT_STACK — zhuyin-active. BpmfZihiSerif (字嗨宋體, ButTaiwan/bpmfvs)
// carries the Bopomofo IVS variant selectors (U+E0100–E01EF) needed to render
// zhuyin annotations on each Chinese character, with serif (宋體) base glyphs
// instead of the previous BpmfGenYoGothic (黑體) — addressing 陳淑麗教授 5/1
// expert review feedback that 黑體 is hostile to nearsighted students.
//
// SERIF_FONT_STACK — zhuyin-off. cwTeXKai (Google Fonts 教育楷書) and Noto
// Serif TC are kerned for reading comprehension at small sizes and align with
// textbook conventions.
export const ZHUYIN_FONT_STACK = "'BpmfZihiSerif', 'Noto Serif TC', serif";
export const SERIF_FONT_STACK =
  "'cwTeXKai', 'Noto Serif TC', 'PingFang TC', 'Microsoft JhengHei', serif";

export const fontForZhuyin = (zhuyinActive: boolean): string =>
  zhuyinActive ? ZHUYIN_FONT_STACK : SERIF_FONT_STACK;
