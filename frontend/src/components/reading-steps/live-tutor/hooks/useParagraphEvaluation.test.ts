import { describe, expect, it } from 'vitest';
import {
  evalReducer,
  initialEvalState,
  type EvalState,
} from './useParagraphEvaluation';
import type { DiffToken } from '../../../../types';

const localDiff: DiffToken[] = [
  { char: '中', type: 'correct' },
  { char: '國', type: 'correct' },
  { char: '的', type: 'missing' },
];

const geminiDiff: DiffToken[] = [
  { char: '中', type: 'correct' },
  { char: '國', type: 'correct' },
  { char: '的', type: 'correct' },
  { char: '戰', type: 'correct' },
];

describe('evalReducer — display diff must stay on local Phase-1 result', () => {
  it('START_LOCAL stores local diff tokens', () => {
    const next = evalReducer(initialEvalState, { type: 'START_LOCAL', diffTokens: localDiff });
    expect(next.lastDiffTokens).toEqual(localDiff);
    expect(next.isAwaitingGemini).toBe(true);
    expect(next.phase).toBe('local_done');
  });

  it('GEMINI_DONE does not overwrite lastDiffTokens with Gemini diff', () => {
    const awaiting: EvalState = {
      ...initialEvalState,
      phase: 'local_done',
      isAwaitingGemini: true,
      lastDiffTokens: localDiff,
    };
    const next = evalReducer(awaiting, {
      type: 'GEMINI_DONE',
      diffTokens: geminiDiff,
    });
    expect(next.lastDiffTokens).toEqual(localDiff);
    expect(next.isAwaitingGemini).toBe(false);
    expect(next.phase).toBe('gemini_done');
  });

  it('GEMINI_ERROR keeps local diff tokens', () => {
    const awaiting: EvalState = {
      ...initialEvalState,
      lastDiffTokens: localDiff,
      isAwaitingGemini: true,
    };
    const next = evalReducer(awaiting, { type: 'GEMINI_ERROR' });
    expect(next.lastDiffTokens).toEqual(localDiff);
    expect(next.phase).toBe('gemini_error');
  });

  it('CLEAR_FOR_PARAGRAPH resets retryCount so next paragraph shows 開始朗讀', () => {
    const afterRetries: EvalState = {
      ...initialEvalState,
      retryCount: 2,
      lastDiffTokens: localDiff,
      streamingUserInput: '測試',
      phase: 'gemini_done',
    };
    const next = evalReducer(afterRetries, { type: 'CLEAR_FOR_PARAGRAPH' });
    expect(next.retryCount).toBe(0);
    expect(next.lastDiffTokens).toBeNull();
    expect(next.streamingUserInput).toBe('');
    expect(next.phase).toBe('idle');
  });
});
