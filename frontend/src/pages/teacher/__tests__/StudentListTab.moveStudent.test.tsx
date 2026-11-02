/**
 * #3819: teachers can move a student from this classroom into another of
 * their own classrooms (換班) without the two-step "remove, then re-add by
 * student id" dance that reads as deleting the student.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import StudentListTab from '../StudentListTab';
import type { ClassroomDetailResponse } from '../../../services/classroomApi';

const { listMyClassroomsMock, moveStudentMock } = vi.hoisted(() => ({
  listMyClassroomsMock: vi.fn(),
  moveStudentMock: vi.fn(),
}));

vi.mock('../../../services/classroomApi', async () => {
  const actual = await vi.importActual<typeof import('../../../services/classroomApi')>(
    '../../../services/classroomApi',
  );
  return {
    ...actual,
    resetStudentPassword: vi.fn(),
    listMyClassrooms: listMyClassroomsMock,
    moveStudent: moveStudentMock,
  };
});
vi.mock('../../../services/parentApi', () => ({ generateParentInviteCode: vi.fn() }));
vi.mock('../CsvUploadModal', () => ({ default: () => null }));
vi.mock('../../../config/featureFlags', () => ({ PARENT_PORTAL_ENABLED: false }));

const classroom: ClassroomDetailResponse = {
  id: 1,
  name: '目前班級',
  school_id: 100,
  teacher_id: 1,
  grade: 4,
  is_active: true,
  created_at: '2026-10-12T00:00:00Z',
  student_count: 1,
  students: [
    { id: 11, name: '王小華', email: 'd30sqw1@student.lingoleap.local', enrolled_at: '2026-10-12T00:00:00Z' },
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

describe('StudentListTab — 換班 (#3819)', () => {
  beforeEach(() => {
    listMyClassroomsMock.mockReset();
    moveStudentMock.mockReset();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders a 換班 button for every student row', () => {
    render(<StudentListTab {...baseProps} />);
    expect(screen.getByRole('button', { name: '換班' })).toBeInTheDocument();
  });

  it('lists only the teacher\'s OTHER classrooms in the SAME school', async () => {
    listMyClassroomsMock.mockResolvedValue({
      items: [
        { id: 1, name: '目前班級', school_id: 100, teacher_id: 1, grade: 4, is_active: true, created_at: '', student_count: 1 },
        { id: 2, name: '同校另一班', school_id: 100, teacher_id: 1, grade: 4, is_active: true, created_at: '', student_count: 0 },
        { id: 3, name: '別校的班', school_id: 200, teacher_id: 1, grade: 4, is_active: true, created_at: '', student_count: 0 },
      ],
      total: 3,
    });
    render(<StudentListTab {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: '換班' }));

    await waitFor(() => expect(listMyClassroomsMock).toHaveBeenCalled());
    const select = await screen.findByRole('combobox', { name: '把 王小華 換到哪個班級' });
    const optionTexts = Array.from(select.querySelectorAll('option')).map((o) => o.textContent);
    expect(optionTexts).toContain('同校另一班');
    expect(optionTexts).not.toContain('目前班級'); // current classroom excluded
    expect(optionTexts).not.toContain('別校的班'); // cross-school excluded
  });

  it('shows a message when there is no other classroom to move into', async () => {
    listMyClassroomsMock.mockResolvedValue({
      items: [{ id: 1, name: '目前班級', school_id: 100, teacher_id: 1, grade: 4, is_active: true, created_at: '', student_count: 1 }],
      total: 1,
    });
    render(<StudentListTab {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: '換班' }));
    expect(await screen.findByText('沒有其他可換入的班級')).toBeInTheDocument();
  });

  it('confirms, calls moveStudent with the right ids, and refreshes the list on success', async () => {
    listMyClassroomsMock.mockResolvedValue({
      items: [
        { id: 1, name: '目前班級', school_id: 100, teacher_id: 1, grade: 4, is_active: true, created_at: '', student_count: 1 },
        { id: 2, name: '同校另一班', school_id: 100, teacher_id: 1, grade: 4, is_active: true, created_at: '', student_count: 0 },
      ],
      total: 2,
    });
    moveStudentMock.mockResolvedValue({ student_id: 11, from_classroom_id: 1, to_classroom_id: 2, enrolled_at: '2026-11-02T00:00:00Z' });

    render(<StudentListTab {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: '換班' }));
    const select = await screen.findByRole('combobox', { name: '把 王小華 換到哪個班級' });
    fireEvent.change(select, { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: '確認換班' }));

    await waitFor(() => expect(moveStudentMock).toHaveBeenCalledWith('test-token', 1, 11, 2));
    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(baseProps.onStudentsImported).toHaveBeenCalled());
  });

  it('does nothing if the teacher cancels the confirm dialog', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    listMyClassroomsMock.mockResolvedValue({
      items: [
        { id: 1, name: '目前班級', school_id: 100, teacher_id: 1, grade: 4, is_active: true, created_at: '', student_count: 1 },
        { id: 2, name: '同校另一班', school_id: 100, teacher_id: 1, grade: 4, is_active: true, created_at: '', student_count: 0 },
      ],
      total: 2,
    });

    render(<StudentListTab {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: '換班' }));
    const select = await screen.findByRole('combobox', { name: '把 王小華 換到哪個班級' });
    fireEvent.change(select, { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: '確認換班' }));

    await waitFor(() => expect(window.confirm).toHaveBeenCalled());
    expect(moveStudentMock).not.toHaveBeenCalled();
  });

  it('shows an error message when the move fails, without crashing', async () => {
    listMyClassroomsMock.mockResolvedValue({
      items: [
        { id: 1, name: '目前班級', school_id: 100, teacher_id: 1, grade: 4, is_active: true, created_at: '', student_count: 1 },
        { id: 2, name: '同校另一班', school_id: 100, teacher_id: 1, grade: 4, is_active: true, created_at: '', student_count: 0 },
      ],
      total: 2,
    });
    moveStudentMock.mockRejectedValue(new Error('Student already in destination classroom'));

    render(<StudentListTab {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: '換班' }));
    const select = await screen.findByRole('combobox', { name: '把 王小華 換到哪個班級' });
    fireEvent.change(select, { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: '確認換班' }));

    expect(await screen.findByText('Student already in destination classroom')).toBeInTheDocument();
  });
});
