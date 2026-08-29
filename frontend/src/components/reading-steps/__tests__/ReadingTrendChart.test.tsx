import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import ReadingTrendChart from '../key-passage-reading/ReadingTrendChart';
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

  it('超過上限時：標出總次數與 20 筆上限，並提供載入更多', () => {
    const history = Array.from({ length: 25 }, (_, i) =>
      makeItem(i + 1, 60 + i, 100 + i * 2, 25 - i),
    );
    render(<ReadingTrendChart history={history} />);
    // 元件把字切成多個節點（「顯示最近 {N} 次」＋超過上限時的補述），
    // 所以比對整段 textContent。斷言的是意圖：有告訴使用者「只畫最近 20 次、總共 25 次」。
    // 元件現在預設只畫最近 4 次，要按「載入更多」才展開，上限仍是 20（#2933）。
    // 舊斷言停在「給 25 筆就直接畫 20 筆」的行為，早就不成立了。
    const txt = document.body.textContent?.replace(/\s+/g, '') ?? '';
    expect(txt, '沒有告訴使用者總共幾次').toContain('共25次');
    expect(txt, '沒有標出 20 筆的上限').toContain('最多顯示20次');
    expect(screen.getByText(/載入更多/), '超過預設筆數時要能展開').toBeTruthy();
  });

  it('does NOT show "最近 20 次" label when within the cap', () => {
    const history = Array.from({ length: 5 }, (_, i) =>
      makeItem(i + 1, 70 + i, 130 + i, 5 - i),
    );
    render(<ReadingTrendChart history={history} />);
    expect(screen.queryByText('最近 20 次')).toBeNull();
  });
});
