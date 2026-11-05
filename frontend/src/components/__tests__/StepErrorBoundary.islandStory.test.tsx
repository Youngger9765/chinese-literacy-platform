/**
 * 喝采島故事模式 — 學習頁壞掉時，「跳過此步驟」要變成「回到島上」且不算完成
 * （team-lead／Young 2026-10-26 明令）。
 *
 * 這個錯誤邊界包著 20011 全部 10 站的每一個學習頁（learningRoutes.tsx 的
 * StepRoute），任何一站在故事模式下壞掉，都不能讓學生被「跳過此步驟」帶去
 * 下一個 step——那正是 PRD §2「一次一關」要擋的同一種逃脫路徑，只是觸發條件
 * 換成「頁面壞掉」而不是「正常答完」。
 */
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const storyMode = { on: false };
const abort = vi.fn();
vi.mock('../../pages/lab/island/storyMode', () => ({
  isIslandStoryMode: () => storyMode.on,
  notifyIslandStepAborted: () => abort(),
}));

import StepErrorBoundary from '../StepErrorBoundary';

function Boom(): never {
  throw new Error('boom');
}

describe('StepErrorBoundary in island story mode', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    abort.mockClear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function renderCrashedAndExhaustRetries(onSkip?: () => void) {
    render(
      <StepErrorBoundary stepLabel="語詞複習" onSkip={onSkip}>
        <Boom />
      </StepErrorBoundary>,
    );
    // 3 auto-retries × 500ms, each re-throws immediately
    for (let i = 0; i < 3; i++) {
      await act(async () => { vi.advanceTimersByTime(500); });
    }
  }

  it('shows 回到島上 (not 跳過此步驟) and calls notifyIslandStepAborted, even with no onSkip prop (classical-only steps have none)', async () => {
    storyMode.on = true;
    await renderCrashedAndExhaustRetries(undefined);
    expect(screen.queryByRole('button', { name: '跳過此步驟' })).toBeNull();
    const backBtn = screen.getByRole('button', { name: '回到島上' });
    fireEvent.click(backBtn);
    expect(abort).toHaveBeenCalledTimes(1);
  });

  it('does not call the normal onSkip (which would navigate to another step) in story mode', async () => {
    storyMode.on = true;
    const onSkip = vi.fn();
    await renderCrashedAndExhaustRetries(onSkip);
    fireEvent.click(screen.getByRole('button', { name: '回到島上' }));
    expect(onSkip).not.toHaveBeenCalled();
  });

  it('positive control: outside the island, 跳過此步驟 still calls onSkip and navigates onward', async () => {
    storyMode.on = false;
    const onSkip = vi.fn();
    await renderCrashedAndExhaustRetries(onSkip);
    expect(screen.queryByRole('button', { name: '回到島上' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '跳過此步驟' }));
    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(abort).not.toHaveBeenCalled();
  });

  it('positive control: outside the island with no onSkip, no skip button at all (unchanged legacy behavior)', async () => {
    storyMode.on = false;
    await renderCrashedAndExhaustRetries(undefined);
    expect(screen.queryByRole('button', { name: '跳過此步驟' })).toBeNull();
    expect(screen.queryByRole('button', { name: '回到島上' })).toBeNull();
  });
});
