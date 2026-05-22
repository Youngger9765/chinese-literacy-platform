/**
 * zhuyinGameLogic.ts
 *
 * Pure logic helpers extracted from ZhuyinPhoneticGame.tsx.
 * No React imports — testable in isolation.
 *
 * Extracted as part of refactor/issue-1859-zhuyin-game-split.
 */

import { INITIALS, PRENUCLEAR } from '../zhuyin/bopomoConstants';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface CharZhuyin {
  char: string;
  zhuyin: string;     // full zhuyin string e.g. "ㄑㄧㄥ"
  initial: string;    // 聲母 e.g. "ㄑ" (empty string if none)
  medial: string;     // 介母 e.g. "ㄧ"
  finalPart: string;  // 韻母 e.g. "ㄥ"
  tone: string;       // tone mark e.g. "ˊ" or ""
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

export const TONE_MARKS = new Set<string>(['ˊ', 'ˇ', 'ˋ', '˙']);
const ALL_INITIALS = new Set<string>(INITIALS);
const ALL_PRENUCLEAR = new Set<string>(PRENUCLEAR);

// ─────────────────────────────────────────────────────────────────────────────
// parseZhuyin
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse a raw zhuyin string (e.g. "ㄑㄧㄥ" or "ㄑㄧㄥˊ") into components.
 * The MOE dictionary returns zhuyin as bopomofo characters with optional tone mark at end.
 */
export function parseZhuyin(raw: string): Pick<CharZhuyin, 'initial' | 'medial' | 'finalPart' | 'tone'> {
  let s = raw.trim();

  // Extract trailing tone mark
  let tone = '';
  if (s.length > 0 && TONE_MARKS.has(s[s.length - 1])) {
    tone = s[s.length - 1];
    s = s.slice(0, -1);
  }

  let initial = '';
  let medial = '';
  let finalPart = '';

  let i = 0;
  // Initial (聲母) — first symbol if it's in INITIALS
  if (i < s.length && ALL_INITIALS.has(s[i])) {
    initial = s[i];
    i++;
  }
  // Medial (介母) — next symbol if it's in PRENUCLEAR
  if (i < s.length && ALL_PRENUCLEAR.has(s[i])) {
    medial = s[i];
    i++;
  }
  // Final (韻母) — rest
  finalPart = s.slice(i);

  return { initial, medial, finalPart, tone };
}

// ─────────────────────────────────────────────────────────────────────────────
// getInitialModeAnswer
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the correct answer for initial (聲母) mode.
 * Falls back to medial when initial is absent (e.g. ㄧ-only syllables).
 */
export function getInitialModeAnswer(q: CharZhuyin): string {
  return q.initial || q.medial;
}

// ─────────────────────────────────────────────────────────────────────────────
// getFinalModeAnswer
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the correct answer for final (韻母) mode, including the tone mark.
 * Logic mirrors the original PickGame correctAnswer computation.
 */
export function getFinalModeAnswer(q: CharZhuyin): string {
  // When medial present but no finalPart: medial acts as the final
  const fin = (q.medial && !q.finalPart) ? q.medial : (q.finalPart || q.medial);
  return fin + q.tone;
}

// ─────────────────────────────────────────────────────────────────────────────
// composeTargetSeq
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the ordered sequence of bopomofo symbols for compose mode.
 * Non-empty parts only: [initial?, medial?, finalPart?, tone?]
 */
export function composeTargetSeq(q: CharZhuyin): string[] {
  const parts: string[] = [];
  if (q.initial) parts.push(q.initial);
  if (q.medial) parts.push(q.medial);
  if (q.finalPart) parts.push(q.finalPart);
  if (q.tone) parts.push(q.tone);
  return parts;
}

// ─────────────────────────────────────────────────────────────────────────────
// shuffle
// ─────────────────────────────────────────────────────────────────────────────

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ─────────────────────────────────────────────────────────────────────────────
// buildChoices
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build `count` answer choices that include `correct` plus distractors from `pool`.
 */
export function buildChoices(correct: string, pool: string[], count = 4): string[] {
  const distractors = shuffle(pool.filter(x => x !== correct)).slice(0, count - 1);
  return shuffle([correct, ...distractors]);
}
