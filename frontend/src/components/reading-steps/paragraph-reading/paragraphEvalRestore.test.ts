import { describe, expect, it } from 'vitest';
import type { DiffToken } from '../../../types';
import {
  planParagraphEvalRestore,
  resolveDisplayLastDiffTokens,
  resolveDisplayParagraphSummary,
} from './paragraphEvalRestore';
import type { LineResult, ParagraphSummaryData } from './paragraphReadingTypes';

const sampleDiff: DiffToken[] = [{ char: '你', type: 'correct' }];

const lineResult: LineResult = {
  lineIndex: 0,
  matchRate: 0.9,
  cpm: 80,
  durationMs: 10_000,
  transcript: '你好',
  diffTokens: sampleDiff,
};

const summary: ParagraphSummaryData = {
  feedback: 'ok',
  matchRate: 0.9,
  wrongCount: 0,
  missingCount: 0,
  tier: 2,
  geminiPending: false,
  sentenceResults: [null],
};

describe('planParagraphEvalRestore — revisit keeps scored paragraph (#451912f4)', () => {
  it('clears when paragraph has no saved result', () => {
    expect(planParagraphEvalRestore(undefined, undefined, 2)).toEqual({ kind: 'clear' });
  });

  it('clears when only line result exists without summary', () => {
    expect(planParagraphEvalRestore(lineResult, undefined, 2)).toEqual({ kind: 'clear' });
  });

  it('restores GEMINI_DONE when scoring finished', () => {
    const plan = planParagraphEvalRestore(lineResult, summary, 1);
    expect(plan).toMatchObject({
      kind: 'restore',
      dispatchAction: { type: 'GEMINI_DONE', diffTokens: sampleDiff },
      nextSentenceIdx: 1,
      lastFinalResultIdx: 0,
    });
  });

  it('restores START_LOCAL when Gemini still pending', () => {
    const pending = { ...summary, geminiPending: true };
    const plan = planParagraphEvalRestore(lineResult, pending, 3);
    expect(plan).toMatchObject({
      kind: 'restore',
      dispatchAction: { type: 'START_LOCAL', diffTokens: sampleDiff },
      nextSentenceIdx: 3,
      lastFinalResultIdx: 2,
    });
  });

  it('fills sentenceResults array when summary has none', () => {
    const plan = planParagraphEvalRestore(lineResult, { ...summary, sentenceResults: undefined }, 2);
    if (plan.kind !== 'restore') throw new Error('expected restore');
    expect(plan.sentenceResults).toEqual([null, null]);
  });
});

describe('resolveDisplayLastDiffTokens — revisit diff fallback', () => {
  it('prefers live eval lastDiffTokens', () => {
    const live: DiffToken[] = [{ char: '好', type: 'correct' }];
    expect(resolveDisplayLastDiffTokens(live, summary, lineResult)).toBe(live);
  });

  it('falls back to saved line result when summary exists but eval cleared', () => {
    expect(resolveDisplayLastDiffTokens(null, summary, lineResult)).toEqual(sampleDiff);
  });

  it('returns null when no summary and no live tokens', () => {
    expect(resolveDisplayLastDiffTokens(null, null, lineResult)).toBeNull();
  });

  it('hides stale saved diff while recording or pending review', () => {
    expect(resolveDisplayLastDiffTokens(null, summary, lineResult, true)).toBeNull();
    const live: DiffToken[] = [{ char: '好', type: 'correct' }];
    expect(resolveDisplayLastDiffTokens(live, summary, lineResult, true)).toBeNull();
  });
});

describe('resolveDisplayParagraphSummary — pending take UX', () => {
  it('returns summary when not hiding stale eval', () => {
    expect(resolveDisplayParagraphSummary(summary, false)).toBe(summary);
  });

  it('returns null while hiding stale eval', () => {
    expect(resolveDisplayParagraphSummary(summary, true)).toBeNull();
  });
});
