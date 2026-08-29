/**
 * vocabDefinitionMatchLogic.ts — Pure logic for VocabDefinitionMatch (#1846)
 *
 * Extracted from VocabDefinitionMatch.tsx (1005 lines) to enable:
 *   - Unit-testable pure functions (shuffle, tone, MCQ options, retry selection)
 *   - Clean orchestrator component (thin)
 *   - Isolated UI sub-components (SummaryScreen, StageStatus, MultipleChoiceMode, DragDropMode)
 *
 * NO React imports. NO side effects. All functions are pure.
 */

import { VocabItem } from '../../types';

/* ------------------------------------------------------------------ */
/*  Re-exported types (shared with VocabDefinitionMatch.tsx)           */
/* ------------------------------------------------------------------ */

export type InteractionMode = 'multiple-choice' | 'drag-drop';
export type Phase = 'matching' | 'summary';

/**
 * Records the answer for one vocabulary item.
 * answeredWordIdx === null  → not yet answered
 * answeredWordIdx === defIndex → correct
 * answeredWordIdx !== defIndex → wrong
 *
 * `correct` reflects the LATEST attempt on purpose (both MCQ and drag-drop
 * modes let a student retry a wrong pick until they get it right, and the
 * live in-round UI — checkmarks, tone chips — should reflect that current
 * state). `firstTryCorrect` is the separate, WRITE-ONCE field #2773 added:
 * once set (on the item's first answer), it never changes on a later retry.
 * `selectRetryIndices` and the summary's 錯題解析 classification key off
 * `firstTryCorrect`, not `correct` — otherwise a student who got something
 * wrong once but retried into the right answer would vanish from every
 * "what did I get wrong" accounting, which is exactly the gap this issue
 * exposed live on staging (vocab-definition showed 11/11 all-correct with
 * zero 錯題 even after deliberately answering wrong on the first try).
 */
export interface AnswerRecord {
  defIndex: number;
  answeredWordIdx: number | null;
  correct: boolean | null;
  wrongAttempts?: number;
  firstTryCorrect?: boolean | null;
  /**
   * The FIRST wrong pick, captured once and never touched again — same
   * write-once shape as `firstTryCorrect`, added for the same reason.
   * `answeredWordIdx` reflects the LATEST attempt, so once a wrong-then-
   * correct retry finishes, `answeredWordIdx` is the CORRECT word — using it
   * to render "你選了 X" shows the correct answer on both sides of the arrow
   * (caught live on the #2773 PR preview:
   * docs/evidence/qa-2026-08-20/vocab-definition-firsttrycorrect-fixed-but-wrong-word-bug.png).
   * null when the item was correct on the first try (nothing wrong to show).
   */
  firstTryAnsweredWordIdx?: number | null;
}

export interface PersistedProgress {
  mode?: InteractionMode;
  phase?: Phase;
  activeDefIndices?: number[];
  mcAnswers?: AnswerRecord[];
  dragDropAnswers?: AnswerRecord[];
  /**
   * #2839 — 「作答到一半」的答案。跟 `mcAnswers` / `dragDropAnswers` 分開存，因為那兩個
   * 是「這個模式已完成」的最終結果，而且 `mcDone` / `dragDropDone` 就是用
   * `.length > 0` 判的 —— 把中途答案塞進去，學生答完第 1 題整個作答畫面就會被
   * 「選擇題 已完成」的結算畫面取代。
   *
   * 這兩個欄位在作答中每答一題就更新一次，是進度 PUT 唯一會變的內容。
   */
  mcProgress?: AnswerRecord[];
  dragDropProgress?: AnswerRecord[];
}

/**
 * 已作答的題數（`answeredWordIdx` 有值）。存進度 / 還原 / 斷言都用這個定義，
 * 避免「陣列長度」被誤當成作答數 —— 陣列一開始就被預先填滿了未作答的空記錄。
 */
export function answeredCount(answers: AnswerRecord[] | undefined): number {
  return (answers ?? []).filter((a) => a.answeredWordIdx !== null).length;
}

/* ------------------------------------------------------------------ */
/*  shuffle — Fisher-Yates                                             */
/* ------------------------------------------------------------------ */

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ------------------------------------------------------------------ */
/*  getDragDropAttemptFeedback — text feedback based on wrong attempts  */
/* ------------------------------------------------------------------ */

export function getDragDropAttemptFeedback(wrongAttempts: number): string | null {
  if (wrongAttempts === 1) return null;
  if (wrongAttempts === 2) return '下次小心喔～';
  if (wrongAttempts >= 3) return `要不要再複習一遍`;
  return null;
}

