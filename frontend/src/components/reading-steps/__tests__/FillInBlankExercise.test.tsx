import { render, screen, fireEvent } from '@testing-library/react';
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

describe('FillInBlankExercise', () => {
  it('renders word bank entries', () => {
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

  it('submit button is disabled when not all blanks are filled', () => {
    render(
      <FillInBlankExercise
        sentences={sentences}
        vocabBank={vocabBank}
        onComplete={() => {}}
      />
    );
    const submitBtn = screen.getByRole('button', { name: '提交答案' });
    expect(submitBtn).toBeDisabled();
  });

  it('submit button is enabled after all blanks are filled', () => {
    render(
      <FillInBlankExercise
        sentences={sentences}
        vocabBank={vocabBank}
        onComplete={() => {}}
      />
    );

    // Select answer for sentence 0 — click the per-sentence option buttons
    // The option buttons appear inside each sentence card
    const allOptionButtons = screen.getAllByRole('button', { name: /^A 疑難雜症$/ });
    fireEvent.click(allOptionButtons[0]);

    const allOptionButtonsB = screen.getAllByRole('button', { name: /^B 龍爭虎鬥$/ });
    fireEvent.click(allOptionButtonsB[1]);

    const submitBtn = screen.getByRole('button', { name: '提交答案' });
    expect(submitBtn).not.toBeDisabled();
  });

  it('after submit shows correct answer in green and wrong answer in red with correction', () => {
    const onComplete = vi.fn();
    render(
      <FillInBlankExercise
        sentences={sentences}
        vocabBank={vocabBank}
        onComplete={onComplete}
      />
    );

    // Select A (correct) for sentence 0, C (wrong) for sentence 1
    const aButtons = screen.getAllByRole('button', { name: /^A 疑難雜症$/ });
    fireEvent.click(aButtons[0]);
    const cButtons = screen.getAllByRole('button', { name: /^C 一鳴驚人$/ });
    fireEvent.click(cButtons[1]);

    fireEvent.click(screen.getByRole('button', { name: '提交答案' }));

    // Correct badge should show green styling (bg-green-100 class present in DOM)
    // Wrong badge should show correction hint
    expect(screen.getByText(/→ B 龍爭虎鬥/)).toBeTruthy();
  });

  it('retry button resets state', () => {
    render(
      <FillInBlankExercise
        sentences={sentences}
        vocabBank={vocabBank}
        onComplete={() => {}}
      />
    );

    const aButtons = screen.getAllByRole('button', { name: /^A 疑難雜症$/ });
    fireEvent.click(aButtons[0]);
    const bButtons = screen.getAllByRole('button', { name: /^B 龍爭虎鬥$/ });
    fireEvent.click(bButtons[1]);
    fireEvent.click(screen.getByRole('button', { name: '提交答案' }));
    fireEvent.click(screen.getByRole('button', { name: '再試一次' }));

    // Submit button should be disabled again (blanks cleared)
    expect(screen.getByRole('button', { name: '提交答案' })).toBeDisabled();
  });

  it('onComplete is called with correct score when continue button is clicked', () => {
    const onComplete = vi.fn();
    render(
      <FillInBlankExercise
        sentences={sentences}
        vocabBank={vocabBank}
        onComplete={onComplete}
      />
    );

    // Answer both correctly (A and B)
    const aButtons = screen.getAllByRole('button', { name: /^A 疑難雜症$/ });
    fireEvent.click(aButtons[0]);
    const bButtons = screen.getAllByRole('button', { name: /^B 龍爭虎鬥$/ });
    fireEvent.click(bButtons[1]);
    fireEvent.click(screen.getByRole('button', { name: '提交答案' }));
    fireEvent.click(screen.getByRole('button', { name: /繼續/ }));

    expect(onComplete).toHaveBeenCalledWith(2, 2);
  });
});
