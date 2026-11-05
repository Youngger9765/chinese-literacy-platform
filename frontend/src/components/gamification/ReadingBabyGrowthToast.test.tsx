import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import ReadingBabyGrowthToast from './ReadingBabyGrowthToast';
import type { ReadingBabyGrowthMessagePayload } from '../../pages/lab/island/storyMode';

/**
 * ReadingBabyGrowthToast — 閱讀寶貝的「寶貝長大了」當頁提示（#3780
 * reading-babies PRD §5「當頁成長提示」，取代 v1 WordBabyRewardToast）。
 * 同一個位置、同一套模式照抄 BadgeUnlockToast/WordBabyRewardToast：渲染在
 * LearningLayout 層級，不管學生當下在哪一步都看得到。
 */
describe('ReadingBabyGrowthToast', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('renders nothing when there are no growth events', () => {
    const { container } = render(<ReadingBabyGrowthToast events={[]} onDismiss={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when every event is quality_passed=false (no hint text)', () => {
    const events: ReadingBabyGrowthMessagePayload[] = [
      { station: 'report', ability_id: 'x', quality_passed: false },
    ];
    const { container } = render(<ReadingBabyGrowthToast events={events} onDismiss={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the 寶貝長大了 hint when a passed event is present', () => {
    const events: ReadingBabyGrowthMessagePayload[] = [
      { station: 'spotlight', ability_id: '5-Ⅱ-5', quality_passed: true },
    ];
    render(<ReadingBabyGrowthToast events={events} onDismiss={() => {}} />);
    expect(screen.getByText('寶貝長大了一點！')).toBeInTheDocument();
  });

  it('does not use upgrade/feed/claim wording anywhere in the rendered text', () => {
    const events: ReadingBabyGrowthMessagePayload[] = [
      { station: 'spotlight', ability_id: '5-Ⅱ-5', quality_passed: true },
    ];
    render(<ReadingBabyGrowthToast events={events} onDismiss={() => {}} />);
    const text = screen.getByTestId('reading-baby-growth-toast').textContent ?? '';
    expect(text).not.toMatch(/升級|餵食|領取/);
  });

  it('calls onDismiss when the dismiss button is clicked', () => {
    const onDismiss = vi.fn();
    const events: ReadingBabyGrowthMessagePayload[] = [
      { station: 'spotlight', ability_id: '5-Ⅱ-5', quality_passed: true },
    ];
    render(<ReadingBabyGrowthToast events={events} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('auto-dismisses after 5s', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    const events: ReadingBabyGrowthMessagePayload[] = [
      { station: 'spotlight', ability_id: '5-Ⅱ-5', quality_passed: true },
    ];
    render(<ReadingBabyGrowthToast events={events} onDismiss={onDismiss} />);
    act(() => { vi.advanceTimersByTime(5000); });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
