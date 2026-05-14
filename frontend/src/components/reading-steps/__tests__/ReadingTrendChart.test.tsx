import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import ReadingTrendChart from '../full-reading/ReadingTrendChart';
import type { ReadingHistoryItem } from '../../../services/readingHistoryApi';

global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const makeItem = (id: number, accuracy: number, cpm: number, daysAgo: number): ReadingHistoryItem => ({
  id,
  student_id: 1,
  lesson_id: '1109',
  paragraph_index: null,
  reading_type: 'full',
  cpm,
  accuracy,
  duration_seconds: 60,
  created_at: new Date(Date.now() - daysAgo * 86400_000).toISOString(),
});

describe('ReadingTrendChart', () => {
  it('shows encouragement when fewer than 2 attempts', () => {
    render(<ReadingTrendChart history={[makeItem(1, 80, 150, 0)]} />);
    expect(screen.getByText(/再多練幾次/)).toBeTruthy();
  });

  it('shows encouragement when history is empty', () => {
    render(<ReadingTrendChart history={[]} />);
    expect(screen.getByText(/再多練幾次/)).toBeTruthy();
  });

  it('renders chart with at least 2 attempts', () => {
    const history = [makeItem(1, 70, 140, 5), makeItem(2, 80, 150, 0)];
    render(<ReadingTrendChart history={history} />);
    expect(screen.getByText('進步趨勢')).toBeTruthy();
    expect(screen.queryByText(/再多練幾次/)).toBeNull();
  });

  it('caps at 20 points and shows "最近 20 次" label when exceeded', () => {
    const history = Array.from({ length: 25 }, (_, i) =>
      makeItem(i + 1, 60 + i, 100 + i * 2, 25 - i),
    );
    render(<ReadingTrendChart history={history} />);
    expect(screen.getByText('最近 20 次')).toBeTruthy();
  });

  it('does NOT show "最近 20 次" label when within the cap', () => {
    const history = Array.from({ length: 5 }, (_, i) =>
      makeItem(i + 1, 70 + i, 130 + i, 5 - i),
    );
    render(<ReadingTrendChart history={history} />);
    expect(screen.queryByText('最近 20 次')).toBeNull();
  });
});
