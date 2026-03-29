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

  it('confirm button is disabled until a word is selected', () => {
    render(
      <FillInBlankExercise
        sentences={sentences}
        vocabBank={vocabBank}
        onComplete={() => {}}
      />
    );
    const confirmBtn = screen.getByRole('button', { name: '請先選擇詞語' });
    expect(confirmBtn).toBeDisabled();
  });

  it('confirm button enables after selecting a word from bank', () => {
    render(
      <FillInBlankExercise
        sentences={sentences}
        vocabBank={vocabBank}
        onComplete={() => {}}
      />
    );
    // Click word A from the top bank
    const bankBtns = screen.getAllByRole('button');
    const aBankBtn = bankBtns.find((b) => b.textContent?.includes('疑難雜症') && b.textContent?.includes('A'));
    expect(aBankBtn).toBeTruthy();
    fireEvent.click(aBankBtn!);

    expect(screen.getByRole('button', { name: '確認填入' })).not.toBeDisabled();
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
    const bankBtns = screen.getAllByRole('button');
    const bBankBtn = bankBtns.find((b) => b.textContent?.includes('龍爭虎鬥') && b.textContent?.includes('B'));
    fireEvent.click(bBankBtn!);
    fireEvent.click(screen.getByRole('button', { name: '確認填入' }));

    // Wrong feedback shown
    expect(screen.getByText(/不對喔/)).toBeTruthy();
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
    const bankBtns = screen.getAllByRole('button');
    const aBankBtn = bankBtns.find((b) => b.textContent?.includes('疑難雜症') && b.textContent?.includes('A'));
    fireEvent.click(aBankBtn!);
    fireEvent.click(screen.getByRole('button', { name: '確認填入' }));

    // Shows correct feedback
    expect(screen.getByText(/答對了/)).toBeTruthy();

    // After the 900ms timeout, advances to sentence 2
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(screen.getByText(/兩隊之間展開/)).toBeTruthy();
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
    const bankBtns = screen.getAllByRole('button');
    const aBankBtn = bankBtns.find((b) => b.textContent?.includes('疑難雜症') && b.textContent?.includes('A'));
    fireEvent.click(aBankBtn!);
    fireEvent.click(screen.getByRole('button', { name: '確認填入' }));

    await act(async () => {
      vi.advanceTimersByTime(1000);
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
    const bankBtns0 = screen.getAllByRole('button');
    const aBankBtn = bankBtns0.find((b) => b.textContent?.includes('疑難雜症'));
    fireEvent.click(aBankBtn!);
    fireEvent.click(screen.getByRole('button', { name: '確認填入' }));
    await act(async () => { vi.advanceTimersByTime(1000); });

    // Answer sentence 1 correctly: B
    const bankBtns1 = screen.getAllByRole('button');
    const bBankBtn = bankBtns1.find((b) => b.textContent?.includes('龍爭虎鬥'));
    fireEvent.click(bBankBtn!);
    fireEvent.click(screen.getByRole('button', { name: '確認填入' }));
    await act(async () => { vi.advanceTimersByTime(1000); });

    // Should now show final score screen with continue button
    fireEvent.click(screen.getByRole('button', { name: /繼續/ }));
    expect(onComplete).toHaveBeenCalledWith(2, 2);

    vi.useRealTimers();
  });
});
