/**
 * comprehensionReview.ts — 閱讀理解的 first-try 計分與錯題卡片資料。
 *
 * 為什麼存在
 * ----------
 * `ComprehensionMcqPage` 原本這樣結束一個步驟：
 *
 *     const total = selectedStory?.multipleChoice?.length ?? 0;
 *     handleMcqComplete(total, total);          // ← 寫死滿分
 *
 * 於是不管學生第一次錯幾題，寫進 `handleProgressChange({ mcqScore, mcqTotal })`
 * 的都是 100%。那個數字會流到學習紀錄與老師端報表 —— 看起來像資料，其實是常數。
 *
 * 這跟 #2784 修掉的「詞語理解結算永遠全對」是同一種病：
 * 紀錄存在、欄位齊全、畫面正常，但它記的不是真的。
 *
 * `LessonRenderer` 其實一直都知道每題的判定（`feedback: Record<id, boolean|null>`，
 * 而且早就透過 `onExerciseChange` 送出來），只是沒有人接。這個模組就是那段接線的
 * 純函式部分：把「當下的判定」收斂成「第一次作答的判定」。
 *
 * 為什麼一定要 first-try 而不是當下判定：學生會重試到答對，
 * 所以「現在還錯的題目」到最後恆為空集合 —— 拿它當「重做錯題」的來源，
 * 那顆按鈕永遠不會出現（#2784 的 `AnswerRecord.correct` 就是這樣壞掉的）。
 *
 * 無 React、無副作用，純資料。
 */
import {
  recordFirstTry,
  type FirstTryRecord,
} from '../../utils/questionReview';

/** 一題選擇題化簡後的樣子（只取計分與錯題卡片需要的欄位）。 */
export interface ReviewableBlock {
  id: string;
  stem: string;
  options: string[];
  /** 正解在 options 裡的索引；null = 這題無法判定對錯（不參與計分）。 */
  answerIndex: number | null;
}

function labelAt(block: ReviewableBlock, idx: unknown): string {
  return typeof idx === 'number' && block.options[idx] !== undefined
    ? block.options[idx]
    : '';
}

/**
 * 把 `LessonRenderer` 當下的 `feedback` 收進 first-try 紀錄。
 *
 * - 只收 verdict 已經是 true/false 的題（null = 還沒作答，不記）
 * - 同一題只記第一次（`recordFirstTry` 保證），重試不覆蓋
 */
export function absorbVerdicts(
  prev: FirstTryRecord<string, string>[],
  feedback: Record<string, boolean | null | undefined>,
  answers: Record<string, unknown>,
  blocks: ReviewableBlock[],
): FirstTryRecord<string, string>[] {
  let out = prev;
  for (const block of blocks) {
    const verdict = feedback[block.id];
    if (verdict !== true && verdict !== false) continue;
    out = recordFirstTry(out, {
      id: block.id,
      firstTryCorrect: verdict,
      studentFirstAnswer: verdict ? null : labelAt(block, answers[block.id]),
      correctAnswer: labelAt(block, block.answerIndex),
    });
  }
  return out;
}

/** 完成卡的逐題資料 — 跟舊的錯題卡片資料不同在於保留答對的題目（見下方函式說明）。 */
export interface ComprehensionCompletionItem {
  id: string;
  stem: string;
  correct: boolean;
  studentAnswer: string | null;
  correctAnswer: string;
}

/**
 * 完成卡（#2834，統一成 vocab-application 的樣式）逐題列出全部題目 —— 答對的也要
 * 出現，不是只列錯題（ComprehensionMcqPage 原本有一顆只列錯題的 `reviewItemsOf`，
 * code review 發現改用這顆之後它變成死 code，已移除；要「只列錯題」直接
 * `.filter(it => !it.correct)` 這顆的輸出即可，不必另開一個函式）。順序照 `blocks`
 * （畫面上的題目順序），不是
 * `records` 被 `absorbVerdicts` 記錄下來的順序（那個順序取決於學生作答快慢）。
 *
 * 還沒有 first-try 紀錄的題目（理論上完成卡出現時不該發生）防呆略過，不是回傳
 * 半吊子的空殼列。
 */
export function allReviewItemsOf(
  records: FirstTryRecord<string, string>[],
  blocks: ReviewableBlock[],
): ComprehensionCompletionItem[] {
  const byId = new Map(records.map((r) => [r.id, r]));
  const out: ComprehensionCompletionItem[] = [];
  for (const b of blocks) {
    const r = byId.get(b.id);
    if (!r) continue;
    out.push({
      id: b.id,
      stem: b.stem,
      correct: r.firstTryCorrect,
      studentAnswer: r.firstTryCorrect ? null : r.studentFirstAnswer ?? '',
      correctAnswer: r.correctAnswer,
    });
  }
  return out;
}
