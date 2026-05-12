import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import MultipleChoiceExercise from '../MultipleChoiceExercise';
import { MultipleChoiceItem } from '../../../types';

// MultipleChoiceExercise + the McqRescueDialog it mounts both call useAuth();
// also #1507 added a fire-and-forget recordMcqAttempt on every click. Stub
// both so tests don't need an AuthProvider and don't hit the network.
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: 'test-token' }),
}));
vi.mock('../../../services/learningApi', () => ({
  recordMcqAttempt: vi.fn(),
  mcqRescueStart: vi.fn(),
  mcqRescueRespond: vi.fn(),
  SessionExpiredError: class SessionExpiredError extends Error {},
}));

const questions: MultipleChoiceItem[] = [
  {
    question: '文章的主題是什麼？',
    options: ['自然環境', '科技發展', '人際關係', '歷史文化'],
    answer: 'B',
    explanation: '文章主要討論科技對社會的影響。',
  },
  {
    question: '作者的態度是？',
    options: ['樂觀', '悲觀', '中立', '批判'],
    answer: 'A',
    explanation: '作者對未來持樂觀態度。',
  },
];

describe('MultipleChoiceExercise', () => {
  it('renders first question and all options', () => {
    render(<MultipleChoiceExercise questions={questions} onComplete={() => {}} />);
    expect(screen.getByText(/文章的主題是什麼？/)).toBeTruthy();
    expect(screen.getByText('自然環境')).toBeTruthy();
    expect(screen.getByText('科技發展')).toBeTruthy();
    expect(screen.getByText('人際關係')).toBeTruthy();
    expect(screen.getByText('歷史文化')).toBeTruthy();
  });

  it('shows progress counter', () => {
    render(<MultipleChoiceExercise questions={questions} onComplete={() => {}} />);
    expect(screen.getByText(/第 1 題／共 2 題/)).toBeTruthy();
  });

  it('selecting correct answer reveals explanation and correct styling text', () => {
    render(<MultipleChoiceExercise questions={questions} onComplete={() => {}} />);

    // Answer B is correct — click the B option button
    const optionB = screen.getByText('科技發展').closest('button');
    fireEvent.click(optionB!);

    // Explanation should appear
    expect(screen.getByText(/文章主要討論科技對社會的影響/)).toBeTruthy();
    // Next button appears
    expect(screen.getByRole('button', { name: /下一題/ })).toBeTruthy();
  });

  it('selecting wrong answer shows explanation and next button', () => {
    render(<MultipleChoiceExercise questions={questions} onComplete={() => {}} />);

    const optionA = screen.getByText('自然環境').closest('button');
    fireEvent.click(optionA!);

    // Explanation still appears
    expect(screen.getByText(/文章主要討論科技對社會的影響/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /下一題/ })).toBeTruthy();
  });

  it('clicking next moves to the next question', () => {
    render(<MultipleChoiceExercise questions={questions} onComplete={() => {}} />);

    // Answer first question
    const optionB = screen.getByText('科技發展').closest('button');
    fireEvent.click(optionB!);
    fireEvent.click(screen.getByRole('button', { name: /下一題/ }));

    // Second question now visible
    expect(screen.getByText(/作者的態度是？/)).toBeTruthy();
    expect(screen.getByText(/第 2 題／共 2 題/)).toBeTruthy();
  });

  it('last question shows 完成測驗 button and calls onComplete', () => {
    const onComplete = vi.fn();
    render(<MultipleChoiceExercise questions={questions} onComplete={onComplete} />);

    // Answer question 1
    fireEvent.click(screen.getByText('科技發展').closest('button')!);
    fireEvent.click(screen.getByRole('button', { name: /下一題/ }));

    // Answer question 2 (correct = A = 樂觀)
    fireEvent.click(screen.getByText('樂觀').closest('button')!);

    expect(screen.getByRole('button', { name: /完成測驗/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /完成測驗/ }));

    expect(onComplete).toHaveBeenCalledWith(expect.any(Number), 2);
  });

  it('options are disabled after selection', () => {
    render(<MultipleChoiceExercise questions={questions} onComplete={() => {}} />);

    const optionA = screen.getByText('自然環境').closest('button');
    fireEvent.click(optionA!);

    // All option buttons should now be disabled
    const allOptionButtons = screen
      .getAllByRole('button')
      .filter((btn) => ['自然環境', '科技發展', '人際關係', '歷史文化'].some((t) => btn.textContent?.includes(t)));
    allOptionButtons.forEach((btn) => expect(btn).toBeDisabled());
  });
});
