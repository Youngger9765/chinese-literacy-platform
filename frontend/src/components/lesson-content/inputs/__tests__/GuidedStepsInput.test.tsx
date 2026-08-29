import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';

// Auth mock so the AI grading path runs (token present).
vi.mock('../../../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: 'test-token' }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// Mock the AI grader so we can inspect the payload it receives.
const validateStrategyAnswer = vi.fn();
vi.mock('../../../../services/learningApi', () => ({
  validateStrategyAnswer: (...args: unknown[]) => validateStrategyAnswer(...args),
}));

import GuidedStepsInput, { type GuidedQuestion } from '../GuidedStepsInput';

const LESSON_PASSAGE = '主課文：公元前299年，秦昭王軟禁了孟嘗君……（小兵立大功）';
const EXAMPLE_PASSAGE =
  '天氣炎熱，烏鴉又渴又累。牠找到一個有水的瓶子，但瓶子太深，水太少，烏鴉喝不到。烏鴉叼來小石頭丟進瓶子，讓水面升高，最後順利喝到水。';

// guided_steps with a worked-example first step that carries its OWN story in `context`.
const question = {
  kind: 'guided_steps',
  strategyName: '摘要策略──問題.解決.結果結構',
  steps: [
    {
      prompt: '❶主角是誰？',
      type: 'free_text',
      referenceAnswer: '烏鴉',
      context: EXAMPLE_PASSAGE,
      section: '例一：烏鴉喝水',
    },
  ],
} as unknown as GuidedQuestion;

function Harness() {
  // Seed with step 0 empty so the one-time `restoredRef` restore effect fires on mount
  // and skips the empty step — leaving it live-editable so the 送出 → AI grading path runs
  // (a fresh {} would let the restore effect swallow the first keystroke as a local grade).
  const [val, setVal] = useState<Record<number, unknown>>({ 0: '' });
  return (
    <GuidedStepsInput
      question={question}
      strategyName="摘要策略──問題.解決.結果結構"
      storyTitle="小兵立大功"
      passage={LESSON_PASSAGE}
      value={val}
      onChange={setVal}
    />
  );
}

describe('GuidedStepsInput free_text grading passage (#2553)', () => {
  beforeEach(() => {
    validateStrategyAnswer.mockReset();
    validateStrategyAnswer.mockResolvedValue({ is_correct: false, feedback: '再想想看', suggestion: '' });
  });

  // 迴歸(#2553):範例子流程(例一:烏鴉喝水)的 free_text 若拿整課 passage(孟嘗君的故事)判分,
  // AI 會誤把「孟嘗君」判成烏鴉喝水的主角。修好後該步驟必須用它自己的 context(烏鴉喝水)判分。
  it('grades a worked-example step against its own context, not the lesson passage', async () => {
    render(<Harness />);

    fireEvent.change(screen.getByLabelText('自由作答'), { target: { value: '孟嘗君' } });
    fireEvent.click(screen.getByText('送出'));

    await waitFor(() => expect(validateStrategyAnswer).toHaveBeenCalledTimes(1));
    const payload = validateStrategyAnswer.mock.calls[0][1] as { passage?: string; studentAnswer?: string };
    expect(payload.studentAnswer).toBe('孟嘗君');
    expect(payload.passage).toBe(EXAMPLE_PASSAGE);       // 用範例自己的故事判分
    expect(payload.passage).not.toBe(LESSON_PASSAGE);    // 不是整課(孟嘗君)課文
  });
});
