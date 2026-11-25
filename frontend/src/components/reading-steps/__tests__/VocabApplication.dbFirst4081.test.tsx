/**
 * #4081 — 語詞應用的完成狀態與成績以 DB 為準。
 *
 * 以前完成畫面只從瀏覽器快取還原：換裝置看不到；同一台裝置上快取裡的舊「已完成」
 * 一掛載就被當成這一次的成績、標完成存回 DB。
 */
import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import VocabApplication from '../VocabApplication';
import type { Story } from '../../../types';

const story = {
  id: 'L4081',
  title: '語詞應用 DB 優先',
  vocabulary: [{ word: '疑難雜症', definition: '難以解決的問題。' }],
  fillInBlank: [{ sentence: '他解決了所有的(　　)。', answer: 'A' }],
  vocabBank: { A: '疑難雜症' },
} as unknown as Story;

const CACHE_KEY = 'vocabApp_progress_L4081';
const completions = (spy: ReturnType<typeof vi.fn>) =>
  spy.mock.calls.filter((c) => (c[0] as { markCompleted?: boolean }).markCompleted === true);

beforeEach(() => localStorage.clear());

describe('VocabApplication restores from the DB (#4081)', () => {
  it('a completion restored from the DB is not written again on mount (it would bump completedAt)', () => {
    const patch = vi.fn();
    render(<VocabApplication story={story} onFinish={vi.fn()} saveStepProgressPatch={patch}
      initialProgress={{ score: 1, total: 1, firstTryResults: [{ sentenceIdx: 0, firstTryCorrect: true }] }} />);
    expect(completions(patch)).toHaveLength(0);
  });

  it('does not take a stale "done" from this device\'s cache when the DB has no completion', () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ phase: 'done', result: { score: 0, total: 1 } }));
    const patch = vi.fn();
    render(<VocabApplication story={story} onFinish={vi.fn()} saveStepProgressPatch={patch} initialProgress={{}} />);
    expect(completions(patch)).toHaveLength(0);
  });
});
