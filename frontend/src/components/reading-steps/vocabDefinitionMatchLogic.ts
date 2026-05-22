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
 */
export interface AnswerRecord {
  defIndex: number;
  answeredWordIdx: number | null;
  correct: boolean | null;
  wrongAttempts?: number;
}

export interface PersistedProgress {
  mode?: InteractionMode;
  phase?: Phase;
  activeDefIndices?: number[];
  mcAnswers?: AnswerRecord[];
  dragDropAnswers?: AnswerRecord[];
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

export function selectRetryIndices(answers: AnswerRecord[]): number[] {
  return answers.filter((a) => !a.correct).map((a) => a.defIndex);
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
  };
}
