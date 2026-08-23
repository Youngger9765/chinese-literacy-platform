/**
 * QuizCompletionScreen.test.tsx — TDD lock for the shared completion-card wrapper
 * (issue #2834, Young 2026-08-21: "選擇題請統一用 vocab-application 的結束方式").
 *
 * Extracted from FillInBlankExercise's summary phase — the header card (icon +
 * "你完成了！"/"全部答對！" + subtitle) and the bottom CTA row (重做錯題 / 全部重做 /
 * 下一關, or the toolbox-mode swap) were IDENTICAL markup duplicated across
 * FillInBlankExercise.tsx and VocabDefinitionMatchSummary.tsx. This component is the
 * one source both FillInBlankExercise and ComprehensionMcqPage now render through —
 * see `quizCompletionScreenUsage.test.ts` for the "nobody hand-rolls a second copy" lock.
 *
 * Per-question rendering is deliberately NOT this component's job (see file header
 * comment) — callers pass their own breakdown as `children`.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import QuizCompletionScreen from '../QuizCompletionScreen';

// ToolboxCompletionActions (rendered when toolboxMode=true) calls useAuth() —
// stub it the same way ComprehensionMcqPage.test.tsx does, so this file doesn't
// need a real AuthProvider just to exercise the toolbox-mode CTA swap.
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: null, user: null }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

function setup(overrides: Partial<React.ComponentProps<typeof QuizCompletionScreen>> = {}) {
  const onRetryWrong = vi.fn();
  const onRetryAll = vi.fn();
  const onNext = vi.fn();
  const utils = render(
    <MemoryRouter>
      <QuizCompletionScreen
        allCorrect={false}
        wrongCount={1}
        onRetryWrong={onRetryWrong}
        onRetryAll={onRetryAll}
        onNext={onNext}
        {...overrides}
      >
        <div data-testid="per-question-breakdown">breakdown goes here</div>
      </QuizCompletionScreen>
    </MemoryRouter>,
  );
  return { ...utils, onRetryWrong, onRetryAll, onNext };
}

describe('QuizCompletionScreen', () => {
  it('allCorrect=false 顯示「你完成了！」與「以下是各題的作答結果」', () => {
    setup({ allCorrect: false });
    expect(screen.getByText('你完成了！')).toBeInTheDocument();
    expect(screen.getByText('以下是各題的作答結果')).toBeInTheDocument();
  });

  it('allCorrect=true 顯示「全部答對！」與「每一題都一次答對，表現優異！」', () => {
    setup({ allCorrect: true, wrongCount: 0 });
    expect(screen.getByText('全部答對！')).toBeInTheDocument();
    expect(screen.getByText('每一題都一次答對，表現優異！')).toBeInTheDocument();
  });

  it('render children（呼叫端自己的逐題清單）', () => {
    setup();
    expect(screen.getByTestId('per-question-breakdown')).toBeInTheDocument();
  });

  it('wrongCount > 0 時顯示「重做錯題（N 題）」，點擊呼叫 onRetryWrong', () => {
    const { onRetryWrong } = setup({ wrongCount: 3 });
    const btn = screen.getByRole('button', { name: '重做錯題（3 題）' });
    fireEvent.click(btn);
    expect(onRetryWrong).toHaveBeenCalledOnce();
  });

  it('wrongCount === 0 時不顯示「重做錯題」按鈕', () => {
    setup({ allCorrect: true, wrongCount: 0 });
    expect(screen.queryByText(/重做錯題/)).toBeNull();
  });

  it('一律顯示「全部重做」，點擊呼叫 onRetryAll', () => {
    const { onRetryAll } = setup();
    fireEvent.click(screen.getByRole('button', { name: '全部重做' }));
    expect(onRetryAll).toHaveBeenCalledOnce();
  });

  it('「下一關」呼叫 onNext（預設文字）', () => {
    const { onNext } = setup();
    fireEvent.click(screen.getByRole('button', { name: /下一關/ }));
    expect(onNext).toHaveBeenCalledOnce();
  });

  // 覆寫值不能是「下一關」——那正是預設值，不管 nextLabel 有沒有被讀取都會綠。
  it('nextLabel 可覆寫按鈕文字', () => {
    setup({ nextLabel: '跳過，下一關' });
    expect(screen.getByRole('button', { name: /跳過，下一關/ })).toBeInTheDocument();
  });

  it('toolboxMode=true 時換成「重做」／「回到練習工具箱」，不顯示錯題/全部重做/下一步三顆', () => {
    setup({ toolboxMode: true, wrongCount: 2 });
    expect(screen.getByRole('button', { name: '重做' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '回到練習工具箱' })).toBeInTheDocument();
    expect(screen.queryByText(/重做錯題/)).toBeNull();
    expect(screen.queryByText('全部重做')).toBeNull();
    expect(screen.queryByText(/下一關/)).toBeNull();
  });

  it('title/subtitle 可被覆寫（供尚未遷移的呼叫端沿用自己的措辭）', () => {
    setup({ title: '自訂標題', subtitle: '自訂副標' });
    expect(screen.getByText('自訂標題')).toBeInTheDocument();
    expect(screen.getByText('自訂副標')).toBeInTheDocument();
    expect(screen.queryByText('你完成了！')).toBeNull();
  });
});
