/**
 * #3756 → #3761 (round 3): StudentPkEntry's banner went plain-text (#3747)
 * → single gradient card with one icon (#3756) → full `PkHeroBanner` with
 * all 7 PK_FIGURES lined up + icon-based "怎麼玩" steps (#3761, after Young
 * reviewed #3756's screenshots: "大半畫面空白，不像遊戲"). Dedicated
 * PkHeroBanner unit tests live in
 * `components/pk/__tests__/PkHeroBanner.test.tsx`; this file only checks
 * that StudentPkEntry actually renders it.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 1, name: '小明' }, token: 'fake-token' }),
}));

vi.mock('../../../services/pkApi', () => ({
  PkApiError: class PkApiError extends Error {},
  joinPkQueue: vi.fn(() => new Promise(() => {})),
  createPkInvite: vi.fn(() => new Promise(() => {})),
  getPkHistory: vi.fn(() => new Promise(() => {})),
  getPkRatingMe: vi.fn(() => new Promise(() => {})),
  getPkOpponents: vi.fn(() => new Promise(() => {})),
}));

vi.mock('../../../services/learning/session', () => ({
  fetchMyEnrolledClassrooms: vi.fn(() =>
    Promise.resolve({ total: 0, student_grade: 4, classrooms: [] }),
  ),
}));

import StudentPkEntry from '../StudentPkEntry';

describe('<StudentPkEntry> — 主視覺橫幅 (#3756/#3761)', () => {
  it('renders PkHeroBanner (title, 怎麼玩 label, and the 3 step texts)', async () => {
    render(
      <MemoryRouter initialEntries={['/pk']}>
        <Routes>
          <Route path="/pk" element={<StudentPkEntry />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText('怎麼玩？')).toBeTruthy());
    expect(screen.getByRole('heading', { name: 'PK 對戰' })).toBeTruthy();
    expect(screen.getByText(/5 題搶答/)).toBeTruthy();
    expect(screen.getByText(/打贏文學家可以解鎖他的人物卡/)).toBeTruthy();
  });

  it('lines up all 7 PK figures, starting with 李白 (tier 7, the one with real committed art)', async () => {
    render(
      <MemoryRouter initialEntries={['/pk']}>
        <Routes>
          <Route path="/pk" element={<StudentPkEntry />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByRole('heading', { name: 'PK 對戰' })).toBeTruthy());
    const libaiImg = document.querySelector('img[src="/story-assets/pk-li-bai/portrait-idle.png"]');
    expect(libaiImg).toBeTruthy();
    // #3761 round 4: PkFigureAvatar labels each banner figure with its real
    // name (not alt="") — a screen reader lineup of 7 unnamed images would
    // be useless, and nothing else near the banner names each figure.
    expect(libaiImg?.getAttribute('alt')).toBe('李白');
  });
});
