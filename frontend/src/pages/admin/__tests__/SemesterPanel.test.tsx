/**
 * SemesterPanel refactor characterization tests (Issue #1959)
 *
 * TDD contract:
 *  1. SemesterList renders list of semesters with correct names and active badge
 *  2. SemesterCreateForm submit calls createSemester with correct payload and reloads
 *  3. Modal (create form) opens on button click and closes on cancel
 *  4. Edit inline form: start edit → save → reload; cancel closes form
 *  5. Activate button calls activateSemester and reloads
 *
 * Tests are written against the public behaviour observable from SemesterPanel's
 * rendered output — agnostic to internal decomposition.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import React from 'react';

// --- Module mocks -----------------------------------------------------------

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: 'test-token' }),
}));

const mockListSemesters = vi.fn();
const mockCreateSemester = vi.fn();
const mockUpdateSemester = vi.fn();
const mockActivateSemester = vi.fn();

vi.mock('../../../services/semesterApi', () => ({
  listSemesters: (...args: unknown[]) => mockListSemesters(...args),
  createSemester: (...args: unknown[]) => mockCreateSemester(...args),
  updateSemester: (...args: unknown[]) => mockUpdateSemester(...args),
  activateSemester: (...args: unknown[]) => mockActivateSemester(...args),
  SemesterApiError: class SemesterApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.name = 'SemesterApiError';
      this.status = status;
    }
  },
}));

// --- Fixture data -----------------------------------------------------------

const SEMESTER_ACTIVE = {
  id: 1,
  school_id: 10,
  name: '113學年度上學期',
  start_date: '2024-09-01',
  end_date: '2025-01-31',
  grace_days: 7,
  is_active: true,
  expires_at_date: '2025-02-07',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
};

const SEMESTER_INACTIVE = {
  id: 2,
  school_id: 10,
  name: '112學年度下學期',
  start_date: '2024-02-01',
  end_date: '2024-06-30',
  grace_days: 14,
  is_active: false,
  expires_at_date: '2024-07-14',
  created_at: '2023-08-01T00:00:00Z',
  updated_at: '2023-08-01T00:00:00Z',
};

// --- Lazy import (after mocks) ---------------------------------------------

let SemesterPanel: React.ComponentType<{ schoolId: number }>;

beforeEach(async () => {
  vi.clearAllMocks();
  mockListSemesters.mockResolvedValue([SEMESTER_ACTIVE, SEMESTER_INACTIVE]);
  mockCreateSemester.mockResolvedValue({ ...SEMESTER_ACTIVE, id: 3 });
  mockUpdateSemester.mockResolvedValue({ ...SEMESTER_ACTIVE });
  mockActivateSemester.mockResolvedValue({ ...SEMESTER_INACTIVE, is_active: true });

  // Dynamic import so mocks are applied before module init
  const mod = await import('../SemesterPanel');
  SemesterPanel = mod.default;
});

// ---------------------------------------------------------------------------
// 1. List render
// ---------------------------------------------------------------------------

describe('SemesterList — list render', () => {
  it('renders semester names after load', async () => {
    render(<SemesterPanel schoolId={10} />);

    await waitFor(() => {
      expect(screen.getByText('113學年度上學期')).toBeInTheDocument();
      expect(screen.getByText('112學年度下學期')).toBeInTheDocument();
    });
  });

  it('shows "目前學期" badge only on active semester', async () => {
    render(<SemesterPanel schoolId={10} />);

    await waitFor(() => screen.getByText('113學年度上學期'));

    const badges = screen.getAllByText('目前學期');
    expect(badges).toHaveLength(1);
  });

  it('shows "設為目前學期" button only for inactive semesters', async () => {
    render(<SemesterPanel schoolId={10} />);

    await waitFor(() => screen.getByText('112學年度下學期'));

    const activateBtns = screen.getAllByText('設為目前學期');
    expect(activateBtns).toHaveLength(1);
  });

  it('shows empty state when no semesters', async () => {
    mockListSemesters.mockResolvedValue([]);
    render(<SemesterPanel schoolId={10} />);

    await waitFor(() => {
      expect(screen.getByText('尚無學期設定')).toBeInTheDocument();
    });
  });

  it('shows error when load fails', async () => {
    const { SemesterApiError } = await import('../../../services/semesterApi');
    mockListSemesters.mockRejectedValue(new SemesterApiError('Server error', 500));
    render(<SemesterPanel schoolId={10} />);

    await waitFor(() => {
      expect(screen.getByText('Server error')).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// 2. Create form — modal open/close
// ---------------------------------------------------------------------------

describe('SemesterCreateForm — modal open/close', () => {
  it('create form is hidden initially', async () => {
    render(<SemesterPanel schoolId={10} />);

    await waitFor(() => screen.getByText('113學年度上學期'));

    expect(screen.queryByText('新增學期', { selector: 'h3' })).not.toBeInTheDocument();
  });

  it('clicking "新增學期" button shows the create form', async () => {
    render(<SemesterPanel schoolId={10} />);

    await waitFor(() => screen.getByText('113學年度上學期'));

    const addBtn = screen.getByRole('button', { name: /新增學期/ });
    fireEvent.click(addBtn);

    expect(screen.getByText('新增學期', { selector: 'h3' })).toBeInTheDocument();
  });

  it('clicking cancel closes the create form', async () => {
    render(<SemesterPanel schoolId={10} />);

    await waitFor(() => screen.getByText('113學年度上學期'));

    fireEvent.click(screen.getByRole('button', { name: /新增學期/ }));
    expect(screen.getByText('新增學期', { selector: 'h3' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.queryByText('新增學期', { selector: 'h3' })).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 3. Create form — submission
// ---------------------------------------------------------------------------

describe('SemesterCreateForm — form submit', () => {
  it('calls createSemester with correct payload and reloads list', async () => {
    // Second call (after create) returns updated list
    mockListSemesters
      .mockResolvedValueOnce([SEMESTER_ACTIVE, SEMESTER_INACTIVE])
      .mockResolvedValueOnce([SEMESTER_ACTIVE, SEMESTER_INACTIVE, { ...SEMESTER_ACTIVE, id: 3, name: '新學期', is_active: false }]);

    render(<SemesterPanel schoolId={10} />);

    await waitFor(() => screen.getByText('113學年度上學期'));

    // Open form
    fireEvent.click(screen.getByRole('button', { name: /新增學期/ }));

    // Fill form
    const nameInput = screen.getByPlaceholderText('例：113學年度上學期');
    const [startInput, endInput] = screen.getAllByDisplayValue('').filter(
      (el): el is HTMLInputElement => el instanceof HTMLInputElement && el.type === 'date'
    );
    fireEvent.change(nameInput, { target: { value: '新學期' } });
    fireEvent.change(startInput, { target: { value: '2025-09-01' } });
    fireEvent.change(endInput, { target: { value: '2026-01-31' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '建立' }));
    });

    await waitFor(() => {
      expect(mockCreateSemester).toHaveBeenCalledWith(
        'test-token',
        10,
        expect.objectContaining({
          name: '新學期',
          start_date: '2025-09-01',
          end_date: '2026-01-31',
        })
      );
    });

    // After create, list reloaded (listSemesters called twice)
    expect(mockListSemesters).toHaveBeenCalledTimes(2);
  });

  it('shows validation error when name is empty', async () => {
    render(<SemesterPanel schoolId={10} />);

    await waitFor(() => screen.getByText('113學年度上學期'));

    fireEvent.click(screen.getByRole('button', { name: /新增學期/ }));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '建立' }));
    });

    expect(screen.getByText('請輸入學期名稱')).toBeInTheDocument();
    expect(mockCreateSemester).not.toHaveBeenCalled();
  });

  it('shows validation error when end_date <= start_date', async () => {
    render(<SemesterPanel schoolId={10} />);

    await waitFor(() => screen.getByText('113學年度上學期'));

    fireEvent.click(screen.getByRole('button', { name: /新增學期/ }));

    const nameInput = screen.getByPlaceholderText('例：113學年度上學期');
    const dateInputs = screen.getAllByDisplayValue('').filter(
      (el): el is HTMLInputElement => el instanceof HTMLInputElement && el.type === 'date'
    );
    fireEvent.change(nameInput, { target: { value: '測試學期' } });
    fireEvent.change(dateInputs[0], { target: { value: '2025-09-01' } });
    fireEvent.change(dateInputs[1], { target: { value: '2025-01-01' } }); // end before start

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '建立' }));
    });

    expect(screen.getByText('結束日期必須晚於開始日期')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 4. Edit inline form
// ---------------------------------------------------------------------------

describe('SemesterList — edit inline', () => {
  it('clicking edit icon shows inline edit form for that semester', async () => {
    render(<SemesterPanel schoolId={10} />);

    await waitFor(() => screen.getByText('113學年度上學期'));

    // There should be edit buttons (one per semester)
    const editBtns = screen.getAllByTitle('編輯');
    expect(editBtns.length).toBeGreaterThanOrEqual(1);

    fireEvent.click(editBtns[0]);

    // Edit form shows 儲存 button
    expect(screen.getByRole('button', { name: '儲存' })).toBeInTheDocument();
  });

  it('cancel edit closes the inline form', async () => {
    render(<SemesterPanel schoolId={10} />);

    await waitFor(() => screen.getByText('113學年度上學期'));

    const editBtns = screen.getAllByTitle('編輯');
    fireEvent.click(editBtns[0]);

    expect(screen.getByRole('button', { name: '儲存' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    expect(screen.queryByRole('button', { name: '儲存' })).not.toBeInTheDocument();
  });

  it('save edit calls updateSemester and reloads', async () => {
    mockListSemesters
      .mockResolvedValueOnce([SEMESTER_ACTIVE, SEMESTER_INACTIVE])
      .mockResolvedValueOnce([{ ...SEMESTER_ACTIVE, name: '113學年度上學期（已更新）' }, SEMESTER_INACTIVE]);

    render(<SemesterPanel schoolId={10} />);

    await waitFor(() => screen.getByText('113學年度上學期'));

    const editBtns = screen.getAllByTitle('編輯');
    fireEvent.click(editBtns[0]);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '儲存' }));
    });

    await waitFor(() => {
      expect(mockUpdateSemester).toHaveBeenCalledWith(
        'test-token',
        10,
        SEMESTER_ACTIVE.id,
        expect.objectContaining({ name: '113學年度上學期' })
      );
    });

    expect(mockListSemesters).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// 5. Activate
// ---------------------------------------------------------------------------

describe('activate semester', () => {
  it('clicking "設為目前學期" calls activateSemester and reloads', async () => {
    mockListSemesters
      .mockResolvedValueOnce([SEMESTER_ACTIVE, SEMESTER_INACTIVE])
      .mockResolvedValueOnce([
        { ...SEMESTER_ACTIVE, is_active: false },
        { ...SEMESTER_INACTIVE, is_active: true },
      ]);

    render(<SemesterPanel schoolId={10} />);

    await waitFor(() => screen.getByText('設為目前學期'));

    await act(async () => {
      fireEvent.click(screen.getByText('設為目前學期'));
    });

    await waitFor(() => {
      expect(mockActivateSemester).toHaveBeenCalledWith('test-token', 10, SEMESTER_INACTIVE.id);
    });

    expect(mockListSemesters).toHaveBeenCalledTimes(2);
  });
});
