/**
 * #3821: teachers can select multiple students in the roster and remove
 * them from the classroom in one call, with a confirm dialog that states
 * the count before anything is sent.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import StudentListTab from '../StudentListTab';
import type { ClassroomDetailResponse } from '../../../services/classroomApi';

const { batchRemoveStudentsMock } = vi.hoisted(() => ({
  batchRemoveStudentsMock: vi.fn(),
}));

vi.mock('../../../services/classroomApi', async () => {
  const actual = await vi.importActual<typeof import('../../../services/classroomApi')>(
    '../../../services/classroomApi',
  );
  return {
    ...actual,
    resetStudentPassword: vi.fn(),
    batchRemoveStudents: batchRemoveStudentsMock,
  };
});
vi.mock('../../../services/parentApi', () => ({ generateParentInviteCode: vi.fn() }));
vi.mock('../CsvUploadModal', () => ({ default: () => null }));
vi.mock('../../../config/featureFlags', () => ({ PARENT_PORTAL_ENABLED: false }));

const classroom: ClassroomDetailResponse = {
  id: 1,
  name: '測試班',
  school_id: 100,
  teacher_id: 1,
  grade: 4,
  is_active: true,
  created_at: '2026-10-12T00:00:00Z',
  student_count: 3,
  students: [
    { id: 11, name: '王小一', email: 'a1@student.lingoleap.local', enrolled_at: '2026-10-12T00:00:00Z' },
    { id: 12, name: '王小二', email: 'a2@student.lingoleap.local', enrolled_at: '2026-10-12T00:00:00Z' },
    { id: 13, name: '王小三', email: 'a3@student.lingoleap.local', enrolled_at: '2026-10-12T00:00:00Z' },
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

describe('StudentListTab — 批次移除學生 (#3821)', () => {
  beforeEach(() => {
    batchRemoveStudentsMock.mockReset();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows no action bar until a student is checked', () => {
    render(<StudentListTab {...baseProps} />);
    expect(screen.queryByText(/已選取/)).toBeNull();
    expect(screen.queryByRole('button', { name: '移除學生' })).toBeNull();
  });

  it('checking students shows the action bar with the right count', () => {
    render(<StudentListTab {...baseProps} />);
    fireEvent.click(screen.getByRole('checkbox', { name: '選取 王小一' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '選取 王小二' }));
    expect(screen.getByText(/已選取/).textContent).toBe('已選取 2 位學生');
    expect(screen.getByRole('button', { name: '移除學生' })).toBeInTheDocument();
  });

  it('confirm dialog states the exact count before calling the API', async () => {
    batchRemoveStudentsMock.mockResolvedValue({ removed_count: 2, not_found_ids: [] });
    render(<StudentListTab {...baseProps} />);
    fireEvent.click(screen.getByRole('checkbox', { name: '選取 王小一' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '選取 王小二' }));
    fireEvent.click(screen.getByRole('button', { name: '移除學生' }));

    expect(window.confirm).toHaveBeenCalledWith('確定要移除 2 位學生嗎？');
    await waitFor(() =>
      expect(batchRemoveStudentsMock).toHaveBeenCalledWith('test-token', 1, [11, 12]),
    );
  });

  it('cancelling the confirm dialog does not call the API', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<StudentListTab {...baseProps} />);
    fireEvent.click(screen.getByRole('checkbox', { name: '選取 王小一' }));
    fireEvent.click(screen.getByRole('button', { name: '移除學生' }));
    expect(batchRemoveStudentsMock).not.toHaveBeenCalled();
  });

  it('clicking 取消 clears the selection without calling the API', () => {
    render(<StudentListTab {...baseProps} />);
    fireEvent.click(screen.getByRole('checkbox', { name: '選取 王小一' }));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.queryByRole('button', { name: '移除學生' })).toBeNull();
    expect(batchRemoveStudentsMock).not.toHaveBeenCalled();
  });

  it('on success, clears selection and refreshes the roster', async () => {
    batchRemoveStudentsMock.mockResolvedValue({ removed_count: 1, not_found_ids: [] });
    render(<StudentListTab {...baseProps} />);
    fireEvent.click(screen.getByRole('checkbox', { name: '選取 王小一' }));
    fireEvent.click(screen.getByRole('button', { name: '移除學生' }));

    await waitFor(() => expect(baseProps.onStudentsImported).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: '移除學生' })).toBeNull();
  });

  it('shows an error message when the batch call fails, without crashing', async () => {
    batchRemoveStudentsMock.mockRejectedValue(new Error('批次移除失敗了'));
    render(<StudentListTab {...baseProps} />);
    fireEvent.click(screen.getByRole('checkbox', { name: '選取 王小一' }));
    fireEvent.click(screen.getByRole('button', { name: '移除學生' }));

    expect(await screen.findByText('批次移除失敗了')).toBeInTheDocument();
    // selection is preserved on failure so the teacher can retry
    expect(screen.getByRole('button', { name: '移除學生' })).toBeInTheDocument();
  });

  it('全選 checkbox selects every student in the classroom', () => {
    render(<StudentListTab {...baseProps} />);
    fireEvent.click(screen.getByRole('checkbox', { name: '全選' }));
    expect(screen.getByText(/已選取/).textContent).toBe('已選取 3 位學生');
  });

  it('switching to a different classroom clears a stale selection', () => {
    const { rerender } = render(<StudentListTab {...baseProps} />);
    fireEvent.click(screen.getByRole('checkbox', { name: '選取 王小一' }));
    expect(screen.getByText(/已選取/).textContent).toBe('已選取 1 位學生');

    const otherClassroom: ClassroomDetailResponse = {
      ...classroom,
      id: 2,
      name: '另一班',
      students: [
        { id: 21, name: '陳小四', email: 'b1@student.lingoleap.local', enrolled_at: '2026-10-12T00:00:00Z' },
      ],
    };
    rerender(<StudentListTab {...baseProps} classroom={otherClassroom} />);

    // The bar must disappear -- a stale checked id from classroom 1 must not
    // silently carry over into a batch-remove call against classroom 2.
    expect(screen.queryByText(/已選取/)).toBeNull();
    expect(screen.queryByRole('button', { name: '移除學生' })).toBeNull();
  });
});
