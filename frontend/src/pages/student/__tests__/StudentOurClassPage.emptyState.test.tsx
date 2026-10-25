/**
 * #3778 (game-academy audit r2, P2-3): the "no season yet" empty state
 * (老師還沒有開啟跨班賽季) was plain text — the only screen in the
 * game-academy round-3 visual pass that never got an illustration/banner,
 * inconsistent with PK/escape-room/live-quiz/team-arena's own empty/entry
 * states. Reuses the existing 跨班賽季 guide character art rather than
 * generating a new asset.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import StudentOurClassPage from '../StudentOurClassPage';

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: 'test-token', user: { id: 9, name: '小明' } }),
}));

vi.mock('../../../services/leagueApi', async (orig) => ({
  ...(await orig<typeof import('../../../services/leagueApi')>()),
  getMyLeagueHistory: vi.fn(() => Promise.resolve([])),
  getSeasonBoard: vi.fn(() => Promise.resolve(null)),
}));

describe('StudentOurClassPage empty state (#3778)', () => {
  it('shows the league guide illustration alongside the existing explanatory text', async () => {
    render(<StudentOurClassPage />);
    expect(await screen.findByText(/老師還沒有開啟跨班賽季/)).toBeTruthy();
    const img = document.querySelector('img[src="/story-assets/league-tang/guide-changan-greet.png"]');
    expect(img).toBeTruthy();
  });
});
