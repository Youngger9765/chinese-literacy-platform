/**
 * EscapeRoomHistoryPanel — #3756 "我的挑戰紀錄". Same three states as its
 * sibling PkHistoryPanel.test.tsx exercises: no history yet, a real list
 * (escaped / not_this_time, with duration), and a silent fetch failure
 * (must render nothing, never block the entry page).
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { EscapeRoomHistoryEntry } from '../../../services/escapeRoomApi';

const getEscapeRoomHistory = vi.fn();

vi.mock('../../../services/escapeRoomApi', () => ({
  getEscapeRoomHistory: (...args: unknown[]) => getEscapeRoomHistory(...args),
}));

import EscapeRoomHistoryPanel from '../EscapeRoomHistoryPanel';

afterEach(() => {
  vi.clearAllMocks();
});

const baseRun: EscapeRoomHistoryEntry = {
  run_id: 1,
  scope_type: 'grade_pool',
  scope_ref: '4',
  result: 'escaped',
  started_at: '2026-10-20T10:00:00Z',
  completed_at: '2026-10-20T10:08:20Z',
  duration_seconds: 500,
};

describe('EscapeRoomHistoryPanel', () => {
  it('shows the empty-state message when there is no run yet', async () => {
    getEscapeRoomHistory.mockResolvedValue({ runs: [] });

    render(<EscapeRoomHistoryPanel token="t" />);

    await waitFor(() => expect(screen.getByText('還沒有挑戰紀錄，去探索第一次吧！')).toBeTruthy());
  });

  it('renders the escaped count and recent runs with their duration', async () => {
    getEscapeRoomHistory.mockResolvedValue({
      runs: [
        baseRun,
        { ...baseRun, run_id: 2, result: 'not_this_time', completed_at: '2026-10-21T09:00:00Z', duration_seconds: 600 },
      ],
    });

    render(<EscapeRoomHistoryPanel token="t" />);

    await waitFor(() => expect(screen.getByTestId('escape-room-history-panel')).toBeTruthy());
    expect(screen.getByText('共逃出 1 次')).toBeTruthy();
    expect(screen.getByText('逃出')).toBeTruthy();
    expect(screen.getByText('沒逃出')).toBeTruthy();
    expect(screen.getByText('用時 8 分 20 秒')).toBeTruthy();
    expect(screen.getByText('用時 10 分 0 秒')).toBeTruthy();
  });

  it('an in-progress run (no duration yet) does not show a 用時 line', async () => {
    getEscapeRoomHistory.mockResolvedValue({
      runs: [{ ...baseRun, result: 'in_progress', completed_at: null, duration_seconds: null }],
    });

    render(<EscapeRoomHistoryPanel token="t" />);

    await waitFor(() => expect(screen.getByText('進行中')).toBeTruthy());
    expect(screen.queryByText(/用時/)).toBeNull();
  });

  it('renders nothing (not an error banner) when the fetch fails', async () => {
    getEscapeRoomHistory.mockRejectedValue(new Error('network'));

    const { container } = render(<EscapeRoomHistoryPanel token="t" />);

    await waitFor(() => expect(container.firstChild).toBeNull());
  });
});
