/**
 * noCorrectAnswerAndGeneric.test.tsx — the two contract additions that let every 閱讀聚光燈
 * lesson move onto LessonRenderer:
 *
 *  1. `noCorrectAnswer` steps (自我覺察／個人經驗／自我檢核…): answering completes the step,
 *     no verdict is shown, and a free-text answer is NOT sent to the AI grader (it would
 *     judge a personal answer against the 課文 and call it wrong).
 *  2. `generic` blocks: the read-only floor for content the adapter cannot type yet —
 *     drawn in source order, no inputs, and they parse through the real zod contract.
 */
import React, { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { camelizeKeys } from '../../../schema/camelize';
import { LessonSchema } from '../../../schema/lessonContent';
import GuidedStepsInput, { type GuidedQuestion } from '../inputs/GuidedStepsInput';
import GenericBlockView from '../blocks/GenericBlockView';

// A token is present on purpose: the no-grader assertion must hold for a logged-in student,
// not merely because the anonymous path never calls the API.
vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => ({ token: 't', user: null }) }));
const validateStrategyAnswer = vi.fn();
vi.mock('../../../services/learningApi', () => ({
  validateStrategyAnswer: (...a: unknown[]) => validateStrategyAnswer(...a),
}));

// Wire-shaped (snake_case) lesson, exactly as lesson_content_loader emits it.
const wire = {
  id: 'LTEST',
  lesson_code: 'LTEST',
  title: '測試',
  blocks: [
    {
      id: 'ex-spotlight-1',
      type: 'exercise',
      question: {
        kind: 'guided_steps',
        strategy_name: '身體覺察',
        instruction: '請觀察自己',
        steps: [
          { prompt: '哪一隻手臂在外側？', type: 'select', options: ['右手', '左手'], no_correct_answer: true },
          { prompt: '你的情緒會是：', type: 'multi_select', options: ['緊張', '焦慮', '專注'], no_correct_answer: true },
          { prompt: '發生的事情是：', type: 'free_text', no_correct_answer: true },
        ],
      },
      answer_space: 'free_text',
      answer: [null, null, null],
      grader: 'rubric_ai',
      anchors: [],
      needs_review: false,
    },
    {
      id: 'gen-1',
      type: 'generic',
      reason: 'choice_lt2_options',
      parts: [
        { kind: 'heading', text: '小試身手' },
        { kind: 'text', text: '選項印在上方圖片裡' },
        { kind: 'options', items: ['A. 甲', 'B. 乙'] },
        { kind: 'table', headers: ['事件', '想法'], rows: [['被超車', '']] },
      ],
    },
  ],
};

const lesson = LessonSchema.parse(camelizeKeys(wire));

function Harness({ onDone }: { onDone: (d: boolean) => void }) {
  const [value, setValue] = useState<Record<number, unknown>>({});
  const ex = lesson.blocks[0];
  if (ex.type !== 'exercise') throw new Error('fixture');
  return (
    <GuidedStepsInput
      question={ex.question as GuidedQuestion}
      strategyName="身體覺察"
      value={value}
      onChange={setValue}
      onAllStepsDone={onDone}
    />
  );
}

describe('noCorrectAnswer steps', () => {
  it('parse through the zod contract, and an answer alongside the flag is rejected', () => {
    expect(lesson.blocks).toHaveLength(2);
    const bad = structuredClone(wire);
    (bad.blocks[0] as { question: { steps: Record<string, unknown>[] } }).question.steps[0].answer = 0;
    expect(LessonSchema.safeParse(camelizeKeys(bad)).success).toBe(false);
  });

  it('answering completes every step with no verdict, and never calls the AI grader', async () => {
    const onDone = vi.fn();
    render(<Harness onDone={onDone} />);

    fireEvent.click(screen.getByRole('radio', { name: /右手/ }));
    fireEvent.click(screen.getAllByRole('button', { name: '確認' })[0]);
    fireEvent.click(screen.getByRole('checkbox', { name: /專注/ }));
    fireEvent.click(screen.getAllByRole('button', { name: '確認' })[0]);
    fireEvent.change(screen.getByLabelText('自由作答'), { target: { value: '上台前很緊張' } });
    fireEvent.click(screen.getByRole('button', { name: '送出' }));

    expect(await screen.findAllByTestId('step-recorded')).toHaveLength(2);
    expect(screen.getByText(/已記錄你的想法/)).toBeTruthy();
    expect(screen.queryByText(/答對了|再想想看/)).toBeNull();
    expect(validateStrategyAnswer).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenLastCalledWith(true);
  });
});

describe('generic block', () => {
  it('draws every part in order, read-only', () => {
    const g = lesson.blocks[1];
    if (g.type !== 'generic') throw new Error('fixture');
    const { container } = render(<GenericBlockView block={g as React.ComponentProps<typeof GenericBlockView>['block']} />);
    const text = container.textContent ?? '';
    for (const s of ['小試身手', '選項印在上方圖片裡', 'A. 甲', 'B. 乙', '事件', '被超車']) {
      expect(text).toContain(s);
    }
    expect(text.indexOf('小試身手')).toBeLessThan(text.indexOf('A. 甲'));
    expect(container.querySelectorAll('input, button, textarea, select')).toHaveLength(0);
  });

  it('rejects an empty part (the floor must show something)', () => {
    const bad = structuredClone(wire);
    (bad.blocks[1] as { parts: unknown[] }).parts = [{ kind: 'text', text: ' ' }];
    expect(LessonSchema.safeParse(camelizeKeys(bad)).success).toBe(false);
  });
});

describe('first pick is not mistaken for restored progress', () => {
  const graded: GuidedQuestion = {
    kind: 'guided_steps',
    strategyName: '找線索',
    instruction: '請作答',
    steps: [
      { prompt: '第一題', type: 'select', options: ['甲', '乙'], answer: 1 },
      { prompt: '第二題', type: 'select', options: ['丙', '丁'], answer: 0 },
    ],
  } as GuidedQuestion;

  function Graded({ initial }: { initial: Record<number, unknown> }) {
    const [value, setValue] = useState<Record<number, unknown>>(initial);
    return <GuidedStepsInput question={graded} strategyName="找線索" value={value} onChange={setValue} />;
  }

  it('a fresh lesson: picking keeps 確認 and shows no verdict until the student confirms', () => {
    render(<Graded initial={{}} />);
    fireEvent.click(screen.getByRole('radio', { name: /甲/ }));
    expect(screen.queryByText(/答對了|再想想看/)).toBeNull();
    expect(screen.getAllByRole('button', { name: '確認' })).toHaveLength(2);
    fireEvent.click(screen.getAllByRole('button', { name: '確認' })[0]);
    expect(screen.getByText('再想想看')).toBeTruthy();
  });

  it('saved progress arriving at mount is still restored with its verdict', () => {
    render(<Graded initial={{ 0: 1 }} />);
    expect(screen.getByText(/答對了/)).toBeTruthy();
  });
});
