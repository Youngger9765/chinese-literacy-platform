/**
 * markModeSelection.ts — 標記模式的拖曳選取（#3134）
 *
 * ## 為什麼需要這條路徑
 *
 * 做記號原本靠瀏覽器的**原生文字選取**（`window.getSelection()`）。桌機沒問題，
 * 但 **iOS 只要有文字被選取就一定會跳出系統編輯選單**（拷貝／查詢／翻譯…）——
 * 那是作業系統層級行為，網頁擋不掉。Hans 2026-09-06 在 iPad（Safari 18.3.1）實測，
 * 選單會蓋住畫面、跟做記號搶同一個手勢。
 *
 * 解法是繞開原生選取：進入標記模式時把課文切成 `user-select:none`，逐字包 span，
 * 用 `elementFromPoint` 定位拖曳的起訖 —— 沒有原生選取，就沒有 iOS 選單。
 *
 * ## 為什麼用 elementFromPoint 而不是 caretRangeFromPoint
 *
 * Hans 在 iPad 上兩種都試過：`caretRangeFromPoint` 在 `user-select:none` 之下
 * **回傳的節點不在課文裡**（起點終點都是），不可用。逐字 span + `elementFromPoint`
 * 可用，而且**語詞複習的找字表已經在正式站用這個方式**（`VocabWordSearch.resolveCell`），
 * 學生早就用觸控操作過，不是新發明。
 *
 * ## 為什麼不需要位移換算
 *
 * `Annotation.charStart/charEnd` 索引的是**已剝除 PUA 選擇碼**的段落
 * （`FullTextAnnotate` 面板那側就是 `stripPUASelectors(...).slice(charStart, charEnd)`）。
 * 所以只要對**剝除後**的文字逐字包 span，**span 的序號就是 charStart**，
 * 不需要任何換算 —— 原生選取那條路才需要，因為它回報的是含選擇碼的 UTF-16 位移。
 */

/** 一次拖曳選到的範圍。與 `Annotation` 的欄位同形，可直接送進 reducer。 */
export interface MarkRange {
  paragraphIndex: number;
  charStart: number;
  /** 半開區間：`slice(charStart, charEnd)` 取得選到的字。 */
  charEnd: number;
}

/** 逐字 span 上掛的兩個資料屬性。 */
export const PARA_ATTR = 'data-para-index';
export const CHAR_ATTR = 'data-char-index';

/**
 * 從 DOM 元素讀出它是第幾段的第幾個字。
 *
 * 元素本身沒有標記時往上找 —— 逐字 span 內若被別的東西包住（例如編者預標的
 * `<mark>`），`elementFromPoint` 命中的會是內層節點。
 */
export function readCellFromElement(el: Element | null): { paragraphIndex: number; charIndex: number } | null {
  let node: Element | null = el;
  while (node) {
    const p = node.getAttribute?.(PARA_ATTR);
    const c = node.getAttribute?.(CHAR_ATTR);
    if (p != null && c != null) {
      const paragraphIndex = Number(p);
      const charIndex = Number(c);
      if (Number.isInteger(paragraphIndex) && Number.isInteger(charIndex)) {
        return { paragraphIndex, charIndex };
      }
      return null;
    }
    node = node.parentElement;
  }
  return null;
}

/**
 * 把拖曳的起訖兩格算成一個範圍。
 *
 * ⛔ **跨段落的拖曳不成立** —— `Annotation` 綁在單一 `paragraphIndex` 上，
 *    硬回傳一個範圍會讓記號落在錯的段落。回 null，由呼叫端忽略。
 *
 * 反向拖曳（從後往前）要正規化：學生從詞尾往詞頭拖是很自然的動作，
 * 不正規化的話 `charStart > charEnd`，`slice` 會回空字串 —— 記號看起來消失了。
 */
export function rangeFromDrag(
  start: { paragraphIndex: number; charIndex: number } | null,
  end: { paragraphIndex: number; charIndex: number } | null,
): MarkRange | null {
  if (!start || !end) return null;
  if (start.paragraphIndex !== end.paragraphIndex) return null;
  const lo = Math.min(start.charIndex, end.charIndex);
  const hi = Math.max(start.charIndex, end.charIndex);
  return { paragraphIndex: start.paragraphIndex, charStart: lo, charEnd: hi + 1 };
}
