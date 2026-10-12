/**
 * #3424: at 390 width the 邀請 submit button had no `shrink-0`, so it shrank
 * along with the `flex-1` email input and its label wrapped into a vertical
 * "邀／請" that overflowed the card edge.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import CoTeachingTab from '../CoTeachingTab';

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: 'test-token', user: { id: 1 } }),
}));

vi.mock('../../../services/classroomApi', () => ({
  listClassroomTeachers: vi.fn(() => Promise.resolve([])),
  inviteCoTeacher: vi.fn(),
  removeCoTeacher: vi.fn(),
  ClassroomApiError: class ClassroomApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.name = 'ClassroomApiError';
      this.status = status;
    }
  },
}));

describe('CoTeachingTab — invite button does not shrink (#3424)', () => {
  it('邀請 button has shrink-0 + whitespace-nowrap so it never wraps mid-word', async () => {
    render(<CoTeachingTab classroomId={1} ownerId={1} />);
    const inviteBtn = await screen.findByRole('button', { name: '邀請' });
    expect(inviteBtn.className).toMatch(/\bshrink-0\b/);
    expect(inviteBtn.className).toMatch(/\bwhitespace-nowrap\b/);
  });
});
