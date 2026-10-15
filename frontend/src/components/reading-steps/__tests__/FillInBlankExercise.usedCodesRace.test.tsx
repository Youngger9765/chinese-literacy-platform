/**
 * #3560 回歸鎖 —— 現場老師回報《這是什麼「意思」？》語詞應用第 2 題
 * 正確答案「諧音」顯示已使用，點不下去。
 *
 * 真環境重現（staging，lesson 20016 語詞應用）＋程式碼追蹤後確認根因是
 * 一個時間競態，不是資料錯誤（該課詞庫 8 題代號 A~H 互不重複）：
 *
 *   1. 答對一題時，`usedCodes` 立刻同步更新（同一個 tick）
 *   2. 但 `currentIdx` 要等「答對了！」動畫跑完才前進 —— 延遲 1200ms
 *   3. 中間這 1.2 秒，畫面還停在**剛剛那一題**，但 `usedCodes` 已經
 *      把那一題自己的正確答案代號記成「用過」
 *   4. 每次 state 變動都會立刻存進 localStorage／回報給 DB（#2848）
 *   5. 如果這 1.2 秒內裝置被中斷（關頁、斷線、下課鈴、被叫走）——
 *      在平板上很容易發生 —— 存下來的進度就是「currentIdx 還停在
 *      這一題，但這一題自己的正確答案已經被標記用過」
 *   6. 重新打開時，這一題的正確答案就顯示成灰色、不可點的「已使用」
 *      decoy —— 跟老師回報的畫面一模一樣
 *
 * 這條鎖直接檢查這個不變量：**只要畫面還停在某一題（currentIdx 指到它），
 * 它自己的正確答案代號就不可以出現在 usedCodes 裡。**
 */
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import FillInBlankExercise, { SavedProgress } from '../FillInBlankExercise';
import { FillInBlankItem } from '../../../types';

// 真實資料形狀：8 題代號 A~H 互不重複（L0016「這是什麼意思」語詞應用）。
// 這裡只取跟 race condition 直接相關的前兩題即可重現。
const vocabBank: Record<string, string> = {
  H: '總結',
  F: '諧音',
};

const sentences: FillInBlankItem[] = [
  { sentence: '這本書的章節結尾皆有重點（　），幫助讀者釐清概念。', answer: 'H' },
  { sentence: '許多廣告標語會巧妙運用（　）效果，讓人印象深刻。', answer: 'F' },
];

describe('FillInBlankExercise — usedCodes/currentIdx race (#3560)', () => {
  it('還在看某一題時，它自己的正確答案不可以已經出現在 usedCodes', async () => {
    vi.useFakeTimers();
    const onProgressChange = vi.fn<(p: SavedProgress) => void>();
    render(
      <FillInBlankExercise
        sentences={sentences}
        vocabBank={vocabBank}
        onComplete={() => {}}
        storyId="lesson-20016-test"
        onProgressChange={onProgressChange}
      />
    );

    // 答對第 0 題（代號 H）
    fireEvent.click(screen.getByText('總結'));

    // 刻意不推進計時器 —— 這裡就是「答對了！」動畫還在跑、畫面還停在
    // 第 0 題的那 1.2 秒視窗。真實情境裡，裝置若在這個視窗被中斷，
    // 存下來的就是這個瞬間的快照。
    const snapshotsStillOnQuestion0 = onProgressChange.mock.calls
      .map(([progress]) => progress)
      .filter((p) => p.currentIdx === 0);

    expect(
      snapshotsStillOnQuestion0.length,
      '答對後應該至少存過一次「還在第 0 題」的快照',
    ).toBeGreaterThan(0);

    for (const p of snapshotsStillOnQuestion0) {
      expect(
        p.usedCodes,
        '畫面還停在第 0 題時，H 不該已經被標記成用過 —— 否則中斷後重開，' +
          '第 0 題自己的正確答案就會顯示成「已使用」',
      ).not.toContain('H');
    }

    await act(async () => {
      vi.advanceTimersByTime(1500);
    });

    // 前進到第 1 題後，H 才應該變成已使用
    const afterAdvance = onProgressChange.mock.calls.at(-1)?.[0];
    expect(afterAdvance?.currentIdx).toBe(1);
    expect(afterAdvance?.usedCodes).toContain('H');

    vi.useRealTimers();
  });

  it('中斷重現：手動還原「currentIdx 停在第 0 題但 usedCodes 已含 H」的壞快照，不可以讓第 0 題自己的正解變成已使用的 decoy', () => {
    // 不等真的競態發生 —— 直接用舊版會產生的「壞快照」當 initialProgress
    // 還原，驗證就算資料層曾經壞過，UI 層也不可以把它渲染成「已使用」。
    // （這是防禦第二層：就算某個舊版本曾經寫出這種壞快照，日後讀到它
    // 也不該再讓使用者卡關。）
    const corruptedProgress: SavedProgress = {
      currentIdx: 0,
      usedCodes: ['H'],
      score: 0,
      firstTryResults: [],
    };
    render(
      <FillInBlankExercise
        sentences={sentences}
        vocabBank={vocabBank}
        onComplete={() => {}}
        storyId="lesson-20016-test-2"
        initialProgress={corruptedProgress}
      />
    );
    // 還原後畫面應該停在第 0 題
    expect(screen.getByText(/這本書的章節結尾皆有重點/)).toBeTruthy();
    // H（總結）不可以是 disabled 的已使用 decoy —— 它是這一題自己的正解
    const hButton = screen.getByText('總結').closest('button');
    expect(hButton?.disabled, '第 0 題自己的正解不該顯示成已使用').not.toBe(true);
  });
});
