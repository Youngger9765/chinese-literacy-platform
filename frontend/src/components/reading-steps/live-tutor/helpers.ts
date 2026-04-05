/**
 * Pure helper functions and types for LiveTutor.
 * Extracted from LiveTutor.tsx — zero behavior changes.
 */

import React from 'react';
import { DiffToken } from '../../../types';
import { normalizeForComparison } from '../../../utils/textDiff';
import { IS_PUNCT } from '../../../utils/liveTutorHelpers';

/* ------------------------------------------------------------------ */
/*  Moving cursor helpers                                              */
/* ------------------------------------------------------------------ */

/**
 * Look-ahead cursor: for each spoken char, try matching the current target
 * position first. On mismatch, look ahead up to LOOK_AHEAD target positions
 * to handle substitutions (e.g. 而且 vs 並且) and rare chars (e.g. 賁).
 * Spoken chars that don't match anything are treated as extra and skipped.
 */
export const LOOK_AHEAD = 3;

export function calcSpeakingProgress(interim: string, target: string): number {
  const s = Array.from(normalizeForComparison(interim));
  const t = Array.from(normalizeForComparison(target));
  let j = 0;
  for (let i = 0; i < s.length && j < t.length; i++) {
    if (s[i] === t[j]) {
      j++;
    } else {
      let found = false;
      for (let k = 1; k <= LOOK_AHEAD && j + k < t.length; k++) {
        if (s[i] === t[j + k]) {
          j = j + k + 1;
          found = true;
          break;
        }
      }
      void found;
    }
  }
  return j;
}

/**
 * Map a count of normalized (punctuation-stripped) matched chars back to
 * the corresponding index in the original target string.
 * Returns the index of the first character not yet covered (cursor position).
 */
export function normalizedToOrigIdx(target: string, normalizedProgress: number): number {
  let norm = 0;
  for (let i = 0; i < target.length; i++) {
    if (norm >= normalizedProgress) return i;
    if (!IS_PUNCT.test(target[i])) norm++;
  }
  return target.length;
}

/**
 * Render the original paragraph with diff annotations below each character.
 * Punctuation is kept as-is. For each content char, consume the next
 * non-extra diff token and apply colored underline / sub-text.
 */
export function renderLineWithDiff(
  originalLine: string,
  tokens: DiffToken[],
  fontSizePx: string | number,
  extraClass: string,
): React.ReactNode {
  let tokenIdx = 0;

  const chars = Array.from(originalLine).map((ch, i) => {
    if (IS_PUNCT.test(ch)) {
      return React.createElement('span', { key: i, className: 'text-gray-400' }, ch);
    }

    // Skip extra tokens — they have no target position
    while (tokenIdx < tokens.length && tokens[tokenIdx].type === 'extra') tokenIdx++;
    const token = tokens[tokenIdx++];

    if (!token) {
      return React.createElement('span', { key: i }, ch);
    }
    if (token.type === 'correct' || token.type === 'forgiven') {
      return React.createElement('span', { key: i, className: 'text-green-600' }, ch);
    }
    if (token.type === 'unread') {
      return React.createElement('span', { key: i, className: 'text-gray-300' }, ch);
    }
    if (token.type === 'missing') {
      return React.createElement(
        'span',
        { key: i, className: 'inline-flex flex-col items-center opacity-40 border-b-2 border-dashed border-gray-400' },
        ch,
      );
    }
    if (token.type === 'wrong') {
      return React.createElement(
        'span',
        {
          key: i,
          className: 'inline-flex flex-col items-center border-b-2 border-red-500',
          title: `讀成「${token.char}」，應是「${ch}」`,
        },
        React.createElement('span', null, ch),
        React.createElement(
          'span',
          { className: 'text-red-500 leading-none', style: { fontSize: `calc(${fontSizePx} * 0.55)` } },
          token.char,
        ),
      );
    }
    return React.createElement('span', { key: i }, ch);
  });

  return React.createElement(
    'p',
    { className: `leading-[4rem] ${extraClass}`, style: { fontSize: fontSizePx } },
    ...chars,
  );
}

/* ------------------------------------------------------------------ */
/*  Per-line result tracking                                          */
/* ------------------------------------------------------------------ */

export interface LineResult {
  lineIndex: number;
  matchRate: number;
  cpm: number;
  durationMs: number;
  transcript: string;
  diffTokens: DiffToken[];
}
