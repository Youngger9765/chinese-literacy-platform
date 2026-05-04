// Font stacks for the learning shell (issue #1351).
//
// ZHUYIN_FONT_STACK — used when zhuyin annotations are visible. BpmfZihiSans
// is a custom PUA font required to render bopomofo on Chinese characters; it
// must remain for zhuyin-active scenes regardless of readability concerns.
//
// SERIF_FONT_STACK — used when zhuyin is off. 陳淑麗教授 (5/1 expert review)
// flagged 黑體 as hostile to nearsighted students; cwTeXKai (Google Fonts
// 教育楷書) and Noto Serif TC are kerned for reading comprehension at small
// sizes and align with textbook conventions.
export const ZHUYIN_FONT_STACK = "'BpmfZihiSans', 'Noto Sans TC', sans-serif";
export const SERIF_FONT_STACK =
  "'cwTeXKai', 'Noto Serif TC', 'PingFang TC', 'Microsoft JhengHei', serif";

export const fontForZhuyin = (zhuyinActive: boolean): string =>
  zhuyinActive ? ZHUYIN_FONT_STACK : SERIF_FONT_STACK;
