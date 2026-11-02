/**
 * #3818 AC5: only the account's password teacher (the teacher who created
 * it, or a system_admin -- surfaced by can_reset_password from the backend)
 * sees the "重設密碼" button. Everyone else sees a self-serve hint instead,
 * never the button.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import StudentListTab from '../StudentListTab';
import type { ClassroomDetailResponse } from '../../../services/classroomApi';

vi.mock('../../../services/classroomApi', async () => {
  const actual = await vi.importActual<typeof import('../../../services/classroomApi')>(
    '../../../services/classroomApi',
  );
  return { ...actual, resetStudentPassword: vi.fn() };
});
vi.mock('../../../services/parentApi', () => ({ generateParentInviteCode: vi.fn() }));
vi.mock('../CsvUploadModal', () => ({ default: () => null }));
vi.mock('../../../config/featureFlags', () => ({ PARENT_PORTAL_ENABLED: false }));

const classroom: ClassroomDetailResponse = {
  id: 1,
  name: '測試班',
  school_id: 1,
  teacher_id: 1,
  grade: 4,
  is_active: true,
  created_at: '2026-10-12T00:00:00Z',
  student_count: 2,
  students: [
    {
      id: 11,
      name: '密碼教師建立的學生',
      email: 'created_by_me@student.lingoleap.local',
      enrolled_at: '2026-10-12T00:00:00Z',
      can_reset_password: true,
    },
    {
      id: 12,
      name: '自行註冊再加入的學生',
      email: 'self_registered@example.com',
      enrolled_at: '2026-10-12T00:00:00Z',
      can_reset_password: false,
    },
  ],
};

const baseProps = {
  classroom,
  token: 'test-token',
  studentIdInput: '',
  setStudentIdInput: vi.fn(),
  isAddingStudent: false,
  addStudentError: '',
  setAddStudentError: vi.fn(),
  onAddStudent: vi.fn(),
  removingStudentId: null,
  onRemoveStudent: vi.fn(),
  setRemovingStudentId: vi.fn(),
  formatDate: (s: string) => s,
  onStudentsImported: vi.fn(),
  isAddStudentsOpen: false,
  onCloseAddStudents: vi.fn(),
  onOpenAddStudents: vi.fn(),
};

describe('StudentListTab — password-teacher gate (#3818)', () => {
  it('shows the 重設密碼 button only for the row whose account this teacher created', () => {
    render(<StudentListTab {...baseProps} />);
    const rows = screen.getAllByRole('row');

    const createdByMeRow = rows.find((r) => r.textContent?.includes('密碼教師建立的學生'))!;
    expect(createdByMeRow).toBeDefined();
    const resetBtnInCreatedRow = createdByMeRow.querySelector('button');
    expect(
      Array.from(createdByMeRow.querySelectorAll('button')).some((b) => b.textContent === '重設密碼'),
    ).toBe(true);
    expect(resetBtnInCreatedRow).not.toBeNull();

    const selfRegisteredRow = rows.find((r) => r.textContent?.includes('自行註冊再加入的學生'))!;
    expect(selfRegisteredRow).toBeDefined();
    expect(
      Array.from(selfRegisteredRow.querySelectorAll('button')).some((b) => b.textContent === '重設密碼'),
    ).toBe(false);
    expect(selfRegisteredRow.textContent).toContain('請學生自己用忘記密碼重設');
  });

  it('a row with can_reset_password omitted (undefined) fails closed -- no button', () => {
    const classroomWithUndefinedFlag: ClassroomDetailResponse = {
      ...classroom,
      students: [
        {
          id: 13,
          name: '未知建立者的學生',
          email: 'legacy@student.lingoleap.local',
          enrolled_at: '2026-10-12T00:00:00Z',
        },
      ],
    };
    render(<StudentListTab {...baseProps} classroom={classroomWithUndefinedFlag} />);
    expect(screen.queryByRole('button', { name: '重設密碼' })).toBeNull();
    expect(screen.getByText('請學生自己用忘記密碼重設')).toBeInTheDocument();
  });
});
