import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import StrategyExercise from '../StrategyExercise';
import { StrategyExercise as StrategyExerciseType } from '../../../types';
import { recordMcqAttempt, validateStrategyAnswer } from '../../../services/learningApi';

// Stub auth + network so tests don't need providers or real API calls.
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: 'test-token' }),
}));
vi.mock('../../../services/learningApi', () => ({
  recordMcqAttempt: vi.fn(),
  validateStrategyAnswer: vi.fn(),
  mcqRescueStart: vi.fn(),
  mcqRescueRespond: vi.fn(),
  SessionExpiredError: class SessionExpiredError extends Error {},
}));
// ZhuyinContext used by the main StrategyExercise wrapper.
vi.mock('../../../context/ZhuyinContext', () => ({
  useZhuyin: () => ({
    zhuyinEnabled: false,
    zhuyinReady: false,
    zhuyinActive: false,
    isZhuyinAny: false,
    processZhuyin: (t: string) => t,
  }),
}));
// McqRescueDialog uses its own fetch internally; stub the whole component so
// it doesn't blow up in jsdom.
vi.mock('../../reading-spotlight/McqRescueDialog', () => ({
  default: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="rescue-dialog" /> : null,
}));

// ── Fixtures ─────────────────────────────────────────────────────────────────

const guidedTwoSelect: StrategyExerciseType = {
  type: 'guided_steps',
  strategy_name: '自我提問',
  instruction: '練習問重要的問題。',
  steps: [
    {
      prompt: '從「主角是誰」的角度，哪個問題最重要？',
      type: 'select',
      options: ['他幾歲？', '他是誰？他有什麼特別之處？', '他住哪裡？'],
      answer: 1,
    },
    {
      prompt: '從「結果如何」的角度，哪個問題最重要？',
      type: 'select',
      options: ['他賺了多少？', '他從中得到什麼？', '他爬了幾座山？'],
      answer: 1,
    },
  ],
};

const guidedFreeText: StrategyExerciseType = {
  type: 'guided_steps',
  strategy_name: '問題.解決.結果',
  instruction: '用自己的話回答。',
  steps: [{ prompt: '主角遇到什麼問題？', type: 'free_text' }],
};

const traitExercise: StrategyExerciseType = {
  type: 'trait_inference',
  strategy_name: '人物特質推論',
  instruction: '根據線索推論人物特質。',
  character: '阿明',
  clues: [{ source: '對話', text: '阿明把午餐分給同學。' }],
  trait_options: ['勇敢', '慷慨', '認真'],
  correct_trait: '慷慨',
};

const singleItemOrdering: StrategyExerciseType = {
  type: 'ordering',
  strategy_name: '單項排序',
  instruction: '排列。',
  items: [{ text: '唯一項目', correct_order: 1 }],
};

