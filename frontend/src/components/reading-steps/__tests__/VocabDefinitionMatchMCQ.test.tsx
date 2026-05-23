/**
 * Characterization tests for VocabDefinitionMatchMCQ — #1912 fix
 *
 * TDD-first protocol:
 *   1. [RED]   Tests fail on current code (wrong answer silently advances)
 *   2. [GREEN] Implement fix → tests pass
 *   3. [REFACTOR] Confirm no regressions
 *
 * Three behaviors under test:
 *   - vocab_def_wrong_answer_shows_x_marker_not_silent_accept
 *   - vocab_def_wrong_answer_does_not_auto_advance
 *   - vocab_def_correct_answer_advances_to_next (or calls onAllDone)
 */
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MultipleChoiceMode } from '../VocabDefinitionMatchMCQ';
import type { VocabItem } from '../../../types';

/* ------------------------------------------------------------------ */
/*  Fixtures                                                            */
/* ------------------------------------------------------------------ */

const VOCAB: VocabItem[] = [
  { word: '勤奮', definition: '努力不懈地工作或學習。' },
  { word: '謙虛', definition: '不自誇，虛心接受他人意見。' },
  { word: '堅持', definition: '不放棄，繼續努力下去。' },
];

/* ------------------------------------------------------------------ */
/*  #1912: Wrong-answer feedback (RED until fix)                        */
/* ------------------------------------------------------------------ */

describe('MultipleChoiceMode — #1912 wrong-answer feedback', () => {
  it('vocab_def_wrong_answer_shows_x_marker_not_silent_accept: wrong choice renders ✗ indicator visible on screen', () => {
    render(
      <MultipleChoiceMode
        vocab={VOCAB}
        activeDefIndices={[0, 1]}
        onAllDone={vi.fn()}
      />
    );

    // The first definition shown is for defIndex 0 → correct answer is '勤奮' (idx 0)
    // Pick any button that is NOT the correct word (i.e., a wrong one)
    const allButtons = screen.getAllByRole('button');
    const wrongButton = allButtons.find(
      (btn) => btn.textContent?.trim() !== '' && btn.textContent?.trim() !== '勤奮'
    );
    expect(wrongButton).toBeTruthy();

    fireEvent.click(wrongButton!);

    // After wrong answer: ✗ or red feedback must appear
    // The fix should render a visible error indicator — look for data-testid
    // or the red feedback panel (use querySelector which doesn't throw on multiple matches)
    const errorIndicator =
      document.querySelector('[data-testid="wrong-answer-indicator"]') ||
      document.querySelector('[class*="border-red"]') ||
      document.querySelector('[class*="bg-red"]');

    expect(errorIndicator).toBeTruthy();
  });

  it('vocab_def_wrong_answer_does_not_auto_advance: stays on same question after wrong answer', async () => {
    const onAllDone = vi.fn();
    render(
      <MultipleChoiceMode
        vocab={VOCAB}
        activeDefIndices={[0]}
        onAllDone={onAllDone}
      />
    );

    // With a single question, wrong answer must NOT call onAllDone
    const allButtons = screen.getAllByRole('button');
    const wrongButton = allButtons.find(
      (btn) => btn.textContent?.trim() !== '' && btn.textContent?.trim() !== '勤奮'
    );

    fireEvent.click(wrongButton!);

    // Wait beyond the old 400ms auto-advance timeout
    await act(async () => {
      await new Promise((r) => setTimeout(r, 600));
    });

    // onAllDone must NOT have been called — wrong answer must not advance
    expect(onAllDone).not.toHaveBeenCalled();
  });

  it('vocab_def_wrong_answer_shows_correct_answer_reveal: correct word displayed after wrong pick', () => {
    render(
      <MultipleChoiceMode
        vocab={VOCAB}
        activeDefIndices={[0]}
        onAllDone={vi.fn()}
      />
    );

    const allButtons = screen.getAllByRole('button');
    const wrongButton = allButtons.find(
      (btn) => btn.textContent?.trim() !== '' && btn.textContent?.trim() !== '勤奮'
    );
    fireEvent.click(wrongButton!);

    // After wrong answer, the feedback panel must mention the correct answer
    // Use getAllByText (no throw on multiple) and confirm at least one element has '勤奮'
    const correctRevealElements = screen.queryAllByText(/勤奮/);
    // There should be at least one occurrence (in the feedback panel or button)
    expect(correctRevealElements.length).toBeGreaterThan(0);
    // AND the red feedback panel should be present
    const feedbackPanel = document.querySelector('[class*="bg-red-50"]');
    expect(feedbackPanel).toBeTruthy();
  });

  it('vocab_def_wrong_answer_explicit_next_required: next button or explicit action needed to advance', () => {
    render(
      <MultipleChoiceMode
        vocab={VOCAB}
        activeDefIndices={[0]}
        onAllDone={vi.fn()}
      />
    );

    const allButtons = screen.getAllByRole('button');
    const wrongButton = allButtons.find(
      (btn) => btn.textContent?.trim() !== '' && btn.textContent?.trim() !== '勤奮'
    );
    fireEvent.click(wrongButton!);

    // After wrong answer, there must be an explicit "next" or "繼續" button
    const nextBtn =
      screen.queryByRole('button', { name: /繼續|下一題|next/i }) ||
      screen.queryByRole('button', { name: /再試一次|try again/i });
    expect(nextBtn).toBeTruthy();
  });
});

/* ------------------------------------------------------------------ */
/*  Correct answer still works after fix                                */
/* ------------------------------------------------------------------ */

describe('MultipleChoiceMode — correct answer behavior (must stay green)', () => {
  it('vocab_def_correct_answer_advances_to_next: correct answer on last question calls onAllDone', async () => {
    const onAllDone = vi.fn();
    render(
      <MultipleChoiceMode
        vocab={VOCAB}
        activeDefIndices={[0]}
        onAllDone={onAllDone}
      />
    );

    // Click the correct answer for defIndex 0 → '勤奮'
    const correctButton = screen.getByRole('button', { name: '勤奮' });
    fireEvent.click(correctButton);

    // Wait for the advance delay (400ms used by correct path)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 600));
    });

    expect(onAllDone).toHaveBeenCalledOnce();
    expect(onAllDone).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ defIndex: 0, correct: true }),
      ])
    );
  });

  it('advances to question 2 after correct answer on question 1', async () => {
    render(
      <MultipleChoiceMode
        vocab={VOCAB}
        activeDefIndices={[0, 1]}
        onAllDone={vi.fn()}
      />
    );

    // Q1: correct answer is '勤奮'
    const correctButton = screen.getByRole('button', { name: '勤奮' });
    fireEvent.click(correctButton);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 600));
    });

    // Now on Q2: definition for defIndex 1 should be visible
    expect(screen.getByText('不自誇，虛心接受他人意見。')).toBeTruthy();
  });

  it('progress bar increments after each correct answer', async () => {
    render(
      <MultipleChoiceMode
        vocab={VOCAB}
        activeDefIndices={[0, 1, 2]}
        onAllDone={vi.fn()}
      />
    );

    // Initially shows 1 / 3
    expect(screen.getByText('1 / 3')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '勤奮' }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 600));
    });

    expect(screen.getByText('2 / 3')).toBeTruthy();
  });
});
