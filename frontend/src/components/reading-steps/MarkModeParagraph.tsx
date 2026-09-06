/**
 * MarkModeParagraph — 標記模式下的段落（#3134）
 *
 * 逐字包 span，讓拖曳可以用 `elementFromPoint` 定位。**只在標記模式開啟時使用**；
 * 模式關閉時走原本的 `AnnotatedParagraph`，桌機使用者完全無感。
 *
 * ## 為什麼這裡不顯示注音
 *
 * `AnnotatedParagraph` 的註解寫得很明白：注音開啟時 `displayText` 同時含
 * BpmfZihiSerif 的 PUA 選擇碼**與 ruby 標記**，而那些**沒辦法逐字拆開**。
 * 同一個函式還要處理難字旗標的平行陣列與對齊守衛，PR #1155 就曾因為切錯位置造成回歸。
 *
 * 所以標記模式**刻意繞開**：以純文字呈現（`stripPUASelectors` 之後），關閉模式注音回來。
 * 學生標「不懂的詞」的當下不需要注音，代價只是切模式時畫面變一次。
 *
 * ⛔ 不要在這裡加回 ruby —— 那會把逐字拆分帶回那個已知會回歸的地方。
 *
 * ## 索引為什麼直接就是 charStart
 *
 * `Annotation.charStart/charEnd` 索引的是**已剝除 PUA 的段落**（面板那側就是
 * `stripPUASelectors(...).slice(charStart, charEnd)`）。這裡渲染的也是剝除後的文字，
 * 所以第 N 個 span 的索引就是 N，不需要任何換算。
 */
import React, { useMemo } from 'react';

import type { Annotation } from './annotationReducer';
import { stripPUASelectors } from './annotationOffsets';
import { CHAR_ATTR, PARA_ATTR } from './markModeSelection';

export interface MarkModeParagraphProps {
  rawText: string;
  paraIdx: number;
  /** 已經存在的記號（學生的 + 編者預標），用來上底色。 */
  annotations: Annotation[];
  /** 拖曳中的暫時範圍 —— 手指還沒放開就要看得到反白。 */
  pending?: { charStart: number; charEnd: number } | null;
  fontSizePx?: number;
}

/** 一個字要用哪種底色：拖曳中 > 學生的記號 > 編者預標 > 無。 */
function classFor(
  index: number,
  byIndex: Map<number, Annotation>,
  pending: { charStart: number; charEnd: number } | null | undefined,
): string {
  if (pending && index >= pending.charStart && index < pending.charEnd) {
    return 'bg-primary/30 rounded-sm';
  }
  const a = byIndex.get(index);
  if (!a) return '';
  if (a.source === 'editor') return 'bg-sky-200/60 rounded-sm';
  return a.type === 'important'
    ? 'bg-amber-200/70 rounded-sm'
    : 'bg-rose-200/70 rounded-sm';
}

export default function MarkModeParagraph({
  rawText,
  paraIdx,
  annotations,
  pending,
  fontSizePx,
}: MarkModeParagraphProps) {
  const text = useMemo(() => stripPUASelectors(rawText), [rawText]);

  // 每個字對到覆蓋它的那個記號。後加的蓋前面的 —— 學生自己標的通常晚於編者預標，
  // 這樣學生看到的是自己的顏色。
  const byIndex = useMemo(() => {
    const m = new Map<number, Annotation>();
    for (const a of annotations) {
      if (a.paragraphIndex !== paraIdx) continue;
      for (let i = a.charStart; i < a.charEnd; i++) m.set(i, a);
    }
    return m;
  }, [annotations, paraIdx]);

  return (
    <p
      data-para-idx={paraIdx}
      data-mark-mode="true"
      className="leading-loose tracking-wide text-on-surface"
      style={{
        fontSize: fontSizePx ? `${fontSizePx}px` : undefined,
        // 🔴 這兩行是整個修法的核心。iOS 只要有文字被選取就一定跳出系統編輯選單
        //    （拷貝／查詢／翻譯），那是作業系統層級行為、網頁擋不掉。關掉選取 +
        //    關掉預設觸控手勢，選單就不會出現，拖曳也不會被捲動搶走。
        WebkitUserSelect: 'none',
        userSelect: 'none',
        touchAction: 'none',
        // iOS 長按仍會跳「拷貝」氣泡，這一行連那個也關掉
        WebkitTouchCallout: 'none',
      } as React.CSSProperties}
    >
      {Array.from(text).map((ch, i) => (
        <span
          key={i}
          {...{ [PARA_ATTR]: String(paraIdx), [CHAR_ATTR]: String(i) }}
          className={classFor(i, byIndex, pending)}
        >
          {ch}
        </span>
      ))}
    </p>
  );
}
