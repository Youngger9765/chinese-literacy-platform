/**
 * PkHistoryPanel — #3747 "過去的戰績表現" + #3761 "N/7 位文學家已擊敗"
 * roster (round 3) + clickable avatar-card grid (round 4). Exercises the
 * states a student can land on: no history yet (with and without the
 * roster), a real list (AI + human opponents, win/loss/draw), clicking a
 * roster card, and a silent failure (must render nothing, never block the
 * entry page).
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import type { PkHistoryEntry, PkOpponent } from '../../../services/pkApi';

const getPkRatingMe = vi.fn();
const getPkHistory = vi.fn();
const getPkOpponents = vi.fn();

vi.mock('../../../services/pkApi', () => ({
  getPkRatingMe: (...args: unknown[]) => getPkRatingMe(...args),
  getPkHistory: (...args: unknown[]) => getPkHistory(...args),
  getPkOpponents: (...args: unknown[]) => getPkOpponents(...args),
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

function opponent(tier: number, unlocked: boolean): PkOpponent {
  return {
    tier,
    slug: `figure-${tier}`,
    name: `文學家${tier}`,
    speed_label: '',
    icon_url: `/story-assets/pk-figure-${tier}/icon.png`,
    portrait_url: `/story-assets/pk-figure-${tier}/portrait-idle.png`,
    recommended: false,
    unlocked,
    previously_played: false,
  };
}

const SEVEN_LOCKED: PkOpponent[] = Array.from({ length: 7 }, (_, i) => opponent(i + 1, false));

function renderPanel(onChallenge: () => void = () => {}) {
  return render(<PkHistoryPanel token="t" onChallenge={onChallenge} />);
}

describe('PkHistoryPanel', () => {
  it('shows the empty-state message AND the 0/7 defeat roster when there is no completed match', async () => {
    getPkRatingMe.mockResolvedValue({ rating: 1000, matches_played: 0, wins: 0, losses: 0, draws: 0 });
    getPkHistory.mockResolvedValue({ matches: [] });
    getPkOpponents.mockResolvedValue({ opponents: SEVEN_LOCKED });

    renderPanel();

    await waitFor(() => expect(screen.getByText('還沒有對戰紀錄，去挑戰第一場吧！')).toBeTruthy());
    expect(screen.getByText('0/7 位文學家已擊敗')).toBeTruthy();
    const roster = screen.getByTestId('pk-defeat-roster');
    // All 7 are locked -> all 7 thumbs carry the grayscale class, each a
    // clickable card showing the figure's name as a caption.
    const imgs = roster.querySelectorAll('img');
    expect(imgs.length).toBe(7);
    imgs.forEach((img) => expect(img.className).toContain('grayscale'));
    expect(roster.querySelectorAll('button').length).toBe(7);
    expect(screen.getByText('文學家1')).toBeTruthy();
  });

  it('unlocked figures in the roster are NOT grayscaled, locked ones are', async () => {
    getPkRatingMe.mockResolvedValue({ rating: 1000, matches_played: 1, wins: 1, losses: 0, draws: 0 });
    getPkHistory.mockResolvedValue({ matches: [baseMatch] });
    const mixed = [opponent(1, true), opponent(2, false)];
    getPkOpponents.mockResolvedValue({ opponents: mixed });

    renderPanel();

    await waitFor(() => expect(screen.getByText('1/2 位文學家已擊敗')).toBeTruthy());
    const roster = screen.getByTestId('pk-defeat-roster');
    const imgs = Array.from(roster.querySelectorAll('img'));
    expect(imgs[0].className).not.toContain('grayscale');
    expect(imgs[1].className).toContain('grayscale');
  });

  it('#3761 round 4: clicking a roster card (locked OR unlocked) calls onChallenge', async () => {
    getPkRatingMe.mockResolvedValue({ rating: 1000, matches_played: 0, wins: 0, losses: 0, draws: 0 });
    getPkHistory.mockResolvedValue({ matches: [] });
    getPkOpponents.mockResolvedValue({ opponents: [opponent(1, true), opponent(2, false)] });
    const onChallenge = vi.fn();

    renderPanel(onChallenge);

    await waitFor(() => expect(screen.getByTestId('pk-defeat-roster')).toBeTruthy());
    const cards = screen.getByTestId('pk-defeat-roster').querySelectorAll('button');
    fireEvent.click(cards[1]);
    expect(onChallenge).toHaveBeenCalledTimes(1);
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
    getPkOpponents.mockResolvedValue({ opponents: [] });

    renderPanel();

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
    getPkOpponents.mockResolvedValue({ opponents: [] });

    renderPanel();

    await waitFor(() => expect(screen.getByText('還沒有對戰紀錄，去挑戰第一場吧！')).toBeTruthy());
  });

  it('renders nothing (not an error banner) only when ALL THREE calls fail — not just one', async () => {
    getPkRatingMe.mockRejectedValue(new Error('network'));
    getPkHistory.mockRejectedValue(new Error('network'));
    getPkOpponents.mockRejectedValue(new Error('network'));

    const { container } = renderPanel();

    await waitFor(() => expect(container.firstChild).toBeNull());
  });

  it('#3766 (Young, staging repro — "0/7 頭像牆與戰績區完全沒出現" for a classroom-enrolled student): a SINGLE failing call must not blank a roster that other, independent calls already fetched successfully', async () => {
    // getPkRatingMe fails (simulating whatever actually failed on staging
    // for that account — never reproducible locally, see #3766), but
    // getPkOpponents succeeds. Promise.all previously made ANY rejection
    // blank the whole panel, including this already-fetched roster data
    // that has nothing to do with rating/history.
    getPkRatingMe.mockRejectedValue(new Error('network'));
    getPkHistory.mockResolvedValue({ matches: [] });
    getPkOpponents.mockResolvedValue({ opponents: SEVEN_LOCKED });

    const { container } = renderPanel();

    await waitFor(() => expect(container.firstChild).not.toBeNull());
    expect(screen.getByText('0/7 位文學家已擊敗')).toBeTruthy();
    const roster = screen.getByTestId('pk-defeat-roster');
    expect(roster.querySelectorAll('img').length).toBe(7);
  });

  it('#3766: the same independence holds when getPkHistory (not rating) is the one that fails', async () => {
    getPkRatingMe.mockResolvedValue({ rating: 1000, matches_played: 0, wins: 0, losses: 0, draws: 0 });
    getPkHistory.mockRejectedValue(new Error('network'));
    getPkOpponents.mockResolvedValue({ opponents: SEVEN_LOCKED });

    renderPanel();

    await waitFor(() => expect(screen.getByText('0/7 位文學家已擊敗')).toBeTruthy());
  });

  it('#3766: if getPkOpponents itself fails but rating/history succeed, the roster is simply absent (no data for it) without blanking the rating/history section', async () => {
    getPkRatingMe.mockResolvedValue({ rating: 1000, matches_played: 0, wins: 0, losses: 0, draws: 0 });
    getPkHistory.mockResolvedValue({ matches: [] });
    getPkOpponents.mockRejectedValue(new Error('network'));

    const { container } = renderPanel();

    await waitFor(() => expect(screen.getByText('還沒有對戰紀錄，去挑戰第一場吧！')).toBeTruthy());
    expect(container.querySelector('[data-testid="pk-defeat-roster"]')).toBeNull();
  });
});