/* ------------------------------------------------------------------ */
/*  getDragDropAttemptTone — card/badge CSS classes based on attempts  */
/* ------------------------------------------------------------------ */

export function getDragDropAttemptTone(wrongAttempts: number): {
  cardClass: string;
  badgeClass: string;
} {
  if (wrongAttempts >= 3) {
    return {
      cardClass: 'bg-red-50 border-red-200',
      badgeClass: 'bg-red-500',
    };
  }
  if (wrongAttempts === 2) {
    return {
      cardClass: 'bg-amber-50 border-amber-200',
      badgeClass: 'bg-amber-500',
    };
  }
  return {
    cardClass: 'bg-emerald-50 border-emerald-200',
    badgeClass: 'bg-emerald-500',
  };
}

/* ------------------------------------------------------------------ */
/*  buildMCQOptions — 1 correct + up to 3 distractors from all vocab  */
/*                                                                      */
/*  Fix #1101: always use ALL vocab as distractor pool so the last     */
/*  question is never a forced-correct single-option card.             */
/* ------------------------------------------------------------------ */

export function buildMCQOptions(vocab: VocabItem[], currentDefIdx: number): number[] {
  const allIndices = vocab.map((_, i) => i);
  const otherIndices = allIndices.filter((i) => i !== currentDefIdx);
  // Aim for 3 distractors; if vocab is small, take as many as available.
  const distractors = shuffle(otherIndices).slice(0, Math.min(3, otherIndices.length));
  return shuffle([currentDefIdx, ...distractors]);
}

/* ------------------------------------------------------------------ */
/*  selectRetryIndices — filter wrong answers for retry-wrong mode     */
/* ------------------------------------------------------------------ */

/**
 * 把「重做錯題」那一輪的結果合併回上一輪的完整作答（#2849）。
 *
 * 重做輪的 `activeDefIndices` 只剩答錯的那幾題，所以 `onAllDone` 交回來的陣列
 * 也只有那幾筆。直接拿它當 `mcAnswers`，先前答對的題目會整批從結算畫面消失。
 *
 * `firstTryCorrect` / `firstTryAnsweredWordIdx` 是 write-once 的第一次作答紀錄
 * （#2773），重做**不覆蓋** —— 一旦覆蓋，錯過一次但重做答對的題目會從
 * 「我錯了什麼」的統計裡整個消失，那正是 #2773 修掉的洞。
 */
export function mergeRetryAnswers(
  baseline: AnswerRecord[],
  retried: AnswerRecord[],
): AnswerRecord[] {
  if (baseline.length === 0) return retried;
  const byDefIndex = new Map(retried.map((a) => [a.defIndex, a]));
  const merged = baseline.map((base) => {
    const next = byDefIndex.get(base.defIndex);
    if (!next) return base;
    byDefIndex.delete(base.defIndex);
    return {
      ...next,
      firstTryCorrect: base.firstTryCorrect ?? next.firstTryCorrect,
      firstTryAnsweredWordIdx: base.firstTryAnsweredWordIdx ?? next.firstTryAnsweredWordIdx,
    };
  });
  // 重做輪出現了 baseline 沒有的題（理論上不會，防禦性保留）。
  return [...merged, ...byDefIndex.values()];
}

export function selectRetryIndices(answers: AnswerRecord[]): number[] {
  // firstTryCorrect ?? correct: prefer the immutable first-try verdict; fall
  // back to `correct` for records that predate the field (persisted progress
  // from before this fix, or single-shot fixtures where first == final).
  return answers.filter((a) => (a.firstTryCorrect ?? a.correct) === false).map((a) => a.defIndex);
}

/* ------------------------------------------------------------------ */
/*  mergePersistedProgress — combine initialProgress prop + localStorage*/
/*                                                                      */
/*  Priority: initialProgress > localStorage > undefined               */
/* ------------------------------------------------------------------ */

export function mergePersistedProgress(
  initialProgress: PersistedProgress,
  localStorageProgress: PersistedProgress,
): PersistedProgress {
  return {
    mode: initialProgress.mode ?? localStorageProgress.mode,
    phase: initialProgress.phase ?? localStorageProgress.phase,
    activeDefIndices: initialProgress.activeDefIndices ?? localStorageProgress.activeDefIndices,
    mcAnswers: initialProgress.mcAnswers ?? localStorageProgress.mcAnswers,
    dragDropAnswers: initialProgress.dragDropAnswers ?? localStorageProgress.dragDropAnswers,
    mcProgress: initialProgress.mcProgress ?? localStorageProgress.mcProgress,
    dragDropProgress: initialProgress.dragDropProgress ?? localStorageProgress.dragDropProgress,
  };
}
