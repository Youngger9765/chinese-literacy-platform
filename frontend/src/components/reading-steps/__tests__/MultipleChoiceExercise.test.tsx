import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import MultipleChoiceExercise from '../MultipleChoiceExercise';
import { MultipleChoiceItem } from '../../../types';
import { recordMcqAttempt } from '../../../services/learningApi';

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
  beforeEach(() => {
    vi.mocked(recordMcqAttempt).mockClear();
  });

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

  it('答錯不揭露答案，請學生再選一次（#2199）', () => {
    render(<MultipleChoiceExercise questions={questions} onComplete={() => {}} />);

    fireEvent.click(screen.getByText('自然環境').closest('button')!);

    const txt = document.body.textContent ?? '';
    // 現在的教學設計：答錯不給答案、也不放行到下一題，讓學生自己再想
    expect(screen.getByText(/再選一次/), '答錯應該請學生再選一次').toBeTruthy();
    expect(txt, '答錯時洩漏了解說').not.toMatch(/文章主要討論科技對社會的影響/);
    expect(
      screen.queryByRole('button', { name: /下一題/ }),
      '答錯不該能直接跳下一題',
    ).toBeNull();
    // 還要能繼續作答 —— 鎖住選項等於卡死學生
    expect(screen.getByText('科技發展').closest('button')).not.toBeDisabled();
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

  it('答對才鎖選項；答錯要能再選（#2199）', () => {
    const opts = () =>
      screen
        .getAllByRole('button')
        .filter((b) => ['自然環境', '科技發展', '人際關係', '歷史文化'].some((t) => b.textContent?.includes(t)));

    render(<MultipleChoiceExercise questions={questions} onComplete={() => {}} />);

    // 答錯 → 不鎖，否則學生卡死
    fireEvent.click(screen.getByText('自然環境').closest('button')!);
    opts().forEach((b) => expect(b, '答錯後選項被鎖住了').not.toBeDisabled());

    // 答對 → 鎖住，避免改答案
    fireEvent.click(screen.getByText('科技發展').closest('button')!);
    opts().forEach((b) => expect(b, '答對後選項應該鎖住').toBeDisabled());
  });

  // ── Issue #1507 — opt-in rescue + telemetry ──────────────────────────

  it('wrong answer shows the 「問 AI 助教」 button', () => {
    render(<MultipleChoiceExercise questions={questions} onComplete={() => {}} lessonId="g7-l29" />);

    fireEvent.click(screen.getByText('自然環境').closest('button')!);

    expect(screen.getByRole('button', { name: /問 AI 助教/ })).toBeTruthy();
  });

  it('correct answer does NOT show the 「問 AI 助教」 button', () => {
    render(<MultipleChoiceExercise questions={questions} onComplete={() => {}} lessonId="g7-l29" />);

    // B = 科技發展 is correct
    fireEvent.click(screen.getByText('科技發展').closest('button')!);

    expect(screen.queryByRole('button', { name: /問 AI 助教/ })).toBeNull();
  });

  it('records each MCQ attempt with the correct payload', () => {
    render(<MultipleChoiceExercise questions={questions} onComplete={() => {}} lessonId="g7-l29" />);

    // Wrong pick first
    fireEvent.click(screen.getByText('自然環境').closest('button')!);
    expect(recordMcqAttempt).toHaveBeenCalledWith('test-token', {
      lesson_id: 'g7-l29',
      question_id: 'g7-l29-q0',
      choice: 'A',
      is_correct: false,
    });

    // #2199 之後答錯不放行，要先答對這一題才進得了下一題 ——
    // 每一次作答（含答錯的那次）都要記錄，這才是老師看得到的訊號。
    fireEvent.click(screen.getByText('科技發展').closest('button')!);
    expect(recordMcqAttempt).toHaveBeenCalledWith('test-token', {
      lesson_id: 'g7-l29',
      question_id: 'g7-l29-q0',
      choice: 'B',
      is_correct: true,
    });

    fireEvent.click(screen.getByRole('button', { name: /下一題/ }));
    fireEvent.click(screen.getByText('樂觀').closest('button')!);
    expect(recordMcqAttempt).toHaveBeenCalledWith('test-token', {
      lesson_id: 'g7-l29',
      question_id: 'g7-l29-q1',
      choice: 'A',
      is_correct: true,
    });

    expect(recordMcqAttempt, '三次作答就要三筆紀錄').toHaveBeenCalledTimes(3);
  });

  // ── Issue #3024 — instant positive feedback + progress bar ──────────────

  it('答對時立刻顯示 CorrectAnswerBurst 正向回饋 (#3024)', () => {
    render(<MultipleChoiceExercise questions={questions} onComplete={() => {}} />);

    expect(screen.queryByTestId('correct-answer-burst'), '答題前不應出現').toBeNull();

    fireEvent.click(screen.getByText('科技發展').closest('button')!);

    expect(screen.getByTestId('correct-answer-burst'), '答對後應立即出現').toBeTruthy();
  });

  it('答錯時不顯示 CorrectAnswerBurst（#3028 out of scope：不做嘗試次數/正確率回饋）', () => {
    render(<MultipleChoiceExercise questions={questions} onComplete={() => {}} />);

    fireEvent.click(screen.getByText('自然環境').closest('button')!);

    expect(screen.queryByTestId('correct-answer-burst'), '答錯不該觸發正向回饋').toBeNull();
  });

  it('每答對一題都重新觸發 CorrectAnswerBurst（跨題目）', () => {
    render(<MultipleChoiceExercise questions={questions} onComplete={() => {}} />);

    fireEvent.click(screen.getByText('科技發展').closest('button')!);
    const firstBurst = screen.getByTestId('correct-answer-burst');
    fireEvent.click(screen.getByRole('button', { name: /下一題/ }));

    // Second question — burst should still be able to fire again (component
    // isn't unmounted between questions, so this exercises the re-trigger path).
    fireEvent.click(screen.getByText('樂觀').closest('button')!);
    expect(screen.getByTestId('correct-answer-burst')).toBeTruthy();
    // Sanity: it's not literally the same stale DOM node lingering from before.
    expect(firstBurst).toBeTruthy();
  });

  it('大題進度條依已完成題數更新寬度（BDD Scenario 3, #3024）', () => {
    const { container } = render(
      <MultipleChoiceExercise questions={questions} onComplete={() => {}} />,
    );
    const bar = container.querySelector('.bg-blue-500.h-1\\.5') as HTMLElement;
    expect(bar, '進度條不存在').toBeTruthy();
    expect(bar.style.width).toBe('0%');

    fireEvent.click(screen.getByText('科技發展').closest('button')!); // Q1 correct
    expect(bar.style.width).toBe('50%'); // 1 of 2 done

    fireEvent.click(screen.getByRole('button', { name: /下一題/ }));
    fireEvent.click(screen.getByText('樂觀').closest('button')!); // Q2 correct
    expect(bar.style.width).toBe('100%');
  });
});
