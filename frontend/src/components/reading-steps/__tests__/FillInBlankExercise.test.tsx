/**
 * Tests for FillInBlankExercise (#698)
 *
 * New UX: one-at-a-time + disappearing word bank
 * - Top word bank shows only unused words
 * - One sentence shown at a time
 * - Correct answer → word disappears + advance
 * - Wrong answer → hint shown, word stays
 */
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import FillInBlankExercise from '../FillInBlankExercise';
import { FillInBlankItem } from '../../../types';

const vocabBank: Record<string, string> = {
  A: '疑難雜症',
  B: '龍爭虎鬥',
  C: '一鳴驚人',
};

const sentences: FillInBlankItem[] = [
  { sentence: '他解決了所有的(　　)。', answer: 'A' },
  { sentence: '兩隊之間展開(　　)的競爭。', answer: 'B' },
];

describe('FillInBlankExercise (#698)', () => {
  it('renders word bank entries in top bank area', () => {
    render(
      <FillInBlankExercise
        sentences={sentences}
        vocabBank={vocabBank}
        onComplete={() => {}}
      />
    );
    expect(screen.getByText('疑難雜症')).toBeTruthy();
    expect(screen.getByText('龍爭虎鬥')).toBeTruthy();
    expect(screen.getByText('一鳴驚人')).toBeTruthy();
  });

  it('shows only the first sentence initially (one at a time)', () => {
    render(
      <FillInBlankExercise
        sentences={sentences}
        vocabBank={vocabBank}
        onComplete={() => {}}
      />
    );
    // First sentence text should be visible
    expect(screen.getByText(/他解決了所有的/)).toBeTruthy();
    // Second sentence should NOT be visible yet
    expect(screen.queryByText(/兩隊之間展開/)).toBeNull();
  });

  it('點一下詞語就直接填入並判定 —— 沒有確認按鈕（#2933）', () => {
    render(
      <FillInBlankExercise sentences={sentences} vocabBank={vocabBank} onComplete={() => {}} />
    );
    // 舊版是「選詞 → 按確認」，現在點一下就填。確認按鈕已經不存在。
    expect(screen.queryByRole('button', { name: /確認|請先選擇/ }), '確認按鈕應該已移除').toBeNull();

    fireEvent.click(screen.getByText('疑難雜症'));

    const txt = document.body.textContent?.replace(/\s+/g, '') ?? '';
    expect(txt, '詞語沒有填進句子').toContain('他解決了所有的疑難雜症');
    expect(txt, '沒有立即給回饋').toMatch(/答對了！|太棒了！|很厲害！|完全正確！|你答對了！/);
  });

  it('wrong answer shows hint and word stays in bank', () => {
    render(
      <FillInBlankExercise
        sentences={sentences}
        vocabBank={vocabBank}
        onComplete={() => {}}
      />
    );
    // Select B (wrong for sentence 0 which expects A)
    // 點一下就判定，沒有確認步驟（#2933）
    fireEvent.click(screen.getByText('龍爭虎鬥'));

    // Wrong feedback shown
    // 文案改成 amber 的「再試試看！」，且刻意不顯示正解（A12）
    expect(screen.getByText(/再試試看/)).toBeTruthy();
    // B is still in the bank (not removed) — may appear in bank + blank slot
    expect(screen.getAllByText('龍爭虎鬥').length).toBeGreaterThanOrEqual(1);
    // Still on question 1
    expect(screen.getByText(/他解決了所有的/)).toBeTruthy();
  });

  it('correct answer advances to next question after delay', async () => {
    vi.useFakeTimers();
    render(
      <FillInBlankExercise
        sentences={sentences}
        vocabBank={vocabBank}
        onComplete={() => {}}
      />
    );
    // Select A (correct for sentence 0)
    fireEvent.click(screen.getByText('疑難雜症'));   // 點一下就判定（#2933）

    // Shows correct feedback
    // 讚美詞是輪替的（CORRECT_PRAISES 五選一），寫死其中一句會飄
    expect(
      screen.getByText(/答對了！|太棒了！|很厲害！|完全正確！|你答對了！/),
      '答對後沒有給任何鼓勵',
    ).toBeTruthy();

    // After the 900ms timeout, advances to sentence 2
    await act(async () => {
      vi.advanceTimersByTime(1500);   // 自動前進是 1200ms（#2933）
    });

    // 句子被空格 span 切成多個節點，用整段文字比對
    expect(
      document.body.textContent?.replace(/\s+/g, ''),
      '沒有前進到第 2 題',
    ).toContain('兩隊之間展開');
    vi.useRealTimers();
  });

  it('used word disappears from bank after correct answer', async () => {
    vi.useFakeTimers();
    render(
      <FillInBlankExercise
        sentences={sentences}
        vocabBank={vocabBank}
        onComplete={() => {}}
      />
    );
    // Answer sentence 0 correctly with A
    fireEvent.click(screen.getByText('疑難雜症'));   // 點一下就判定（#2933）

    await act(async () => {
      vi.advanceTimersByTime(1500);   // 自動前進是 1200ms（#2933）
    });

    // A/疑難雜症 should no longer be in the bank buttons
    const updatedBtns = screen.getAllByRole('button');
    const aStillInBank = updatedBtns.find(
      (b) => b.textContent?.includes('A') && b.textContent?.includes('疑難雜症')
    );
    expect(aStillInBank).toBeUndefined();

    vi.useRealTimers();
  });

  it('onComplete is called with correct score after all questions answered', async () => {
    vi.useFakeTimers();
    const onComplete = vi.fn();
    render(
      <FillInBlankExercise
        sentences={sentences}
        vocabBank={vocabBank}
        onComplete={onComplete}
      />
    );

    // Answer sentence 0 correctly: A
    fireEvent.click(screen.getByText('疑難雜症'));   // 點一下就判定（#2933）
    await act(async () => { vi.advanceTimersByTime(1500); });

    // Answer sentence 1 correctly: B
    fireEvent.click(screen.getByText('龍爭虎鬥'));   // 點一下就判定（#2933）
    await act(async () => { vi.advanceTimersByTime(1500); });

    // Should now show final score screen with continue button
    // 完成畫面的 CTA 從「繼續」改成「下一關」（#2834 抽成 QuizCompletionScreen）
    fireEvent.click(screen.getByRole('button', { name: /下一關/ }));
    // 現在多帶第三個參數 firstTryResults（逐題一次答對與否），
    // 完成畫面用它畫每一題的勾勾。
    expect(onComplete).toHaveBeenCalledWith(2, 2, expect.any(Array));
    const results = onComplete.mock.calls[0][2] as unknown[];
    expect(results, '逐題結果的筆數要等於題數').toHaveLength(2);

    vi.useRealTimers();
  });
});
