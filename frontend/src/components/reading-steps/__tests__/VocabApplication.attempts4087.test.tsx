/**
 * #4087 — 語詞應用每做完一輪記一筆作答（成績單折線圖）。
 * 「重做錯題」也算一次，成績是做完那一輪之後總共答對幾題。還原的「已做完」不記。
 */
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import VocabApplication from '../VocabApplication';
import type { Story } from '../../../types';

const story = {
  id: 'L2848',
  title: '進度保存回歸測試',
  vocabulary: [
    { word: '疑難雜症', definition: '難以解決的困難或問題。' },
    { word: '龍爭虎鬥', definition: '形容激烈競爭。' },
    { word: '一鳴驚人', definition: '一下子表現得很好。' },
  ],
  fillInBlank: [
    { sentence: '他解決了所有的(　　)。', answer: 'A' },
    { sentence: '兩隊之間展開(　　)的競爭。', answer: 'B' },
    { sentence: '他這次考試(　　)。', answer: 'C' },
  ],
  vocabBank: { A: '疑難雜症', B: '龍爭虎鬥', C: '一鳴驚人' },
} as unknown as Story;

/** 答對後停留 1200ms 才換下一題。 */
const ADVANCE_MS = 1200;

/** 首次進來會有導覽罩，不關掉點不到語詞庫。 */
function dismissCoachIfPresent() {
  const btn = screen.queryByRole('button', { name: '我知道了' });
  if (btn) fireEvent.click(btn);
}

/** 點語詞庫裡代號為 `code` 的那顆按鈕（正解就會判定答對並前進）。 */
function answerWith(code: 'A' | 'B' | 'C') {
  const word = { A: '疑難雜症', B: '龍爭虎鬥', C: '一鳴驚人' }[code];
  const btn = screen
    .getAllByRole('button')
    .find((b) => b.textContent?.trim() === word);
  if (!btn) throw new Error(`語詞庫裡找不到「${word}」— 測試沒真的答到題`);
  fireEvent.click(btn);
  act(() => {
    vi.advanceTimersByTime(ADVANCE_MS + 50);
  });
}

type Attempt = { kind: string; correct: number; total: number; rows: { correct: boolean; studentAnswer?: string | null; correctAnswer?: string | null }[] };
const attemptsOf = (spy: ReturnType<typeof vi.fn>) =>
  spy.mock.calls.map((c) => (c[0] as { appendAttempt?: Attempt }).appendAttempt).filter(Boolean) as Attempt[];

function answerWrongThenRight(code: 'A' | 'B' | 'C', wrong: 'A' | 'B' | 'C') {
  const word = { A: '疑難雜症', B: '龍爭虎鬥', C: '一鳴驚人' }[wrong];
  const btn = screen.getAllByRole('button').find((b) => b.textContent?.trim() === word)!;
  fireEvent.click(btn);
  act(() => { vi.advanceTimersByTime(800); });
  answerWith(code);
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
});

describe('vocab-application records each finished round (#4087)', () => {
  it('a first full round records its first-try score with the wrong word picked', () => {
    const patch = vi.fn();
    render(<VocabApplication story={story} onFinish={vi.fn()} saveStepProgressPatch={patch} initialProgress={{}} />);
    dismissCoachIfPresent();
    answerWrongThenRight('A', 'B');
    answerWith('B');
    answerWith('C');
    const a = attemptsOf(patch);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ kind: 'first', correct: 2, total: 3 });
    expect(a[0].rows[0]).toMatchObject({ correct: false, studentAnswer: '龍爭虎鬥', correctAnswer: '疑難雜症' });
  });

  it('重做錯題 is another attempt, scored as right after that round', () => {
    const patch = vi.fn();
    render(<VocabApplication story={story} onFinish={vi.fn()} saveStepProgressPatch={patch} initialProgress={{}} />);
    dismissCoachIfPresent();
    answerWrongThenRight('A', 'B');
    answerWith('B');
    answerWith('C');
    fireEvent.click(screen.getByRole('button', { name: /重做錯題/ }));
    answerWith('A');
    const a = attemptsOf(patch);
    expect(a.map((x) => x.kind)).toEqual(['first', 'retry-wrong']);
    expect(a[1]).toMatchObject({ correct: 3, total: 3 });
  });

  it('a round already finished when restored is not a new attempt', () => {
    const patch = vi.fn();
    render(<VocabApplication story={story} onFinish={vi.fn()} saveStepProgressPatch={patch}
      initialProgress={{ exercise: { currentIdx: 3, usedCodes: [], score: 3, firstTryResults: [
        { sentenceIdx: 0, firstTryCorrect: true }, { sentenceIdx: 1, firstTryCorrect: true }, { sentenceIdx: 2, firstTryCorrect: true },
      ] } }} />);
    expect(attemptsOf(patch)).toHaveLength(0);
  });
});
