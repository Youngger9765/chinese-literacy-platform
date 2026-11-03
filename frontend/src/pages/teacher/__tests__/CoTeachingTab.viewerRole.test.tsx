/**
 * #3820: co-teacher viewer role + invite accept/reject.
 * - Invite form lets the owner pick editor/viewer.
 * - A pending invite shows a "待確認" badge.
 * - The owner gets a role <select> per non-primary row; a non-owner sees a
 *   plain role badge instead (can't change others' roles).
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import CoTeachingTab from '../CoTeachingTab';
import type { ClassroomTeacherResponse } from '../../../services/classroomApi';

const owner: ClassroomTeacherResponse = {
  id: 1,
  classroom_id: 1,
  teacher_id: 1,
  teacher_name: '王老師',
  teacher_email: 'owner@test.com',
  role: 'primary',
  status: 'accepted',
  invited_at: '2026-01-01T00:00:00Z',
  accepted_at: '2026-01-01T00:00:00Z',
};

const pendingViewer: ClassroomTeacherResponse = {
  id: 2,
  classroom_id: 1,
  teacher_id: 2,
  teacher_name: '陳老師',
  teacher_email: 'viewer@test.com',
  role: 'viewer',
  status: 'pending',
  invited_at: '2026-02-01T00:00:00Z',
  accepted_at: null,
};

let mockTeachers: ClassroomTeacherResponse[] = [];

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: 'test-token', user: { id: 1 } }),
}));

vi.mock('../../../services/classroomApi', () => ({
  listClassroomTeachers: vi.fn(() => Promise.resolve(mockTeachers)),
  inviteCoTeacher: vi.fn(),
  updateCoTeacherRole: vi.fn(),
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

describe('CoTeachingTab — viewer role + invitation status (#3820)', () => {
  it('invite form has an editor/viewer role select', async () => {
    mockTeachers = [owner];
    render(<CoTeachingTab classroomId={1} ownerId={1} />);
    const roleSelect = await screen.findByLabelText('協同教師角色');
    expect(roleSelect).toBeTruthy();
    expect(screen.getByRole('option', { name: '可編輯' })).toBeTruthy();
    expect(screen.getByRole('option', { name: '只能看' })).toBeTruthy();
  });

  it('shows a 待確認 badge for a pending co-teacher', async () => {
    mockTeachers = [owner, pendingViewer];
    render(<CoTeachingTab classroomId={1} ownerId={1} />);
    expect(await screen.findByText('待確認')).toBeTruthy();
  });

  it("owner sees a per-row role <select> for a non-primary teacher (not just a badge)", async () => {
    mockTeachers = [owner, pendingViewer];
    render(<CoTeachingTab classroomId={1} ownerId={1} />);
    const roleSelect = await screen.findByLabelText('陳老師 的角色');
    expect(roleSelect).toBeTruthy();
    expect((roleSelect as HTMLSelectElement).value).toBe('viewer');
  });

  it('owner sees 撤回 (not 移除) for a still-pending invite', async () => {
    mockTeachers = [owner, pendingViewer];
    render(<CoTeachingTab classroomId={1} ownerId={1} />);
    expect(await screen.findByRole('button', { name: '撤回' })).toBeTruthy();
  });
});
