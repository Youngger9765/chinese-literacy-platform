/**
 * 標記模式的拖曳選取（#3134）
 *
 * Hans 在 iPad（Safari 18.3.1）實測：做記號靠原生文字選取，而 **iOS 只要有文字
 * 被選取就一定跳出系統編輯選單**，跟做記號搶同一個手勢。解法是模式開啟時關掉
 * 原生選取、逐字包 span、用 elementFromPoint 定位。
 *
 * 這一支測的是那條路徑的純函式部分 —— 位移正確性、反向拖曳、跨段落。
 * 真機上「iOS 選單不出現」只有 Hans 能驗（驗收條件第 2 條）。
 */
import { describe, it, expect } from 'vitest';
import {
  readCellFromElement, rangeFromDrag, PARA_ATTR, CHAR_ATTR,
} from '../markModeSelection';
import { stripPUASelectors } from '../annotationOffsets';

function span(paragraphIndex: number, charIndex: number, wrap = false): Element {
  const el = document.createElement('span');
  el.setAttribute(PARA_ATTR, String(paragraphIndex));
  el.setAttribute(CHAR_ATTR, String(charIndex));
  if (!wrap) return el;
  // 編者預標會在逐字 span 內再包一層 —— elementFromPoint 命中的是內層
  const inner = document.createElement('mark');
  el.appendChild(inner);
  return inner;
}

describe('從 DOM 讀出座標', () => {
  it('直接命中逐字 span', () => {
    expect(readCellFromElement(span(2, 7))).toEqual({ paragraphIndex: 2, charIndex: 7 });
  });

  it('命中內層元素時往上找 —— 編者預標會多包一層', () => {
    expect(readCellFromElement(span(1, 3, true))).toEqual({ paragraphIndex: 1, charIndex: 3 });
  });

  it('負向對照：課文以外的元素回 null，不可以亂猜一個座標', () => {
    expect(readCellFromElement(document.createElement('div'))).toBeNull();
    expect(readCellFromElement(null)).toBeNull();
  });
});

describe('拖曳算範圍', () => {
  it('正向拖曳', () => {
    expect(rangeFromDrag({ paragraphIndex: 0, charIndex: 2 }, { paragraphIndex: 0, charIndex: 5 }))
      .toEqual({ paragraphIndex: 0, charStart: 2, charEnd: 6 });
  });

  it('反向拖曳要正規化 —— 學生從詞尾往詞頭拖是自然動作', () => {
    expect(rangeFromDrag({ paragraphIndex: 0, charIndex: 5 }, { paragraphIndex: 0, charIndex: 2 }))
      .toEqual({ paragraphIndex: 0, charStart: 2, charEnd: 6 });
  });

  it('單字（起訖同一格）也是一個合法範圍', () => {
    expect(rangeFromDrag({ paragraphIndex: 3, charIndex: 4 }, { paragraphIndex: 3, charIndex: 4 }))
      .toEqual({ paragraphIndex: 3, charStart: 4, charEnd: 5 });
  });

  it('⛔ 跨段落不成立 —— Annotation 綁在單一段落上，硬回傳會讓記號落在錯的段', () => {
    expect(rangeFromDrag({ paragraphIndex: 0, charIndex: 1 }, { paragraphIndex: 1, charIndex: 3 }))
      .toBeNull();
  });

  it('負向對照：起或訖任一為 null 就沒有範圍', () => {
    expect(rangeFromDrag(null, { paragraphIndex: 0, charIndex: 1 })).toBeNull();
    expect(rangeFromDrag({ paragraphIndex: 0, charIndex: 1 }, null)).toBeNull();
  });
});

describe('位移對得上剝除選擇碼後的段落', () => {
  // 真實課文每個字後面嵌一個 U+E01E1 選擇碼（跟 lesson YAML 一樣）
  const SEL = '󠇡';
  const raw = ['滿', '座', '皆', '驚'].map(c => c + SEL).join('');
  const stripped = stripPUASelectors(raw);

  it('剝除後每個字剛好一格', () => {
    expect(stripped).toBe('滿座皆驚');
    expect(raw.length).toBe(12);        // 4 字 × (1 + 2 code unit)
    expect(stripped.length).toBe(4);
  });

  it('拖「滿座」兩格 → slice 拿到的正是那兩個字', () => {
    const r = rangeFromDrag({ paragraphIndex: 0, charIndex: 0 }, { paragraphIndex: 0, charIndex: 1 })!;
    expect(stripped.slice(r.charStart, r.charEnd)).toBe('滿座');
  });

  it('拖中間兩格 → 不會被選擇碼推移', () => {
    const r = rangeFromDrag({ paragraphIndex: 0, charIndex: 2 }, { paragraphIndex: 0, charIndex: 3 })!;
    expect(stripped.slice(r.charStart, r.charEnd)).toBe('皆驚');
  });
});
