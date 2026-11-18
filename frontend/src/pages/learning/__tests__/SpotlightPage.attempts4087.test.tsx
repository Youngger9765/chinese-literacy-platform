/**
 * #4087 — 閱讀聚光燈的作答紀錄（成績單折線圖）。
 *
 * - 做完那一次：在收到 allDone 的作答狀態時記，含最後一題的對錯（以前在渲染器的
 *   onComplete 當下記，最後一題的對錯還沒傳過來，實測記成 5/8）
 * - 做完之後再確認 = 訂正，不是新的一輪
 * - 錯題全部改對的當下記一筆 retry-wrong；改答案時那一題先回到「待確認」，那一下不算
 *   （實測多記了一筆 8/9）
 * - 從 DB 還原成已完成，不記
 */
import { act, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let emit: (state: Record<string, unknown>) => void = () => {};
vi.mock('../../../components/reading-spotlight/BlockSequenceRenderer', () => ({
  default: (props: { onChange?: (s: Record<string, unknown>) => void }) => {
    emit = (s) => props.onChange?.(s);
    return <div data-testid="renderer" />;
  },
}));
vi.mock('../../../config/featureFlags', () => ({ LESSON_RENDERER_V1: false }));

const saveStepProgressPatch = vi.fn();
let stepData: Record<string, unknown> = {};
vi.mock('../../../layouts/LearningLayout', () => ({
  useLearningContext: () => ({
    selectedStory: { id: '20013', title: 't', content: [], spotlightV2: { blocks: [{ type: 'single' }] } },
    handleFinishReadingStrategy: vi.fn(),
    dbSessionId: 1,
    saveStepProgressPatch,
    stepProgressData: { current_step: null, steps_completed: [], step_data: stepData },
  }),
}));

import SpotlightPage from '../SpotlightPage';

const attempts = () =>
  saveStepProgressPatch.mock.calls
    .map((c) => (c[0] as { appendAttempt?: { kind: string; correct: number; total: number } }).appendAttempt)
    .filter(Boolean) as { kind: string; correct: number; total: number }[];

const log = {
  a: { order: 0, label: '第一題', firstAnswer: '錯', latestAnswer: '錯', correctAnswer: '對' },
  b: { order: 1, label: '第二題', firstAnswer: 'B', latestAnswer: 'B', correctAnswer: 'B' },
};
const state = (feedback: Record<string, boolean | null>, allDone: boolean) => ({
  blockState: {}, feedback, textGrades: {}, allDone, answerLog: log, renderer: 'spotlight_v2',
});

const renderPage = () =>
  render(
    <MemoryRouter>
      <SpotlightPage />
    </MemoryRouter>,
  );

beforeEach(() => {
  saveStepProgressPatch.mockReset();
  stepData = {};
});

describe('SpotlightPage attempts (#4087)', () => {
  it('records the finished run including the last question, then one correction when all are fixed', () => {
    renderPage();
    act(() => emit(state({ a: false }, false)));
    act(() => emit(state({ a: false, b: true }, true))); // 做完（含最後一題）
    expect(attempts()).toEqual([expect.objectContaining({ kind: 'first', correct: 1, total: 2 })]);

    act(() => emit(state({ a: null, b: true }, true))); // 選了新答案，還沒確認
    expect(attempts()).toHaveLength(1);

    act(() => emit(state({ a: true, b: true }, true))); // 改對了
    expect(attempts().map((x) => x.kind)).toEqual(['first', 'retry-wrong']);
    expect(attempts()[1]).toMatchObject({ correct: 2, total: 2 });
  });

  it('a spotlight restored as done is not a new run; fixing it is a correction', () => {
    stepData = { spotlight: { allDone: true, feedback: { a: false, b: true }, firstFeedback: { a: false, b: true } } };
    renderPage();
    act(() => emit(state({ a: false, b: true }, true)));
    expect(attempts()).toHaveLength(0);
    act(() => emit(state({ a: true, b: true }, true)));
    expect(attempts()).toEqual([expect.objectContaining({ kind: 'retry-wrong', correct: 2 })]);
  });

  it('a partial correction is recorded when the student leaves the page', () => {
    const { unmount } = renderPage();
    act(() => emit(state({ a: false, b: false }, true)));
    act(() => emit(state({ a: true, b: false }, true)));
    expect(attempts()).toHaveLength(1);
    unmount();
    expect(attempts().map((x) => x.kind)).toEqual(['first', 'retry-wrong']);
    expect(attempts()[1].correct).toBe(1);
  });
});
