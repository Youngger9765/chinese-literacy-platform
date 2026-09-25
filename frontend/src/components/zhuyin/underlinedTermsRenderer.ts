/**
 * 課文裡的專有名詞底線（#3309）。
 *
 * 教材在教師版 DOCX 裡替專有名詞（人名／地名／國名／機構名）加底線（`w:u`）。
 * 60 課共 240 個不重複詞，抽出來很久了但一直沒有任何消費端 —— 不知道「孟嘗君」
 * 是人名的孩子會把整句讀錯，而答案一直在檔案裡。
 *
 * ## 為什麼是「逐索引旗標」而不是塞 `<u>` 進段落
 *
 * 課文頁是學生**拖曳標記**的介面，字元位移是承重的（`annotationOffsets.ts`
 * 的 `countRawChars`），而且這個 repo 有過位移錯位的事故（#2165：PUA 變體選擇器
 * 讓側邊面板顯示錯位兩個字）。`FullTextAnnotate.tsx` 的註解也寫著插入的東西
 * 「must not inflate selection offsets」。
 *
 * 所以做法跟難字標記（#3022 的 `difficultSpanRenderer`）一樣：課文本來就是
 * **逐字元 `<span data-ci={i}>`**，只要給落在詞範圍內的那些 span 多一個 class，
 * DOM 的文字內容一個字都沒動，位移天生不受影響。
 *
 * ⚠️ 索引的基準是**剝過 PUA 之後**的字串 —— 跟 `AnnotatedParagraph` 產生
 * `data-ci` 時用的 `stripPUASelectors(rawText)` 同一個基準。用沒剝的字串算會
 * 整段右移，而且畫面上看起來只是「底線畫錯字」，不會有任何錯誤。
 */
import { stripPUASelectors } from '../reading-steps/annotationOffsets';

/**
 * 哪些（剝過 PUA 的）字元索引落在專有名詞裡。
 *
 * 比對用單純的子字串掃描，**不做任何詞界推測** —— 詞表是教材自己標的，
 * 不是我們猜的。重疊的詞（「臺東」與「臺東市」同時在表裡）取聯集，因為畫面上
 * 那就是一條連續的底線。
 */
export function underlinedFlagsByRawIndex(
  text: string,
  terms: readonly string[] | null | undefined,
): boolean[] {
  const raw = stripPUASelectors(text);
  const flags = new Array<boolean>(Array.from(raw).length).fill(false);
  if (!terms?.length) return flags;

  // 逐字元陣列，不用 String.length —— 課文含代理對時兩者不等，
  // 而 data-ci 是照 [...text] 的索引發的。
  const chars = Array.from(raw);
  for (const term of terms) {
    const t = Array.from(term ?? '');
    if (t.length === 0) continue;
    for (let i = 0; i + t.length <= chars.length; i++) {
      let hit = true;
      for (let j = 0; j < t.length; j++) {
        if (chars[i + j] !== t[j]) { hit = false; break; }
      }
      if (hit) {
        for (let j = 0; j < t.length; j++) flags[i + j] = true;
      }
    }
  }
  return flags;
}

/** 底線的樣式。跟學生自己的記號分開 —— 那些用背景色，這個只有底線。 */
export const UNDERLINED_TERM_CLASS = 'underline decoration-on-surface/40 underline-offset-4';
