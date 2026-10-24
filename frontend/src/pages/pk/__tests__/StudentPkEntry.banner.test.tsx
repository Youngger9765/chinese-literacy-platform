/**
 * #3756: StudentPkEntry's "怎麼玩" card upgraded from a plain text block
 * (#3747) into a hero banner using 李白's existing icon.png. Locks: the
 * banner still shows the same explanation bullets, and now also renders a
 * decorative (aria-hidden) image anchored to 李白's already-committed art
 * asset — not a new file this PR adds, and not `pkFigures.ts`.
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
}));

vi.mock('../../../services/learning/session', () => ({
  fetchMyEnrolledClassrooms: vi.fn(() =>
    Promise.resolve({ total: 0, student_grade: 4, classrooms: [] }),
  ),
}));

import StudentPkEntry from '../StudentPkEntry';

describe('<StudentPkEntry> — 主視覺橫幅 (#3756)', () => {
  it('shows the 怎麼玩 banner with its explanation bullets and a decorative 李白 icon', async () => {
    render(
      <MemoryRouter initialEntries={['/pk']}>
        <Routes>
          <Route path="/pk" element={<StudentPkEntry />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText('怎麼玩？')).toBeTruthy());
    expect(screen.getByText(/5 題搶答/)).toBeTruthy();
    expect(screen.getByText(/打贏文學家可以解鎖他的人物卡/)).toBeTruthy();

    const banner = screen.getByText('怎麼玩？').closest('div')?.parentElement;
    const icon = banner?.querySelector('img[src="/story-assets/pk-li-bai/icon.png"]');
    expect(icon).toBeTruthy();
    expect(icon?.getAttribute('alt')).toBe('');
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
  });
});
