import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import FluencyProgressChart, { type FullReadingAttempt } from '../full-reading/FluencyProgressChart';
import type { ParsedBenchmark } from '../../../utils/fluencyAnalyzer';

// Recharts uses ResizeObserver internally — stub it for test env
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const makeAttempt = (idx: number, cpm: number, durationMs?: number): FullReadingAttempt => ({
  attempt_index: idx,
  cpm,
  accuracy: 0.9,
  duration_ms: durationMs ?? (cpm > 0 ? Math.round((200 / cpm) * 60000) : 60000),
  transcript: '',
  timestamp: new Date().toISOString(),
});

const cpmBenchmark: ParsedBenchmark[] = [
  { minCpm: 0, maxCpm: 180, feedback: '需要練習' },
  { minCpm: 181, maxCpm: 220, feedback: '不錯' },
  { minCpm: 221, maxCpm: Infinity, feedback: '優秀' },
];

const secBenchmark: ParsedBenchmark[] = [
  { unit: 'sec', minSec: 0, maxSec: 30, feedback: '非常快' },
  { unit: 'sec', minSec: 31, maxSec: 50, feedback: '適中' },
  { unit: 'sec', minSec: 51, maxSec: Infinity, feedback: '再練習' },
];

describe('FluencyProgressChart', () => {
  it('renders nothing when attempts is empty', () => {
    const { container } = render(
      <FluencyProgressChart attempts={[]} benchmark={null} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders with 1 attempt, no benchmark', () => {
    const attempts = [makeAttempt(1, 180)];
    render(
      <FluencyProgressChart attempts={attempts} benchmark={null} />
    );
    expect(screen.getByText('練習進步曲線')).toBeTruthy();
    expect(screen.getByText(/已完成 1\/4 次/)).toBeTruthy();
  });

  it('renders with 2 attempts showing trend label', () => {
    const attempts = [makeAttempt(1, 160), makeAttempt(2, 200)];
    render(
      <FluencyProgressChart attempts={attempts} benchmark={null} unit="cpm" />
    );
    expect(screen.getByText('進步中')).toBeTruthy();
  });

  it('renders with 4 attempts and CPM benchmark', () => {
    const attempts = [
      makeAttempt(1, 170),
      makeAttempt(2, 185),
      makeAttempt(3, 200),
      makeAttempt(4, 215),
    ];
    render(
      <FluencyProgressChart attempts={attempts} benchmark={cpmBenchmark} unit="cpm" />
    );
    expect(screen.getByText('練習進步曲線')).toBeTruthy();
    expect(screen.getByText(/已完成 4\/4 次/)).toBeTruthy();
    expect(screen.getByText(/字\/分越高越好/)).toBeTruthy();
  });

  it('renders with 2 attempts and sec benchmark (G8 文言文)', () => {
    const attempts = [
      makeAttempt(1, 0, 55000), // 55 sec
      makeAttempt(2, 0, 42000), // 42 sec — improving (fewer sec)
    ];
    render(
      <FluencyProgressChart attempts={attempts} benchmark={secBenchmark} unit="sec" />
    );
    expect(screen.getByText('秒數越少越好 · 已完成 2/4 次')).toBeTruthy();
    expect(screen.getByText('進步中')).toBeTruthy();
  });

  it('shows flat trend when values are similar', () => {
    const attempts = [makeAttempt(1, 200), makeAttempt(2, 202)];
    render(
      <FluencyProgressChart attempts={attempts} benchmark={null} unit="cpm" />
    );
    expect(screen.getByText('持平')).toBeTruthy();
  });

  it('shows downward trend when CPM decreases', () => {
    const attempts = [makeAttempt(1, 220), makeAttempt(2, 190)];
    render(
      <FluencyProgressChart attempts={attempts} benchmark={null} unit="cpm" />
    );
    expect(screen.getByText('速度下降')).toBeTruthy();
  });

  it('renders 4-cell progress grid with correct filled count for 2 attempts', () => {
    const attempts = [makeAttempt(1, 180), makeAttempt(2, 190)];
    const { container } = render(
      <FluencyProgressChart attempts={attempts} benchmark={null} unit="cpm" />
    );
    // Should render 4 grid cells (progress bar)
    const progressBars = container.querySelectorAll('.bg-accent, .bg-surface-container-high');
    expect(progressBars.length).toBe(4);
  });
});
