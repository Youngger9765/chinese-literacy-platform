/**
 * VocabDefinitionMatchDragDrop.restore.test.tsx — 拖拉配對存下的進度要還原得回來（#2850）
 *
 * PR #2846（#2839）把「存」接上了：每放對／放錯一次都回報，答案確實進得了
 * `step_data['vocab-definition'].dragDropProgress`。但沒人讀它 —— 重新載入之後
 * 拖拉配對從空的重來。**存了讀不回來等於沒存。**
 *
 * 2026-08-21 staging 實測（真瀏覽器，session 1937，課文 20011）：
 *   放對 5 格 → 等 12 秒 → 2 次 PUT 200，`dragDropProgress` 讀回 answered = 5，
 *   畫面剩 6 個空格（11−5）→ 存是好的。
 *   接著清掉 localStorage `vocabDef_progress_20011` 再重整 →
 *   **11 個空格全部回來**，那 5 格沒有還原。
 *
 * ⚠️ `didResetOnceRef` 的坑（MCQ 那邊 #2839 踩過）：mount 時的
 * `useEffect([activeDefIndices, shuffledWords])` 會把剛種好的還原快照整個抹掉，
 * 沒有任何錯誤、看起來就只是「沒還原」。這裡一併上鎖。
 */
import { StrictMode } from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DragDropMode } from '../VocabDefinitionMatchDragDrop';
import type { AnswerRecord } from '../vocabDefinitionMatchLogic';
import type { VocabItem } from '../../../types';

const VOCAB: VocabItem[] = [
  { word: '勤奮', definition: '努力不懈地工作或學習。' },
  { word: '謙虛', definition: '不自誇，虛心接受他人意見。' },
  { word: '果斷', definition: '做決定時明快不猶豫。' },
];
const ALL = [0, 1, 2];

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