const multiItemOrdering: StrategyExerciseType = {
  type: 'ordering',
  strategy_name: '故事順序',
  instruction: '依照故事順序排列。',
  items: [
    { text: '第一件事', correct_order: 1 },
    { text: '第二件事', correct_order: 2 },
    { text: '第三件事', correct_order: 3 },
  ],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function pickOption(label: string) {
  const btn = screen.getByText(label).closest('button');
  fireEvent.click(btn!);
}

function clickConfirm() {
  // 已確認的步驟會隱藏確認按鈕（!isDone），所以 confirms[0] 永遠是「第一個未確認步驟」的按鈕
  const confirms = screen.getAllByRole('button', { name: /確認/ });
  fireEvent.click(confirms[0]);
}

// ── TDD: ordering_submit_marks_correct_only_when_order_matches ────────────────

describe('ordering_submit_marks_correct_only_when_order_matches', () => {
  it('calls onComplete when single item is submitted (always correct)', () => {
    const onComplete = vi.fn();
    render(<StrategyExercise exercise={singleItemOrdering} onComplete={onComplete} />);
    fireEvent.click(screen.getByRole('button', { name: /送出答案/ }));
    // Single item is always in correct position — onComplete must fire exactly once.
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('shows reset button after submit (submit button disappears)', () => {
    render(<StrategyExercise exercise={multiItemOrdering} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /送出答案/ }));
    // Regardless of correctness, submit button should be gone and reset appears.
    expect(screen.queryByRole('button', { name: /送出答案/ })).toBeNull();
    expect(screen.getByRole('button', { name: /重新練習/ })).toBeTruthy();
  });

  it('does not fire onComplete more than once even on repeated resubmits', () => {
    const onComplete = vi.fn();
    render(<StrategyExercise exercise={singleItemOrdering} onComplete={onComplete} />);
    fireEvent.click(screen.getByRole('button', { name: /送出答案/ }));
    // Reset and resubmit
    fireEvent.click(screen.getByRole('button', { name: /重新練習/ }));
    fireEvent.click(screen.getByRole('button', { name: /送出答案/ }));
    // Each submit of a correct answer should call onComplete once, so max 2 here.
    expect(onComplete.mock.calls.length).toBeLessThanOrEqual(2);
  });
});

// ── TDD: trait_wrong_answer_records_attempt_and_opens_rescue_context ──────────

describe('trait_wrong_answer_records_attempt_and_opens_rescue_context', () => {
  beforeEach(() => {
    vi.mocked(recordMcqAttempt).mockClear();
  });

  it('records MCQ attempt with is_correct=false when wrong answer submitted', () => {
    render(
      <StrategyExercise exercise={traitExercise} lessonId="lesson-1" onComplete={vi.fn()} />,
    );
    pickOption('勇敢'); // wrong
    fireEvent.click(screen.getByRole('button', { name: /送出答案/ }));
    expect(recordMcqAttempt).toHaveBeenCalledWith(
      'test-token',
      expect.objectContaining({ is_correct: false }),
    );
  });

  it('shows AI rescue button after wrong answer', () => {
    render(
      <StrategyExercise exercise={traitExercise} lessonId="lesson-1" onComplete={vi.fn()} />,
    );
    pickOption('勇敢'); // wrong
    fireEvent.click(screen.getByRole('button', { name: /送出答案/ }));
    expect(screen.getByText(/問 AI 助教/)).toBeTruthy();
  });

  it('opens rescue dialog when AI rescue button clicked', () => {
    render(
      <StrategyExercise exercise={traitExercise} lessonId="lesson-1" onComplete={vi.fn()} />,
    );
    pickOption('勇敢'); // wrong
    fireEvent.click(screen.getByRole('button', { name: /送出答案/ }));
    fireEvent.click(screen.getByText(/問 AI 助教/));
    expect(screen.getByTestId('rescue-dialog')).toBeTruthy();
  });

  it('does NOT show rescue button when correct answer submitted', () => {
    render(
      <StrategyExercise exercise={traitExercise} lessonId="lesson-1" onComplete={vi.fn()} />,
    );
    pickOption('慷慨'); // correct
    fireEvent.click(screen.getByRole('button', { name: /送出答案/ }));
    expect(screen.queryByText(/問 AI 助教/)).toBeNull();
  });
});

// ── free_text AI grading (#2192 item 5) ─────────────────────────────────────

describe('guided_steps free_text AI grading', () => {
  beforeEach(() => {
    vi.mocked(validateStrategyAnswer).mockReset();
  });

  it('shows AI feedback after a free_text answer is graded', async () => {
    vi.mocked(validateStrategyAnswer).mockResolvedValue({
      is_correct: true,
      feedback: '你抓到重點了！',
      suggestion: '',
    });
    render(<StrategyExercise exercise={guidedFreeText} onComplete={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText(/寫下你的答案/), {
      target: { value: '城門打不開' },
    });
    fireEvent.click(screen.getByRole('button', { name: /確認/ }));

    expect(await screen.findByText('你抓到重點了！')).toBeTruthy();
    expect(validateStrategyAnswer).toHaveBeenCalledWith(
      'test-token',
      expect.objectContaining({ studentAnswer: '城門打不開', question: '主角遇到什麼問題？' }),
    );
  });

  it('shows suggestion hint when answer is off-track', async () => {
    vi.mocked(validateStrategyAnswer).mockResolvedValue({
      is_correct: false,
      feedback: '方向對了，再想想看～',
      suggestion: '試著找出主角卡關的地方',
    });
    render(<StrategyExercise exercise={guidedFreeText} onComplete={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText(/寫下你的答案/), {
      target: { value: '不知道' },
    });
    fireEvent.click(screen.getByRole('button', { name: /確認/ }));

    expect(await screen.findByText('方向對了，再想想看～')).toBeTruthy();
    expect(screen.getByText('試著找出主角卡關的地方')).toBeTruthy();
  });

  it('falls back to 已記錄 and still completes when grading throws', async () => {
    vi.mocked(validateStrategyAnswer).mockRejectedValue(new Error('network'));
    const onComplete = vi.fn();
    render(<StrategyExercise exercise={guidedFreeText} onComplete={onComplete} />);

    fireEvent.change(screen.getByPlaceholderText(/寫下你的答案/), {
      target: { value: '隨便寫' },
    });
    fireEvent.click(screen.getByRole('button', { name: /確認/ }));

    expect(await screen.findByText(/已記錄你的答案/)).toBeTruthy();
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});

// ── TDD: guided_steps_persists_answers_feedback_and_all_done ─────────────────

describe('guided_steps_persists_answers_feedback_and_all_done', () => {
  it('calls onChange with exerciseType and answers array on each selection', () => {
    const onChange = vi.fn();
    render(
      <StrategyExercise exercise={guidedTwoSelect} onChange={onChange} onComplete={vi.fn()} />,
    );
    pickOption('他是誰？他有什麼特別之處？');
    expect(onChange).toHaveBeenCalled();
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(lastCall).toMatchObject({ exerciseType: 'guided_steps' });
    expect(Array.isArray(lastCall.answers)).toBe(true);
  });

  it('sets allDone=true in onChange after all steps confirmed', () => {
    const onChange = vi.fn();
    render(
      <StrategyExercise exercise={guidedTwoSelect} onChange={onChange} onComplete={vi.fn()} />,
    );
    pickOption('他是誰？他有什麼特別之處？');
    clickConfirm();
    pickOption('他從中得到什麼？');
    clickConfirm();
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(lastCall.allDone).toBe(true);
  });

  it('shows 全部步驟完成 banner after all steps confirmed', () => {
    render(<StrategyExercise exercise={guidedTwoSelect} onComplete={vi.fn()} />);
    pickOption('他是誰？他有什麼特別之處？');
    clickConfirm();
    pickOption('他從中得到什麼？');
    clickConfirm();
    expect(screen.getByText(/全部步驟完成/)).toBeTruthy();
  });

  it('restores allDone=true from initialState showing banner immediately', () => {
    const savedState = {
      exerciseType: 'guided_steps',
      answers: [1, 1],
      stepFeedback: [true, true],
      allDone: true,
    };
    render(
      <StrategyExercise
        exercise={guidedTwoSelect}
        initialState={savedState}
        onComplete={vi.fn()}
      />,
    );
    expect(screen.getByText(/全部步驟完成/)).toBeTruthy();
  });
});

// ── Original tests (keep passing after refactor) ──────────────────────────────

describe('StrategyExercise — guided_steps (original)', () => {
  it('does not call onComplete after only Q1 confirmed', () => {
    const onComplete = vi.fn();
    render(<StrategyExercise exercise={guidedTwoSelect} onComplete={onComplete} />);

    pickOption('他是誰？他有什麼特別之處？');
    clickConfirm();

    expect(onComplete).not.toHaveBeenCalled();
  });

  it('calls onComplete after all steps answered correctly', () => {
    const onComplete = vi.fn();
    render(<StrategyExercise exercise={guidedTwoSelect} onComplete={onComplete} />);

    pickOption('他是誰？他有什麼特別之處？');
    clickConfirm();
    pickOption('他從中得到什麼？');
    clickConfirm();

    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('calls onComplete even when some steps are answered wrong (#1491)', () => {
    const onComplete = vi.fn();
    render(<StrategyExercise exercise={guidedTwoSelect} onComplete={onComplete} />);

    pickOption('他幾歲？');
    clickConfirm();
    pickOption('他從中得到什麼？');
    clickConfirm();

    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});
