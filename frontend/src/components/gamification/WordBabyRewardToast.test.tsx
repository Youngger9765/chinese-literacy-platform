/**
 * TDD — PRD §5（docs/prd/2026-10-30-island-v2-rpg-pets-story-prd.md）
 * 「即時回饋：學習活動做完的當下，就在學習頁跳出碎片／寶貝提示」。
 *
 * 跟 BadgeUnlockToast（#3024）同一個位置、同一套模式（渲染在 LearningLayout
 * 層級，不管學生在哪一步都看得到）——這支鎖「有沒有正確顯示 reward 文案、
 * 會不會自動消失、空陣列時不渲染」，文案本身的優先序規則（遇到新寶貝 >
 * 碎片）已經在 `wordBabyRewardHint.test.ts` 鎖過，這裡不重複測。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import WordBabyRewardToast from './WordBabyRewardToast';
import type { WordBabyRewardMessagePayload } from '../../pages/lab/island/storyMode';

const fragmentReward: WordBabyRewardMessagePayload = {
  id: 1,
  station: 'vocab-definition',
  fragment_awarded: true,
  fragment_flavor: '語文基礎',
  encounter_result: 'none',
  encounter_baby_id: null,
};

const encounterReward: WordBabyRewardMessagePayload = {
  id: 2,
  station: 'reading-comprehension',
  fragment_awarded: true,
  fragment_flavor: '語文基礎',
  encounter_result: 'caught',
  encounter_baby_id: 'unknown-baby-id-not-in-catalog',
};

describe('WordBabyRewardToast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders nothing when rewards is empty', () => {
    render(<WordBabyRewardToast rewards={[]} onDismiss={vi.fn()} />);
    expect(screen.queryByTestId('word-baby-reward-toast')).toBeNull();
  });

  it('shows the fragment hint text for a fragment reward', () => {
    render(<WordBabyRewardToast rewards={[fragmentReward]} onDismiss={vi.fn()} />);
    const toast = screen.getByTestId('word-baby-reward-toast');
    expect(toast.textContent).toContain('語文基礎');
  });

  it('shows the encounter hint when a baby is caught', () => {
    render(<WordBabyRewardToast rewards={[encounterReward]} onDismiss={vi.fn()} />);
    const toast = screen.getByTestId('word-baby-reward-toast');
    expect(toast.textContent).toContain('遇到了新朋友');
  });

  it('calls onDismiss when the dismiss button is clicked', () => {
    const onDismiss = vi.fn();
    render(<WordBabyRewardToast rewards={[fragmentReward]} onDismiss={onDismiss} />);
    screen.getByRole('button', { name: /好的/ }).click();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('auto-dismisses after a delay', () => {
    const onDismiss = vi.fn();
    render(<WordBabyRewardToast rewards={[fragmentReward]} onDismiss={onDismiss} />);
    expect(onDismiss).not.toHaveBeenCalled();

    act(() => { vi.advanceTimersByTime(6000); });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('uses aria-live="polite" — never interrupts what the student is doing', () => {
    render(<WordBabyRewardToast rewards={[fragmentReward]} onDismiss={vi.fn()} />);
    const toast = screen.getByTestId('word-baby-reward-toast');
    expect(toast.getAttribute('aria-live')).toBe('polite');
  });

  it('不會因為全部獎勵都沒有文案（理論上不該發生）就拋錯，而是不渲染', () => {
    const noHintReward: WordBabyRewardMessagePayload = {
      id: 3, station: 'x', fragment_awarded: false, fragment_flavor: null, encounter_result: 'none', encounter_baby_id: null,
    };
    render(<WordBabyRewardToast rewards={[noHintReward]} onDismiss={vi.fn()} />);
    expect(screen.queryByTestId('word-baby-reward-toast')).toBeNull();
  });
});
