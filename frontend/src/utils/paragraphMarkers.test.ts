import { describe, it, expect } from 'vitest';
import {
  detectImageMarker,
  detectTableMarker,
  detectTableBodyMarker,
  resolveImageIndex,
  resolveTableIndex,
} from './paragraphMarkers';

describe('detectImageMarker', () => {
  it('matches G7-L30 caption "圖一 白尾八哥..."', () => {
    expect(detectImageMarker('圖一 白尾八哥（左）與 臺灣冠八哥（右）外形圖')).toBe(1);
  });

  it('matches G7-L28 caption "圖一 巴斯德..."', () => {
    expect(detectImageMarker('圖一 巴斯德鵝頸瓶實驗的設計與程序')).toBe(1);
  });

  it('matches 圖二/圖三/圖四', () => {
    expect(detectImageMarker('圖二 something')).toBe(2);
    expect(detectImageMarker('圖三 something')).toBe(3);
    expect(detectImageMarker('圖四 something')).toBe(4);
  });

  it('does NOT match body sentences referencing 圖 N', () => {
    expect(detectImageMarker('圖三進一步說明了一百多年來')).toBeNull();
    expect(detectImageMarker('圖一比較了兩種八哥')).toBeNull();
  });

  it('returns null for non-marker text', () => {
    expect(detectImageMarker('白尾八哥是一種外來種')).toBeNull();
    expect(detectImageMarker('')).toBeNull();
    expect(detectImageMarker('表一 something')).toBeNull(); // table marker, not image
  });

  it('tolerates CJK fullwidth space (U+3000)', () => {
    expect(detectImageMarker('圖一　白尾八哥')).toBe(1);
  });
});

describe('detectTableMarker', () => {
  it('matches G7-L30 captions "表一 ..." and "表二 ..."', () => {
    expect(detectTableMarker('表一 白尾八哥與臺灣冠八哥比較異同表')).toBe(1);
    expect(detectTableMarker('表二 近年兩種臺灣常見八哥之族群數量之變化')).toBe(2);
  });

  it('does NOT match body sentences referencing 表 N', () => {
    expect(detectTableMarker('表一比較了白尾八哥和臺灣冠八哥')).toBeNull();
    expect(detectTableMarker('表二則說明了兩種八哥近年族群數量的變化')).toBeNull();
    expect(detectTableMarker('從表二可知')).toBeNull();
  });

  it('returns null for non-marker text', () => {
    expect(detectTableMarker('白尾八哥是一種外來種')).toBeNull();
    expect(detectTableMarker('圖一 something')).toBeNull(); // image marker
  });
});

describe('detectTableBodyMarker', () => {
  // After #2218 stripped the `表N …` caption rows from G7-L30 paragraphs, the
  // inline anchor falls back to the body sentence that introduces each table.
  it('matches G7-L30 table intro sentences "表一比較了…" / "表二則說明了…"', () => {
    expect(detectTableBodyMarker('表一比較了白尾八哥和臺灣冠八哥在外形與習性上的異同。')).toBe(1);
    expect(detectTableBodyMarker('表二則說明了兩種八哥近年族群數量的變化。')).toBe(2);
  });

  it('does NOT match a standalone caption row (whitespace after 表N)', () => {
    // Caption rows are handled by detectTableMarker, not the body-intro matcher.
    expect(detectTableBodyMarker('表一 白尾八哥與臺灣冠八哥比較異同表')).toBeNull();
    expect(detectTableBodyMarker('表二　近年兩種臺灣常見八哥之族群數量之變化')).toBeNull();
  });

  it('does NOT match a mid-sentence reference like "從表二可知"', () => {
    expect(detectTableBodyMarker('從表二可知，外來種白尾八哥明顯多過原生種。')).toBeNull();
    expect(detectTableBodyMarker('請回到表一看一看，哪一種八哥比較不怕人？')).toBeNull();
  });

  it('returns null for non-marker / image text', () => {
    expect(detectTableBodyMarker('白尾八哥是一種外來種')).toBeNull();
    expect(detectTableBodyMarker('圖三進一步說明了一百多年來')).toBeNull();
    expect(detectTableBodyMarker('')).toBeNull();
  });
});

describe('resolveImageIndex', () => {
  it('returns positional index (markerNumber - 1)', () => {
    const imgs = [{}, {}, {}, {}];
    expect(resolveImageIndex(imgs, 1)).toBe(0);
    expect(resolveImageIndex(imgs, 4)).toBe(3);
  });

  it('returns null when out of bounds or empty', () => {
    expect(resolveImageIndex([], 1)).toBeNull();
    expect(resolveImageIndex(undefined, 1)).toBeNull();
    expect(resolveImageIndex([{}], 5)).toBeNull();
  });
});

describe('resolveTableIndex', () => {
  it('matches by title prefix when titles embed the marker', () => {
    const tables = [
      { title: '表一 白尾八哥與臺灣冠八哥比較異同表' },
      { title: '表二 近年兩種臺灣常見八哥之族群數量之變化' },
    ];
    expect(resolveTableIndex(tables, 1)).toBe(0);
    expect(resolveTableIndex(tables, 2)).toBe(1);
  });

  it('falls back to positional index when title has no marker', () => {
    const tables = [
      { title: '文章重點表 — 以實驗破解肉湯腐敗之謎' },
    ];
    expect(resolveTableIndex(tables, 1)).toBe(0);
  });

  it('returns null when out of bounds or empty', () => {
    expect(resolveTableIndex([], 1)).toBeNull();
    expect(resolveTableIndex(undefined, 1)).toBeNull();
    expect(resolveTableIndex([{ title: '表一 X' }], 5)).toBeNull();
  });
});
