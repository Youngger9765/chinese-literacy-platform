import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import StrategyExercise from '../StrategyExercise';
import { StrategyExercise as StrategyExerciseType } from '../../../types';

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

function pickOption(label: string) {
  const btn = screen.getByText(label).closest('button');
  fireEvent.click(btn!);
}

function clickConfirm() {
  // 已確認的步驟會隱藏確認按鈕（!isDone），所以 confirms[0] 永遠是「第一個未確認步驟」的按鈕
  const confirms = screen.getAllByRole('button', { name: /確認/ });
  fireEvent.click(confirms[0]);
}
  const confirms = screen.getAllByRole('button', { name: /確認/ });
  fireEvent.click(confirms[0]);
}

describe('StrategyExercise — guided_steps', () => {
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
