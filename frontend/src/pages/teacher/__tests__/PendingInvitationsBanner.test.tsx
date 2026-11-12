/**
 * #3820: a pending co-teaching invitation grants no classroom access, so
 * this banner (GET /co-teaching/invitations) is the invitee's only way to
 * discover and act on it.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PendingInvitationsBanner from '../PendingInvitationsBanner';
import type { PendingInvitationResponse } from '../../../services/classroomApi';

const invitation: PendingInvitationResponse = {
  classroom_teacher_id: 42,
  classroom_id: 7,
  teacher_id: 99,
  classroom_name: '五年甲班',
  role: 'viewer',
  invited_by_name: '王老師',
  invited_at: '2026-11-01T00:00:00Z',
};

const { listMyPendingInvitationsMock, acceptCoTeacherInvitationMock, removeCoTeacherMock } = vi.hoisted(() => ({
  listMyPendingInvitationsMock: vi.fn(),
  acceptCoTeacherInvitationMock: vi.fn(),
  removeCoTeacherMock: vi.fn(),
}));

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: 'test-token', user: { id: 99 } }),
}));

vi.mock('../../../services/classroomApi', () => ({
  listMyPendingInvitations: listMyPendingInvitationsMock,
  acceptCoTeacherInvitation: acceptCoTeacherInvitationMock,
  removeCoTeacher: removeCoTeacherMock,
  ClassroomApiError: class ClassroomApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.name = 'ClassroomApiError';
      this.status = status;
    }
  },
}));

beforeEach(() => {
  listMyPendingInvitationsMock.mockReset();
  acceptCoTeacherInvitationMock.mockReset();
  removeCoTeacherMock.mockReset();
});

describe('PendingInvitationsBanner (#3820)', () => {
  it('renders nothing when there are no pending invitations', async () => {
    listMyPendingInvitationsMock.mockResolvedValue([]);
    const { container } = render(<PendingInvitationsBanner />);
    await waitFor(() => expect(listMyPendingInvitationsMock).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
  });

  it('shows who invited, as what role, into which classroom', async () => {
    listMyPendingInvitationsMock.mockResolvedValue([invitation]);
    render(<PendingInvitationsBanner />);
    expect(await screen.findByText('王老師')).toBeTruthy();
    expect(screen.getByText('只能看')).toBeTruthy();
    expect(screen.getByText('五年甲班')).toBeTruthy();
  });

  it('接受 calls acceptCoTeacherInvitation with classroom_id + the invitee user id', async () => {
    listMyPendingInvitationsMock.mockResolvedValueOnce([invitation]).mockResolvedValueOnce([]);
    acceptCoTeacherInvitationMock.mockResolvedValue({ ...invitation, status: 'accepted' });
    render(<PendingInvitationsBanner />);
    const acceptBtn = await screen.findByRole('button', { name: '接受' });
    await userEvent.click(acceptBtn);
    await waitFor(() => expect(acceptCoTeacherInvitationMock).toHaveBeenCalledWith('test-token', 7, 99));
  });

  it('拒絕 calls removeCoTeacher with classroom_id + the invitee user id', async () => {
    listMyPendingInvitationsMock.mockResolvedValueOnce([invitation]).mockResolvedValueOnce([]);
    removeCoTeacherMock.mockResolvedValue(undefined);
    render(<PendingInvitationsBanner />);
    const rejectBtn = await screen.findByRole('button', { name: '拒絕' });
    await userEvent.click(rejectBtn);
    await waitFor(() => expect(removeCoTeacherMock).toHaveBeenCalledWith('test-token', 7, 99));
  });
});
