/**
 * VocabDefinitionMatch.retryWrong.test.tsx — 結算畫面按「重做錯題」要真的回到答題（#2849）
 *
 * 為什麼會漏掉：只有 `VocabDefinitionMatchSummary.test.tsx` 用
 * `onRetryModeWrong={noop}` 單測結算畫面本身，沒有任何測試從 parent 走完整條路。
 *
 * 根因：`handleRetryModeWrong` → `startStage(targetMode, wrongIndices)`，而
 * `startStage` 只設 `mode` / `phase='matching'` / `activeDefIndices`，不清
 * `mcAnswers` / `dragDropAnswers`。但 render gate 是
 * `mcDone ? <StageCompletedPlaceholder/> : <MultipleChoiceMode/>`，
 * 而 `mcDone = mcAnswers.length > 0` —— 上一輪答完就恆為 true，所以永遠落到
 * 「選擇題 已完成」的 placeholder，而且列的還是上一輪完整的答案。學生按了沒用。
 *
 * 2026-08-21 staging 實測（真瀏覽器，session 1937，課文 20011）：
 *   MCQ 第 1 題故意答錯再答對、其餘 10 題答對 → 拖拉配對 11 格全放完 →
 *   結算畫面按「重做錯題」→ 畫面變成「選擇題（已完成）」，列出上一輪全部 11 題
 *   （每題都 check_circle），沒有回到答題。
 *
 * 另一半（#2846 已寫、當時到不了子元件的 `setMcProgress([])`）也在這裡上鎖：
 * 重做時若沒清掉「作答中」的快照，重新掛載會把上一輪的中途答案接回來，
 * 學生按了「重做」卻發現題目已經被填好。
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
  fireEvent.click(screen.getAllByText(word)[0]);
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
async function playToSummaryWithOneWrong() {
  render(<VocabDefinitionMatch story={story} onFinish={vi.fn()} onProgressChange={vi.fn()} />);
  dismissCoachIfPresent();

  answerCurrentWrong();
  answerCurrentCorrectly();
  answerCurrentCorrectly();

  // MCQ 做完 → 「選擇題 已完成」→ 前往拖拉配對
  fireEvent.click(screen.getByRole('button', { name: /前往拖拉配對/ }));
  dismissCoachIfPresent();

  for (const v of VOCAB) await placeSlot(v.word, v.definition);
}

describe('詞語理解 —「重做錯題」要真的回到答題（#2849）', () => {
  it('按下「重做錯題」後回到選擇題作答畫面，不是停在「選擇題 已完成」', async () => {
    await playToSummaryWithOneWrong();

    expect(screen.getByRole('button', { name: '重做錯題' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '重做錯題' }));

    // 回到作答：不可以出現「已完成」的結算 placeholder。
    expect(screen.queryByText('選擇題 已完成')).toBeNull();
    // 錯的那一題（勤奮）要重新出現在題目位置，而且語詞可以點。
    expect(screen.getByText(VOCAB[0].definition)).toBeTruthy();
    expect(
      screen.getAllByRole('button').some((b) => b.textContent?.trim() === VOCAB[0].word),
    ).toBe(true);
  });

  it('重做錯題只重做答錯的那些題，不是整關重來', async () => {
    await playToSummaryWithOneWrong();
    fireEvent.click(screen.getByRole('button', { name: '重做錯題' }));

    // 只有第 1 題 first-try 錯 → 重做輪裡不該出現第 2 題的定義。
    expect(screen.queryByText(VOCAB[1].definition)).toBeNull();
  });

  it('重做完成後，先前答對的題目不會從結算畫面消失（合併回上一輪，不是整包換掉）', async () => {
    const onProgressChange = vi.fn();
    render(<VocabDefinitionMatch story={story} onFinish={vi.fn()} onProgressChange={onProgressChange} />);
    dismissCoachIfPresent();
    answerCurrentWrong();
    answerCurrentCorrectly();
    answerCurrentCorrectly();
    fireEvent.click(screen.getByRole('button', { name: /前往拖拉配對/ }));
    dismissCoachIfPresent();
    for (const v of VOCAB) await placeSlot(v.word, v.definition);

    fireEvent.click(screen.getByRole('button', { name: '重做錯題' }));
    answerCurrentCorrectly(); // 把唯一的錯題答對 → 這一輪做完

    // 數量斷言：重做那輪只含 1 題，若整包換掉 mcAnswers 就只剩 1 筆。
    const payload = onProgressChange.mock.calls[
      onProgressChange.mock.calls.length - 1
    ][0] as { mcAnswers?: { defIndex: number; firstTryCorrect?: boolean | null }[] };
    const mc = payload.mcAnswers ?? [];
    expect(mc).toHaveLength(VOCAB.length);
    expect(mc.map((a) => a.defIndex).sort()).toEqual([0, 1]);
    // 第一次作答的錯誤紀錄是 write-once，重做答對也不可以把它洗成 true（#2773）。
    expect(mc.find((a) => a.defIndex === 0)?.firstTryCorrect).toBe(false);
  });

  it('重做時要一併清掉「作答中」的快照，否則題目會被上一輪的答案預先填好', async () => {
    const onProgressChange = vi.fn();
    render(<VocabDefinitionMatch story={story} onFinish={vi.fn()} onProgressChange={onProgressChange} />);
    dismissCoachIfPresent();
    answerCurrentWrong();
    answerCurrentCorrectly();
    answerCurrentCorrectly();
    fireEvent.click(screen.getByRole('button', { name: /前往拖拉配對/ }));
    dismissCoachIfPresent();
    for (const v of VOCAB) await placeSlot(v.word, v.definition);

    fireEvent.click(screen.getByRole('button', { name: '重做錯題' }));

    const payload = onProgressChange.mock.calls[
      onProgressChange.mock.calls.length - 1
    ][0] as { mcProgress?: { answeredWordIdx: number | null }[] };
    const answered = (payload.mcProgress ?? []).filter((a) => a.answeredWordIdx !== null);
    expect(answered).toHaveLength(0);
  });
});
