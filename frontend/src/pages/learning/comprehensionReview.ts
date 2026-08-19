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

/** 錯題卡片要顯示的一列。 */
export interface ComprehensionReviewItem {
  id: string;
  stem: string;
  studentAnswer: string;
  correctAnswer: string;
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

/**
 * 錯題卡片的資料。
 *
 * ⚠️ 這裡只回「答錯的那些」。正解字串從這裡出去之後，
 * 只能由**送出後才渲染**的元件顯示（`WrongAnswerReviewList` 的 `revealed`
 * 是 fail-closed 的：沒明確傳 true 就什麼都不畫）。
 */
export function reviewItemsOf(
  records: FirstTryRecord<string, string>[],
  blocks: ReviewableBlock[],
): ComprehensionReviewItem[] {
  const byId = new Map(blocks.map((b) => [b.id, b]));
  return records
    .filter((r) => !r.firstTryCorrect)
    .map((r) => {
      const b = byId.get(r.id);
      return {
        id: r.id,
        stem: b?.stem ?? '',
        studentAnswer: r.studentFirstAnswer ?? '',
        correctAnswer: r.correctAnswer,
      };
    });
}