function dismissCoachIfPresent() {
  const btn = screen.queryByRole('button', { name: '我知道了' });
  if (btn) fireEvent.click(btn);
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

/** 畫面上還沒填的格子數。 */
function emptySlotCount(): number {
  return screen.queryAllByText('拖拉語詞到這裡').length;
}

/** 已作答的筆數（陣列一開始就被預先填滿未作答的空記錄，長度不等於作答數）。 */
function answeredCount(answers: AnswerRecord[] | undefined): number {
  return (answers ?? []).filter((a) => a.answeredWordIdx !== null).length;
}

describe('拖拉配對 — 存下的進度要還原得回來（#2850）', () => {
  it('已定案的格子在重新掛載後還在，而且數量對得上（放 N 格就要回 N 格）', async () => {
    const onAnswersChange = vi.fn();
    const { unmount } = render(
      <DragDropMode
        vocab={VOCAB}
        activeDefIndices={ALL}
        shuffledWords={ALL}
        onAllDone={vi.fn()}
        onAnswersChange={onAnswersChange}
      />,
    );
    dismissCoachIfPresent();

    const slotsAtStart = emptySlotCount();
    expect(slotsAtStart).toBe(ALL.length);

    await placeSlot(VOCAB[0].word, VOCAB[0].definition);
    await placeSlot(VOCAB[1].word, VOCAB[1].definition);

    const saved = onAnswersChange.mock.calls[
      onAnswersChange.mock.calls.length - 1
    ][0] as AnswerRecord[];
    expect(answeredCount(saved)).toBe(2);
    expect(emptySlotCount()).toBe(ALL.length - 2);

    unmount();

    render(
      <DragDropMode
        vocab={VOCAB}
        activeDefIndices={ALL}
        shuffledWords={ALL}
        onAllDone={vi.fn()}
        initialAnswers={saved}
        onAnswersChange={vi.fn()}
      />,
    );
    dismissCoachIfPresent();

    // 數量斷言：放了 2 格，回來就要剩 1 格空的，不是 3 格全空。
    expect(emptySlotCount()).toBe(ALL.length - 2);
    // 已定案的兩個語詞不該再出現在語詞庫等著被拖（它們已經放進格子了）。
    expect(screen.getByText(VOCAB[0].definition)).toBeTruthy();
    expect(screen.getByText(VOCAB[1].definition)).toBeTruthy();
  });

  it('還原後接著放最後一格就完成，回報的作答筆數是 3 不是 1', async () => {
    const restored: AnswerRecord[] = [
      { defIndex: 0, answeredWordIdx: 0, correct: true, wrongAttempts: 0, firstTryCorrect: true },
      { defIndex: 1, answeredWordIdx: 1, correct: true, wrongAttempts: 2, firstTryCorrect: false },
    ];
    const onAllDone = vi.fn();
    render(
      <DragDropMode
        vocab={VOCAB}
        activeDefIndices={ALL}
        shuffledWords={ALL}
        onAllDone={onAllDone}
        initialAnswers={restored}
        onAnswersChange={vi.fn()}
      />,
    );
    dismissCoachIfPresent();
    expect(emptySlotCount()).toBe(1);

    await placeSlot(VOCAB[2].word, VOCAB[2].definition);

    expect(onAllDone).toHaveBeenCalled();
    const final = onAllDone.mock.calls[onAllDone.mock.calls.length - 1][0] as AnswerRecord[];
    expect(answeredCount(final)).toBe(3);
    // 還原進來的第一次作答紀錄是 write-once，不可以被重建成「一次就對」（#2773）。
    expect(final.find((a) => a.defIndex === 1)?.firstTryCorrect).toBe(false);
    expect(final.find((a) => a.defIndex === 1)?.wrongAttempts).toBe(2);
  });

  it('還原回來就已經全部放完時要完成這一關，不可以卡在一個沒有任何按鈕的畫面', async () => {
    // `onAllDone` 只有一個呼叫點（`attemptPlace` 裡的 `setConfirmed` updater），
    // 只有「活的一次放格」才會觸發。最後一格放對的當下 `onAnswersChange` 是同步送出的，
    // 但 `onAllDone` 還要等 ~1.15s（fly-away 550ms + 600ms）；學生在這個空窗切走分頁，
    // useProgressSync 的 pagehide beacon 會把「全部放完」的 dragDropProgress 存進 DB，
    // 而代表「這一關完成」的 dragDropAnswers 還是空的。
    // 下次進來 → 格子全滿、語詞庫空了、`dragDropDone` 仍是 false 所以結算 placeholder
    // 也不會出現 → 學生卡死，而且每次重進都一樣。
    const allDone: AnswerRecord[] = ALL.map((i) => ({
      defIndex: i, answeredWordIdx: i, correct: true, wrongAttempts: 0, firstTryCorrect: true,
    }));
    const onAllDone = vi.fn();
    render(
      <DragDropMode
        vocab={VOCAB}
        activeDefIndices={ALL}
        shuffledWords={ALL}
        onAllDone={onAllDone}
        initialAnswers={allDone}
        onAnswersChange={vi.fn()}
      />,
    );
    dismissCoachIfPresent();
    for (let i = 0; i < 10; i++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    }

    expect(onAllDone).toHaveBeenCalled();
    expect(answeredCount(onAllDone.mock.calls[0][0] as AnswerRecord[])).toBe(ALL.length);
  });

  it('還沒放完的還原不可以誤觸完成', async () => {
    const partial: AnswerRecord[] = [
      { defIndex: 0, answeredWordIdx: 0, correct: true, wrongAttempts: 0, firstTryCorrect: true },
    ];
    const onAllDone = vi.fn();
    render(
      <DragDropMode
        vocab={VOCAB}
        activeDefIndices={ALL}
        shuffledWords={ALL}
        onAllDone={onAllDone}
        initialAnswers={partial}
        onAnswersChange={vi.fn()}
      />,
    );
    dismissCoachIfPresent();
    for (let i = 0; i < 10; i++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    }
    expect(onAllDone).not.toHaveBeenCalled();
  });

  it('StrictMode 下還原一樣要活著（effect 被重跑一次不可以把快照抹掉）', () => {
    // React 18 的 StrictMode 在 mount 時會 setup → cleanup → setup 跑兩次。
    // 用「跑過第一次就跳過」的旗標擋 reset effect，第二次 setup 時旗標已經是 true，
    // reset 照跑，還原就被靜默抹掉 —— 開發模式下看起來就是「存的進度都不見了」。
    const restored: AnswerRecord[] = [
      { defIndex: 0, answeredWordIdx: 0, correct: true, wrongAttempts: 0, firstTryCorrect: true },
    ];
    render(
      <StrictMode>
        <DragDropMode
          vocab={VOCAB}
          activeDefIndices={ALL}
          shuffledWords={ALL}
          onAllDone={vi.fn()}
          initialAnswers={restored}
          onAnswersChange={vi.fn()}
        />
      </StrictMode>,
    );
    dismissCoachIfPresent();
    expect(emptySlotCount()).toBe(ALL.length - 1);
  });

  it('mount 時的 reset effect 不可以把剛種好的還原快照抹掉', () => {
    const restored: AnswerRecord[] = [
      { defIndex: 0, answeredWordIdx: 0, correct: true, wrongAttempts: 0, firstTryCorrect: true },
    ];
    render(
      <DragDropMode
        vocab={VOCAB}
        activeDefIndices={ALL}
        shuffledWords={ALL}
        onAllDone={vi.fn()}
        initialAnswers={restored}
        onAnswersChange={vi.fn()}
      />,
    );
    dismissCoachIfPresent();
    act(() => {
      vi.advanceTimersByTime(1000); // 讓所有 mount 時排的 effect / timer 都跑完
    });
    expect(emptySlotCount()).toBe(ALL.length - 1);
  });
});
