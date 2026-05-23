/**
 * zhuyinGameEngine.ts
 *
 * Game-level logic for ZhuyinPhoneticGame: answer derivation, palette
 * construction, scoring helpers. Separate from zhuyinGameLogic.ts (which
 * holds pure parse/shuffle/buildChoices utilities).
 *
 * No React imports — testable in isolation.
 * Extracted as part of refactor/issue-1885-zhuyin-game-ui-split.
 */

import { INITIALS, PRENUCLEAR, FINALS } from '../zhuyin/bopomoConstants';
import { CharZhuyin, shuffle, buildChoices as rawBuildChoices } from './zhuyinGameLogic';

// Re-export CharZhuyin so UI files can import from a single engine file
export type { CharZhuyin };

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type GameMode = 'initial' | 'final' | 'compose';
export type AnswerState = 'idle' | 'correct' | 'wrong';

// ─────────────────────────────────────────────────────────────────────────────
// deriveAnswer
//
// Returns the single correct answer string for a given mode and question.
// For initial mode: use initial if present, else fall back to medial.
// For final mode: finalPart+tone, falling back to medial+tone when no finalPart.
// ─────────────────────────────────────────────────────────────────────────────

export function deriveInitialAnswer(q: CharZhuyin): string {
  return q.initial || q.medial;
}

export function deriveFinalAnswer(q: CharZhuyin): string {
  const fin = q.medial && !q.finalPart ? q.medial : q.finalPart || q.medial;
  return fin + q.tone;
}

// ─────────────────────────────────────────────────────────────────────────────
// buildPickChoices
//
// Build the 4 answer choices for initial/final (pick) mode.
// Correct answer is always included exactly once; no duplicates.
// ─────────────────────────────────────────────────────────────────────────────

export function buildInitialPool(): string[] {
  return [...INITIALS, ...PRENUCLEAR];
}

export function buildFinalPool(): string[] {
  return [
    ...FINALS,
    ...FINALS.map(f => f + 'ˊ'),
    ...FINALS.map(f => f + 'ˇ'),
    ...FINALS.map(f => f + 'ˋ'),
    ...PRENUCLEAR,
    ...PRENUCLEAR.map(p => p + 'ˊ'),
    ...PRENUCLEAR.map(p => p + 'ˇ'),
    ...PRENUCLEAR.map(p => p + 'ˋ'),
  ];
}

export function buildPickChoices(correct: string, mode: GameMode, count = 4): string[] {
  const pool = mode === 'initial' ? buildInitialPool() : buildFinalPool();
  return rawBuildChoices(correct, pool, count);
}

// ─────────────────────────────────────────────────────────────────────────────
// buildComposePalette
//
// Builds the symbol palette for compose mode: correct sequence symbols
// plus distractors. Total size = max(targetSeq.length + 4, 8).
// ─────────────────────────────────────────────────────────────────────────────

export function buildComposePalette(targetSeq: string[]): string[] {
  const correct = new Set(targetSeq);
  const distractorPool = shuffle([
    ...INITIALS.filter(x => !correct.has(x)),
    ...PRENUCLEAR.filter(x => !correct.has(x)),
    ...FINALS.filter(x => !correct.has(x)),
    ...['ˊ', 'ˇ', 'ˋ'].filter(x => !correct.has(x)),
  ]);
  const distractors = distractorPool.slice(0, Math.max(0, 8 - targetSeq.length));
  return shuffle([...targetSeq, ...distractors]);
}

// ─────────────────────────────────────────────────────────────────────────────
// scoreOnce
//
// Returns the new score when a question completes.
// If correct: increment by 1. If wrong: unchanged.
// Pure function — no side effects.
// ─────────────────────────────────────────────────────────────────────────────

export function scoreOnce(currentScore: number, isCorrect: boolean): number {
  return isCorrect ? currentScore + 1 : currentScore;
}

// ─────────────────────────────────────────────────────────────────────────────
// filterQuestionsForMode
//
// Filter charData for questions that have the required phonetic components.
// ─────────────────────────────────────────────────────────────────────────────

export function filterQuestionsForMode(data: CharZhuyin[], mode: GameMode): CharZhuyin[] {
  if (mode === 'initial') return data.filter(c => c.initial || c.medial);
  if (mode === 'final')   return data.filter(c => c.finalPart || c.medial);
  return data; // compose uses all
}
