/**
 * #3826: teachers can inline-edit a student's display name and seat number
 * from the classroom roster -- pencil-icon style (Enter confirms, Esc
 * cancels), without touching the student's login account/username.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import StudentListTab from '../StudentListTab';
import type { ClassroomDetailResponse } from '../../../services/classroomApi';

const { renameStudentMock, setStudentSeatNumberMock } = vi.hoisted(() => ({
  renameStudentMock: vi.fn(),
  setStudentSeatNumberMock: vi.fn(),
}));

vi.mock('../../../services/classroomApi', async () => {
  const actual = await vi.importActual<typeof import('../../../services/classroomApi')>(
    '../../../services/classroomApi',
  );
  return {
    ...actual,
    resetStudentPassword: vi.fn(),
    renameStudent: renameStudentMock,
    setStudentSeatNumber: setStudentSeatNumberMock,
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
  student_count: 2,
  students: [
    { id: 11, name: '王小一', email: 'a1@student.lingoleap.local', enrolled_at: '2026-10-12T00:00:00Z', seat_number: null },
    { id: 12, name: '王小二', email: 'a2@student.lingoleap.local', enrolled_at: '2026-10-12T00:00:00Z', seat_number: 5 },
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

describe('StudentListTab — 改顯示名稱 (#3826)', () => {
  beforeEach(() => {
    renameStudentMock.mockReset();
    setStudentSeatNumberMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('clicking the name pencil icon opens an input prefilled with the current name', () => {
    render(<StudentListTab {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: '編輯 王小一 的顯示名稱' }));
    expect(screen.getByDisplayValue('王小一')).toBeInTheDocument();
  });

  it('Enter confirms the new name and calls the API', async () => {
    renameStudentMock.mockResolvedValue({ id: 11, name: '新名字', email: 'a1@student.lingoleap.local', enrolled_at: '2026-10-12T00:00:00Z', seat_number: null });
    render(<StudentListTab {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: '編輯 王小一 的顯示名稱' }));
    const input = screen.getByDisplayValue('王小一');
    fireEvent.change(input, { target: { value: '新名字' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(renameStudentMock).toHaveBeenCalledWith('test-token', 1, 11, '新名字'));
    await waitFor(() => expect(baseProps.onStudentsImported).toHaveBeenCalled());
  });

  it('Escape cancels without calling the API', () => {
    render(<StudentListTab {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: '編輯 王小一 的顯示名稱' }));
    const input = screen.getByDisplayValue('王小一');
    fireEvent.change(input, { target: { value: '改到一半' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(renameStudentMock).not.toHaveBeenCalled();
    expect(screen.queryByDisplayValue('改到一半')).toBeNull();
    expect(screen.getByText('王小一')).toBeInTheDocument();
  });

  it('shows an inline error and keeps editing open when the API rejects', async () => {
    renameStudentMock.mockRejectedValue(new Error('改名失敗了'));
    render(<StudentListTab {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: '編輯 王小一 的顯示名稱' }));
    const input = screen.getByDisplayValue('王小一');
    fireEvent.change(input, { target: { value: '新名字' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(await screen.findByText('改名失敗了')).toBeInTheDocument();
    expect(screen.getByDisplayValue('新名字')).toBeInTheDocument();
  });
});

describe('StudentListTab — 管理座號 (#3826)', () => {
  beforeEach(() => {
    renameStudentMock.mockReset();
    setStudentSeatNumberMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sorts by seat number (nulls last) and falls back to list position when seat_number is null (#3992)', () => {
    render(<StudentListTab {...baseProps} />);
    // 王小二 has seat_number 5, 王小一 has no seat yet -- the roster is
    // shown in 座號 order (#3992), so 王小二 renders FIRST despite being
    // added to the classroom second. 王小一's fallback display is its own
    // position in that sorted list (2), not its original array index (1).
    // rows[0] is the (CSS-hidden-on-mobile, but still in the DOM) <thead>
    // header row -- jsdom doesn't evaluate the Tailwind `hidden` utility's
    // actual computed style, so it still comes back from getAllByRole.
    const rows = screen.getAllByRole('row');
    expect(within(rows[1]).getByText('王小二')).toBeInTheDocument();
    expect(within(rows[1]).getByText('5')).toBeInTheDocument();
    expect(within(rows[2]).getByText('王小一')).toBeInTheDocument();
    expect(within(rows[2]).getByText('2')).toBeInTheDocument();
  });

  it('clicking the seat pencil icon opens a number input', () => {
    render(<StudentListTab {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: '編輯 王小一 的座號' }));
    expect(screen.getByLabelText('王小一 座號輸入框')).toBeInTheDocument();
  });

  it('Enter confirms a new seat number and calls the API', async () => {
    setStudentSeatNumberMock.mockResolvedValue({ id: 11, name: '王小一', email: 'a1@student.lingoleap.local', enrolled_at: '2026-10-12T00:00:00Z', seat_number: 3 });
    render(<StudentListTab {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: '編輯 王小一 的座號' }));
    const input = screen.getByLabelText('王小一 座號輸入框');
    fireEvent.change(input, { target: { value: '3' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(setStudentSeatNumberMock).toHaveBeenCalledWith('test-token', 1, 11, 3));
    await waitFor(() => expect(baseProps.onStudentsImported).toHaveBeenCalled());
  });

  it('clearing the seat input and confirming sends null', async () => {
    setStudentSeatNumberMock.mockResolvedValue({ id: 12, name: '王小二', email: 'a2@student.lingoleap.local', enrolled_at: '2026-10-12T00:00:00Z', seat_number: null });
    render(<StudentListTab {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: '編輯 王小二 的座號' }));
    const input = screen.getByLabelText('王小二 座號輸入框');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(setStudentSeatNumberMock).toHaveBeenCalledWith('test-token', 1, 12, null));
  });

  it('shows a duplicate-seat inline error (409) without clearing the input', async () => {
    setStudentSeatNumberMock.mockRejectedValue(new Error('這個座號已經有人用了'));
    render(<StudentListTab {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: '編輯 王小一 的座號' }));
    const input = screen.getByLabelText('王小一 座號輸入框');
    fireEvent.change(input, { target: { value: '5' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(await screen.findByText('這個座號已經有人用了')).toBeInTheDocument();
    expect(screen.getByLabelText('王小一 座號輸入框')).toHaveValue(5);
  });

  it('Escape cancels seat editing without calling the API', () => {
    render(<StudentListTab {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: '編輯 王小二 的座號' }));
    const input = screen.getByLabelText('王小二 座號輸入框');
    fireEvent.change(input, { target: { value: '9' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(setStudentSeatNumberMock).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('王小二 座號輸入框')).toBeNull();
    expect(screen.getByText('5')).toBeInTheDocument();
  });
});
