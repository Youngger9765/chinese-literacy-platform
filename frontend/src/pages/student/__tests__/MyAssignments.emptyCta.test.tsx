import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const navigateSpy = vi.fn();
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => navigateSpy,
}));
vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => ({ token: 't', user: { name: '丙' } }) }));
vi.mock('../../../services/assignmentApi', async (orig) => ({
  ...(await orig<typeof import('../../../services/assignmentApi')>()),
  getMyAssignments: vi.fn().mockResolvedValue([]),
  startAssignment: vi.fn(),
}));
vi.mock('../../../services/learningApi', async (orig) => ({
  ...(await orig<typeof import('../../../services/learningApi')>()),
  fetchMyEnrolledClassrooms: vi.fn().mockResolvedValue({ classrooms: [], total: 0 }),
}));

import MyAssignments from '../MyAssignments';

// 「目前沒有待完成的作業」 used to be a dead end; point to self-study instead.
describe('MyAssignments — empty pending list points to the library', () => {
  it('shows 去圖書館自己練習 and goes to /library', async () => {
    render(
      <MemoryRouter>
        <MyAssignments />
      </MemoryRouter>,
    );
    const cta = await screen.findByRole('button', { name: /去圖書館自己練習/ });
    await userEvent.click(cta);
    expect(navigateSpy).toHaveBeenCalledWith('/library');
  });
});
