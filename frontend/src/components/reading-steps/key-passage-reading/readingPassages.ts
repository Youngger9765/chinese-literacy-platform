/**
 * readingPassages.ts — 重點朗讀要唸哪些段落。
 *
 * 為什麼獨立成純函式
 * ------------------
 * 原本這段是 `KeyPassageReading.tsx` 裡的一行三元式：
 *
 *     story.keyReading?.passage ? [story.keyReading.passage] : story.content
 *
 * 文言文那 10 課（文-L3～文-L12）兩邊都是空的 —— 它們的內容在
 * `classicalText.paragraphs`（282～817 字）。於是畫面上寫著
 * 「從頭到尾讀完整篇文章，不要中斷！」，卻沒有任何文章（#2792）。
 *
 * 抽出來是為了讓「有內容就一定挑得出來」這件事可以被測試直接呼叫，
 * 而不是只能靠渲染整個元件去推斷。
 */

export interface ReadingPassageSource {
  /** 老師 ☞ 指定的重點段。有就只讀這段（#2559）。 */
  keyReading?: { passage?: string | null } | null;
  /** 白話課文段落。 */
  content?: string[] | null;
  /** 文言文原文段落 —— 文言文課的內容只存在這裡。 */
  classicalText?: { paragraphs?: string[] | null } | null;
}

function nonEmpty(xs: string[] | null | undefined): string[] {
  return (xs ?? []).filter((s) => typeof s === 'string' && s.trim().length > 0);
}

/**
 * 依序：老師指定的重點段 → 白話課文 → 文言文原文。
 *
 * 回空陣列代表「這一課真的沒有可朗讀的內容」——
 * 上層要據此顯示誠實的空狀態，**不要**照樣畫出朗讀工具列
 * 讓學生去讀一篇不存在的文章。
 */
export function readingPassagesOf(story: ReadingPassageSource): string[] {
  const passage = story.keyReading?.passage;
  if (typeof passage === 'string' && passage.trim().length > 0) return [passage];

  const modern = nonEmpty(story.content);
  if (modern.length > 0) return modern;

  return nonEmpty(story.classicalText?.paragraphs);
}
