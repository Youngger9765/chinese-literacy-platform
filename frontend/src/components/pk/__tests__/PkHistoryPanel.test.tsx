/**
 * PkHistoryPanel — #3747 "過去的戰績表現". Exercises the three states a
 * student can land on: no history yet, a real list (AI + human opponents,
 * win/loss/draw), and a silent failure (must render nothing, never block
 * the entry page).
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { PkHistoryEntry } from '../../../services/pkApi';

const getPkRatingMe = vi.fn();
const getPkHistory = vi.fn();

vi.mock('../../../services/pkApi', () => ({
  getPkRatingMe: (...args: unknown[]) => getPkRatingMe(...args),
  getPkHistory: (...args: unknown[]) => getPkHistory(...args),
}));

import PkHistoryPanel from '../PkHistoryPanel';

afterEach(() => {
  vi.clearAllMocks();
});

const baseMatch: PkHistoryEntry = {
  match_id: 1,
  status: 'completed',
  opponent_type: 'AI',
  bot_tier: 7,
  my_score: 4000,
  opponent_score: 3000,
  outcome: 'win',
  started_at: '2026-10-20T10:00:00Z',
  completed_at: '2026-10-20T10:05:00Z',
};

describe('PkHistoryPanel', () => {
  it('shows the empty-state message when there is no completed match', async () => {
    getPkRatingMe.mockResolvedValue({ rating: 1000, matches_played: 0, wins: 0, losses: 0, draws: 0 });
    getPkHistory.mockResolvedValue({ matches: [] });

    render(<PkHistoryPanel token="t" />);

    await waitFor(() => expect(screen.getByText('還沒有對戰紀錄，去挑戰第一場吧！')).toBeTruthy());
  });

  it('renders rating summary and recent matches, resolving the AI opponent name from bot_tier', async () => {
    getPkRatingMe.mockResolvedValue({ rating: 1024, matches_played: 2, wins: 1, losses: 1, draws: 0 });
    getPkHistory.mockResolvedValue({
      matches: [
        baseMatch,
        {
          ...baseMatch,
          match_id: 2,
          opponent_type: 'player',
          bot_tier: null,
          outcome: 'loss',
          my_score: 2000,
          opponent_score: 3000,
        },
      ],
    });

    render(<PkHistoryPanel token="t" />);

    await waitFor(() => expect(screen.getByTestId('pk-history-panel')).toBeTruthy());
    expect(screen.getByText('積分 1024')).toBeTruthy();
    // tier 7's name (李白) resolved from bot_tier, not a literal "AI" string.
    expect(screen.getByText('vs 李白')).toBeTruthy();
    expect(screen.getByText('vs 同學')).toBeTruthy();
    expect(screen.getByText('4000 : 3000')).toBeTruthy();
  });

  it('filters out non-completed matches (active/abandoned have no outcome yet)', async () => {
    getPkRatingMe.mockResolvedValue({ rating: 1000, matches_played: 1, wins: 0, losses: 0, draws: 0 });
    getPkHistory.mockResolvedValue({
      matches: [{ ...baseMatch, status: 'abandoned', outcome: null }],
    });

    render(<PkHistoryPanel token="t" />);

    await waitFor(() => expect(screen.getByText('還沒有對戰紀錄，去挑戰第一場吧！')).toBeTruthy());
  });

  it('renders nothing (not an error banner) when the fetch fails', async () => {
    getPkRatingMe.mockRejectedValue(new Error('network'));
    getPkHistory.mockResolvedValue({ matches: [] });

    const { container } = render(<PkHistoryPanel token="t" />);

    await waitFor(() => expect(container.firstChild).toBeNull());
  });
});
