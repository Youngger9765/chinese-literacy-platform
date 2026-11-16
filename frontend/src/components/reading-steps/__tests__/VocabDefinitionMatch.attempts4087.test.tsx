/**
 * #4087 — 詞語理解每回到總結畫面一次，記一筆作答（成績單折線圖）。
 * 「重做錯題」也算一次，成績是做完那一輪之後總共答對幾題。從 DB 還原的總結畫面不記。
 */
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import VocabDefinitionMatch from '../VocabDefinitionMatch';
import type { Story } from '../../../types';

const VOCAB = [
  { word: '勤奮', definition: '努力不懈地工作或學習。' },
  { word: '謙虛', definition: '不自誇，虛心接受他人意見。' },
];

const story = { id: '2849', title: '重做錯題回歸測試', vocabulary: VOCAB } as unknown as Story;

/** MCQ 答對後停留 1200ms 才換下一題。 */
const CORRECT_ADVANCE_DELAY_MS = 1200;

function dismissCoachIfPresent() {
  const btn = screen.queryByRole('button', { name: '我知道了' });
  if (btn) fireEvent.click(btn);
}

/** 目前螢幕上這一題對應到哪個語詞。 */
function currentPrompt(): { word: string; definition: string } {
  const item = VOCAB.find((v) => screen.queryByText(v.definition) !== null);
  if (!item) throw new Error('畫面上沒有題目 — 測試沒真的答到題');
  return item;
}

function clickWord(word: string) {
  const btn = screen.getAllByRole('button').find((b) => b.textContent?.trim() === word);
  if (!btn) throw new Error(`找不到語詞按鈕「${word}」`);
  fireEvent.click(btn);
}

/** 答對目前這一題並等它前進。 */
function answerCurrentCorrectly() {
  clickWord(currentPrompt().word);
  act(() => {
    vi.advanceTimersByTime(CORRECT_ADVANCE_DELAY_MS + 50);
  });
}

/** 故意答錯目前這一題（不前進）。 */
function answerCurrentWrong() {
  const { word } = currentPrompt();
  const other = VOCAB.find((v) => v.word !== word)!;
  clickWord(other.word);
  act(() => {
    vi.advanceTimersByTime(700);
  });
}

/** 用點選路徑放一格（`handleTouchStart` → `handleSlotTap`，真實的行動版互動路徑）。 */
async function placeSlot(word: string, definition: string) {
  // #3191：選詞改由 pointerup 觸發（真瀏覽器每次互動都先發 pointerup 再發 click；
  // 只發 click 是不會發生的序列）。格子仍然是 onClick，所以下一行不動。
  fireEvent.pointerUp(screen.getAllByText(word)[0]);
  fireEvent.click(screen.getByText(definition));
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
  }
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/** 兩關都做完，第 1 題 first-try 答錯 → 結算畫面一定有「重做錯題」。 */
type Attempt = { kind: string; correct: number; total: number; rows: { correct: boolean; studentAnswer?: string | null; correctAnswer?: string | null }[] };
const attemptsOf = (spy: ReturnType<typeof vi.fn>) =>
  spy.mock.calls.map((c) => c[2] as Attempt | undefined).filter(Boolean) as Attempt[];

async function playToSummaryWithOneWrong(onProgressChange: ReturnType<typeof vi.fn>) {
  render(<VocabDefinitionMatch story={story} onFinish={vi.fn()} onProgressChange={onProgressChange} />);
  dismissCoachIfPresent();
  answerCurrentWrong();
  answerCurrentCorrectly();
  answerCurrentCorrectly();
  fireEvent.click(screen.getByRole('button', { name: /前往拖拉配對/ }));
  dismissCoachIfPresent();
  for (const v of VOCAB) await placeSlot(v.word, v.definition);
}

describe('vocab-definition records each attempt (#4087)', () => {
  it('reaching the summary records one first attempt scored by first tries', async () => {
    const spy = vi.fn();
    await playToSummaryWithOneWrong(spy);
    const a = attemptsOf(spy);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ kind: 'first', correct: 3, total: 4 });
    const miss = a[0].rows.find((r) => !r.correct)!;
    expect(miss).toMatchObject({ studentAnswer: VOCAB[1].word, correctAnswer: VOCAB[0].word });
  });

  it('a 重做錯題 round back to the summary is another attempt with the total now right', async () => {
    const spy = vi.fn();
    await playToSummaryWithOneWrong(spy);
    fireEvent.click(screen.getByRole('button', { name: '重做錯題' }));
    answerCurrentCorrectly();
    const a = attemptsOf(spy);
    expect(a.map((x) => x.kind)).toEqual(['first', 'retry-wrong']);
    expect(a[1]).toMatchObject({ correct: 4, total: 4 });
  });

  it('a summary restored from the DB is not a new attempt', () => {
    const spy = vi.fn();
    render(
      <VocabDefinitionMatch
        story={story}
        onFinish={vi.fn()}
        onProgressChange={spy}
        initialProgress={{
          mode: 'drag-drop', phase: 'summary', completed: true,
          mcAnswers: VOCAB.map((_, i) => ({ defIndex: i, answeredWordIdx: i, correct: true, firstTryCorrect: true })),
          dragDropAnswers: VOCAB.map((_, i) => ({ defIndex: i, answeredWordIdx: i, correct: true, firstTryCorrect: true })),
          attempts: [{ id: 'x', at: '2026-11-16T00:00:00Z', kind: 'first', correct: 4, total: 4 }],
        }}
      />,
    );
    expect(attemptsOf(spy)).toHaveLength(0);
  });
});
